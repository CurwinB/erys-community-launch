import * as dotenv from "dotenv";
dotenv.config();

import { executeAllPendingLaunches } from "./executeLaunch";
import { fundAllPendingSponsoredEscrows } from "./fundSponsoredEscrow";
import { sweepAllCancelledSponsorEscrows } from "./sweepCancelledSponsorEscrows";
import { refundOrphanContributions } from "./refundOrphanContributions";
import { getAllWallets, warmWalletPool } from "./pumpportalWalletPool";
import { supabase } from "./db";

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "30000");

// Unique worker identifier — falls back to Railway's per-replica env var so
// horizontal scaling needs no per-instance env config.
const WORKER_ID =
  process.env.WORKER_ID || process.env.RAILWAY_REPLICA_ID || "worker-default";

function validateEnv(): void {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SOLANA_RPC_URL",
    "SOLANA_WSS_URL",
    "ESCROW_ENCRYPTION_KEY",
    "BAGS_API_KEY",
    "BAGS_PARTNER_WALLET",
    "BAGS_PARTNER_CONFIG",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

async function main(): Promise<void> {
  console.log("Erys Executor starting...");

  try {
    validateEnv();
  } catch (err: any) {
    console.error("Environment validation failed:", err.message);
    process.exit(1);
  }

  console.log(`Polling every ${POLL_INTERVAL_MS}ms for executing launches`);
  console.log(`Worker ID: ${WORKER_ID}`);
  console.log(`Connected to Supabase: ${process.env.SUPABASE_URL}`);
  console.log(
    `Using RPC: ${process.env.SOLANA_RPC_URL?.split("/v2/")[0]}/v2/***`
  );
  console.log(
    `SOLANA_WSS_URL override set: ${process.env.SOLANA_WSS_URL ? "yes" : "no (derived from SOLANA_RPC_URL)"}`
  );

  // Auto-seed the legacy Railway env wallet into lightning_wallets if it
  // isn't already there. Idempotent — runs once per cold boot.
  await seedLightningWalletFromEnv();

  // Warm the hybrid (DB + env) wallet pool before publishing capacity.
  await warmWalletPool();

  // Pump.fun scheduling capacity is now a fixed constant in
  // supabase/functions/_shared/scheduleCapacity.ts. Per-launch Lightning
  // wallets removed the shared-wallet bottleneck, so we no longer publish
  // pumpportal_wallet_pool_size from here.

  const tick = async () => {
    await fundAllPendingSponsoredEscrows(WORKER_ID);
    await sweepAllCancelledSponsorEscrows(WORKER_ID);
    await refundOrphanContributions();
    await executeAllPendingLaunches(WORKER_ID);
  };

  await tick();
  setInterval(tick, POLL_INTERVAL_MS);

  process.on("SIGTERM", () => {
    console.log("SIGTERM received. Shutting down...");
    process.exit(0);
  });

  process.on("SIGINT", () => {
    console.log("SIGINT received. Shutting down...");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

async function seedLightningWalletFromEnv(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  if (!url) return;
  const fnUrl = `${url.replace(/\/$/, "")}/functions/v1/seed-lightning-wallet-from-env`;
  try {
    const res = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
      },
      body: "{}",
    });
    const json: any = await res.json().catch(() => ({}));
    if (json?.seeded) {
      console.log(
        `[lightning-wallets] Seeded env wallet at slot ${json.slot} (${json.pubkey})`,
      );
    } else if (json?.alreadyPresent) {
      console.log(`[lightning-wallets] Env wallet already in DB at slot ${json.slot}`);
    } else {
      console.log(`[lightning-wallets] Seed result: ${JSON.stringify(json)}`);
    }
  } catch (err: any) {
    console.warn(`[lightning-wallets] Seed call failed (non-fatal): ${err?.message ?? err}`);
  }
}