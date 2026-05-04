import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { decryptEscrowKey } from "./decrypt";
import { supabase } from "./db";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const SOLANA_WSS_URL =
  process.env.SOLANA_WSS_URL ||
  SOLANA_RPC_URL.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
const TX_FEE = 5_000n;
const RENT_EXEMPT_RESERVE = 890_880n;

/**
 * Sweeps `contributions.pending_orphan_refund = true` rows and refunds the
 * SOL that landed in escrow but failed downstream validation (race against
 * launch state change). Only fires for genuine races — the pre-flight
 * `validate-contribution` edge function blocks the common cases before any
 * SOL ever moves.
 */
export async function refundOrphanContributions(): Promise<void> {
  const { data: rows, error } = await supabase
    .from("contributions")
    .select(
      "id, launch_id, wallet_address, amount_lamports, token_delivery_wallet, refund_tx_signature"
    )
    .eq("pending_orphan_refund", true)
    .is("refund_tx_signature", null)
    .limit(25);

  if (error) {
    console.error("refundOrphanContributions: select failed:", error.message);
    return;
  }
  if (!rows || rows.length === 0) return;

  console.log(`refundOrphanContributions: ${rows.length} pending orphan refund(s)`);

  // Group by launch so we decrypt each escrow keypair once.
  const byLaunch = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byLaunch.get(r.launch_id) ?? [];
    arr.push(r);
    byLaunch.set(r.launch_id, arr);
  }

  const connection = new Connection(SOLANA_RPC_URL, {
    commitment: "confirmed",
    wsEndpoint: SOLANA_WSS_URL,
  });

  for (const [launchId, contribs] of byLaunch) {
    const { data: launch, error: launchErr } = await supabase
      .from("launches")
      .select("id, escrow_wallet_encrypted_private_key")
      .eq("id", launchId)
      .single();
    if (launchErr || !launch) {
      console.error(
        `refundOrphanContributions: launch ${launchId} not found:`,
        launchErr?.message
      );
      continue;
    }

    let escrowSecret: Buffer;
    try {
      escrowSecret = decryptEscrowKey(launch.escrow_wallet_encrypted_private_key);
    } catch (err: any) {
      console.error(
        `refundOrphanContributions: decrypt failed for ${launchId}:`,
        err.message
      );
      continue;
    }
    if (escrowSecret.length !== 64) continue;
    const escrowKeypair = Keypair.fromSecretKey(new Uint8Array(escrowSecret));

    let escrowAvailable: bigint;
    try {
      escrowAvailable =
        BigInt(await connection.getBalance(escrowKeypair.publicKey, "confirmed")) -
        RENT_EXEMPT_RESERVE;
    } catch (err: any) {
      console.error(`refundOrphanContributions: getBalance failed:`, err.message);
      continue;
    }

    for (const contrib of contribs) {
      try {
        const requested = BigInt(contrib.amount_lamports) - TX_FEE;
        if (requested <= 0n) continue;
        if (escrowAvailable <= TX_FEE) {
          await supabase
            .from("contributions")
            .update({ refund_shortfall_lamports: Number(requested) })
            .eq("id", contrib.id);
          continue;
        }
        const spendable = escrowAvailable - TX_FEE;
        const payout = requested < spendable ? requested : spendable;
        const shortfall = requested - payout;

        const recipient = new PublicKey(
          contrib.token_delivery_wallet || contrib.wallet_address
        );

        const sig = await sendRefundOnce(
          connection,
          escrowKeypair,
          recipient,
          Number(payout)
        );

        await supabase
          .from("contributions")
          .update({
            refund_tx_signature: sig,
            refund_shortfall_lamports: Number(shortfall),
            pending_orphan_refund: false,
          })
          .eq("id", contrib.id);

        escrowAvailable -= payout + TX_FEE;
        console.log(
          `Orphan refund ${Number(payout) / LAMPORTS_PER_SOL} SOL to ${recipient.toBase58()}: ${sig}`
        );
      } catch (err: any) {
        console.error(
          `refundOrphanContributions: refund failed for ${contrib.id}:`,
          err.message
        );
      }
    }
  }
}

async function sendRefundOnce(
  connection: Connection,
  escrowKeypair: Keypair,
  recipient: PublicKey,
  lamports: number
): Promise<string> {
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
    })
  );
  tx.sign(escrowKeypair);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 5,
  });
  const result = await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  if (result.value.err) {
    throw new Error(`Orphan refund tx failed: ${JSON.stringify(result.value.err)}`);
  }
  return sig;
}