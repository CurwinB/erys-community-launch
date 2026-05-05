/**
 * Rewrite legacy `launches.ipfs_metadata_url` rows to use the dedicated
 * Pinata gateway (PINATA_GATEWAY_DOMAIN). Covers:
 *   - https://*.pinata.cloud/ipfs/<cid>     (shared free-tier gateway)
 *   - https://ipfs.io/ipfs/<cid>            (rate-limits / 504s on egress)
 *   - ipfs://<cid>
 *
 * USAGE:
 *   cd executor
 *   ADMIN_TEST_TOKEN=<token> npx ts-node scripts/rewriteLegacyMetadataUrls.ts          # dry-run
 *   ADMIN_TEST_TOKEN=<token> npx ts-node scripts/rewriteLegacyMetadataUrls.ts --apply  # write
 */

import * as dotenv from "dotenv";
dotenv.config();

const TAG = "[REWRITE_METADATA_URL]";
const log = (m: string, ...r: any[]) => console.log(`${TAG} ${m}`, ...r);
const err = (m: string, ...r: any[]) => console.error(`${TAG} ${m}`, ...r);

function gate(): void {
  const token = process.env.ADMIN_TEST_TOKEN;
  if (!token || token.trim().length === 0) {
    err("ADMIN_TEST_TOKEN is not set. Refusing to run.");
    process.exit(1);
  }
  const expected = process.env.ADMIN_TEST_TOKEN_EXPECTED;
  if (expected && token !== expected) {
    err("ADMIN_TEST_TOKEN does not match expected value. Aborting.");
    process.exit(1);
  }
}
gate();

const apply = process.argv.includes("--apply");
log(apply ? "MODE: --apply (writes will occur)" : "MODE: dry-run");

const GATEWAY = (process.env.PINATA_GATEWAY_DOMAIN ?? "")
  .trim()
  .replace(/^https?:\/\//, "")
  .replace(/\/.*$/, "");
if (!GATEWAY) {
  err("PINATA_GATEWAY_DOMAIN is not set in env. Refusing to rewrite without a target gateway.");
  process.exit(1);
}
const target = (cid: string) => `https://${GATEWAY}/ipfs/${cid}`;

function rewrite(url: string | null): string | null {
  if (!url) return url;
  // Already on the dedicated gateway — leave alone.
  if (url.startsWith(`https://${GATEWAY}/ipfs/`)) return url;
  const pinata = url.match(/^https?:\/\/[^/]*pinata[^/]*\/ipfs\/(.+)$/i);
  if (pinata) return target(pinata[1]);
  const ipfsIo = url.match(/^https?:\/\/[^/]*ipfs\.io\/ipfs\/(.+)$/i);
  if (ipfsIo) return target(ipfsIo[1]);
  const cf = url.match(/^https?:\/\/[^/]*cloudflare-ipfs[^/]*\/ipfs\/(.+)$/i);
  if (cf) return target(cf[1]);
  const ipfsProto = url.match(/^ipfs:\/\/(.+)$/i);
  if (ipfsProto) return target(ipfsProto[1]);
  return url;
}

async function main(): Promise<void> {
  const { supabase } = await import("../src/db");
  const { data, error } = await supabase
    .from("launches")
    .select("id, status, ipfs_metadata_url")
    .or(
      "ipfs_metadata_url.ilike.%pinata.cloud%,ipfs_metadata_url.ilike.%ipfs.io%,ipfs_metadata_url.ilike.%cloudflare-ipfs%,ipfs_metadata_url.ilike.ipfs://%"
    );
  if (error) {
    err(`Query failed: ${error.message}`);
    process.exit(1);
  }
  if (!data || data.length === 0) {
    log("No legacy public-gateway metadata URLs found. Nothing to do.");
    return;
  }
  log(`Found ${data.length} launch row(s) with legacy URLs.`);
  let updated = 0;
  for (const row of data) {
    const next = rewrite(row.ipfs_metadata_url);
    if (!next || next === row.ipfs_metadata_url) {
      log(`SKIP ${row.id} (status=${row.status}) — no rewrite produced`);
      continue;
    }
    log(`${apply ? "WRITE" : "WOULD WRITE"} ${row.id} (status=${row.status})`);
    log(`  from: ${row.ipfs_metadata_url}`);
    log(`    to: ${next}`);
    if (apply) {
      const { error: upErr } = await supabase
        .from("launches")
        .update({ ipfs_metadata_url: next })
        .eq("id", row.id);
      if (upErr) {
        err(`  failed to update ${row.id}: ${upErr.message}`);
      } else {
        updated++;
      }
    }
  }
  log(`Done. ${apply ? `Updated ${updated} row(s).` : "Dry-run only — re-run with --apply to write."}`);
}

main().catch((e) => {
  err("Unhandled error:", e?.message ?? e);
  process.exit(1);
});
