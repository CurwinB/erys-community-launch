import * as dotenv from "dotenv";
dotenv.config();

import { getPendingDistributions } from "./db";
import { distributeTokensForLaunch } from "./distribute";
import { claimAllPumpfunFees } from "./claimPumpfunFees";

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "30000");

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

const processing = new Set<string>();

async function pollAndDistribute(): Promise<void> {
  try {
    const launches = await getPendingDistributions();
    if (launches.length === 0) return;

    console.log(`Found ${launches.length} launches needing distribution`);

    for (const launch of launches) {
      if (processing.has(launch.id)) {
        console.log(`Launch ${launch.id} already being processed, skipping`);
        continue;
      }
      processing.add(launch.id);
      distributeTokensForLaunch(launch)
        .catch((err) => console.error(`Unhandled error distributing launch ${launch.id}:`, err))
        .finally(() => processing.delete(launch.id));
    }
  } catch (err) {
    console.error("Error in poll loop:", err);
  }
}

async function main(): Promise<void> {
  console.log("Erys Distributor starting...");

  try {
    validateEnv();
  } catch (err: any) {
    console.error("Environment validation failed:", err.message);
    process.exit(1);
  }

  console.log(`Polling every ${POLL_INTERVAL_MS}ms for pending distributions`);
  console.log(`Connected to Supabase: ${process.env.SUPABASE_URL}`);
  console.log(`Using RPC: ${process.env.SOLANA_RPC_URL?.split("/v2/")[0]}/v2/***`);

  await pollAndDistribute();
  setInterval(pollAndDistribute, POLL_INTERVAL_MS);

  // Pump.fun creator fee claiming runs every 6 hours
  // But individual launches are only claimed if 24 hours have passed since last claim
  const PUMPFUN_CLAIM_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

  console.log("Pump.fun fee claiming enabled. Checking every 6 hours.");

  // Run immediately on startup then on interval
  await claimAllPumpfunFees();
  setInterval(claimAllPumpfunFees, PUMPFUN_CLAIM_INTERVAL_MS);

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
