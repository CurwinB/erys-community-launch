import * as dotenv from "dotenv";
dotenv.config();

import { executeAllPendingLaunches } from "./executeLaunch";
import { getAllWallets } from "./pumpportalWalletPool";
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

  // Publish PumpPortal wallet pool size so the scheduling edge functions
  // know the current Pump.fun per-minute capacity. Failure is non-fatal —
  // schedule defaults to 1.
  try {
    const pool = getAllWallets();
    if (pool.length > 0) {
      await supabase.rpc("set_app_setting", {
        p_key: "pumpportal_wallet_pool_size",
        p_value: String(pool.length),
      });
      console.log(`Published Pump.fun wallet pool size: ${pool.length}`);
    }
  } catch (err: any) {
    console.warn(`Could not publish wallet pool size: ${err?.message ?? err}`);
  }

  await executeAllPendingLaunches(WORKER_ID);
  setInterval(() => executeAllPendingLaunches(WORKER_ID), POLL_INTERVAL_MS);

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