import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

export const supabase = createClient(supabaseUrl, supabaseKey);

export interface Launch {
  id: string;
  token_name: string;
  token_symbol: string;
  token_mint_address: string;
  escrow_wallet_public_key: string;
  escrow_wallet_encrypted_private_key: string;
  status: string;
  distribution_completed: boolean;
  created_by_wallet: string;
  created_at: string;
  platform: string;
  pumpfun_fees_last_claimed_at: string | null;
  pumpfun_fees_claimed_total: number;
  worker_locked_at: string | null;
  worker_id: string | null;
  pumpportal_wallet_pubkey: string | null;
  lightning_wallet_public_key: string | null;
  lightning_wallet_encrypted_private_key: string | null;
  lightning_wallet_encrypted_api_key: string | null;
  fee_harvest_state?: string | null;
  fee_harvest_last_success_at?: string | null;
  is_sponsored?: boolean | null;
}

export interface Contribution {
  id: string;
  launch_id: string;
  wallet_address: string;
  amount_lamports: string;
  token_amount: string | null;
  tokens_distributed: boolean;
  distribution_tx_signature: string | null;
  distribution_error: string | null;
  basis_points: number | null;
  token_delivery_wallet: string | null;
}

/** @deprecated Use claimNextDistribution for atomic worker-safe claiming. */
export async function getPendingDistributions(): Promise<Launch[]> {
  const { data, error } = await supabase
    .from("launches")
    .select("*")
    .eq("status", "launched")
    .eq("distribution_completed", false)
    .order("created_at", { ascending: true })
    .limit(5);

  if (error) {
    console.error("Error fetching pending distributions:", error.message);
    return [];
  }
  return (data as Launch[]) || [];
}

// Atomically claim the next launch needing distribution for this worker.
// Uses Postgres FOR UPDATE SKIP LOCKED via SQL function so multiple
// distributor replicas can run safely in parallel without ever picking up
// the same launch.
export async function claimNextDistribution(workerId: string): Promise<Launch | null> {
  const { data, error } = await supabase.rpc("claim_launch_for_worker", {
    p_worker_id: workerId,
    p_status: "launched",
    p_lock_expiry_seconds: 300,
  });

  if (error) {
    console.error("Error claiming launch for worker:", error.message);
    return null;
  }
  return (data?.[0] as Launch) || null;
}

// Atomically claim the next Pump.fun launch needing a fee claim for this worker.
export async function claimNextPumpfunFeeClaim(workerId: string): Promise<Launch | null> {
  const { data, error } = await supabase.rpc("claim_pumpfun_launch_for_worker", {
    p_worker_id: workerId,
    p_lock_expiry_seconds: 300,
  });

  if (error) {
    console.error("Error claiming Pump.fun launch for worker:", error.message);
    return null;
  }
  return (data?.[0] as Launch) || null;
}

// Atomically claim a BATCH of Pump.fun launches needing a fee claim for this
// worker. Skips locked rows so multiple replicas can grab disjoint batches.
// Single round-trip — much cheaper than calling claimNextPumpfunFeeClaim N times.
export async function claimPumpfunFeeBatchForWorker(
  workerId: string,
  limit: number,
  walletPubkey?: string | null
): Promise<Launch[]> {
  const { data, error } = await supabase.rpc(
    "claim_pumpfun_launches_batch_for_worker",
    {
      p_worker_id: workerId,
      p_limit: limit,
      p_lock_expiry_seconds: 300,
      p_wallet_pubkey: walletPubkey ?? null,
    }
  );
  if (error) {
    console.error("Error claiming Pump.fun batch for worker:", error.message);
    return [];
  }
  return (data as Launch[]) || [];
}

// Record a successful claim that returned ZERO lamports (creator vault was
// empty). Bumps the empty-claim counter; after 3 consecutive empties the SQL
// function pushes the next attempt out by 1 hour.
export async function recordPumpfunEmptyClaim(launchId: string): Promise<void> {
  const { error } = await supabase.rpc("record_pumpfun_empty_claim", {
    p_launch_id: launchId,
  });
  if (error) {
    console.error(
      `Error recording empty Pump.fun claim for launch ${launchId}:`,
      error.message
    );
  }
}

// Record a treasury sweep: SOL transferred from the shared PumpPortal custodial
// wallet directly to the platform treasury. Logs the on-chain signature so
// every cent that leaves the custodial wallet is auditable, and stamps the
// related launch row as having a healthy fee-claim cycle.
export async function recordPumpfunFeeTreasurySweep(args: {
  launchId: string | null;
  sourceWallet: string;
  treasuryWallet: string;
  amountLamports: number;
  txSignature: string;
  notes?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("record_pumpfun_fee_treasury_sweep", {
    p_launch_id: args.launchId,
    p_source_wallet: args.sourceWallet,
    p_treasury_wallet: args.treasuryWallet,
    p_amount_lamports: args.amountLamports,
    p_tx_signature: args.txSignature,
    p_notes: args.notes ?? null,
  });
  if (error) {
    console.error(
      `Error recording Pump.fun treasury sweep for launch ${
        args.launchId ?? "(none)"
      }:`,
      error.message
    );
  }
}

// Release a worker lock. Always called in a finally so crashed workers don't
// hold rows hostage; the SQL claim functions also self-heal locks older than
// the expiry window as a backstop.
export async function releaseLaunchLock(launchId: string): Promise<void> {
  const { error } = await supabase
    .from("launches")
    .update({ worker_locked_at: null, worker_id: null })
    .eq("id", launchId);
  if (error) console.error(`Error releasing lock for launch ${launchId}:`, error.message);
}

export async function getPendingContributions(launchId: string): Promise<Contribution[]> {
  const { data, error } = await supabase
    .from("contributions")
    .select("*")
    .eq("launch_id", launchId)
    .eq("tokens_distributed", false)
    .order("amount_lamports", { ascending: false });

  if (error) {
    console.error("Error fetching contributions:", error.message);
    return [];
  }
  return (data as Contribution[]) || [];
}

export async function markDistributed(contributionId: string, txSignature: string): Promise<void> {
  const { error } = await supabase
    .from("contributions")
    .update({
      tokens_distributed: true,
      distribution_tx_signature: txSignature,
      distribution_error: null,
    })
    .eq("id", contributionId);
  if (error) console.error(`Error marking contribution ${contributionId} distributed:`, error.message);
}

export async function markDistributionFailed(contributionId: string, errorMessage: string): Promise<void> {
  const { error } = await supabase
    .from("contributions")
    .update({
      tokens_distributed: false,
      distribution_error: errorMessage,
    })
    .eq("id", contributionId);
  if (error) console.error(`Error marking contribution ${contributionId} failed:`, error.message);
}

export async function markLaunchDistributionComplete(
  launchId: string,
  totalTokensDistributed: number
): Promise<void> {
  const { error } = await supabase
    .from("launches")
    .update({
      distribution_completed: true,
      distribution_completed_at: new Date().toISOString(),
      total_tokens_distributed: totalTokensDistributed,
    })
    .eq("id", launchId);
  if (error) console.error(`Error marking launch ${launchId} distribution complete:`, error.message);
}

// Find Pump.fun launches ready for fee claiming
// Claim when: 10 minutes have passed since last claim OR never been claimed
/** @deprecated Use claimNextPumpfunFeeClaim for atomic worker-safe claiming. */
export async function getPumpfunLaunchesForFeeClaim(): Promise<Launch[]> {
  const cutoff10min = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("launches")
    .select("*")
    .eq("status", "launched")
    .eq("platform", "pumpfun")
    .or(
      `pumpfun_fees_last_claimed_at.is.null,pumpfun_fees_last_claimed_at.lte.${cutoff10min}`
    )
    .order("created_at", { ascending: true })
    .limit(10);

  if (error) {
    console.error("Error fetching Pump.fun launches for fee claim:", error.message);
    return [];
  }
  return (data as Launch[]) || [];
}

// Update fee claim tracking after successful claim
export async function updatePumpfunFeesClaimed(
  launchId: string,
  amountLamports: number
): Promise<void> {
  const { error } = await supabase.rpc("increment_pumpfun_fees_claimed", {
    launch_id: launchId,
    amount: amountLamports,
  });

  if (error) {
    console.error(`Error updating Pump.fun fee claim for launch ${launchId}:`, error.message);
  }
}

// Stamp pumpfun_fees_last_claimed_at WITHOUT incrementing the claimed total.
// Called when collectCreatorFee succeeded on-chain but the vault was empty
// (i.e. "No creator fee to collect"). This is the steady state for any low-
// volume launch and we MUST throttle these no-op claims, otherwise the
// distributor re-fires the call every poll cycle and burns ~55k lamports of
// priority fee per attempt out of the custodial wallet.
export async function markPumpfunFeeClaimAttempt(launchId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_pumpfun_fee_claim_attempt", {
    p_launch_id: launchId,
  });
  if (error) {
    console.error(
      `Error stamping Pump.fun fee claim attempt for launch ${launchId}:`,
      error.message
    );
  }
}

// Record a fee-claim FAILURE in the DB. Stamps the throttle so we don't
// re-fire the broken path every 30 seconds, and persists the error message
// so we can see it in the admin UI without grepping Railway logs.
export async function recordPumpfunFeeClaimFailure(
  launchId: string,
  errorMessage: string
): Promise<void> {
  const { error } = await supabase.rpc("record_pumpfun_fee_claim_failure", {
    p_launch_id: launchId,
    p_error: errorMessage,
  });
  if (error) {
    console.error(
      `Error recording Pump.fun fee claim failure for launch ${launchId}:`,
      error.message
    );
  }
}

// Record that the custodial wallet was too low on SOL to attempt a claim.
// IMPORTANT: this does NOT stamp pumpfun_fees_last_claimed_at — we want the
// launch to be re-eligible immediately as soon as the wallet is topped up,
// rather than waiting another 10 minutes. The error string surfaces in the
// admin Recovery panel so it's obvious what action is needed.
export async function recordPumpfunWalletStarved(
  launchId: string,
  errorMessage: string
): Promise<void> {
  const { error } = await supabase.rpc("record_pumpfun_wallet_starved", {
    p_launch_id: launchId,
    p_error: errorMessage,
  });
  if (error) {
    console.error(
      `Error recording wallet-starved state for launch ${launchId}:`,
      error.message
    );
  }
}

// Stamp the on-chain creator vault balance on every launch in the batch.
// Called once per cycle whether or not we actually claim, so the admin UI
// always sees a fresh "vault has X SOL" number explaining why a claim did
// or did not fire.
export async function recordPumpfunCreatorVaultBalance(
  launchIds: string[],
  balanceLamports: number
): Promise<void> {
  if (launchIds.length === 0) return;
  const { error } = await supabase.rpc("record_pumpfun_creator_vault_balance", {
    p_launch_ids: launchIds,
    p_balance_lamports: balanceLamports,
  });
  if (error) {
    console.error(
      `Error recording Pump.fun creator vault balance:`,
      error.message
    );
  }
}

// ---------------------------------------------------------------------------
// Affiliate program (per-launch fee split)
// ---------------------------------------------------------------------------

export interface CodevAllocation {
  wallet_address: string;
  weight: string; // contribution_lamports, bigint as string
  pending_lamports: string; // bigint as string
}

export interface LaunchFeeSplit {
  launch_id?: string;
  creator_wallet: string;
  creator_bps: number;
  treasury_bps: number;
  affiliate_id?: string | null;
  affiliate_wallet: string | null;
  affiliate_bps: number;
  codev_bps?: number;
  codev_allocations?: CodevAllocation[];
}

// Resolves how a launch's harvested fees should be split. Returns the
// standard 7000/3000/0 (creator/treasury/affiliate) split for launches with
// no affiliate attribution, or 7000/1500/1500 when launches.referred_by_affiliate_id
// is set. Falls back to null on RPC error so callers can fail closed to the
// hardcoded default split rather than risk misrouting funds.
export async function getLaunchFeeSplit(
  launchId: string
): Promise<LaunchFeeSplit | null> {
  const { data, error } = await supabase.rpc("get_launch_fee_split", {
    p_launch_id: launchId,
  });
  if (error) {
    console.error(
      `[AFFILIATE] get_launch_fee_split failed for launch ${launchId}:`,
      error.message
    );
    return null;
  }
  // RPC returns a single row (function, not a set-returning query in our usage).
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return row as LaunchFeeSplit;
}

// Appends a row to the affiliate earnings ledger after an affiliate payout
// attempt. Idempotent on (launch_id, tx_signature), so safe to call even if
// a retry re-runs this harvest cycle. status should be 'paid' on a
// confirmed on-chain transfer, or 'failed' if a tx was broadcast but
// reverted/never confirmed (this keeps the failure visible on the affiliate
// dashboard instead of silently disappearing into that cycle's treasury cut).
export async function recordAffiliateEarning(args: {
  launchId: string;
  amountLamports: bigint;
  txSignature: string | null;
  status: "paid" | "pending" | "failed";
}): Promise<void> {
  const { error } = await supabase.rpc("record_affiliate_earning", {
    p_launch_id: args.launchId,
    p_amount_lamports: args.amountLamports.toString() as any,
    p_tx_signature: args.txSignature,
    p_status: args.status,
  });
  if (error) {
    console.error(
      `[AFFILIATE] record_affiliate_earning failed for launch ${args.launchId} (tx ${args.txSignature ?? "none"}, status ${args.status}):`,
      error.message
    );
  }
}

// ---------------------------------------------------------------------------
// Co-dev fee sharing (per-launch, opt-in)
// ---------------------------------------------------------------------------

export interface CodevPayoutRecord {
  wallet_address: string;
  amount_lamports: string; // bigint as string
}

// Atomically records a successful batch of co-dev payouts: inserts ledger
// rows (idempotent on launch_id+wallet+tx_signature) and decrements
// pending_lamports / bumps paid_lamports for each wallet in the batch.
export async function recordCodevBatch(args: {
  launchId: string;
  cycleId: string | null;
  txSignature: string;
  payouts: CodevPayoutRecord[];
}): Promise<void> {
  if (args.payouts.length === 0) return;
  const { error } = await supabase.rpc("record_codev_batch", {
    p_launch_id: args.launchId,
    p_cycle_id: args.cycleId,
    p_tx_signature: args.txSignature,
    p_payouts: args.payouts as any,
  });
  if (error) {
    console.error(
      `[CODEV] record_codev_batch failed for launch ${args.launchId} (tx ${args.txSignature}):`,
      error.message
    );
  }
}

// Bulk-accrues pending_lamports for co-devs whose share this cycle either
// fell below the per-wallet gas-relative floor, or whose batch transfer
// failed to land. Never drops a share — it stays owed and is re-evaluated
// against the floor next cycle, same fail-closed pattern as affiliate.
export async function accrueCodevPending(
  launchId: string,
  deltas: CodevPayoutRecord[]
): Promise<void> {
  if (deltas.length === 0) return;
  const { error } = await supabase.rpc("accrue_codev_pending", {
    p_launch_id: launchId,
    p_deltas: deltas as any,
  });
  if (error) {
    console.error(
      `[CODEV] accrue_codev_pending failed for launch ${launchId}:`,
      error.message
    );
  }
}

// Reset launches stuck in "executing" status whose scheduled launch_datetime
// is well in the past AND no worker is actively holding the lock. Flips
// them to "execution_failed" so the existing pg_cron retry job will pick
// them up and re-execute.
//
// Two guards prevent stomping on in-flight executions:
//   1. launch_datetime must be > 30 min old (covers fee-share rebuild
//      retries + Bags index settle + launch tx + confirmation).
//   2. worker_locked_at must be NULL or > 10 min old. The executor refreshes
//      its lock per-claim; a fresh lock means a worker is actively running.
export async function resetStaleExecutingLaunches(): Promise<void> {
  const launchCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const lockCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("launches")
    .update({
      status: "execution_failed",
      execution_error: "Reset from stale executing state by distributor",
    })
    .eq("status", "executing")
    .lt("launch_datetime", launchCutoff)
    .or(`worker_locked_at.is.null,worker_locked_at.lt.${lockCutoff}`);

  if (error) {
    console.error("Error resetting stale executing launches:", error.message);
  }
}

