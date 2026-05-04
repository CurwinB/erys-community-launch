/**
 * One-off recovery script.
 *
 * Re-uploads the metadata JSON for failed Pump.fun launches via pump.fun's
 * canonical /api/ipfs endpoint (with browser headers to bypass Cloudflare),
 * then patches `launches.ipfs_metadata_url` to the returned `metadataUri`.
 *
 * After this runs, the launches can be retried from the admin retry-failed
 * flow and PumpPortal /trade-local will be able to read the metadata.
 *
 * USAGE:
 *   cd executor
 *   npx ts-node scripts/repairFailedMetadata.ts <launch_id> [<launch_id>...]
 *   # or with no args, repairs all execution_failed pumpfun launches
 */

import * as dotenv from "dotenv";
dotenv.config();

import fetch from "node-fetch";
// @ts-ignore — node-fetch v2 ships its own FormData
import FormDataNode from "form-data";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Origin: "https://pump.fun",
  Referer: "https://pump.fun/create",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

async function repair(supabase: any, launchId: string) {
  const { data: launch, error } = await supabase
    .from("launches")
    .select("*")
    .eq("id", launchId)
    .single();
  if (error || !launch) {
    console.error(`[${launchId}] not found: ${error?.message}`);
    return;
  }
  console.log(`[${launchId}] ${launch.token_name} (${launch.token_symbol})`);

  // Fetch existing metadata to recover image url + socials
  let existingMeta: any = {};
  try {
    const r = await fetch(launch.ipfs_metadata_url);
    if (r.ok) existingMeta = await r.json();
  } catch {}

  const imageUrl: string | undefined =
    existingMeta.image || launch.image_url || undefined;
  if (!imageUrl) {
    console.error(`[${launchId}] no image URL recoverable; skipping`);
    return;
  }

  // Pull image bytes
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) {
    console.error(`[${launchId}] image fetch ${imgRes.status}; skipping`);
    return;
  }
  const imgBuf = Buffer.from(await imgRes.arrayBuffer());
  const ct = imgRes.headers.get("content-type") || "image/png";
  const ext = ct.split("/")[1]?.split(";")[0] || "png";

  const form = new FormDataNode();
  form.append("file", imgBuf, { filename: `image.${ext}`, contentType: ct });
  form.append("name", (launch.token_name ?? "").trim());
  form.append("symbol", (launch.token_symbol ?? "").trim().toUpperCase());
  form.append("description", launch.description ?? "");
  if (launch.twitter_url) form.append("twitter", launch.twitter_url);
  if (launch.telegram_url) form.append("telegram", launch.telegram_url);
  if (launch.website_url) form.append("website", launch.website_url);
  form.append("showName", "true");

  let pumpUri: string | undefined;
  for (let attempt = 1; attempt <= 3 && !pumpUri; attempt++) {
    try {
      const r = await fetch("https://pump.fun/api/ipfs", {
        method: "POST",
        headers: { ...BROWSER_HEADERS, ...form.getHeaders() },
        body: form as any,
      });
      if (r.ok) {
        const j: any = await r.json();
        if (j?.metadataUri) {
          pumpUri = j.metadataUri as string;
          break;
        }
        console.warn(`[${launchId}] attempt ${attempt}: 200 but no metadataUri`);
      } else {
        console.warn(`[${launchId}] attempt ${attempt}: ${r.status}`);
      }
    } catch (e: any) {
      console.warn(`[${launchId}] attempt ${attempt} threw: ${e?.message ?? e}`);
    }
    if (!pumpUri) await new Promise((r) => setTimeout(r, 2_000 * attempt));
  }

  if (!pumpUri) {
    console.error(`[${launchId}] FAILED to upload to pump.fun`);
    return;
  }

  const { error: updErr } = await supabase
    .from("launches")
    .update({ ipfs_metadata_url: pumpUri, execution_error: null })
    .eq("id", launchId);
  if (updErr) {
    console.error(`[${launchId}] DB update failed: ${updErr.message}`);
    return;
  }
  console.log(`[${launchId}] ✓ patched to ${pumpUri}`);
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const args = process.argv.slice(2);
  let ids: string[] = args;
  if (ids.length === 0) {
    const { data } = await supabase
      .from("launches")
      .select("id")
      .eq("platform", "pumpfun")
      .eq("status", "execution_failed");
    ids = (data ?? []).map((r: any) => r.id);
  }
  console.log(`Repairing ${ids.length} launch(es)`);
  for (const id of ids) await repair(supabase, id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});