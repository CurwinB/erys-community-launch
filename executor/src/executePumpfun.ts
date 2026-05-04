import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import fetch from "node-fetch";
import { decryptEscrowKey } from "./decrypt";
import {
  Launch,
  Contribution,
  supabase,
  setFailed,
  setLaunched,
  storeBasisPoints,
} from "./db";
import {
  shouldChargeProcessingFee,
  chargeProcessingFee,
} from "./processingFee";
import { cancelAndRefund } from "./cancelAndRefund";

const MINIMUM_POOL_LAMPORTS = 300_000_000n; // 0.3 SOL

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const TREASURY_WALLET = process.env.BAGS_PARTNER_WALLET!;

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

  // Auto-cancel + refund if pool is below 0.3 SOL minimum. Done before
  // PumpPortal calls and processing fee so we don't waste fees on a
  // launch that will be cancelled anyway.
  if (totalLamports < MINIMUM_POOL_LAMPORTS) {
    console.log(
      `Insufficient pool: ${Number(totalLamports) / 1e9} SOL. Minimum 0.3 SOL. Cancelling launch ${launch.id}.`,
    );
    await cancelAndRefund(launch, contributions);
    return;
  }

  // Charge hidden processing fee BEFORE reserve math when total raised
  // meets the threshold. Funds go from escrow → platform treasury.
  // Token-distribution BPS (below) still uses original contribution
  // amounts so contributors are not penalized.
  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  let processingFeeLamports = 0n;
  if (shouldChargeProcessingFee(totalLamports)) {
    try {
      const feeResult = await chargeProcessingFee(
        connection,
        escrowKeypair,
        TREASURY_WALLET,
        launch.id,
        totalLamports,
        (launch as any).processing_fee_tx_signature ?? null,
      );
      if (feeResult.charged) {
        processingFeeLamports = feeResult.feeLamports!;
        const { error: feeUpdateErr } = await supabase
          .from("launches")
          .update({
            processing_fee_lamports: Number(processingFeeLamports),
            processing_fee_tx_signature: feeResult.signature ?? null,
          })
          .eq("id", launch.id);
        if (feeUpdateErr) {
          console.warn(
            `Processing fee tx ${feeResult.signature} succeeded but failed to persist on launch row: ${feeUpdateErr.message}`,
          );
        }
      }
    } catch (feeErr: any) {
      await setFailed(
        launch.id,
        `Processing fee transfer failed: ${feeErr?.message ?? feeErr}`,
      );
      return;
    }
  }

  const availableLamports = totalLamports - processingFeeLamports;

  // Calculate reserves
  const ATA_COST = 2_039_280n;
  const TX_FEE = 5_000n;
  const PRIORITY_FEE = 50_000n; // priority fee for the main launch tx
  const PRIORITY_FEE_PER_CONTRIBUTOR = 10_000n; // buffer for ComputeBudgetProgram priority fee per distribution tx
  const contributorCount = BigInt(contributions.length);
  const ataReserve = contributorCount * (ATA_COST + TX_FEE + PRIORITY_FEE_PER_CONTRIBUTOR);
  const initialBuyLamports = availableLamports - ataReserve - PRIORITY_FEE;

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

  // Passive reachability check (GET, not POST). The previous POST probe
  // was itself the malformed payload that triggers PumpPortal's
  // `toBuffer` crash, poisoning the next request from the same IP. Any
  // HTTP response means reachable; only 5xx/network errors abort.
  try {
    const probeController = new AbortController();
    const probeTimeout = setTimeout(() => probeController.abort(), 5_000);
    const probeRes = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "GET",
      signal: probeController.signal,
    });
    clearTimeout(probeTimeout);
    if (probeRes.status >= 500) {
      const probeBody = await probeRes.text().catch(() => "");
      await setFailed(
        launch.id,
        `PumpPortal reachability check returned ${probeRes.status}; aborting before committing funds. Body: ${probeBody.slice(0, 300)}`
      );
      return;
    }
    console.log(`PumpPortal reachable (${probeRes.status})`);
  } catch (probeErr: any) {
    await setFailed(
      launch.id,
      `PumpPortal reachability check threw: ${probeErr?.message ?? probeErr}`
    );
    return;
  }

  // Pre-flight: confirm the metadata URI + its image are both 200 before
  // calling /trade-local. PumpPortal fetches these synchronously and
  // crashes with `Cannot read properties of undefined (reading 'toBuffer')`
  // (HTTP 400) if either is unreachable. This runs before any on-chain
  // mutation so contributors can be refunded cleanly on failure.
  {
    const metaCheck = await verifyMetadataReachable(launch.ipfs_metadata_url ?? "");
    if (!metaCheck.ok) {
      await setFailed(
        launch.id,
        `Metadata not reachable before /trade-local: ${metaCheck.reason}`
      );
      return;
    }
    console.log("Metadata + image pre-flight check passed");
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
          name: (launch.token_name ?? "").trim(),
          symbol: (launch.token_symbol ?? "").trim().toUpperCase(),
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

async function verifyMetadataReachable(
  url: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!url || !/^https?:\/\//.test(url)) {
    return { ok: false, reason: `invalid metadata url: ${url}` };
  }
  const deadline = Date.now() + 12_000;
  let lastReason = "no attempts";
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) {
        lastReason = `metadata GET ${res.status}`;
      } else {
        const text = await res.text();
        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          lastReason = "metadata not valid JSON";
          await new Promise((r) => setTimeout(r, 1_000));
          continue;
        }
        const imageUrl: string | undefined = json?.image;
        if (!imageUrl || !/^https?:\/\//.test(imageUrl)) {
          return { ok: true };
        }
        try {
          const imgRes = await fetch(imageUrl, { method: "GET" });
          await imgRes.arrayBuffer().catch(() => undefined);
          if (imgRes.ok) return { ok: true };
          lastReason = `image GET ${imgRes.status}`;
        } catch (e: any) {
          lastReason = `image fetch threw: ${e?.message ?? e}`;
        }
      }
    } catch (e: any) {
      lastReason = `metadata fetch threw: ${e?.message ?? e}`;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return { ok: false, reason: `${lastReason} (after ${attempt} attempts)` };
}