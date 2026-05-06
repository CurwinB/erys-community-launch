import * as dotenv from "dotenv";
dotenv.config();

import {
  claimNextDistribution,
  releaseLaunchLock,
  resetStaleExecutingLaunches,
} from "./db";
import { distributeTokensForLaunch } from "./distribute";

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "30000");

// Unique worker identifier. Falls back to Railway's per-replica env var so we
// can horizontally scale by simply bumping replica count — no per-instance
// env config required.
const WORKER_ID =
  process.env.WORKER_ID || process.env.RAILWAY_REPLICA_ID || "worker-default";

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

async function pollAndDistribute(): Promise<void> {
  try {
    await resetStaleExecutingLaunches();

    // Atomically claim launches one at a time. SKIP LOCKED guarantees no two
    // replicas pick up the same row. Loop until this worker can't claim more.
    while (true) {
      const launch = await claimNextDistribution(WORKER_ID);
      if (!launch) break;

      console.log(`Worker ${WORKER_ID} claimed launch ${launch.id} for distribution`);
      // Fire-and-forget — distributeTokensForLaunch releases its own lock in
      // a finally block. Running in background lets us immediately try to
      // claim another launch without waiting for this one to finish.
      distributeTokensForLaunch(launch).catch((err) =>
        console.error(`Unhandled error distributing launch ${launch.id}:`, err)
      );
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

  console.log(`Worker ID: ${WORKER_ID}`);
  console.log(`Polling every ${POLL_INTERVAL_MS}ms for pending distributions`);
  console.log(`Connected to Supabase: ${process.env.SUPABASE_URL}`);
  console.log(`Using RPC: ${process.env.SOLANA_RPC_URL?.split("/v2/")[0]}/v2/***`);

  // Pump.fun creator-fee claiming runs in its own dedicated `fee-claimer`
  // Railway service. The distributor only handles SPL token distribution
  // to contributors after a launch lands.

  await pollAndDistribute();
  setInterval(pollAndDistribute, POLL_INTERVAL_MS);

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
