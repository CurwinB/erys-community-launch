import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { decryptEscrowKey } from "./decrypt";
import { supabase } from "./db";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const TX_FEE = 5_000n;
const RENT_EXEMPT_RESERVE = 890_880n;

// Best-effort bulk refund of all contributors of a failed launch.
// Mirrors supabase/functions/refund-launch logic but runs in Node from
// the executor so failures auto-trigger refunds without admin action.
export async function refundFailedLaunch(launchId: string): Promise<void> {
  console.log(`Auto-refunding contributors for failed launch ${launchId}`);

  const { data: launch, error: launchErr } = await supabase
    .from("launches")
    .select(
      "escrow_wallet_encrypted_private_key, status, platform, pumpfun_launch_signature"
    )
    .eq("id", launchId)
    .single();

  if (launchErr || !launch) {
    console.error(`refundFailedLaunch: launch ${launchId} not found`, launchErr?.message);
    return;
  }

  // Hard guardrail: never auto-refund a Pump.fun launch whose mint exists
  // on-chain. SOL is in the bonding curve; the correct payout is tokens.
  if (
    launch.platform === "pumpfun" &&
    (launch.status === "launched" ||
      launch.status === "sweep_recovery" ||
      launch.pumpfun_launch_signature)
  ) {
    console.warn(
      `refundFailedLaunch: skipping ${launchId} — Pump.fun mint exists on-chain (status=${launch.status}, sig=${launch.pumpfun_launch_signature ?? "<none>"}). Tokens will be distributed instead.`,
    );
    return;
  }

  const { data: contributions, error: contribErr } = await supabase
    .from("contributions")
    .select("*")
    .eq("launch_id", launchId)
    .order("contributed_at", { ascending: true });

  if (contribErr) {
    console.error(`refundFailedLaunch: error loading contributions`, contribErr.message);
    return;
  }
  if (!contributions || contributions.length === 0) {
    console.log(`refundFailedLaunch: no contributions for ${launchId}`);
    return;
  }

  let escrowSecret: Buffer;
  try {
    escrowSecret = decryptEscrowKey(launch.escrow_wallet_encrypted_private_key);
  } catch (err: any) {
    console.error(`refundFailedLaunch: decrypt failed for ${launchId}:`, err.message);
    return;
  }

  if (escrowSecret.length !== 64) {
    console.error(
      `refundFailedLaunch: invalid escrow key length ${escrowSecret.length} for ${launchId}`,
    );
    return;
  }

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const escrowKeypair = Keypair.fromSecretKey(new Uint8Array(escrowSecret));

  let escrowAvailable: bigint;
  try {
    escrowAvailable =
      BigInt(await connection.getBalance(escrowKeypair.publicKey, "confirmed")) -
      RENT_EXEMPT_RESERVE;
  } catch (err: any) {
    console.error(`refundFailedLaunch: getBalance failed:`, err.message);
    return;
  }

  let refunded = 0;
  let partial = 0;
  let unrecoverable = 0;
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
        unrecoverable++;
        continue;
      }

      const spendable = escrowAvailable - TX_FEE;
      const payout = requested < spendable ? requested : spendable;
      const shortfall = requested - payout;

      const txSignature = await sendRefundWithRetry(
        connection,
        escrowKeypair,
        new PublicKey(contrib.wallet_address),
        Number(payout),
      );

      await supabase
        .from("contributions")
        .update({
          refund_tx_signature: txSignature,
          refund_shortfall_lamports: Number(shortfall),
        })
        .eq("id", contrib.id);

      escrowAvailable -= payout + TX_FEE;
      refunded++;
      if (shortfall > 0n) partial++;
    } catch (err: any) {
      console.error(
        `refundFailedLaunch: refund failed for ${contrib.wallet_address}:`,
        err.message,
      );
      failed++;
    }
  }

  console.log(
    `refundFailedLaunch ${launchId}: refunded=${refunded} partial=${partial} unrecoverable=${unrecoverable} failed=${failed} total=${contributions.length}`,
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
          `Refund transaction failed on-chain: ${JSON.stringify(result.value.err)}`,
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
      } catch (_) {
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