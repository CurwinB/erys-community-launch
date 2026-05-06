import { parentPort } from "worker_threads";
import { Keypair } from "@solana/web3.js";

const SUFFIX = (process.env.SUFFIX ?? "pump").toLowerCase();
let paused = false;

if (!parentPort) throw new Error("worker must be spawned with worker_threads");

parentPort.on("message", (msg: any) => {
  if (msg?.type === "pause") paused = true;
  else if (msg?.type === "resume") paused = false;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (paused) {
      await sleep(1_000);
      continue;
    }
    const t0 = Date.now();
    let attempts = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const kp = Keypair.generate();
      attempts++;
      const pub = kp.publicKey.toBase58();
      if (pub.toLowerCase().endsWith(SUFFIX)) {
        const secretKeyHex = Buffer.from(kp.secretKey).toString("hex");
        parentPort!.postMessage({
          type: "ground",
          publicKey: pub,
          secretKeyHex,
          msTaken: Date.now() - t0,
          attempts,
        });
        break;
      }
      // Yield occasionally so messages (pause/resume) are processed.
      if (attempts % 50_000 === 0) {
        await sleep(0);
        if (paused) break;
      }
    }
  }
})();