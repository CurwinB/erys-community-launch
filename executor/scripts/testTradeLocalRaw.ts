/**
 * Standalone PumpPortal /trade-local probe.
 *
 * Sends two minimal `create` requests back-to-back with hardcoded values
 * (NO dependency on our DB / launch row / executor code) to isolate
 * whether the endpoint accepts our payload shape:
 *
 *   Variant A: mint = mintKeypair.publicKey.toBase58()      (44 chars, broken)
 *   Variant B: mint = bs58.encode(mintKeypair.secretKey)    (~88 chars, per docs)
 *
 * Run: cd executor && npx ts-node scripts/testTradeLocalRaw.ts
 */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import fetch from "node-fetch";

const ENDPOINT = "https://pumpportal.fun/api/trade-local";

// Hardcoded reachable metadata URI (from PumpPortal's own docs example
// pattern). Any real Pinata URI works; this one is one of ours that we
// already verified returns 200 + valid JSON.
const URI =
  "https://indigo-causal-wasp-353.mypinata.cloud/ipfs/bafkreign5qjikxfnwvd7g5ilrwoy5jnffnszuuywrwsinv6tfd4gws6xfu";

// Throwaway payer pubkey. We never submit the returned tx — we only care
// about the HTTP response from /trade-local. PumpPortal does not check
// that the payer has SOL at this stage.
const PAYER =
  process.env.TEST_WALLET_PUBKEY ?? Keypair.generate().publicKey.toBase58();

async function probe(label: string, mintField: string, mintPubkey: string) {
  const body = {
    publicKey: PAYER,
    action: "create",
    tokenMetadata: { name: "RawTest", symbol: "RAWT", uri: URI },
    mint: mintField,
    denominatedInSol: "true",
    amount: 0.1,
    slippage: 15,
    priorityFee: 0.00005,
    pool: "pump",
  };
  const safeBody = { ...body, mint: `<${mintField.length}-char, pubkey=${mintPubkey}>` };
  console.log(`\n=== ${label} ===`);
  console.log("Request:", JSON.stringify(safeBody));
  const t0 = Date.now();
  let res: any;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    console.error(`Network error after ${Date.now() - t0}ms: ${e.message}`);
    return;
  }
  const ct = res.headers.get("content-type") || "";
  if (res.ok) {
    const buf = new Uint8Array(await res.arrayBuffer());
    console.log(`HTTP ${res.status} OK in ${Date.now() - t0}ms — got ${buf.length} bytes (likely serialized tx)`);
  } else {
    const text = await res.text().catch(() => "");
    console.log(`HTTP ${res.status} ${res.statusText} in ${Date.now() - t0}ms`);
    console.log(`content-type: ${ct}`);
    console.log(`body: ${text.slice(0, 1000)}`);
  }
}

async function main() {
  console.log(`PumpPortal /trade-local raw probe`);
  console.log(`Payer pubkey: ${PAYER}${process.env.TEST_WALLET_PUBKEY ? "" : " (generated)"}`);

  const kpA = Keypair.generate();
  await probe(
    "VARIANT A (mint = public key — what we were sending)",
    kpA.publicKey.toBase58(),
    kpA.publicKey.toBase58()
  );

  const kpB = Keypair.generate();
  await probe(
    "VARIANT B (mint = bs58(secretKey) — per PumpPortal docs)",
    bs58.encode(kpB.secretKey),
    kpB.publicKey.toBase58()
  );

  // Variant C: mint = pubkey (per docs), pool = "pump", funded payer.
  const kpC = Keypair.generate();
  await probeWithPool(
    "VARIANT C (mint=pubkey, pool=pump, funded payer)",
    kpC.publicKey.toBase58(),
    kpC.publicKey.toBase58(),
    "pump"
  );

  // Variant D: mint = pubkey, pool omitted (let PumpPortal pick).
  const kpD = Keypair.generate();
  await probeWithPool(
    "VARIANT D (mint=pubkey, pool omitted, funded payer)",
    kpD.publicKey.toBase58(),
    kpD.publicKey.toBase58(),
    undefined
  );
}

async function probeWithPool(
  label: string,
  mintField: string,
  mintPubkey: string,
  pool: string | undefined
) {
  const body: any = {
    publicKey: PAYER,
    action: "create",
    tokenMetadata: { name: "RawTest", symbol: "RAWT", uri: URI },
    mint: mintField,
    denominatedInSol: "true",
    amount: 0.1,
    slippage: 15,
    priorityFee: 0.00005,
  };
  if (pool) body.pool = pool;
  console.log(`\n=== ${label} ===`);
  console.log("Request:", JSON.stringify({ ...body, mint: `<${mintField.length}-char, pubkey=${mintPubkey}>` }));
  const t0 = Date.now();
  let res: any;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    console.error(`Network error after ${Date.now() - t0}ms: ${e.message}`);
    return;
  }
  if (res.ok) {
    const buf = new Uint8Array(await res.arrayBuffer());
    console.log(`HTTP ${res.status} OK in ${Date.now() - t0}ms — got ${buf.length} bytes (likely serialized tx)`);
  } else {
    const text = await res.text().catch(() => "");
    console.log(`HTTP ${res.status} ${res.statusText} in ${Date.now() - t0}ms`);
    console.log(`body: ${text.slice(0, 1000)}`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});