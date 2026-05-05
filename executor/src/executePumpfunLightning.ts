import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import fetch from "node-fetch";
import * as crypto from "crypto";
import { decryptEscrowKey } from "./decrypt";
import {
  Launch,
  Contribution,
  setFailed,
  setLaunched,
  storeBasisPoints,
  supabase,
} from "./db";
import {
  setFailedNoRefund,
  setFailedWithSignature,
  markForSweepRecovery,
} from "./db";
import {
  fundCustodialWallet,
  sweepSolToWallet,
  sweepTokensToWallet,
  resolveLaunchWallet,
  lamportsToSol,
} from "./pumpportalCustodial";
import type { PumpPortalWallet } from "./pumpportalWalletPool";
import { withCustodialLock } from "./custodialLock";
import {
  shouldChargeProcessingFee,
  chargeProcessingFee,
} from "./processingFee";
import { cancelAndRefund } from "./cancelAndRefund";
import { supabase as db } from "./db";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const SOLANA_WSS_URL =
  process.env.SOLANA_WSS_URL ||
  SOLANA_RPC_URL.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
const TREASURY_WALLET = process.env.BAGS_PARTNER_WALLET!;
const WORKER_ID =
  process.env.WORKER_ID || process.env.RAILWAY_REPLICA_ID || "executor-default";

// Buffer of SOL we ship to PumpPortal on top of the dev-buy amount, to cover
// the on-chain create + buy tx in a single transaction. Must cover:
//   - 2x ATA rent (~0.00408 SOL: mint metadata + custodial token account)
//   - Pump.fun 1% protocol fee on the initial buy (up to ~0.005 on a 0.5 SOL buy)
//   - Pump.fun 0.30% creator fee (negligible on small buys)
//   - Compute + priority fees (~0.001 SOL)
//   - PumpPortal tx fee (~0.001 SOL)
//   - Safety margin (~0.013 SOL)
// 0.01 SOL was empirically too small (custodial wallet ran 0.0027 SOL short
// during the Buy CPI). 0.025 SOL gives comfortable headroom; leftovers are
// swept back to escrow on success.
const CUSTODIAL_FUNDING_BUFFER_LAMPORTS = 25_000_000n; // 0.025 SOL

export async function executePumpfunLightningLaunch(
  launch: Launch,
  contributions: Contribution[]
): Promise<void> {
  console.log(
    `Executing Pump.fun (Lightning) launch ${launch.id} (${launch.token_name})`
  );

  // ---- Decrypt escrow + mint keypairs ----
  const escrowSecret = decryptEscrowKey(
    launch.escrow_wallet_encrypted_private_key
  );
  const escrowKeypair = Keypair.fromSecretKey(new Uint8Array(escrowSecret));

  if (!launch.pumpfun_mint_keypair_encrypted) {
    await setFailed(launch.id, "Missing pumpfun_mint_keypair_encrypted");
    return;
  }
  const mintSecret = decryptEscrowKey(launch.pumpfun_mint_keypair_encrypted);
  const mintKeypair = Keypair.fromSecretKey(new Uint8Array(mintSecret));
  const derivedMint = mintKeypair.publicKey.toBase58();
  if (derivedMint !== launch.token_mint_address) {
    await setFailed(
      launch.id,
      `Mint keypair mismatch. Stored: ${launch.token_mint_address}, Derived: ${derivedMint}`
    );
    return;
  }

  // ---- Pick (or look up) the custodial wallet for this launch ----
  // New per-launch model: the Lightning wallet is generated fresh at launch-
  // creation time and IS the escrow wallet. PumpPortal API key is stored
  // encrypted on the launch row. Legacy launches (pre-rollout) fall back to
  // the shared pool via resolveLaunchWallet.
  const isPerLaunchWallet = !!launch.lightning_wallet_public_key;
  let wallet: PumpPortalWallet;
  try {
    if (isPerLaunchWallet) {
      wallet = buildPerLaunchWallet(launch, escrowKeypair);
      console.log(
        `Using per-launch Lightning wallet (${wallet.pubkey}) for launch ${launch.id}`
      );
    } else {
      wallet = resolveLaunchWallet(
        launch.id,
        (launch as any).pumpportal_wallet_pubkey ?? null
      );
      console.log(
        `Using pooled PumpPortal custodial wallet slot ${wallet.slot} (${wallet.pubkey})`
      );
    }
  } catch (err: any) {
    await setFailed(
      launch.id,
      `Custodial wallet config invalid: ${err?.message ?? err}`
    );
    return;
  }
  const custodialPubkey = wallet.publicKey;

  // Legacy pool path: persist the wallet assignment up front so fee-claim
  // + recovery can find the exact wallet later, even across pool changes.
  if (!isPerLaunchWallet && !(launch as any).pumpportal_wallet_pubkey) {
    const { error: assignErr } = await db
      .from("launches")
      .update({ pumpportal_wallet_pubkey: wallet.pubkey })
      .eq("id", launch.id);
    if (assignErr) {
      console.warn(
        `Failed to persist pumpportal_wallet_pubkey on launch ${launch.id}: ${assignErr.message}`
      );
    }
  }

  // ---- Compute split: contributor reserves + initial buy ----
  const totalLamports = contributions.reduce(
    (sum, c) => sum + BigInt(c.amount_lamports),
    0n
  );

  const connection = new Connection(SOLANA_RPC_URL, {
    commitment: "confirmed",
    wsEndpoint: SOLANA_WSS_URL,
  });

  // ---- Auto-cancel if pool below platform minimum (0.3 SOL) ----
  // Runs before processing fee, custodial funding, and any PumpPortal API
  // call so nothing needs to be unwound on a sub-threshold raise.
  const MINIMUM_POOL_LAMPORTS = 300_000_000n; // 0.3 SOL
  if (totalLamports < MINIMUM_POOL_LAMPORTS) {
    console.log(
      `Launch ${launch.id} below minimum pool (${totalLamports} < ${MINIMUM_POOL_LAMPORTS}). Cancelling and refunding.`
    );
    await cancelAndRefund(launch, contributions);
    return;
  }

  // Charge hidden processing fee BEFORE the custodial-lock critical section
  // when total raised meets threshold. Funds go escrow → platform treasury.
  // Token-distribution BPS (below) still uses original contribution amounts.
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

  // SOL available for the actual launch buy after the processing fee debit.
  const availableLamports = totalLamports - processingFeeLamports;

  // Reserves identical to the Local-API path so distributor math stays
  // unchanged. ATA cost + tx fee + per-contributor priority dust.
  const ATA_COST = 2_039_280n;
  const TX_FEE = 5_000n;
  const PRIORITY_FEE_PER_CONTRIBUTOR = 10_000n;
  const contributorCount = BigInt(contributions.length);
  const ataReserve =
    contributorCount * (ATA_COST + TX_FEE + PRIORITY_FEE_PER_CONTRIBUTOR);
  // Per-launch model: no escrow→custodial funding tx, no buffer needed.
  const fundingTxFee = isPerLaunchWallet ? 0n : 5_000n;
  const fundingBuffer = isPerLaunchWallet ? 0n : CUSTODIAL_FUNDING_BUFFER_LAMPORTS;
  const initialBuyLamports =
    availableLamports - ataReserve - fundingTxFee - fundingBuffer;

  if (initialBuyLamports < 10_000_000n) {
    await setFailed(
      launch.id,
      `Insufficient SOL after processing fee + reserves. Total: ${totalLamports}, Fee: ${processingFeeLamports}, Available: ${availableLamports}, Net buy: ${initialBuyLamports}`
    );
    return;
  }

  // ---- Persist proportional basis points BEFORE moving funds ----
  // Always uses the ORIGINAL totalLamports so token shares are based on
  // each contributor's actual deposit, not the post-fee available amount.
  const totalNum = Number(totalLamports);
  for (const c of contributions) {
    const bps = Math.floor(
      (Number(BigInt(c.amount_lamports)) / totalNum) * 10000
    );
    await storeBasisPoints(c.id, bps);
  }

  // ============================================================
  // CRITICAL SECTION: serialize all custodial-wallet operations.
  // Lock key = custodial wallet pubkey, so future per-wallet pools
  // (Option 3) get free isolation by passing different keys.
  // ============================================================
  const lockKey = custodialPubkey.toBase58();
  try {
    await withCustodialLock(lockKey, WORKER_ID, async () => {
      await runCustodialCriticalSection(
        launch,
        connection,
        escrowKeypair,
        mintKeypair,
        wallet,
        initialBuyLamports,
        isPerLaunchWallet
      );
    });
  } catch (lockErr: any) {
    // Lock-acquire timeout. Don't fail the launch — just log so the next
    // poll can pick it up. The worker_locked_at row lock is released by the
    // caller's finally block in executeLaunch.ts.
    console.error(
      `Could not acquire custodial lock for launch ${launch.id}: ${
        lockErr?.message ?? lockErr
      }. Will retry on next poll.`
    );
  }
}

// Everything in here runs while we hold the custodial lock. Splitting it out
// keeps the lock scope obvious and makes early-return error paths clean.
async function runCustodialCriticalSection(
  launch: Launch,
  connection: Connection,
  escrowKeypair: Keypair,
  mintKeypair: Keypair,
  wallet: PumpPortalWallet,
  initialBuyLamports: bigint,
  isPerLaunchWallet: boolean
): Promise<void> {
  const custodialPubkey = wallet.publicKey;
  // ---- Step 1: Fund the custodial wallet from escrow (legacy pool only) ----
  // Per-launch model: contributor SOL already lives in the Lightning wallet
  // (which IS the escrow), so there's nothing to transfer.
  if (!isPerLaunchWallet) {
    const fundingAmount = initialBuyLamports + CUSTODIAL_FUNDING_BUFFER_LAMPORTS;
    console.log(
      `Funding custodial wallet with ${lamportsToSol(fundingAmount)} SOL ` +
        `(buy: ${lamportsToSol(initialBuyLamports)}, buffer: ${lamportsToSol(
          CUSTODIAL_FUNDING_BUFFER_LAMPORTS
        )})`
    );
    try {
      const fundingSig = await fundCustodialWallet(
        connection,
        escrowKeypair,
        fundingAmount,
        wallet
      );
      console.log(`Custodial funding tx confirmed: ${fundingSig}`);
    } catch (err: any) {
      await setFailed(
        launch.id,
        `Failed to fund custodial wallet: ${err?.message ?? err}`
      );
      return;
    }
  }

  // ---- Step 2: Call Lightning create ----
  // PumpPortal Lightning expects `mint` as the bs58-encoded SECRET key of the
  // mint keypair (per official docs example). It needs the secret to sign the
  // create instruction on its side.
  const mintBs58Secret = bs58.encode(mintKeypair.secretKey);
  const lightningUrl = `https://pumpportal.fun/api/trade?api-key=${encodeURIComponent(
    wallet.apiKey
  )}`;

  console.log("Calling PumpPortal Lightning create");
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 45_000);
  let lightningRes: any;
  try {
    lightningRes = await fetch(lightningUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        tokenMetadata: {
          name: (launch.token_name ?? "").trim(),
          symbol: (launch.token_symbol ?? "").trim().toUpperCase(),
          uri: launch.ipfs_metadata_url,
        },
        mint: mintBs58Secret,
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
    await trySweepSolBack(connection, escrowKeypair.publicKey, wallet).catch(() => {});
    if (err.name === "AbortError") {
      await setFailed(
        launch.id,
        "PumpPortal Lightning request timed out after 45 seconds"
      );
    } else {
      await setFailed(
        launch.id,
        `PumpPortal Lightning request failed: ${err.message}`
      );
    }
    return;
  }
  clearTimeout(timeout);

  // Lightning returns JSON regardless of success/failure status code.
  let lightningJson: any;
  try {
    lightningJson = await lightningRes.json();
  } catch (jsonErr: any) {
    const rawText = await lightningRes.text().catch(() => "");
    await trySweepSolBack(connection, escrowKeypair.publicKey, wallet).catch(() => {});
    await setFailed(
      launch.id,
      `PumpPortal Lightning returned non-JSON [${lightningRes.status} ${
        lightningRes.statusText
      }]: ${rawText.slice(0, 500)}`
    );
    return;
  }

  // PumpPortal Lightning returns `errors: []` (empty array — TRUTHY in JS) on
  // success, so we must check the array length, not just existence.
  const lightningErrors: string[] = Array.isArray(lightningJson?.errors)
    ? lightningJson.errors
    : [];
  if (!lightningRes.ok || lightningErrors.length > 0) {
    const errSummary =
      lightningErrors.length > 0
        ? lightningErrors.join(" | ")
        : JSON.stringify(lightningJson).slice(0, 500);
    console.error(
      `Lightning create failed [${lightningRes.status}]:`,
      lightningJson
    );
    await trySweepSolBack(connection, escrowKeypair.publicKey, wallet).catch(() => {});
    await setFailed(
      launch.id,
      `PumpPortal Lightning create failed (${lightningRes.status}): ${errSummary}`
    );
    return;
  }

  const launchSignature: string | undefined = lightningJson?.signature;
  if (!launchSignature) {
    await trySweepSolBack(connection, escrowKeypair.publicKey, wallet).catch(() => {});
    await setFailed(
      launch.id,
      `PumpPortal Lightning returned no signature: ${JSON.stringify(
        lightningJson
      ).slice(0, 500)}`
    );
    return;
  }

  console.log(`Lightning create submitted: ${launchSignature}`);
  console.log(`Solscan: https://solscan.io/tx/${launchSignature}`);

  // ---- Step 3: Determine on-chain landing status via HTTP polling ----
  // Lightning returns the signature pre-confirmation. We must poll because:
  //   - "succeeded" → mint exists on-chain, SOL is in bonding curve, do NOT refund
  //   - "reverted"  → tx exists but failed; no mint, no SOL spent, refunds OK
  //   - "not_landed" → tx never landed within window; no mint, no SOL spent, refunds OK
  // In every case below, the launch signature is persisted on the row so the
  // mint event (if any) is permanently traceable.
  const landed = await pollLandedStatus(connection, launchSignature, {
    timeoutMs: 60_000,
    intervalMs: 2_000,
  });
  console.log(
    `On-chain status for ${launchSignature}: ${landed.status}` +
      (landed.err ? ` (err=${JSON.stringify(landed.err)})` : "")
  );
  console.log(
    `Token mint ${launch.token_mint_address} created: ${
      landed.status === "succeeded" ? "yes" : "no"
    }`
  );

  if (landed.status === "reverted") {
    const errStr =
      typeof landed.err === "string" ? landed.err : JSON.stringify(landed.err);
    await trySweepSolBack(connection, escrowKeypair.publicKey, wallet).catch(() => {});
    await setFailedWithSignature(
      launch.id,
      `Pump.fun launch tx reverted on-chain (${launchSignature}): ${errStr}. ` +
        `Common cause: custodial funding buffer too small for the buy + ATA rent + protocol fees.`,
      launchSignature
    );
    return;
  }

  if (landed.status === "not_landed") {
    await trySweepSolBack(connection, escrowKeypair.publicKey, wallet).catch(() => {});
    await setFailedWithSignature(
      launch.id,
      `Pump.fun launch tx ${launchSignature} did not land within 60s polling window. ` +
        `Mint not created on-chain. Contributors will be refunded.`,
      launchSignature
    );
    return;
  }

  // landed.status === "succeeded" — mint exists, proceed to token sweep

  // ---- Step 4 + 5: Sweep tokens + residual SOL custodial → escrow ----
  // Per-launch model: the custodial wallet IS the escrow, so the dev-buy
  // tokens and residual SOL are already in the right place. Skip the sweeps.
  if (!isPerLaunchWallet) {
    let tokenSweepResult: { signature: string; amount: bigint } | null = null;
    let lastSweepErr: any = null;
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        tokenSweepResult = await sweepTokensToWallet(
          connection,
          launch.token_mint_address!,
          escrowKeypair.publicKey,
          wallet
        );
        break;
      } catch (sweepErr: any) {
        lastSweepErr = sweepErr;
        console.warn(
          `Token sweep attempt ${attempt}/6 failed: ${
            sweepErr?.message ?? sweepErr
          }`
        );
        await new Promise((r) => setTimeout(r, 4_000));
      }
    }
    if (!tokenSweepResult) {
      await markForSweepRecovery(
        launch.id,
        `Lightning create succeeded (${launchSignature}) but token sweep failed after retries: ${
          lastSweepErr?.message ?? lastSweepErr
        }. Tokens remain in custodial wallet ${custodialPubkey.toBase58()} and will be auto-recovered on next poll.`,
        launchSignature,
      );
      return;
    }
    console.log(
      `Swept ${tokenSweepResult.amount} token base units to escrow: ${tokenSweepResult.signature}`
    );

    try {
      const solSweep = await sweepSolToWallet(
        connection,
        escrowKeypair.publicKey,
        wallet
      );
      if (solSweep) {
        console.log(
          `Swept ${lamportsToSol(solSweep.amount)} SOL residual back to escrow: ${
            solSweep.signature
          }`
        );
      } else {
        console.log("No residual SOL to sweep above the rent-exempt floor");
      }
    } catch (solSweepErr: any) {
      console.warn(
        `SOL residual sweep failed (non-fatal): ${
          solSweepErr?.message ?? solSweepErr
        }`
      );
    }
  } else {
    console.log(
      `Per-launch wallet: skipping custodial→escrow sweeps (already unified). ` +
        `Tokens + residual SOL remain in ${custodialPubkey.toBase58()}.`
    );
  }

  await setLaunched(launch.id, launchSignature);
  console.log(`Pump.fun (Lightning) launch ${launch.id} complete`);
}

// Poll on-chain status of a signature via HTTP getSignatureStatuses.
// Returns:
//   - "succeeded": tx landed and confirmed/finalized with no err
//   - "reverted":  tx landed but failed (status.err is set)
//   - "not_landed": no status returned within timeout window
// Uses HTTP (not WebSocket) so it works on any RPC tier and avoids
// signatureSubscribe log spam on Alchemy.
type LandedStatus = "succeeded" | "reverted" | "not_landed";
async function pollLandedStatus(
  connection: Connection,
  signature: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<{ status: LandedStatus; err: any | null }> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const s = res?.value?.[0];
      if (s) {
        if (s.err) return { status: "reverted", err: s.err };
        const conf = s.confirmationStatus;
        if (conf === "confirmed" || conf === "finalized") {
          return { status: "succeeded", err: null };
        }
      }
    } catch (err: any) {
      console.warn(
        `getSignatureStatuses poll error for ${signature} (will retry): ${
          err?.message ?? err
        }`
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { status: "not_landed", err: null };
}

// Best-effort SOL sweep used when create fails after we've already funded the
// custodial wallet. We don't want that SOL stranded.
async function trySweepSolBack(
  connection: Connection,
  escrowPubkey: PublicKey,
  wallet: PumpPortalWallet
): Promise<void> {
  try {
    const sweep = await sweepSolToWallet(connection, escrowPubkey, wallet);
    if (sweep) {
      console.log(
        `Refunded ${lamportsToSol(sweep.amount)} SOL from custodial back to escrow after failed create: ${sweep.signature}`
      );
    }
  } catch (err: any) {
    console.warn(
      `Could not refund custodial SOL after failed create: ${err?.message ?? err}`
    );
  }
}