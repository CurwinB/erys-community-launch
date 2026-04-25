import { Keypair, VersionedTransaction } from "@solana/web3.js";
import fetch from "node-fetch";
import { decryptEscrowKey } from "./decrypt";
import {
  Launch,
  Contribution,
  setFailed,
  setLaunched,
  storeBasisPoints,
} from "./db";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;

export async function executePumpfunLaunch(
  launch: Launch,
  contributions: Contribution[]
): Promise<void> {
  console.log(`Executing Pump.fun launch ${launch.id} (${launch.token_name})`);

  // Decrypt escrow keypair
  const escrowSecret = decryptEscrowKey(launch.escrow_wallet_encrypted_private_key);
  const escrowKeypair = Keypair.fromSecretKey(new Uint8Array(escrowSecret));

  // Decrypt mint keypair
  if (!launch.pumpfun_mint_keypair_encrypted) {
    await setFailed(launch.id, "Missing pumpfun_mint_keypair_encrypted");
    return;
  }

  const mintSecret = decryptEscrowKey(launch.pumpfun_mint_keypair_encrypted);
  const mintKeypair = Keypair.fromSecretKey(new Uint8Array(mintSecret));

  // Verify mint address
  const derivedMint = mintKeypair.publicKey.toBase58();
  if (derivedMint !== launch.token_mint_address) {
    await setFailed(
      launch.id,
      `Mint keypair mismatch. Stored: ${launch.token_mint_address}, Derived: ${derivedMint}`
    );
    return;
  }

  const totalLamports = contributions.reduce(
    (sum, c) => sum + BigInt(c.amount_lamports),
    0n
  );

  // Calculate reserves
  const ATA_COST = 2_039_280n;
  const TX_FEE = 5_000n;
  const PRIORITY_FEE = 50_000n; // priority fee for the main launch tx
  const PRIORITY_FEE_PER_CONTRIBUTOR = 10_000n; // buffer for ComputeBudgetProgram priority fee per distribution tx
  const contributorCount = BigInt(contributions.length);
  const ataReserve = contributorCount * (ATA_COST + TX_FEE + PRIORITY_FEE_PER_CONTRIBUTOR);
  const initialBuyLamports = totalLamports - ataReserve - PRIORITY_FEE;

  if (initialBuyLamports < 10_000_000n) {
    await setFailed(launch.id, `Insufficient SOL. Net: ${initialBuyLamports}`);
    return;
  }

  // Store basis points per contribution
  const totalNum = Number(totalLamports);
  for (const c of contributions) {
    const bps = Math.floor(
      (Number(BigInt(c.amount_lamports)) / totalNum) * 10000
    );
    await storeBasisPoints(c.id, bps);
  }

  // Pre-flight health probe: hit PumpPortal with a deliberately invalid
  // payload. A healthy server returns a 4xx with a validation message in
  // `statusText`. If we get 5xx or a `toBuffer` / undefined-property style
  // crash, the endpoint is broken — abort BEFORE committing contributor
  // funds so the launch can be retried instead of marked failed.
  try {
    const probeController = new AbortController();
    const probeTimeout = setTimeout(() => probeController.abort(), 10_000);
    const probeRes = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create" }), // intentionally minimal
      signal: probeController.signal,
    });
    clearTimeout(probeTimeout);
    const probeStatusText = probeRes.statusText || "";
    if (probeRes.status >= 500 || /toBuffer|undefined/i.test(probeStatusText)) {
      const probeBody = await probeRes.text().catch(() => "");
      await setFailed(
        launch.id,
        `PumpPortal health probe failed (${probeRes.status} ${probeStatusText}). Endpoint appears broken; aborting before committing funds. Body: ${probeBody.slice(0, 300)}`
      );
      return;
    }
    console.log(
      `PumpPortal health probe OK (${probeRes.status} ${probeStatusText})`
    );
  } catch (probeErr: any) {
    await setFailed(
      launch.id,
      `PumpPortal health probe threw: ${probeErr?.message ?? probeErr}`
    );
    return;
  }

  // Call PumpPortal
  console.log("Calling PumpPortal create");
  const pumpController = new AbortController();
  const pumpTimeout = setTimeout(() => pumpController.abort(), 30_000);
  let pumpRes: any;
  try {
    pumpRes = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: launch.escrow_wallet_public_key,
        action: "create",
        tokenMetadata: {
          name: launch.token_name,
          symbol: launch.token_symbol.toUpperCase(),
          uri: launch.ipfs_metadata_url,
        },
        mint: launch.token_mint_address,
        denominatedInSol: "true",
        amount: Number(initialBuyLamports) / 1e9,
        slippage: 15,
        priorityFee: 0.00005,
        pool: "pump",
      }),
      signal: pumpController.signal,
    });
  } catch (err: any) {
    if (err.name === "AbortError") {
      await setFailed(launch.id, "PumpPortal request timed out after 30 seconds");
      return;
    }
    await setFailed(launch.id, `PumpPortal request failed: ${err.message}`);
    return;
  } finally {
    clearTimeout(pumpTimeout);
  }

  if (!pumpRes.ok) {
    const errBody = await pumpRes.text();
    // PumpPortal returns its real diagnostic in `statusText` (HTTP reason
    // phrase), e.g. "Cannot read properties of undefined (reading 'toBuffer')".
    // The body is often just "Bad Request" which is useless for debugging.
    const statusText = pumpRes.statusText || "";
    const headerSnapshot: Record<string, string> = {};
    pumpRes.headers.forEach((v: string, k: string) => {
      headerSnapshot[k] = v;
    });
    console.error(
      `PumpPortal create failed [${pumpRes.status} ${statusText}]:`,
      errBody
    );
    console.error("PumpPortal response headers:", headerSnapshot);
    console.error("Request payload was:", {
      publicKey: launch.escrow_wallet_public_key,
      mint: launch.token_mint_address,
      uri: launch.ipfs_metadata_url,
      name: launch.token_name,
      symbol: launch.token_symbol.toUpperCase(),
      amountSol: Number(initialBuyLamports) / 1e9,
    });
    const reason =
      [statusText, errBody].filter(Boolean).join(" | ").slice(0, 800) ||
      "no error body";
    await setFailed(
      launch.id,
      `PumpPortal create failed (${pumpRes.status}): ${reason}`
    );
    return;
  }

  const txBytes = new Uint8Array(await pumpRes.arrayBuffer());

  // Sign: mint first then escrow
  const tx = VersionedTransaction.deserialize(txBytes);
  tx.sign([mintKeypair, escrowKeypair]);

  const signedBytes = tx.serialize();
  const txBase64 = Buffer.from(signedBytes).toString("base64");

  // Submit via Alchemy RPC
  const rpcRes = await fetch(SOLANA_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: [txBase64, { encoding: "base64", preflightCommitment: "confirmed" }],
    }),
  });

  const rpcData = (await rpcRes.json()) as any;
  if (rpcData.error) {
    await setFailed(
      launch.id,
      `RPC sendTransaction failed: ${JSON.stringify(rpcData.error)}`
    );
    return;
  }

  const txSignature = rpcData.result;
  console.log(`Pump.fun tx submitted: ${txSignature}`);
  console.log(`Solscan: https://solscan.io/tx/${txSignature}`);

  await setLaunched(launch.id, txSignature);
  console.log(`Pump.fun launch ${launch.id} complete`);
}