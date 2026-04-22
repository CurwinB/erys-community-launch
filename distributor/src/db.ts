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
}

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
// Claim when: 24 hours have passed since last claim OR never been claimed
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
