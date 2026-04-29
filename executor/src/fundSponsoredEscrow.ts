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
// When the escrow already holds at least this much SOL, treat it as funded
// regardless of who funded it (covers the case where a previous attempt's
// transfer landed on-chain but our confirmTransaction call threw).
const ESCROW_FUNDED_THRESHOLD_LAMPORTS = 50_000_000; // 0.05 SOL — well below the 0.0999 SOL drop
// How long to wait after a failed confirmTransaction before re-checking
// whether the transaction actually landed on-chain.
const POST_FAILURE_RECHECK_DELAY_MS = 8_000;

async function findRecentInboundSignature(
  connection: Connection,
  pubkey: PublicKey,
): Promise<string | null> {
  try {
    const sigs = await connection.getSignaturesForAddress(pubkey, { limit: 1 });
    return sigs[0]?.signature ?? null;
  } catch (err: any) {
    console.warn(
      `Could not fetch recent signatures for ${pubkey.toBase58()}:`,
      err?.message ?? err,
    );
    return null;
  }
}

async function markScheduled(
  launchId: string,
  signature: string | null,
): Promise<void> {
  const { error: updateErr } = await supabase
    .from("launches")
    .update({
      status: "scheduled",
      sponsored_tx_signature: signature,
      sponsor_funding_error: null,
      worker_locked_at: null,
      worker_id: null,
    })
    .eq("id", launchId);
  if (updateErr) {
    console.error(
      `Funded ${launchId} but failed to update DB:`,
      updateErr.message,
    );
  }
}

interface SponsorFundingRow {
  id: string;
  escrow_wallet_public_key: string;
  sponsored_amount_lamports: number | null;
  sponsor_funding_attempts: number;
  creator_delivery_wallet: string | null;
  created_by_wallet: string;
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

/**
 * Idempotently record the platform's 0.1 SOL drop as a contribution row
 * for the influencer. Without this, the executor would launch with zero
 * contributions and the influencer would never receive tokens for the
 * seed SOL the platform spent on their behalf.
 *
 *   - wallet_address       = influencer's pump wallet (or created_by_wallet
 *                            placeholder if they didn't provide one).
 *   - token_delivery_wallet = same pump wallet (NULL otherwise — distributor
 *                             falls back to wallet_address).
 *   - amount_lamports      = the funded amount.
 *   - tx_signature         = the funding tx (used as the dedupe key).
 *   - is_fee_claimer       = true so the influencer joins the fee-share split,
 *                            matching how a regular launch's creator is treated.
 */
async function recordSponsoredContribution(
  row: SponsorFundingRow,
  amountLamports: number,
  signature: string | null,
): Promise<void> {
  if (!signature) {
    console.warn(
      `Skipping contribution insert for ${row.id}: missing tx signature.`,
    );
    return;
  }

  const walletAddress =
    (row.creator_delivery_wallet || "").trim() || row.created_by_wallet;
  if (!walletAddress) {
    console.warn(
      `Skipping contribution insert for ${row.id}: no wallet address available.`,
    );
    return;
  }

  // Idempotency: same tx_signature => same drop => bail.
  const { data: existing, error: existingErr } = await supabase
    .from("contributions")
    .select("id")
    .eq("launch_id", row.id)
    .eq("tx_signature", signature)
    .maybeSingle();
  if (existingErr) {
    console.warn(
      `Could not check existing contribution for ${row.id}:`,
      existingErr.message,
    );
  }
  if (existing) {
    return;
  }

  const { error: insertErr } = await supabase.from("contributions").insert({
    launch_id: row.id,
    wallet_address: walletAddress,
    token_delivery_wallet: row.creator_delivery_wallet || null,
    amount_lamports: amountLamports,
    tx_signature: signature,
    is_fee_claimer: true,
  });
  if (insertErr) {
    console.error(
      `Failed to record sponsored contribution for ${row.id}:`,
      insertErr.message,
    );
  } else {
    console.log(
      `Recorded sponsored contribution for ${row.id}: ${walletAddress} (${amountLamports} lamports)`,
    );
  }
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

  const wssUrl =
    process.env.SOLANA_WSS_URL ||
    rpcUrl.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: wssUrl,
  });

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

      // Idempotency check: a previous attempt's transfer may have landed
      // on-chain even though our client recorded a failure. If the escrow
      // is already funded, skip the transfer and just mark the launch
      // scheduled so we don't drain the source wallet a second time.
      const existingBalance = await connection.getBalance(
        escrowPubkey,
        "confirmed",
      );
      if (existingBalance >= ESCROW_FUNDED_THRESHOLD_LAMPORTS) {
        const recentSig = await findRecentInboundSignature(
          connection,
          escrowPubkey,
        );
        console.log(
          `Escrow ${row.escrow_wallet_public_key} already holds ${
            existingBalance / LAMPORTS_PER_SOL
          } SOL — marking launch ${row.id} scheduled${
            recentSig ? ` (sig ${recentSig})` : ""
          }.`,
        );
        await recordSponsoredContribution(row, existingBalance, recentSig);
        await markScheduled(row.id, recentSig);
        continue;
      }

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
          `Funded sponsored escrow for launch ${row.id}: ${pendingSignature} (${
            transferAmount / LAMPORTS_PER_SOL
          } SOL)`,
        );

        await recordSponsoredContribution(
          row,
          transferAmount,
          pendingSignature,
        );
        await markScheduled(row.id, pendingSignature);
      } catch (sendErr: any) {
        // The send/confirm path threw, but the tx may still have landed.
        // Wait a moment, then check the escrow balance and (if we have one)
        // the signature status before declaring failure.
        const sendMsg = sendErr?.message ?? String(sendErr);
        console.warn(
          `Send/confirm failed for ${row.id}: ${sendMsg} — rechecking on-chain state...`,
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
            // ignore — fall through to balance check
          }
        }
        if (!landed) {
          const recheckBalance = await connection.getBalance(
            escrowPubkey,
            "confirmed",
          );
          if (recheckBalance >= ESCROW_FUNDED_THRESHOLD_LAMPORTS) {
            landed = true;
          }
        }

        if (landed) {
          const sigToStore =
            pendingSignature ??
            (await findRecentInboundSignature(connection, escrowPubkey));
          console.log(
            `Recovered: escrow for launch ${row.id} is funded on-chain despite send error. Marking scheduled${
              sigToStore ? ` (sig ${sigToStore})` : ""
            }.`,
          );
          // Use whatever the escrow currently holds as the contribution
          // amount — this is what the launch will actually spend.
          const fundedBalance = await connection.getBalance(
            escrowPubkey,
            "confirmed",
          );
          await recordSponsoredContribution(row, fundedBalance, sigToStore);
          await markScheduled(row.id, sigToStore);
        } else {
          // Genuine failure — rethrow into the outer catch below for the
          // existing attempts/error-recording path.
          throw sendErr;
        }
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
