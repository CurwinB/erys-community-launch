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
  token_mint_address: string | null;
  description: string | null;
  image_url: string | null;
  twitter_url: string | null;
  telegram_url: string | null;
  website_url: string | null;
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
  processing_fee_lamports: number;
  processing_fee_tx_signature: string | null;
  is_sponsored: boolean | null;
  sponsored_amount_lamports: number | null;
}

export interface Contribution {
  id: string;
  launch_id: string;
  wallet_address: string;
  amount_lamports: string;
  basis_points: number | null;
  tokens_distributed: boolean;
  token_delivery_wallet: string | null;
  refund_tx_signature?: string | null;
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

// Atomically claim the next sweep_recovery launch (mint exists on-chain
// but custodial -> escrow token sweep failed previously). Same SKIP LOCKED
// semantics as claim_executing_launch_for_worker.
export async function claimNextSweepRecovery(workerId: string): Promise<Launch | null> {
  const { data, error } = await supabase.rpc(
    "claim_sweep_recovery_launch_for_worker",
    { p_worker_id: workerId, p_lock_expiry_seconds: 300 }
  );
  if (error) {
    console.error("Error claiming sweep_recovery launch:", error.message);
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

  // Auto-refund contributors. Imported lazily to avoid a circular dependency
  // (refundFailedLaunch.ts imports `supabase` from this file).
  try {
    const { refundFailedLaunch } = await import("./refundFailedLaunch");
    await refundFailedLaunch(launchId);
  } catch (refundErr: any) {
    console.error(
      `Auto-refund failed for launch ${launchId}:`,
      refundErr?.message ?? refundErr,
    );
  }
}

// Mark a launch failed AND persist its on-chain signature, then auto-refund.
// Use this when we have a Pump.fun launch signature but the tx either
// reverted on-chain or never landed within our polling window. In both cases
// the SOL has NOT been spent into a bonding curve, so refunds are correct.
// We still save the signature for audit / manual lookup so future operators
// can verify the on-chain state of the attempted mint.
export async function setFailedWithSignature(
  launchId: string,
  reason: string,
  signature: string,
): Promise<void> {
  console.error(`Launch ${launchId} failed (signature ${signature}): ${reason}`);
  const { error } = await supabase
    .from("launches")
    .update({
      status: "execution_failed",
      execution_error: reason,
      pumpfun_launch_signature: signature,
    })
    .eq("id", launchId);

  if (error)
    console.error(
      `Error marking launch ${launchId} failed-with-signature:`,
      error.message,
    );

  try {
    const { refundFailedLaunch } = await import("./refundFailedLaunch");
    await refundFailedLaunch(launchId);
  } catch (refundErr: any) {
    console.error(
      `Auto-refund failed for launch ${launchId}:`,
      refundErr?.message ?? refundErr,
    );
  }
}

// Mark a launch failed WITHOUT triggering auto-refund. Use this when the
// on-chain launch already happened (e.g. Pump.fun create succeeded, signature
// is final on-chain) but a downstream step like the token sweep failed.
// In that state the SOL has already been spent into the bonding curve, so
// auto-refunds would just cause partial/short refunds while leaving the
// dev-buy tokens stranded in the custodial wallet for manual recovery.
export async function setFailedNoRefund(
  launchId: string,
  reason: string,
  signature?: string,
): Promise<void> {
  console.error(`Launch ${launchId} failed (no auto-refund): ${reason}`);
  const update: Record<string, unknown> = {
    status: "execution_failed",
    execution_error: reason,
  };
  if (signature) update.pumpfun_launch_signature = signature;
  const { error } = await supabase
    .from("launches")
    .update(update)
    .eq("id", launchId);
  if (error)
    console.error(
      `Error marking launch ${launchId} failed-no-refund:`,
      error.message,
    );
}

// Mark a Pump.fun launch as needing custodial->escrow token sweep recovery.
// The mint exists on-chain (signature must be persisted), but the sweep
// failed. The next executor poll will pick this up via
// claim_sweep_recovery_launch_for_worker and re-attempt only the sweep.
// No refunds — contributor SOL is already in the bonding curve.
export async function markForSweepRecovery(
  launchId: string,
  reason: string,
  signature: string,
): Promise<void> {
  console.error(
    `Launch ${launchId} entering sweep_recovery (signature ${signature}): ${reason}`,
  );
  const { error } = await supabase
    .from("launches")
    .update({
      status: "sweep_recovery",
      execution_error: reason,
      pumpfun_launch_signature: signature,
      worker_locked_at: null,
      worker_id: null,
    })
    .eq("id", launchId);
  if (error)
    console.error(
      `Error marking launch ${launchId} sweep_recovery:`,
      error.message,
    );
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