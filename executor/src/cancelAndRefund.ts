import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { decryptEscrowKey } from "./decrypt";
import { supabase, Launch, Contribution } from "./db";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const SOLANA_WSS_URL =
  process.env.SOLANA_WSS_URL ||
  SOLANA_RPC_URL.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
const TX_FEE = 5_000n;
const RENT_EXEMPT_RESERVE = 890_880n;

/**
 * Auto-cancel + refund for launches that fail the minimum-pool threshold
 * (0.3 SOL). Marks the launch `cancelled`, refunds contributors pro-rata
 * down if escrow can't cover (matches refundFailedLaunch.ts semantics),
 * and leaves any sponsored seed for the existing
 * sweepCancelledSponsorEscrows worker to recover to the treasury.
 */
export async function cancelAndRefund(
  launch: Launch,
  contributions: Contribution[],
): Promise<void> {
  console.log(
    `Cancelling launch ${launch.id} (insufficient pool). Refunding ${contributions.length} contributors.`,
  );

  // 1) Mark launch cancelled FIRST so re-claims won't re-enter execution.
  const { error: cancelErr } = await supabase
    .from("launches")
    .update({
      status: "cancelled",
      execution_error:
        "Insufficient pool. Minimum 0.3 SOL required. Launch cancelled and contributors refunded.",
      worker_locked_at: null,
      worker_id: null,
    })
    .eq("id", launch.id);
  if (cancelErr) {
    console.error(
      `cancelAndRefund: failed to mark launch ${launch.id} cancelled: ${cancelErr.message}`,
    );
    return;
  }

  if (contributions.length === 0) return;

  // 2) Decrypt escrow keypair (raw 64-byte secret — see decrypt.ts).
  let escrowSecret: Buffer;
  try {
    escrowSecret = decryptEscrowKey(launch.escrow_wallet_encrypted_private_key);
  } catch (err: any) {
    console.error(`cancelAndRefund: decrypt failed for ${launch.id}:`, err.message);
    return;
  }
  if (escrowSecret.length !== 64) {
    console.error(
      `cancelAndRefund: invalid escrow key length ${escrowSecret.length} for ${launch.id}`,
    );
    return;
  }

  const connection = new Connection(SOLANA_RPC_URL, {
    commitment: "confirmed",
    wsEndpoint: SOLANA_WSS_URL,
  });
  const escrowKeypair = Keypair.fromSecretKey(new Uint8Array(escrowSecret));

  let escrowAvailable: bigint;
  try {
    escrowAvailable =
      BigInt(await connection.getBalance(escrowKeypair.publicKey, "confirmed")) -
      RENT_EXEMPT_RESERVE;
  } catch (err: any) {
    console.error(`cancelAndRefund: getBalance failed:`, err.message);
    return;
  }

  let refunded = 0;
  let partial = 0;
  let failed = 0;

  for (const contrib of contributions as any[]) {
    try {
      if (contrib.refund_tx_signature) continue;

      const requested = BigInt(contrib.amount_lamports) - TX_FEE;
      if (requested <= 0n) {
        failed++;
        continue;
      }
      if (escrowAvailable <= TX_FEE) {
        await supabase
          .from("contributions")
          .update({ refund_shortfall_lamports: Number(requested) })
          .eq("id", contrib.id);
        failed++;
        continue;
      }

      const spendable = escrowAvailable - TX_FEE;
      const payout = requested < spendable ? requested : spendable;
      const shortfall = requested - payout;

      const recipient = new PublicKey(
        contrib.token_delivery_wallet || contrib.wallet_address,
      );

      const sig = await sendRefundWithRetry(
        connection,
        escrowKeypair,
        recipient,
        Number(payout),
      );

      await supabase
        .from("contributions")
        .update({
          refund_tx_signature: sig,
          refund_shortfall_lamports: Number(shortfall),
        })
        .eq("id", contrib.id);

      escrowAvailable -= payout + TX_FEE;
      refunded++;
      if (shortfall > 0n) partial++;
      console.log(
        `Refunded ${Number(payout) / LAMPORTS_PER_SOL} SOL to ${recipient.toBase58()}: ${sig}`,
      );
    } catch (err: any) {
      console.error(
        `cancelAndRefund: refund failed for ${contrib.wallet_address}:`,
        err.message,
      );
      failed++;
    }
  }

  console.log(
    `cancelAndRefund ${launch.id}: refunded=${refunded} partial=${partial} failed=${failed} total=${contributions.length}`,
  );
}

async function sendRefundWithRetry(
  connection: Connection,
  escrowKeypair: Keypair,
  recipient: PublicKey,
  lamports: number,
  maxAttempts = 3,
): Promise<string> {
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({
      feePayer: escrowKeypair.publicKey,
      blockhash,
      lastValidBlockHeight,
    }).add(
      SystemProgram.transfer({
        fromPubkey: escrowKeypair.publicKey,
        toPubkey: recipient,
        lamports,
      }),
    );
    tx.sign(escrowKeypair);
    const raw = tx.serialize();
    let signature: string;
    try {
      signature = await connection.sendRawTransaction(raw, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 5,
      });
    } catch (sendErr: any) {
      lastErr = sendErr;
      const msg = sendErr?.message ?? String(sendErr);
      if (
        /insufficient/i.test(msg) ||
        /invalid/i.test(msg) ||
        /unauthorized/i.test(msg) ||
        /forbidden/i.test(msg)
      ) {
        throw new Error(`Refund send failed: ${msg}`);
      }
      if (attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }
      throw new Error(`Refund send failed after ${maxAttempts} attempts: ${msg}`);
    }

    try {
      const result = await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
      );
      if (result.value.err) {
        throw new Error(
          `Refund tx failed on-chain: ${JSON.stringify(result.value.err)}`,
        );
      }
      return signature;
    } catch (confirmErr: any) {
      lastErr = confirmErr;
      const msg = confirmErr?.message ?? String(confirmErr);
      const expired =
        /block height exceeded/i.test(msg) ||
        /TransactionExpired/i.test(msg) ||
        confirmErr?.name === "TransactionExpiredBlockheightExceededError";
      try {
        const status = await connection.getSignatureStatus(signature, {
          searchTransactionHistory: true,
        });
        const conf = status?.value?.confirmationStatus;
        if (
          status?.value &&
          !status.value.err &&
          (conf === "confirmed" || conf === "finalized")
        ) {
          return signature;
        }
      } catch {
        // ignore
      }
      if (expired && attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }
      if (expired) {
        throw new Error(
          `Refund failed after ${maxAttempts} attempts due to blockhash expiry`,
        );
      }
      throw new Error(`Refund confirmation failed: ${msg}`);
    }
  }
  throw lastErr ?? new Error("Refund failed: unknown error");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}