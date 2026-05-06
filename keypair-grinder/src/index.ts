import { Worker } from "worker_threads";
import path from "path";
import { encryptSecret } from "./encrypt";
import { countUnclaimed, insertKeypair, makeSupabase } from "./db";

const TARGET_POOL_SIZE = parseInt(process.env.TARGET_POOL_SIZE ?? "1000", 10);
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT ?? "2", 10);
const SUFFIX = (process.env.SUFFIX ?? "pump").toLowerCase();
const ENCRYPTION_KEY = process.env.ESCROW_ENCRYPTION_KEY;

if (!ENCRYPTION_KEY) {
  console.error("ESCROW_ENCRYPTION_KEY env var is required");
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const supabase = makeSupabase();
  console.log(
    `[grinder] starting: workers=${WORKER_COUNT} target=${TARGET_POOL_SIZE} suffix="${SUFFIX}"`,
  );

  const workers: Worker[] = [];
  let paused = false;
  let currentPoolDepth = 0;

  const setPaused = (p: boolean) => {
    if (paused === p) return;
    paused = p;
    for (const w of workers) {
      w.postMessage({ type: p ? "pause" : "resume" });
    }
    console.log(`[grinder] ${p ? "PAUSED" : "RESUMED"} (pool=${currentPoolDepth}/${TARGET_POOL_SIZE})`);
  };

  const handleGround = async (msg: {
    publicKey: string;
    secretKeyHex: string;
    msTaken: number;
    attempts: number;
  }) => {
    if (paused) return; // Discard late messages once we've hit target.
    try {
      const encrypted = encryptSecret(msg.secretKeyHex, ENCRYPTION_KEY!);
      const res = await insertKeypair(supabase, msg.publicKey, encrypted);
      if (res.inserted) {
        currentPoolDepth++;
        console.log(
          `[grinder] +1 ${msg.publicKey} in ${(msg.msTaken / 1000).toFixed(1)}s (${msg.attempts} tries) pool=${currentPoolDepth}/${TARGET_POOL_SIZE}`,
        );
      } else {
        console.warn(`[grinder] insert skipped for ${msg.publicKey}: ${res.reason}`);
      }
      if (currentPoolDepth >= TARGET_POOL_SIZE) setPaused(true);
    } catch (err: any) {
      console.error(`[grinder] insert failed for ${msg.publicKey}:`, err?.message ?? err);
    }
  };

  // Spawn workers
  const workerPath = path.resolve(__dirname, "worker.js");
  for (let i = 0; i < WORKER_COUNT; i++) {
    const w = new Worker(workerPath, { env: process.env });
    w.on("message", (msg: any) => {
      if (msg?.type === "ground") void handleGround(msg);
    });
    w.on("error", (err) => console.error(`[grinder] worker ${i} error:`, err));
    w.on("exit", (code) => {
      console.error(`[grinder] worker ${i} exited code=${code} — restarting in 5s`);
      setTimeout(() => {
        const replacement = new Worker(workerPath, { env: process.env });
        workers[i] = replacement;
        replacement.on("message", (msg: any) => {
          if (msg?.type === "ground") void handleGround(msg);
        });
        if (paused) replacement.postMessage({ type: "pause" });
      }, 5_000);
    });
    workers.push(w);
  }

  // Initial pool depth
  try {
    currentPoolDepth = await countUnclaimed(supabase);
    console.log(`[grinder] initial pool depth: ${currentPoolDepth}/${TARGET_POOL_SIZE}`);
    if (currentPoolDepth >= TARGET_POOL_SIZE) setPaused(true);
  } catch (err: any) {
    console.error("[grinder] failed to read initial pool depth:", err?.message ?? err);
  }

  // Refresh-from-DB loop: while paused, poll every 60s. Always refresh
  // every 60s so currentPoolDepth tracks reality (consumers reduce it).
  setInterval(async () => {
    try {
      currentPoolDepth = await countUnclaimed(supabase);
      if (paused && currentPoolDepth < TARGET_POOL_SIZE) setPaused(false);
      else if (!paused && currentPoolDepth >= TARGET_POOL_SIZE) setPaused(true);
    } catch (err: any) {
      console.error("[grinder] pool depth refresh failed:", err?.message ?? err);
    }
  }, 60_000);

  // Health log every 10 minutes — visible in Railway logs without
  // hitting the database manually.
  setInterval(() => {
    console.log(
      `[grinder][health] pool=${currentPoolDepth}/${TARGET_POOL_SIZE} state=${paused ? "paused" : "grinding"}`,
    );
  }, 10 * 60 * 1000);

  // Keep the process alive forever.
  await new Promise(() => undefined);
}

main().catch((err) => {
  console.error("[grinder] fatal:", err);
  process.exit(1);
});