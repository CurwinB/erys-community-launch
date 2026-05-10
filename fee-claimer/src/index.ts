import * as dotenv from "dotenv";
dotenv.config();

import { harvestPerLaunchFees } from "./harvestPerLaunchFees";
import { warmWalletPool } from "./pumpportalWalletPool";

// Pump.fun creator fee claiming runs every 10 minutes. Per-launch and
// per-vault throttles are also 10 minutes — shorter ticks would just no-op.
const PUMPFUN_CLAIM_INTERVAL_MS = 10 * 60 * 1000;

const WORKER_ID =
  process.env.WORKER_ID || process.env.RAILWAY_REPLICA_ID || "fee-claimer-default";

function validateEnv(): void {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SOLANA_RPC_URL",
    "ESCROW_ENCRYPTION_KEY",
    "BAGS_PARTNER_WALLET",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

async function pollAndClaimFees(): Promise<void> {
  try {
    // NOTE: legacy batch sweeps (claimPumpfunFeesBatch / claimLocalSigningFeesBatch)
    // are intentionally disabled. They sweep 100% of the creator vault to the
    // treasury and pre-drain it before the per-launch 70/30 harvester can run.
    // Only the per-launch Lightning wallet harvest path runs now — splits 70/30
    // between the launch creator and the treasury.
    await harvestPerLaunchFees();
  } catch (err: any) {
    console.error("Error in pollAndClaimFees:", err.message);
  }
}

async function main(): Promise<void> {
  console.log("Erys Fee-Claimer starting...");

  try {
    validateEnv();
  } catch (err: any) {
    console.error("Environment validation failed:", err.message);
    process.exit(1);
  }

  console.log(`Worker ID: ${WORKER_ID}`);
  console.log(
    `Polling every ${PUMPFUN_CLAIM_INTERVAL_MS / 60_000} minutes for fee claims`,
  );
  console.log(`Connected to Supabase: ${process.env.SUPABASE_URL}`);
  console.log(`Using RPC: ${process.env.SOLANA_RPC_URL?.split("/v2/")[0]}/v2/***`);

  // Warm the hybrid (DB + env) PumpPortal wallet pool before first tick.
  // Used by the batched custodial-claim path. The local-signing and
  // per-launch harvest paths don't need it but warming is cheap.
  await warmWalletPool();

  // Run immediately on startup then on interval.
  await pollAndClaimFees();
  setInterval(pollAndClaimFees, PUMPFUN_CLAIM_INTERVAL_MS);

  process.on("SIGTERM", () => {
    console.log("SIGTERM received. Shutting down gracefully...");
    process.exit(0);
  });

  process.on("SIGINT", () => {
    console.log("SIGINT received. Shutting down gracefully...");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});