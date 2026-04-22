import * as dotenv from "dotenv";
dotenv.config();

import { executeAllPendingLaunches } from "./executeLaunch";

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "30000");

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
  console.log(`Connected to Supabase: ${process.env.SUPABASE_URL}`);
  console.log(
    `Using RPC: ${process.env.SOLANA_RPC_URL?.split("/v2/")[0]}/v2/***`
  );

  await executeAllPendingLaunches();
  setInterval(executeAllPendingLaunches, POLL_INTERVAL_MS);

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