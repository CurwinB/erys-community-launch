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
  limit: number
): Promise<Launch[]> {
  const { data, error } = await supabase.rpc(
    "claim_pumpfun_launches_batch_for_worker",
    {
      p_worker_id: workerId,
      p_limit: limit,
      p_lock_expiry_seconds: 300,
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

// Reset launches stuck in "executing" status whose scheduled launch_datetime
// is more than 10 minutes in the past. Flips them to "execution_failed" so
// the existing pg_cron retry job will pick them up and re-execute.
// Note: launches table has no updated_at column, so we use launch_datetime
// as the staleness signal — better anyway since it's lifecycle-tied.
export async function resetStaleExecutingLaunches(): Promise<void> {
  const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("launches")
    .update({
      status: "execution_failed",
      execution_error: "Reset from stale executing state by distributor",
    })
    .eq("status", "executing")
    .lt("launch_datetime", staleCutoff);

  if (error) {
    console.error("Error resetting stale executing launches:", error.message);
  }
}
