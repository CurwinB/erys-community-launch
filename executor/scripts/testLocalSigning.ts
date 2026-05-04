/**
 * Admin-only test harness for the local-signing Pump.fun launch path.
 *
 * Bypasses USE_LOCAL_SIGNING entirely — invokes launchWithLocalSigning
 * directly. Does NOT touch the polling worker. Does NOT claim launches
 * via claim_executing_launch_for_worker.
 *
 * USAGE:
 *   cd executor
 *   ADMIN_TEST_TOKEN=<token> npx ts-node scripts/testLocalSigning.ts <launch-id> [--dry-run]
 *
 * --dry-run: load keypairs, fetch /trade-local, sign locally, but do NOT
 *            submit to RPC and do NOT mutate any DB rows.
 *
 * Gate order:
 *   1. dotenv.config()
 *   2. ADMIN_TEST_TOKEN check  ← FIRST. Missing/invalid → exit(1) before
 *      any Supabase client construction or DB read.
 *   3. Parse CLI args.
 *   4. Construct Supabase client, fetch launch + contributions.
 *   5. Safety checks (status must be 'executing' or --dry-run).
 *   6. Invoke launchWithLocalSigning.
 */

import * as dotenv from "dotenv";
dotenv.config();

const TAG = "[LOCAL_SIGNING][TEST]";
const log = (msg: string, ...rest: any[]) => console.log(`${TAG} ${msg}`, ...rest);
const err = (msg: string, ...rest: any[]) => console.error(`${TAG} ${msg}`, ...rest);

// ---- STEP 1+2: ADMIN_TEST_TOKEN gate FIRST. No DB, no network, no imports
// of anything that would lazily connect to Supabase. ----
function gate(): void {
  const token = process.env.ADMIN_TEST_TOKEN;
  if (!token || token.trim().length === 0) {
    err(
      "ADMIN_TEST_TOKEN is not set. Refusing to run. Aborting before any DB or RPC activity."
    );
    process.exit(1);
  }
  // If you want a fixed expected value, set ADMIN_TEST_TOKEN_EXPECTED in
  // Railway and check equality. Otherwise any non-empty value passes — the
  // mere presence of the secret is the gate.
  const expected = process.env.ADMIN_TEST_TOKEN_EXPECTED;
  if (expected && token !== expected) {
    err("ADMIN_TEST_TOKEN does not match expected value. Aborting.");
    process.exit(1);
  }
  log("ADMIN_TEST_TOKEN check passed.");
}

gate();

// ---- STEP 3: parse args ----
function parseArgs(): { launchId: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  if (positional.length < 1) {
    err("Usage: testLocalSigning.ts <launch-id> [--dry-run]");
    process.exit(1);
  }
  return { launchId: positional[0], dryRun };
}

const { launchId, dryRun } = parseArgs();
log(`Target launch: ${launchId}${dryRun ? " (DRY-RUN)" : ""}`);

// ---- STEP 4+: import only AFTER the gate has passed ----
async function main(): Promise<void> {
  const { supabase } = await import("../src/db");
  const { launchWithLocalSigning } = await import("../src/launchWithLocalSigning");

  log("Fetching launch row...");
  const { data: launch, error: launchErr } = await supabase
    .from("launches")
    .select("*")
    .eq("id", launchId)
    .single();
  if (launchErr || !launch) {
    err(`Failed to fetch launch ${launchId}: ${launchErr?.message ?? "not found"}`);
    process.exit(1);
  }

  if (launch.platform !== "pumpfun") {
    err(`Launch ${launchId} is platform=${launch.platform}, not pumpfun. Aborting.`);
    process.exit(1);
  }

  // Safety: refuse to run on a non-executing launch unless dry-run.
  if (!dryRun && launch.status !== "executing") {
    err(
      `Launch status is '${launch.status}', not 'executing'. Refusing to run without --dry-run.`
    );
    process.exit(1);
  }

  log("Fetching contributions...");
  const { data: contributions, error: contribErr } = await supabase
    .from("contributions")
    .select("*")
    .eq("launch_id", launchId);
  if (contribErr) {
    err(`Failed to fetch contributions: ${contribErr.message}`);
    process.exit(1);
  }
  if (!contributions || contributions.length === 0) {
    err("No contributions found for launch. Aborting.");
    process.exit(1);
  }
  log(`Loaded ${contributions.length} contribution(s).`);

  log("Invoking launchWithLocalSigning...");
  await launchWithLocalSigning(launch as any, contributions as any, { dryRun });
  log("Done.");
}

main().catch((e) => {
  err("Unhandled error:", e?.message ?? e);
  process.exit(1);
});
