import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    const { admin_wallet, launch_id } = await req.json();
    if (!admin_wallet || !launch_id) {
      return errorResponse("Missing admin_wallet or launch_id", 400);
    }

    const { data: isAdmin, error: adminErr } = await supabase.rpc("is_admin_wallet", {
      p_wallet: admin_wallet,
    });
    if (adminErr) return errorResponse(`Admin check failed: ${adminErr.message}`, 500);
    if (!isAdmin) return errorResponse("Unauthorized: not an admin wallet", 403);

    const { error } = await supabase
      .from("launches")
      .update({ status: "cancelled" })
      .eq("id", launch_id)
      .eq("status", "sponsor_pending");

    if (error) return errorResponse(`Failed to cancel: ${error.message}`, 500);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return errorResponse(err.message || "Unknown error", 500);
  }
});

function errorResponse(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}