// Sponsor "funding" worker — now a no-op promotion step.
//
// Sponsored launches no longer receive a 0.1 SOL platform seed. The
// edge function (claim-sponsored-slot) still parks new sponsored
// launches in `sponsor_pending_funding` so this worker remains the
// single point that flips them to `scheduled`. We just do it without
// moving any SOL or inserting a seed contribution row — the escrow
// stays at 0 SOL until real contributors deposit.

import { supabase } from "./db";

interface SponsorFundingRow {
  id: string;
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

async function markScheduled(launchId: string): Promise<void> {
  const { error: updateErr } = await supabase
    .from("launches")
    .update({
      status: "scheduled",
      sponsored_tx_signature: null,
      sponsor_funding_error: null,
      worker_locked_at: null,
      worker_id: null,
    })
    .eq("id", launchId);
  if (updateErr) {
    console.error(
      `Failed to mark sponsored launch ${launchId} scheduled:`,
      updateErr.message,
    );
  }
}

export async function fundAllPendingSponsoredEscrows(
  workerId: string,
): Promise<void> {
  while (true) {
    const row = await claimNextSponsorFunding(workerId);
    if (!row) break;

    console.log(
      `Worker ${workerId} promoting sponsored launch ${row.id} to scheduled (no platform seed).`,
    );

    try {
      await markScheduled(row.id);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(
        `Failed to promote sponsored launch ${row.id}:`,
        msg,
      );
      // Clear the worker lock so the row can be retried on the next tick.
      await supabase
        .from("launches")
        .update({
          worker_locked_at: null,
          worker_id: null,
          sponsor_funding_error: msg.slice(0, 500),
        })
        .eq("id", row.id);
    }
  }
}