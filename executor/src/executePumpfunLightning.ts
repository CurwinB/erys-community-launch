import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import fetch from "node-fetch";
import { decryptEscrowKey } from "./decrypt";
import {
  Launch,
  Contribution,
  setFailed,
  setLaunched,
  storeBasisPoints,
} from "./db";
import { setFailedNoRefund } from "./db";
import {
  fundCustodialWallet,
  sweepSolToWallet,
  sweepTokensToWallet,
  getCustodialPublicKey,
  lamportsToSol,
} from "./pumpportalCustodial";
import { withCustodialLock } from "./custodialLock";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const PUMPPORTAL_API_KEY = process.env.PUMPPORTAL_API_KEY!;
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

  if (!PUMPPORTAL_API_KEY) {
    await setFailed(launch.id, "PUMPPORTAL_API_KEY env var is not set");
    return;
  }

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

  // ---- Pre-flight: verify custodial keypair is well-formed ----
  let custodialPubkey: PublicKey;
  try {
    custodialPubkey = getCustodialPublicKey();
    console.log(
      `Using PumpPortal custodial wallet ${custodialPubkey.toBase58()}`
    );
  } catch (err: any) {
    await setFailed(
      launch.id,
      `Custodial wallet config invalid: ${err?.message ?? err}`
    );
    return;
  }

  // ---- Compute split: contributor reserves + initial buy ----
  const totalLamports = contributions.reduce(
    (sum, c) => sum + BigInt(c.amount_lamports),
    0n
  );

  // Reserves identical to the Local-API path so distributor math stays
  // unchanged. ATA cost + tx fee + per-contributor priority dust.
  const ATA_COST = 2_039_280n;
  const TX_FEE = 5_000n;
  const PRIORITY_FEE_PER_CONTRIBUTOR = 10_000n;
  const contributorCount = BigInt(contributions.length);
  const ataReserve =
    contributorCount * (ATA_COST + TX_FEE + PRIORITY_FEE_PER_CONTRIBUTOR);
  const fundingTxFee = 5_000n; // escrow → custodial transfer tx
  const initialBuyLamports =
    totalLamports - ataReserve - fundingTxFee - CUSTODIAL_FUNDING_BUFFER_LAMPORTS;

  if (initialBuyLamports < 10_000_000n) {
    await setFailed(
      launch.id,
      `Insufficient SOL after reserves. Net buy: ${initialBuyLamports} lamports`
    );
    return;
  }

  // ---- Persist proportional basis points BEFORE moving funds ----
  const totalNum = Number(totalLamports);
  for (const c of contributions) {
    const bps = Math.floor(
      (Number(BigInt(c.amount_lamports)) / totalNum) * 10000
    );
    await storeBasisPoints(c.id, bps);
  }

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");

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
        custodialPubkey,
        initialBuyLamports
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
  custodialPubkey: PublicKey,
  initialBuyLamports: bigint
): Promise<void> {
  // ---- Step 1: Fund the custodial wallet from escrow ----
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
      fundingAmount
    );
    console.log(`Custodial funding tx confirmed: ${fundingSig}`);
  } catch (err: any) {
    await setFailed(
      launch.id,
      `Failed to fund custodial wallet: ${err?.message ?? err}`
    );
    return;
  }

  // ---- Step 2: Call Lightning create ----
  // PumpPortal Lightning expects `mint` as the bs58-encoded SECRET key of the
  // mint keypair (per official docs example). It needs the secret to sign the
  // create instruction on its side.
  const mintBs58Secret = bs58.encode(mintKeypair.secretKey);
  const lightningUrl = `https://pumpportal.fun/api/trade?api-key=${encodeURIComponent(
    PUMPPORTAL_API_KEY
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
          name: launch.token_name,
          symbol: launch.token_symbol.toUpperCase(),
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
    await trySweepSolBack(connection, escrowKeypair.publicKey).catch(() => {});
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
    await trySweepSolBack(connection, escrowKeypair.publicKey).catch(() => {});
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
    await trySweepSolBack(connection, escrowKeypair.publicKey).catch(() => {});
    await setFailed(
      launch.id,
      `PumpPortal Lightning create failed (${lightningRes.status}): ${errSummary}`
    );
    return;
  }

  const launchSignature: string | undefined = lightningJson?.signature;
  if (!launchSignature) {
    await trySweepSolBack(connection, escrowKeypair.publicKey).catch(() => {});
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

  // ---- Step 3: Wait for Pump.fun create to land + tokens to settle in custodial wallet ----
  // Lightning returns the signature pre-confirmation. Confirm it on-chain
  // before we attempt to sweep tokens.
  try {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction(
      { signature: launchSignature, blockhash, lastValidBlockHeight },
      "confirmed"
    );
  } catch (confErr: any) {
    // Even if confirmTransaction times out, the tx may still have landed.
    // Don't fail outright — proceed to sweep step which will surface the
    // real state via SPL balance read.
    console.warn(
      `confirmTransaction warning for ${launchSignature}:`,
      confErr?.message ?? confErr
    );
  }

  // ---- Step 3b: Verify on-chain status. Lightning returns 200+signature
  // even when the tx reverts on-chain (e.g. insufficient lamports during the
  // Buy CPI). Without this check we'd race ahead to the token sweep and
  // surface a confusing "no token balance" error.
  try {
    const statusRes = await connection.getSignatureStatuses([launchSignature], {
      searchTransactionHistory: true,
    });
    const status = statusRes?.value?.[0];
    if (status?.err) {
      const errStr =
        typeof status.err === "string"
          ? status.err
          : JSON.stringify(status.err);
      console.error(
        `Pump.fun launch tx ${launchSignature} reverted on-chain:`,
        errStr
      );
      // Refund custodial SOL to escrow so it isn't stranded.
      await trySweepSolBack(connection, escrowKeypair.publicKey).catch(() => {});
      await setFailed(
        launch.id,
        `Pump.fun launch tx reverted on-chain (${launchSignature}): ${errStr}. ` +
          `Common cause: custodial funding buffer too small for the buy + ATA rent + protocol fees.`
      );
      return;
    }
    if (!status) {
      // Status not yet available — log but continue. Token sweep retry loop
      // will catch it if the tx genuinely never landed.
      console.warn(
        `getSignatureStatuses returned no status yet for ${launchSignature}; proceeding to token sweep`
      );
    }
  } catch (statusErr: any) {
    console.warn(
      `Could not read on-chain status for ${launchSignature} (non-fatal): ${
        statusErr?.message ?? statusErr
      }`
    );
  }

  // ---- Step 4: Sweep tokens custodial → escrow ATA ----
  // Retry a few times because the create tx can be confirmed before
  // the indexer view of the SPL ATA catches up.
  let tokenSweepResult: { signature: string; amount: bigint } | null = null;
  let lastSweepErr: any = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      tokenSweepResult = await sweepTokensToWallet(
        connection,
        launch.token_mint_address!,
        escrowKeypair.publicKey
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
    // Token sweep is the only operation we can't safely retry through the
    // worker queue right now (the custodial wallet holds the dev-buy supply
    // for many concurrent launches). Mark the launch failed but DO NOT
    // refund — the tokens are still in the custodial wallet and recoverable
    // by an admin running the sweep manually.
    await setFailed(
      launch.id,
      `Lightning create succeeded (${launchSignature}) but token sweep failed after retries: ${
        lastSweepErr?.message ?? lastSweepErr
      }. Tokens remain in custodial wallet ${custodialPubkey.toBase58()} and can be recovered manually.`
    );
    return;
  }
  console.log(
    `Swept ${tokenSweepResult.amount} token base units to escrow: ${tokenSweepResult.signature}`
  );

  // ---- Step 5: Sweep residual SOL custodial → escrow (best-effort) ----
  try {
    const solSweep = await sweepSolToWallet(connection, escrowKeypair.publicKey);
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
    // Non-fatal; the SOL is still in the custodial wallet for the next launch
    // to consume or for admin sweep.
    console.warn(
      `SOL residual sweep failed (non-fatal): ${
        solSweepErr?.message ?? solSweepErr
      }`
    );
  }

  await setLaunched(launch.id, launchSignature);
  console.log(`Pump.fun (Lightning) launch ${launch.id} complete`);
}

// Best-effort SOL sweep used when create fails after we've already funded the
// custodial wallet. We don't want that SOL stranded.
async function trySweepSolBack(
  connection: Connection,
  escrowPubkey: PublicKey
): Promise<void> {
  try {
    const sweep = await sweepSolToWallet(connection, escrowPubkey);
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