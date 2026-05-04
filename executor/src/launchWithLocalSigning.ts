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

// =====================================================================
// Parallel Pump.fun launch path: PumpPortal /trade-local + local signing.
//
// This file is wired in only when USE_LOCAL_SIGNING=true, OR when invoked
// directly by scripts/testLocalSigning.ts. The default Lightning path in
// executePumpfunLightning.ts is NOT modified by this file's existence.
//
// Signing keypairs (REUSED, never generated):
//   - escrowKeypair: decrypted from launch.escrow_wallet_encrypted_private_key
//                    (must sign as `publicKey` payer/buyer)
//   - mintKeypair:   decrypted from launch.pumpfun_mint_keypair_encrypted
//                    (must sign because `create` instantiates a new mint)
// No Keypair.generate() calls anywhere in this file. No secretKey bytes
// ever reach console.* — keypairs live in local consts and go out of scope
// when the function returns.
// =====================================================================

const MINIMUM_POOL_LAMPORTS = 300_000_000n; // 0.3 SOL
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const TREASURY_WALLET = process.env.BAGS_PARTNER_WALLET!;

const LOG = (msg: string, ...rest: any[]) =>
  console.log(`[LOCAL_SIGNING] ${msg}`, ...rest);
const ERR = (msg: string, ...rest: any[]) =>
  console.error(`[LOCAL_SIGNING] ${msg}`, ...rest);
const WARN = (msg: string, ...rest: any[]) =>
  console.warn(`[LOCAL_SIGNING] ${msg}`, ...rest);

export interface LocalSigningOptions {
  /**
   * If true, performs all keypair loading, validation, /trade-local fetch,
   * and local signing — but does NOT submit the signed tx to RPC and does
   * NOT mutate the DB (no setLaunched, no setFailed, no fee charge, no
   * BPS write, no cancelAndRefund). Used by the test CLI to validate the
   * pipeline without on-chain side effects.
   */
  dryRun?: boolean;
}

export async function launchWithLocalSigning(
  launch: Launch,
  contributions: Contribution[],
  opts: LocalSigningOptions = {}
): Promise<void> {
  const dryRun = !!opts.dryRun;
  LOG(
    `${dryRun ? "[DRY-RUN] " : ""}Executing Pump.fun launch ${launch.id} (${launch.token_name})`
  );

  // ---- Decrypt escrow keypair (REUSE — not generated) ----
  const escrowSecret = decryptEscrowKey(
    launch.escrow_wallet_encrypted_private_key
  );
  const escrowKeypair = Keypair.fromSecretKey(new Uint8Array(escrowSecret));
  LOG(`Loaded escrow keypair: ${escrowKeypair.publicKey.toBase58()}`);

  // ---- Decrypt mint keypair (REUSE — not generated) ----
  if (!launch.pumpfun_mint_keypair_encrypted) {
    const msg = "Missing pumpfun_mint_keypair_encrypted";
    ERR(msg);
    if (!dryRun) await setFailed(launch.id, msg);
    return;
  }
  const mintSecret = decryptEscrowKey(launch.pumpfun_mint_keypair_encrypted);
  const mintKeypair = Keypair.fromSecretKey(new Uint8Array(mintSecret));
  const derivedMint = mintKeypair.publicKey.toBase58();
  if (derivedMint !== launch.token_mint_address) {
    const msg = `Mint keypair mismatch. Stored: ${launch.token_mint_address}, Derived: ${derivedMint}`;
    ERR(msg);
    if (!dryRun) await setFailed(launch.id, msg);
    return;
  }
  LOG(`Loaded mint keypair: ${derivedMint}`);

  const totalLamports = contributions.reduce(
    (sum, c) => sum + BigInt(c.amount_lamports),
    0n
  );
  LOG(
    `Pool total: ${Number(totalLamports) / 1e9} SOL across ${contributions.length} contribution(s)`
  );

  // ---- Auto-cancel + refund if below 0.3 SOL ----
  if (totalLamports < MINIMUM_POOL_LAMPORTS) {
    LOG(
      `Insufficient pool: ${Number(totalLamports) / 1e9} SOL. Minimum 0.3 SOL.`
    );
    if (dryRun) {
      LOG("[DRY-RUN] Would call cancelAndRefund — skipping");
      return;
    }
    await cancelAndRefund(launch, contributions);
    return;
  }

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");

  // ---- Hidden processing fee (skipped on dry-run) ----
  let processingFeeLamports = 0n;
  if (shouldChargeProcessingFee(totalLamports)) {
    if (dryRun) {
      LOG("[DRY-RUN] Would charge processing fee — skipping");
    } else {
      try {
        const feeResult = await chargeProcessingFee(
          connection,
          escrowKeypair,
          TREASURY_WALLET,
          launch.id,
          totalLamports,
          (launch as any).processing_fee_tx_signature ?? null
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
            WARN(
              `Processing fee tx ${feeResult.signature} succeeded but failed to persist: ${feeUpdateErr.message}`
            );
          }
        }
      } catch (feeErr: any) {
        const msg = `Processing fee transfer failed: ${feeErr?.message ?? feeErr}`;
        ERR(msg);
        await setFailed(launch.id, msg);
        return;
      }
    }
  }

  const availableLamports = totalLamports - processingFeeLamports;

  // ---- Reserve math (matches executePumpfun.ts exactly) ----
  const ATA_COST = 2_039_280n;
  const TX_FEE = 5_000n;
  const PRIORITY_FEE = 50_000n;
  const PRIORITY_FEE_PER_CONTRIBUTOR = 10_000n;
  const contributorCount = BigInt(contributions.length);
  const ataReserve =
    contributorCount * (ATA_COST + TX_FEE + PRIORITY_FEE_PER_CONTRIBUTOR);
  const initialBuyLamports = availableLamports - ataReserve - PRIORITY_FEE;

  if (initialBuyLamports < 10_000_000n) {
    const msg = `Insufficient SOL after reserves. Net buy: ${initialBuyLamports}`;
    ERR(msg);
    if (!dryRun) await setFailed(launch.id, msg);
    return;
  }
  LOG(`Initial buy lamports: ${initialBuyLamports} (${Number(initialBuyLamports) / 1e9} SOL)`);

  // ---- Persist BPS (skipped on dry-run) ----
  if (!dryRun) {
    const totalNum = Number(totalLamports);
    for (const c of contributions) {
      const bps = Math.floor(
        (Number(BigInt(c.amount_lamports)) / totalNum) * 10000
      );
      await storeBasisPoints(c.id, bps);
    }
  } else {
    LOG("[DRY-RUN] Would persist basis points — skipping");
  }

  // ---- Call /trade-local for unsigned tx bytes ----
  LOG("Calling PumpPortal /trade-local");
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30_000);
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
      signal: ctrl.signal,
    });
  } catch (err: any) {
    clearTimeout(timeout);
    const msg =
      err.name === "AbortError"
        ? "PumpPortal /trade-local request timed out after 30 seconds"
        : `PumpPortal /trade-local request failed: ${err.message}`;
    ERR(msg);
    if (!dryRun) await setFailed(launch.id, msg);
    return;
  }
  clearTimeout(timeout);

  if (!pumpRes.ok) {
    const errBody = await pumpRes.text().catch(() => "");
    const statusText = pumpRes.statusText || "";
    const reason =
      [statusText, errBody].filter(Boolean).join(" | ").slice(0, 800) ||
      "no error body";
    const msg = `PumpPortal /trade-local failed (${pumpRes.status}): ${reason}`;
    ERR(msg);
    if (!dryRun) await setFailed(launch.id, msg);
    return;
  }

  const txBytes = new Uint8Array(await pumpRes.arrayBuffer());
  LOG(`Received ${txBytes.length}-byte unsigned transaction`);

  // ---- Local signing: mint then escrow (REUSED keypairs only) ----
  const tx = VersionedTransaction.deserialize(txBytes);
  tx.sign([mintKeypair, escrowKeypair]);
  const signedBytes = tx.serialize();
  LOG(`Locally signed transaction: ${signedBytes.length} bytes`);

  if (dryRun) {
    LOG(`Signed transaction size: ${signedBytes.length} bytes`);
    LOG(`Escrow public key: ${escrowKeypair.publicKey.toBase58()}`);
    LOG(`Mint public key:   ${mintKeypair.publicKey.toBase58()}`);
    if (mintKeypair.publicKey.toBase58() === launch.token_mint_address) {
      LOG(
        `Mint match confirmed: derived mint === launch.token_mint_address (${launch.token_mint_address})`
      );
    } else {
      ERR(
        `Mint MISMATCH: derived ${mintKeypair.publicKey.toBase58()} !== launch.token_mint_address ${launch.token_mint_address}`
      );
    }
    console.log("[DRY RUN] Transaction ready \u2014 not submitted");
    return;
  }

  // ---- Submit via Connection.sendRawTransaction ----
  let txSignature: string;
  try {
    txSignature = await connection.sendRawTransaction(signedBytes, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });
  } catch (sendErr: any) {
    const msg = `sendRawTransaction failed: ${sendErr?.message ?? sendErr}`;
    ERR(msg);
    await setFailed(launch.id, msg);
    return;
  }

  LOG(`Submitted: ${txSignature}`);
  LOG(`Solscan: https://solscan.io/tx/${txSignature}`);

  await setLaunched(launch.id, txSignature);
  LOG(`Launch ${launch.id} complete`);
}
