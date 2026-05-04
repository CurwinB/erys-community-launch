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
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const { launch_id, wallet_address, amount_lamports } = body;
    let { token_delivery_wallet } = body;

    if (!launch_id || !wallet_address || !amount_lamports) {
      return errorResponse(
        "Missing required fields: launch_id, wallet_address, amount_lamports",
        400
      );
    }

    // wallet_address must look like a base58 Solana pubkey
    if (
      typeof wallet_address !== "string" ||
      wallet_address.length < 32 ||
      wallet_address.length > 44 ||
      !/^[1-9A-HJ-NP-Za-km-z]+$/.test(wallet_address)
    ) {
      return errorResponse("wallet_address is not a valid Solana address", 400);
    }

    // Optional token delivery wallet
    if (
      token_delivery_wallet !== undefined &&
      token_delivery_wallet !== null &&
      token_delivery_wallet !== ""
    ) {
      if (typeof token_delivery_wallet !== "string") {
        return errorResponse("token_delivery_wallet must be a string", 400);
      }
      token_delivery_wallet = token_delivery_wallet.trim();
      if (
        token_delivery_wallet.length < 32 ||
        token_delivery_wallet.length > 44 ||
        !/^[1-9A-HJ-NP-Za-km-z]+$/.test(token_delivery_wallet)
      ) {
        return errorResponse(
          "token_delivery_wallet must be a valid Solana wallet address",
          400
        );
      }
    }

    // Platform minimum (0.1 SOL)
    const PLATFORM_MIN_CONTRIBUTION = 100_000_000;
    const amount = Number(amount_lamports);
    if (!Number.isFinite(amount) || amount <= 0) {
      return errorResponse("amount_lamports must be a positive number", 400);
    }
    if (amount < PLATFORM_MIN_CONTRIBUTION) {
      return errorResponse(
        `Minimum ape is 0.1 SOL. You entered ${amount / 1e9} SOL.`,
        400
      );
    }

    const { data: launch, error: launchErr } = await supabase
      .from("launches")
      .select("id, status, launch_datetime, escrow_wallet_public_key")
      .eq("id", launch_id)
      .single();

    if (launchErr || !launch) {
      return errorResponse("Launch not found", 404);
    }

    if (launch.status !== "scheduled") {
      return errorResponse(
        `This launch is no longer accepting apes (status: ${launch.status}).`,
        400
      );
    }

    if (new Date(launch.launch_datetime) <= new Date()) {
      return errorResponse(
        "Contribution window has closed (launch datetime has passed).",
        400
      );
    }

    const launchTime = new Date(launch.launch_datetime).getTime();
    if (launchTime - Date.now() < 5 * 60 * 1000) {
      return errorResponse(
        "Contribution window is closed. This launch executes in less than 5 minutes.",
        400
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        escrow_wallet_public_key: launch.escrow_wallet_public_key,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("validate-contribution error:", error);
    return errorResponse(error.message ?? "Unexpected error", 500);
  }
});

function errorResponse(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}