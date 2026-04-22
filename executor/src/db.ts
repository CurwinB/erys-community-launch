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
  platform: string;
  status: string;
  created_by_wallet: string;
  created_at: string;
  launch_datetime: string;
  ipfs_metadata_url: string | null;
  fee_share_config_key: string | null;
  claimer_count: number | null;
  execution_attempts: number;
  execution_error: string | null;
  pumpfun_mint_keypair_encrypted: string | null;
  pumpfun_launch_signature: string | null;
  worker_locked_at: string | null;
  worker_id: string | null;
}

export interface Contribution {
  id: string;
  launch_id: string;
  wallet_address: string;
  amount_lamports: string;
  basis_points: number | null;
  tokens_distributed: boolean;
}

export async function getExecutingLaunches(): Promise<Launch[]> {
  const { data, error } = await supabase
    .from("launches")
    .select("*")
    .eq("status", "executing")
    .order("launch_datetime", { ascending: true })
    .limit(3);

  if (error) {
    console.error("Error fetching executing launches:", error.message);
    return [];
  }
  return (data as Launch[]) || [];
}

// Atomically claim the next executing launch for this worker.
// Uses Postgres FOR UPDATE SKIP LOCKED via SQL function so multiple
// executor replicas can run safely in parallel.
export async function claimNextExecutingLaunch(workerId: string): Promise<Launch | null> {
  const { data, error } = await supabase.rpc("claim_executing_launch_for_worker", {
    p_worker_id: workerId,
    p_lock_expiry_seconds: 120,
  });

  if (error) {
    console.error("Error claiming executing launch:", error.message);
    return null;
  }
  return (data?.[0] as Launch) || null;
}

// Release a worker lock. Crashed workers' locks also self-heal via the
// expiry window in claim_executing_launch_for_worker.
export async function releaseLaunchLock(launchId: string): Promise<void> {
  const { error } = await supabase
    .from("launches")
    .update({ worker_locked_at: null, worker_id: null })
    .eq("id", launchId);
  if (error) console.error(`Error releasing lock for launch ${launchId}:`, error.message);
}

export async function getContributions(launchId: string): Promise<Contribution[]> {
  const { data, error } = await supabase
    .from("contributions")
    .select("*")
    .eq("launch_id", launchId)
    .order("amount_lamports", { ascending: false });

  if (error) {
    console.error("Error fetching contributions:", error.message);
    return [];
  }
  return (data as Contribution[]) || [];
}

export async function setLaunched(launchId: string, signature?: string): Promise<void> {
  const update: Record<string, unknown> = { status: "launched" };
  if (signature) update.pumpfun_launch_signature = signature;

  const { error } = await supabase
    .from("launches")
    .update(update)
    .eq("id", launchId);

  if (error) console.error(`Error marking launch ${launchId} launched:`, error.message);
}

export async function setFailed(launchId: string, reason: string): Promise<void> {
  console.error(`Launch ${launchId} failed: ${reason}`);
  const { error } = await supabase
    .from("launches")
    .update({
      status: "execution_failed",
      execution_error: reason,
    })
    .eq("id", launchId);

  if (error) console.error(`Error marking launch ${launchId} failed:`, error.message);
}

export async function storeFeeShareConfig(
  launchId: string,
  configKey: string,
  claimerCount: number
): Promise<void> {
  await supabase
    .from("launches")
    .update({ fee_share_config_key: configKey, claimer_count: claimerCount })
    .eq("id", launchId);
}

export async function storeBasisPoints(
  contributionId: string,
  bps: number
): Promise<void> {
  await supabase
    .from("contributions")
    .update({ basis_points: bps })
    .eq("id", contributionId);
}