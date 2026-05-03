import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

// Hidden platform processing fee. Charged from the escrow wallet to the
// platform treasury just before the launch transaction whenever the total
// raised meets a tier threshold. Invisible to users — fee-share BPS and
// token-distribution BPS continue to be calculated from the original
// contribution amounts so contributors are not penalized.
//
// Tiers:
//   total >= 2.0 SOL  -> 5% of total
//   total >= 0.3 SOL  -> 0.06 SOL
//   total <  0.3 SOL  -> 0
export const PROCESSING_FEE_THRESHOLD_LOW  = 300_000_000n;   // 0.3 SOL
export const PROCESSING_FEE_THRESHOLD_HIGH = 2_000_000_000n; // 2.0 SOL
export const PROCESSING_FEE_LOW  = 60_000_000n;              // 0.06 SOL flat
export const PROCESSING_FEE_HIGH_PERCENT = 5n;               // 5% above 2 SOL
const PROCESSING_FEE_TX_FEE = 5_000n; // network fee for the SystemProgram.transfer

// How long we re-poll signature status after a confirmTransaction throw
// before deciding the tx genuinely didn't land. Mirrors the pattern in
// fundSponsoredEscrow.ts so RPC blockhash flakiness doesn't abort launches.
const CONFIRM_RECOVERY_POLL_MS = 30_000;
const CONFIRM_RECOVERY_INTERVAL_MS = 2_000;
const MAX_SEND_ATTEMPTS = 3;

export function shouldChargeProcessingFee(totalLamports: bigint): boolean {
  return totalLamports >= PROCESSING_FEE_THRESHOLD_LOW;
}

/**
 * Returns the processing-fee debit (in lamports) that should be charged for
 * a launch raising `totalLamports`. Returns 0n when no fee applies.
 */
export function getProcessingFeeLamports(totalLamports: bigint): bigint {
  if (totalLamports >= PROCESSING_FEE_THRESHOLD_HIGH) {
    // 5% of total contributions for launches >= 2 SOL — smooth scaling, no cliff
    return (totalLamports * PROCESSING_FEE_HIGH_PERCENT) / 100n;
  }
  if (totalLamports >= PROCESSING_FEE_THRESHOLD_LOW) return PROCESSING_FEE_LOW;
  return 0n;
}

export interface ProcessingFeeResult {
  charged: boolean;
  signature?: string;
  feeLamports?: bigint;
}

/**
 * Poll signature status until landed (confirmed/finalized) or the budget
 * runs out. Returns true on landing, false on timeout, throws on tx error.
 */
async function waitForSignatureLanded(
  connection: Connection,
  signature: string,
  budgetMs: number,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    try {
      const res = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const status = res?.value?.[0];
      if (status) {
        if (status.err) {
          throw new Error(
            `Processing fee tx ${signature} reverted on-chain: ${JSON.stringify(
              status.err,
            )}`,
          );
        }
        const conf = status.confirmationStatus;
        if (conf === "confirmed" || conf === "finalized") return true;
      }
    } catch (err: any) {
      // Re-throw on-chain reverts; swallow transient RPC errors.
      if (err?.message?.includes("reverted on-chain")) throw err;
    }
    await new Promise((r) => setTimeout(r, CONFIRM_RECOVERY_INTERVAL_MS));
  }
  return false;
}

/**
 * If the launch row already has a processing_fee_tx_signature, check it
 * on-chain. If finalized → treat as already paid (idempotency). Returns
 * the existing signature on success, null otherwise.
 */
export async function findAlreadyPaidProcessingFee(
  connection: Connection,
  existingSignature: string | null | undefined,
): Promise<string | null> {
  if (!existingSignature) return null;
  try {
    const res = await connection.getSignatureStatuses([existingSignature], {
      searchTransactionHistory: true,
    });
    const status = res?.value?.[0];
    if (!status) return null;
    if (status.err) return null; // reverted — treat as not paid, charge again
    const conf = status.confirmationStatus;
    if (conf === "confirmed" || conf === "finalized") {
      return existingSignature;
    }
  } catch {
    // ignore — fall through to fresh charge
  }
  return null;
}

/**
 * Transfers (tier fee - tx fee) from the escrow wallet to the platform
 * treasury. The on-chain debit on the escrow is exactly the tier fee
 * (transfer + 5_000 network fee). Tier is selected from `totalLamports`
 * via getProcessingFeeLamports.
 *
 * Hardened against RPC blockhash flakiness:
 *   - If `existingSignature` is provided and finalized on-chain, returns it
 *     immediately (no second debit).
 *   - On confirmTransaction throw, re-polls signature status before treating
 *     it as a failure (the tx often lands seconds after we gave up).
 *   - On a true blockhash expiry, re-signs with a fresh blockhash up to
 *     MAX_SEND_ATTEMPTS times.
 *
 * Throws only after every recovery path is exhausted.
 */
export async function chargeProcessingFee(
  connection: Connection,
  escrowKeypair: Keypair,
  treasuryWallet: string,
  launchId: string,
  totalLamports: bigint,
  existingSignature?: string | null,
): Promise<ProcessingFeeResult> {
  const feeLamports = getProcessingFeeLamports(totalLamports);
  if (feeLamports === 0n) {
    return { charged: false };
  }

  // Idempotency: if a prior attempt already landed, return it.
  const alreadyPaid = await findAlreadyPaidProcessingFee(
    connection,
    existingSignature,
  );
  if (alreadyPaid) {
    console.log(
      `[launch ${launchId}] Processing fee already paid on-chain (${alreadyPaid}) — skipping`,
    );
    return {
      charged: true,
      signature: alreadyPaid,
      feeLamports,
    };
  }

  const transferAmount = feeLamports - PROCESSING_FEE_TX_FEE;

  console.log(
    `[launch ${launchId}] Charging processing fee: ${
      Number(feeLamports) / LAMPORTS_PER_SOL
    } SOL → ${treasuryWallet} (total contributions: ${
      Number(totalLamports) / LAMPORTS_PER_SOL
    } SOL)`,
  );

  let lastError: any = null;
  let lastSignature: string | null = null;

  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: escrowKeypair.publicKey,
        toPubkey: new PublicKey(treasuryWallet),
        lamports: Number(transferAmount),
      }),
    );
    tx.feePayer = escrowKeypair.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(escrowKeypair);

    let signature: string;
    try {
      signature = await connection.sendRawTransaction(tx.serialize(), {
        preflightCommitment: "confirmed",
      });
    } catch (sendErr: any) {
      lastError = sendErr;
      console.warn(
        `[launch ${launchId}] Processing fee send attempt ${attempt} failed: ${sendErr?.message ?? sendErr}`,
      );
      // If a previous attempt produced a signature still in-flight, check it.
      if (lastSignature) {
        const landed = await waitForSignatureLanded(
          connection,
          lastSignature,
          CONFIRM_RECOVERY_POLL_MS,
        );
        if (landed) {
          console.log(
            `[launch ${launchId}] Prior attempt's tx ${lastSignature} landed during retry — using it`,
          );
          return {
            charged: true,
            signature: lastSignature,
            feeLamports,
          };
        }
      }
      continue;
    }

    lastSignature = signature;

    try {
      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
      );
      console.log(`[launch ${launchId}] Processing fee sent: ${signature}`);
      console.log(
        `[launch ${launchId}] Solscan: https://solscan.io/tx/${signature}`,
      );
      return {
        charged: true,
        signature,
        feeLamports,
      };
    } catch (confirmErr: any) {
      lastError = confirmErr;
      console.warn(
        `[launch ${launchId}] confirmTransaction threw on attempt ${attempt} (${confirmErr?.message ?? confirmErr}) — polling status for ${CONFIRM_RECOVERY_POLL_MS}ms before retry`,
      );

      // The tx may still land. Poll status before declaring failure.
      try {
        const landed = await waitForSignatureLanded(
          connection,
          signature,
          CONFIRM_RECOVERY_POLL_MS,
        );
        if (landed) {
          console.log(
            `[launch ${launchId}] Processing fee tx ${signature} landed after confirm timeout`,
          );
          return {
            charged: true,
            signature,
            feeLamports,
          };
        }
      } catch (statusErr: any) {
        // On-chain revert — bail out, do not retry.
        throw statusErr;
      }

      // Not landed within budget. Loop will rebuild with a fresh blockhash.
    }
  }

  throw new Error(
    `Processing fee transfer failed after ${MAX_SEND_ATTEMPTS} attempts. Last error: ${
      lastError?.message ?? lastError ?? "unknown"
    }${lastSignature ? ` Last signature: ${lastSignature}` : ""}`,
  );
}