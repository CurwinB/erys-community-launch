// Recovery worker: sweeps SOL out of cancelled sponsored launch escrows
// back to the Erys platform (Bags) wallet.
//
// When a sponsored claim flow ends in `status='cancelled'` (e.g. funding
// retries exhausted, expired link after pre-funding, rare race conditions)
// the 0.1 SOL we already sent to the freshly-generated escrow wallet
// would otherwise be stranded — its private key is encrypted in the DB
// but no human has the keys to spend it. This worker decrypts the escrow
// key, sweeps the spendable balance back to the platform wallet, and
// records the recovery so we never re-attempt it.
//
// Idempotency / safety:
//   - We claim one cancelled-sponsor row at a time via an SQL function
//     with a worker-lock TTL so multiple replicas can run safely.
//   - We re-read the on-chain balance every tick. If it's already empty
//     (or below rent + fee) we just mark recovery_completed_at and move on.
//   - On confirm timeout we recheck signature status + balance before
//     declaring failure, mirroring fundSponsoredEscrow.ts.

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { decryptEscrowKey } from "./decrypt";
import { supabase } from "./db";

const TX_FEE_LAMPORTS = 5_000;
const RENT_EXEMPT_RESERVE_LAMPORTS = 890_880;
// Anything strictly above this is worth sweeping (rent + fee + minimum payout).
const MIN_RECOVERABLE_LAMPORTS = RENT_EXEMPT_RESERVE_LAMPORTS + TX_FEE_LAMPORTS + 1;
const MAX_RECOVERY_ATTEMPTS = 5;
const POST_FAILURE_RECHECK_DELAY_MS = 8_000;

interface SponsorRecoveryRow {
  id: string;
  escrow_wallet_public_key: string;
  escrow_wallet_encrypted_private_key: string;
  sponsor_recovery_attempts: number;
}

async function claimNextRecovery(
  workerId: string,
): Promise<SponsorRecoveryRow | null> {
  const { data, error } = await supabase.rpc(
    "claim_sponsor_recovery_for_worker",
    { p_worker_id: workerId, p_lock_expiry_seconds: 120 },
  );
  if (error) {
    console.error("Error claiming sponsor recovery row:", error.message);
    return null;
  }
  return (data?.[0] as SponsorRecoveryRow) || null;
}

async function markRecovered(
  launchId: string,
  amount: number,
  signature: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("launches")
    .update({
      sponsor_recovery_completed_at: new Date().toISOString(),
      sponsor_recovery_tx_signature: signature,
      sponsor_recovery_amount_lamports: amount,
      sponsor_recovery_error: null,
      worker_locked_at: null,
      worker_id: null,
    })
    .eq("id", launchId);
  if (error) {
    console.error(
      `Recovered ${launchId} but failed to update DB:`,
      error.message,
    );
  }
}

async function markRecoveryNothingToDo(launchId: string): Promise<void> {
  // Escrow already empty — record completion with a 0 amount so we don't
  // pick this row up again.
  await supabase
    .from("launches")
    .update({
      sponsor_recovery_completed_at: new Date().toISOString(),
      sponsor_recovery_amount_lamports: 0,
      sponsor_recovery_error: null,
      worker_locked_at: null,
      worker_id: null,
    })
    .eq("id", launchId);
}

async function recordRecoveryFailure(
  launchId: string,
  attempts: number,
  errorMsg: string,
): Promise<void> {
  // We never auto-give-up permanently — we just stop retrying after
  // MAX_RECOVERY_ATTEMPTS by keeping completed_at NULL but logging the
  // error. Admin can manually clear sponsor_recovery_attempts to retry.
  const giveUp = attempts >= MAX_RECOVERY_ATTEMPTS;
  await supabase
    .from("launches")
    .update({
      sponsor_recovery_attempts: attempts,
      sponsor_recovery_error: errorMsg.slice(0, 500),
      // Mark as completed once we've burned all retries, so we stop
      // re-claiming this row every tick. Ops can reset by clearing
      // attempts + completed_at if they want to try again.
      sponsor_recovery_completed_at: giveUp
        ? new Date().toISOString()
        : null,
      worker_locked_at: null,
      worker_id: null,
    })
    .eq("id", launchId);
}

export async function sweepAllCancelledSponsorEscrows(
  workerId: string,
): Promise<void> {
  const platformPk = process.env.ERYS_PLATFORM_PRIVATE_KEY;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!platformPk || !rpcUrl) {
    return;
  }

  let platformKeypair: Keypair;
  try {
    platformKeypair = Keypair.fromSecretKey(bs58.decode(platformPk));
  } catch (err: any) {
    console.error(
      "Invalid ERYS_PLATFORM_PRIVATE_KEY (expected base58):",
      err?.message ?? err,
    );
    return;
  }

  const wssUrl =
    process.env.SOLANA_WSS_URL ||
    rpcUrl.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: wssUrl,
  });

  while (true) {
    const row = await claimNextRecovery(workerId);
    if (!row) break;

    console.log(
      `Worker ${workerId} claimed cancelled sponsored launch ${row.id} for SOL recovery`,
    );

    const nextAttempts = (row.sponsor_recovery_attempts || 0) + 1;

    let escrowKeypair: Keypair;
    try {
      const secret = decryptEscrowKey(row.escrow_wallet_encrypted_private_key);
      escrowKeypair = Keypair.fromSecretKey(new Uint8Array(secret));
    } catch (err: any) {
      const msg = `Failed to decrypt escrow key: ${err?.message ?? err}`;
      console.error(`[recovery] ${row.id}: ${msg}`);
      await recordRecoveryFailure(row.id, nextAttempts, msg);
      continue;
    }

    const escrowPubkey = escrowKeypair.publicKey;

    let balance: number;
    try {
      balance = await connection.getBalance(escrowPubkey, "confirmed");
    } catch (err: any) {
      const msg = `Failed to fetch escrow balance: ${err?.message ?? err}`;
      console.error(`[recovery] ${row.id}: ${msg}`);
      await recordRecoveryFailure(row.id, nextAttempts, msg);
      continue;
    }

    if (balance < MIN_RECOVERABLE_LAMPORTS) {
      console.log(
        `[recovery] ${row.id}: escrow balance ${balance} below recoverable threshold — marking complete (nothing to sweep).`,
      );
      await markRecoveryNothingToDo(row.id);
      continue;
    }

    const sweepLamports = balance - RENT_EXEMPT_RESERVE_LAMPORTS - TX_FEE_LAMPORTS;

    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: escrowPubkey,
          toPubkey: platformKeypair.publicKey,
          lamports: sweepLamports,
        }),
      );
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = escrowPubkey;
      tx.sign(escrowKeypair);

      let pendingSignature: string | null = null;
      try {
        pendingSignature = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 3,
        });
        await connection.confirmTransaction(
          { signature: pendingSignature, blockhash, lastValidBlockHeight },
          "confirmed",
        );
        console.log(
          `[recovery] Swept ${sweepLamports / LAMPORTS_PER_SOL} SOL from ${
            row.id
          } back to platform wallet (sig ${pendingSignature})`,
        );
        await markRecovered(row.id, sweepLamports, pendingSignature);
      } catch (sendErr: any) {
        const sendMsg = sendErr?.message ?? String(sendErr);
        console.warn(
          `[recovery] Send/confirm failed for ${row.id}: ${sendMsg} — rechecking on-chain state...`,
        );
        await new Promise((r) =>
          setTimeout(r, POST_FAILURE_RECHECK_DELAY_MS),
        );

        let landed = false;
        if (pendingSignature) {
          try {
            const status = await connection.getSignatureStatus(
              pendingSignature,
              { searchTransactionHistory: true },
            );
            const conf = status.value?.confirmationStatus;
            if (
              !status.value?.err &&
              (conf === "confirmed" || conf === "finalized")
            ) {
              landed = true;
            }
          } catch {
            // fall through to balance check
          }
        }
        if (!landed) {
          const recheck = await connection.getBalance(
            escrowPubkey,
            "confirmed",
          );
          // If the escrow has dropped close to rent reserve, the sweep
          // landed even if our client lost the response.
          if (recheck < MIN_RECOVERABLE_LAMPORTS) {
            landed = true;
          }
        }

        if (landed) {
          console.log(
            `[recovery] Recovered: sweep for ${row.id} succeeded on-chain despite send error.`,
          );
          await markRecovered(row.id, sweepLamports, pendingSignature);
        } else {
          throw sendErr;
        }
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`[recovery] Sweep failed for ${row.id}:`, msg);
      await recordRecoveryFailure(row.id, nextAttempts, msg);
    }
  }
}
