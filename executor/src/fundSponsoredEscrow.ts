// Async funding worker for sponsored launches.
//
// When an influencer claims a sponsored slot, the edge function only
// writes a DB row with status='sponsor_pending_funding'. This worker
// polls for those rows, transfers 0.1 SOL from the platform wallet to
// the launch's escrow, and flips status to 'scheduled'.
//
// Why this is here and not in the edge function:
//   importing @solana/web3.js + bs58 in Deno edge-runtime exceeded the
//   boot CPU budget ("CPU Time exceeded" on cold start). The Railway
//   executor already has the Solana stack loaded and warm.

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { supabase } from "./db";

const SPONSORED_AMOUNT_LAMPORTS = 100_000_000; // 0.1 SOL
const TX_FEE_LAMPORTS = 5_000;
const MAX_FUNDING_ATTEMPTS = 3;

interface SponsorFundingRow {
  id: string;
  escrow_wallet_public_key: string;
  sponsored_amount_lamports: number | null;
  sponsor_funding_attempts: number;
}

async function claimNextSponsorFunding(
  workerId: string,
): Promise<SponsorFundingRow | null> {
  const { data, error } = await supabase.rpc("claim_sponsor_funding_for_worker", {
    p_worker_id: workerId,
    p_lock_expiry_seconds: 120,
  });
  if (error) {
    console.error("Error claiming sponsor funding row:", error.message);
    return null;
  }
  return (data?.[0] as SponsorFundingRow) || null;
}

export async function fundAllPendingSponsoredEscrows(
  workerId: string,
): Promise<void> {
  const platformPk = process.env.ERYS_PLATFORM_PRIVATE_KEY;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!platformPk || !rpcUrl) {
    // Quietly skip if not configured (e.g. local dev).
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

  const connection = new Connection(rpcUrl, "confirmed");

  while (true) {
    const row = await claimNextSponsorFunding(workerId);
    if (!row) break;

    console.log(
      `Worker ${workerId} claimed sponsored launch ${row.id} for escrow funding`,
    );

    try {
      const amount =
        Number(row.sponsored_amount_lamports) || SPONSORED_AMOUNT_LAMPORTS;
      const transferAmount = amount - TX_FEE_LAMPORTS;

      const escrowPubkey = new PublicKey(row.escrow_wallet_public_key);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: platformKeypair.publicKey,
          toPubkey: escrowPubkey,
          lamports: transferAmount,
        }),
      );

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = platformKeypair.publicKey;
      tx.sign(platformKeypair);

      const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 3,
      });

      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
      );

      console.log(
        `Funded sponsored escrow for launch ${row.id}: ${signature} (${
          transferAmount / LAMPORTS_PER_SOL
        } SOL)`,
      );

      const { error: updateErr } = await supabase
        .from("launches")
        .update({
          status: "scheduled",
          sponsored_tx_signature: signature,
          sponsor_funding_error: null,
          worker_locked_at: null,
          worker_id: null,
        })
        .eq("id", row.id);
      if (updateErr) {
        console.error(
          `Funded ${row.id} but failed to update DB:`,
          updateErr.message,
        );
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`Failed to fund sponsored escrow ${row.id}:`, msg);

      const nextAttempts = (row.sponsor_funding_attempts || 0) + 1;
      const giveUp = nextAttempts >= MAX_FUNDING_ATTEMPTS;

      const { error: updateErr } = await supabase
        .from("launches")
        .update({
          status: giveUp ? "cancelled" : "sponsor_pending_funding",
          sponsor_funding_attempts: nextAttempts,
          sponsor_funding_error: msg.slice(0, 500),
          worker_locked_at: null,
          worker_id: null,
        })
        .eq("id", row.id);
      if (updateErr) {
        console.error(
          `Failed to record funding failure for ${row.id}:`,
          updateErr.message,
        );
      }
    }
  }
}
