import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
} from "@solana/spl-token";
import bs58 from "bs58";
import {
  getWalletByPubkey,
  getWalletForLaunch,
  type PumpPortalWallet,
} from "./pumpportalWalletPool";

/**
 * Helpers for working with PumpPortal Lightning custodial wallets.
 *
 * Each Pump.fun launch is bound to one wallet from the pool (see
 * pumpportalWalletPool.ts). All on-chain operations for a launch — funding,
 * Lightning create, post-mint sweep, fee claim, recovery — flow through
 * that single wallet, so the lock key (= wallet pubkey) cleanly serializes
 * per-wallet operations and lets distinct wallets run in parallel.
 */

// Keep a small SOL floor in the custodial wallet so it stays rent-exempt
// and we don't need to fund a fresh account on the next launch.
export const CUSTODIAL_SOL_FLOOR_LAMPORTS = 2_000_000n; // 0.002 SOL

// Generous priority fee for sweeps so they land quickly even under load.
const SWEEP_PRIORITY_MICROLAMPORTS = 50_000;

// HTTP-polling confirmation tunables. We deliberately avoid web3.js's
// confirmTransaction because it tries `signatureSubscribe` over WebSocket
// first; on RPC tiers without WS (e.g. Helius/Alchemy basic), it errors out
// with -32601 and the slow fallback often misses the ~60–90s blockhash
// expiry window. Polling getSignatureStatuses + rebroadcasting the signed
// tx is universally supported and idempotent.
const POLL_INTERVAL_MS = 2_000;
const REBROADCAST_EVERY_MS = 5_000;
const PER_ATTEMPT_TIMEOUT_MS = 90_000;
const MAX_BLOCKHASH_REFRESH_ATTEMPTS = 3;

/**
 * Resolve the wallet a launch should use. If the launch row has a stored
 * pubkey (post-rollout), use that exact wallet. Otherwise fall back to the
 * deterministic pool selection so legacy rows + brand-new launches both
 * work identically.
 */
export function resolveLaunchWallet(
  launchId: string,
  storedPubkey?: string | null
): PumpPortalWallet {
  if (storedPubkey) {
    const w = getWalletByPubkey(storedPubkey);
    if (!w) {
      throw new Error(
        `Launch ${launchId} was assigned to wallet ${storedPubkey}, but that ` +
          `wallet is no longer in the configured pool. Re-add its secrets to recover.`
      );
    }
    return w;
  }
  return getWalletForLaunch(launchId);
}

/**
 * Build → sign → send → confirm a transaction with HTTP polling and
 * automatic blockhash-refresh retries. Use this anywhere we'd otherwise
 * call `connection.confirmTransaction`, which is fragile on RPC tiers
 * without WebSocket support.
 *
 * @param buildTx receives a fresh blockhash and must return a SIGNED Transaction.
 *                Called once per blockhash-refresh attempt.
 * @param label   human-readable op name for error messages.
 */
async function sendAndConfirmWithRetry(
  connection: Connection,
  buildTx: (blockhash: string) => Transaction,
  label: string
): Promise<string> {
  let lastSignature: string | null = null;
  let lastErr: any = null;

  for (let attempt = 1; attempt <= MAX_BLOCKHASH_REFRESH_ATTEMPTS; attempt++) {
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tx = buildTx(blockhash);
    const rawTx = tx.serialize();

    let signature: string;
    try {
      signature = await connection.sendRawTransaction(rawTx, {
        preflightCommitment: "confirmed",
        skipPreflight: false,
      });
    } catch (sendErr: any) {
      lastErr = sendErr;
      console.warn(
        `[${label}] sendRawTransaction attempt ${attempt} failed: ${
          sendErr?.message ?? sendErr
        }`
      );
      continue;
    }
    lastSignature = signature;
    console.log(`[${label}] submitted ${signature} (attempt ${attempt})`);

    const start = Date.now();
    let lastRebroadcast = start;
    while (Date.now() - start < PER_ATTEMPT_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      // Poll status via HTTP — works on every RPC tier.
      try {
        const statuses = await connection.getSignatureStatuses([signature], {
          searchTransactionHistory: false,
        });
        const status = statuses?.value?.[0];
        if (status) {
          if (status.err) {
            throw new Error(
              `tx ${signature} on-chain error: ${JSON.stringify(status.err)}`
            );
          }
          if (
            status.confirmationStatus === "confirmed" ||
            status.confirmationStatus === "finalized"
          ) {
            return signature;
          }
        }
      } catch (pollErr: any) {
        // Permanent on-chain failure — don't retry with a new blockhash.
        if (/on-chain error/.test(pollErr?.message ?? "")) {
          throw pollErr;
        }
        console.warn(
          `[${label}] getSignatureStatuses transient error: ${
            pollErr?.message ?? pollErr
          }`
        );
      }

      // Cheap rebroadcast — Solana dedupes, costs us nothing extra.
      if (Date.now() - lastRebroadcast >= REBROADCAST_EVERY_MS) {
        lastRebroadcast = Date.now();
        try {
          await connection.sendRawTransaction(rawTx, {
            preflightCommitment: "confirmed",
            skipPreflight: true,
          });
        } catch {
          /* ignore — leader may already have it */
        }
      }
    }

    // Timed out for this blockhash. One last status check before giving up
    // on this attempt — the tx may have landed in the final tick.
    try {
      const finalStatuses = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const finalStatus = finalStatuses?.value?.[0];
      if (
        finalStatus &&
        !finalStatus.err &&
        (finalStatus.confirmationStatus === "confirmed" ||
          finalStatus.confirmationStatus === "finalized")
      ) {
        return signature;
      }
    } catch {
      /* ignore and fall through to retry */
    }

    lastErr = new Error(
      `tx ${signature} not confirmed within ${PER_ATTEMPT_TIMEOUT_MS}ms; retrying with fresh blockhash`
    );
    console.warn(`[${label}] ${(lastErr as Error).message}`);
  }

  throw new Error(
    `[${label}] failed after ${MAX_BLOCKHASH_REFRESH_ATTEMPTS} blockhash-refresh attempts. Last signature: ${
      lastSignature ?? "<none>"
    }. Last error: ${lastErr?.message ?? lastErr}`
  );
}

/**
 * Send SOL from the per-launch escrow wallet into the PumpPortal custodial
 * wallet to fund the upcoming Lightning create call. PumpPortal will spend
 * this SOL on the dev buy + on-chain tx fees. We add a small buffer for the
 * sweep transactions we'll do afterwards.
 */
export async function fundCustodialWallet(
  connection: Connection,
  escrowKeypair: Keypair,
  lamports: bigint,
  wallet: PumpPortalWallet
): Promise<string> {
  const custodialPubkey = wallet.publicKey;
  return sendAndConfirmWithRetry(
    connection,
    (blockhash) => {
      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: SWEEP_PRIORITY_MICROLAMPORTS,
        }),
        SystemProgram.transfer({
          fromPubkey: escrowKeypair.publicKey,
          toPubkey: custodialPubkey,
          lamports: Number(lamports),
        })
      );
      tx.feePayer = escrowKeypair.publicKey;
      tx.recentBlockhash = blockhash;
      tx.sign(escrowKeypair);
      return tx;
    },
    "fundCustodialWallet"
  );
}

/**
 * Move all SPL tokens of `mint` held by the custodial wallet into the given
 * destination wallet's associated token account. Creates the destination ATA
 * if it doesn't exist, fee-paid by the custodial wallet.
 * Returns the tx signature and the amount of base units swept.
 */
export async function sweepTokensToWallet(
  connection: Connection,
  mintAddress: string,
  destinationOwner: PublicKey,
  wallet: PumpPortalWallet
): Promise<{ signature: string; amount: bigint }> {
  const custodial = wallet.keypair;
  const mintPubkey = new PublicKey(mintAddress);

  // Pump.fun mints created since the Token-2022 cutover are owned by the
  // Token-2022 program, not the legacy SPL Token program. ATAs for
  // Token-2022 mints have a DIFFERENT derived address because the program
  // id is part of the seed. We must detect the mint's owner program first
  // and route every subsequent ATA derivation, getAccount, and transfer
  // instruction through the matching token program.
  const mintAccountInfo = await connection.getAccountInfo(mintPubkey);
  if (!mintAccountInfo) {
    throw new Error(
      `Mint account ${mintAddress} not found on-chain — Lightning create may not have landed yet`
    );
  }
  const mintOwner = mintAccountInfo.owner;
  let tokenProgramId: PublicKey;
  if (mintOwner.equals(TOKEN_2022_PROGRAM_ID)) {
    tokenProgramId = TOKEN_2022_PROGRAM_ID;
    console.log(`[sweepTokensToWallet] mint ${mintAddress} is Token-2022`);
  } else if (mintOwner.equals(TOKEN_PROGRAM_ID)) {
    tokenProgramId = TOKEN_PROGRAM_ID;
    console.log(`[sweepTokensToWallet] mint ${mintAddress} is legacy SPL Token`);
  } else {
    throw new Error(
      `Mint ${mintAddress} owned by unsupported program ${mintOwner.toBase58()}`
    );
  }

  const sourceAta = await getAssociatedTokenAddress(
    mintPubkey,
    custodial.publicKey,
    false,
    tokenProgramId
  );
  const destAta = await getAssociatedTokenAddress(
    mintPubkey,
    destinationOwner,
    false,
    tokenProgramId
  );
  console.log(
    `[sweepTokensToWallet] sourceAta=${sourceAta.toBase58()} destAta=${destAta.toBase58()}`
  );

  let amount = 0n;
  try {
    const sourceAccount = await getAccount(
      connection,
      sourceAta,
      "confirmed",
      tokenProgramId
    );
    amount = sourceAccount.amount;
  } catch (err: any) {
    throw new Error(
      `Custodial wallet has no token account for mint ${mintAddress} (program ${tokenProgramId.toBase58()}): ${
        err?.message ?? err
      }`
    );
  }
  console.log(`[sweepTokensToWallet] custodial holds ${amount} base units`);

  if (amount === 0n) {
    throw new Error(
      `Custodial wallet token balance is 0 for mint ${mintAddress} — Lightning create may not have completed`
    );
  }

  // Check destination ATA existence ONCE outside the retry loop. If it
  // exists at first attempt, we shouldn't keep re-checking on each retry
  // because creating it twice fails the second time.
  const destAtaExists = !!(await connection.getAccountInfo(destAta));

  const signature = await sendAndConfirmWithRetry(
    connection,
    (blockhash) => {
      const tx = new Transaction();
      tx.add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: SWEEP_PRIORITY_MICROLAMPORTS,
        })
      );
      if (!destAtaExists) {
        tx.add(
          createAssociatedTokenAccountInstruction(
            custodial.publicKey,
            destAta,
            destinationOwner,
            mintPubkey,
            tokenProgramId
          )
        );
      }
      tx.add(
        createTransferInstruction(
          sourceAta,
          destAta,
          custodial.publicKey,
          amount,
          [],
          tokenProgramId
        )
      );
      tx.feePayer = custodial.publicKey;
      tx.recentBlockhash = blockhash;
      tx.sign(custodial);
      return tx;
    },
    "sweepTokensToWallet"
  );
  return { signature, amount };
}

/**
 * Sweep residual SOL from the custodial wallet into a destination wallet,
 * leaving CUSTODIAL_SOL_FLOOR_LAMPORTS behind so the wallet stays
 * rent-exempt and ready for the next launch. Returns the swept amount and
 * tx signature, or null if there's nothing meaningful to sweep.
 */
export async function sweepSolToWallet(
  connection: Connection,
  destination: PublicKey,
  wallet: PumpPortalWallet
): Promise<{ signature: string; amount: bigint } | null> {
  const custodial = wallet.keypair;
  const balance = BigInt(
    await connection.getBalance(custodial.publicKey, "confirmed")
  );

  // Reserve the floor + a tx fee for this sweep itself.
  const txFee = 5_000n;
  if (balance <= CUSTODIAL_SOL_FLOOR_LAMPORTS + txFee) {
    return null;
  }
  const sweepAmount = balance - CUSTODIAL_SOL_FLOOR_LAMPORTS - txFee;

  const signature = await sendAndConfirmWithRetry(
    connection,
    (blockhash) => {
      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: SWEEP_PRIORITY_MICROLAMPORTS,
        }),
        SystemProgram.transfer({
          fromPubkey: custodial.publicKey,
          toPubkey: destination,
          lamports: Number(sweepAmount),
        })
      );
      tx.feePayer = custodial.publicKey;
      tx.recentBlockhash = blockhash;
      tx.sign(custodial);
      return tx;
    },
    "sweepSolToWallet"
  );
  return { signature, amount: sweepAmount };
}

export function lamportsToSol(lamports: bigint | number): string {
  const n = typeof lamports === "bigint" ? Number(lamports) : lamports;
  return (n / LAMPORTS_PER_SOL).toFixed(6);
}