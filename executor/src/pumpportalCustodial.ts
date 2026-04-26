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
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
} from "@solana/spl-token";
import bs58 from "bs58";

/**
 * Helpers for working with the shared PumpPortal Lightning custodial wallet.
 *
 * The PumpPortal Lightning API signs and submits all create / buy / sell
 * transactions using a custodial wallet that PumpPortal generates for you.
 * Per their FAQ, the wallet is a normal Solana keypair — they give you the
 * private key on creation and we hold it as a secret. We use that private
 * key to sweep tokens and SOL back to the per-launch escrow wallet so the
 * rest of the system (distributor, fee claimer, refund flow) keeps working
 * exactly as it does today, with the escrow as the source of truth.
 */

const CUSTODIAL_PRIVATE_KEY_BS58 = process.env.PUMPPORTAL_CUSTODIAL_PRIVATE_KEY!;
const CUSTODIAL_PUBLIC_KEY = process.env.PUMPPORTAL_CUSTODIAL_WALLET!;

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

let cachedKeypair: Keypair | null = null;

export function getCustodialKeypair(): Keypair {
  if (cachedKeypair) return cachedKeypair;
  if (!CUSTODIAL_PRIVATE_KEY_BS58) {
    throw new Error("PUMPPORTAL_CUSTODIAL_PRIVATE_KEY env var is not set");
  }
  const secret = bs58.decode(CUSTODIAL_PRIVATE_KEY_BS58);
  if (secret.length !== 64) {
    throw new Error(
      `PUMPPORTAL_CUSTODIAL_PRIVATE_KEY decoded to ${secret.length} bytes, expected 64`
    );
  }
  cachedKeypair = Keypair.fromSecretKey(new Uint8Array(secret));
  // Sanity-check: decoded pubkey must match the PUMPPORTAL_CUSTODIAL_WALLET
  // secret. Mismatched keypair vs wallet is an instant disaster, so fail loud.
  if (
    CUSTODIAL_PUBLIC_KEY &&
    cachedKeypair.publicKey.toBase58() !== CUSTODIAL_PUBLIC_KEY
  ) {
    throw new Error(
      `PUMPPORTAL_CUSTODIAL_PRIVATE_KEY pubkey ${cachedKeypair.publicKey.toBase58()} does not match PUMPPORTAL_CUSTODIAL_WALLET ${CUSTODIAL_PUBLIC_KEY}`
    );
  }
  return cachedKeypair;
}

export function getCustodialPublicKey(): PublicKey {
  return getCustodialKeypair().publicKey;
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
  lamports: bigint
): Promise<string> {
  const custodialPubkey = getCustodialPublicKey();
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
  destinationOwner: PublicKey
): Promise<{ signature: string; amount: bigint }> {
  const custodial = getCustodialKeypair();
  const mintPubkey = new PublicKey(mintAddress);

  const sourceAta = await getAssociatedTokenAddress(
    mintPubkey,
    custodial.publicKey
  );
  const destAta = await getAssociatedTokenAddress(mintPubkey, destinationOwner);

  let amount = 0n;
  try {
    const sourceAccount = await getAccount(connection, sourceAta);
    amount = sourceAccount.amount;
  } catch (err: any) {
    throw new Error(
      `Custodial wallet has no token account for mint ${mintAddress}: ${
        err?.message ?? err
      }`
    );
  }

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
            mintPubkey
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
          TOKEN_PROGRAM_ID
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
  destination: PublicKey
): Promise<{ signature: string; amount: bigint } | null> {
  const custodial = getCustodialKeypair();
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