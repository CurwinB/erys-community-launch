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
    const { admin_wallet, influencer_wallet, launch_datetime } = await req.json();

    if (!admin_wallet || !influencer_wallet || !launch_datetime) {
      return errorResponse("Missing admin_wallet, influencer_wallet, or launch_datetime", 400);
    }

    // Verify admin
    const { data: isAdmin, error: adminErr } = await supabase.rpc("is_admin_wallet", {
      p_wallet: admin_wallet,
    });
    if (adminErr) return errorResponse(`Admin check failed: ${adminErr.message}`, 500);
    if (!isAdmin) return errorResponse("Unauthorized: not an admin wallet", 403);

    // Validate launch time 1-72h ahead
    const launchTime = new Date(launch_datetime);
    const now = new Date();
    const diffHours = (launchTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (Number.isNaN(diffHours) || diffHours < 1 || diffHours > 72) {
      return errorResponse("Launch must be between 1 and 72 hours from now", 400);
    }

    const linkToken = crypto.randomUUID().replace(/-/g, "");

    const fortyEightHours = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const oneHourBeforeLaunch = new Date(launchTime.getTime() - 60 * 60 * 1000);
    const expiresAt = fortyEightHours < oneHourBeforeLaunch ? fortyEightHours : oneHourBeforeLaunch;

    const { data, error } = await supabase
      .from("launches")
      .insert({
        created_by_wallet: influencer_wallet,
        launch_datetime,
        platform: "pumpfun",
        status: "sponsor_pending",
        is_sponsored: true,
        sponsored_by: "erys_platform",
        sponsored_amount_lamports: 100_000_000,
        sponsor_link_token: linkToken,
        sponsor_link_expires_at: expiresAt.toISOString(),
        token_name: "PENDING",
        token_symbol: "PENDING",
        min_contribution_lamports: 10_000_000,
        escrow_wallet_public_key: "PENDING",
        escrow_wallet_encrypted_private_key: "PENDING",
      })
      .select("id")
      .single();

    if (error) {
      console.error("Insert error:", error);
      return errorResponse(`Failed to create sponsored slot: ${error.message}`, 500);
    }

    const siteUrl = Deno.env.get("SITE_URL") || "https://erys.live";
    const sponsorLink = `${siteUrl}/sponsored/${linkToken}`;

    return new Response(
      JSON.stringify({
        success: true,
        launch_id: data.id,
        sponsor_link: sponsorLink,
        expires_at: expiresAt.toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("create-sponsored-slot error:", err);
    return errorResponse(err.message || "Unknown error", 500);
  }
});

function errorResponse(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}