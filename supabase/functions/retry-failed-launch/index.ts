// Admin-triggered retry for `execution_failed` launches.
//
// Flips the launch back to `executing` and clears the worker lock so the
// Railway executor picks it up on the next tick. The hardened
// `chargeProcessingFee` (idempotent on `processing_fee_tx_signature`) makes
// re-execution safe — no double-debit, no double-buy.
//
// Caller must be an admin wallet (validated via `is_admin_wallet`).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { launch_id, admin_wallet } = await req.json();
    if (!launch_id || !admin_wallet) {
      return json({ error: "launch_id and admin_wallet required" }, 400);
    }

    const { data: isAdmin, error: adminErr } = await supabase.rpc(
      "is_admin_wallet",
      { p_wallet: String(admin_wallet).toLowerCase() },
    );
    if (adminErr) return json({ error: adminErr.message }, 500);
    if (!isAdmin) return json({ error: "unauthorized" }, 403);

    const { data: launch, error: fetchErr } = await supabase
      .from("launches")
      .select("id, status, pumpfun_launch_signature")
      .eq("id", launch_id)
      .single();
    if (fetchErr || !launch) {
      return json({ error: "launch not found" }, 404);
    }

    if (launch.status !== "execution_failed") {
      return json(
        {
          error: `Launch is in status '${launch.status}', expected 'execution_failed'`,
        },
        400,
      );
    }

    if (launch.pumpfun_launch_signature) {
      return json(
        {
          error:
            "Launch already has a pumpfun_launch_signature — refusing retry to avoid double-launch",
        },
        400,
      );
    }

    const { error: updateErr } = await supabase
      .from("launches")
      .update({
        status: "executing",
        execution_error: null,
        worker_locked_at: null,
        worker_id: null,
      })
      .eq("id", launch_id)
      .eq("status", "execution_failed");
    if (updateErr) return json({ error: updateErr.message }, 500);

    return json({ success: true, launch_id });
  } catch (err: any) {
    return json({ error: err?.message ?? "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
