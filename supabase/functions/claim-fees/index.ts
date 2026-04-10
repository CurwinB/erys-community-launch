import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BAGS_API_BASE = "https://api.bags.fm";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const BAGS_API_KEY = Deno.env.get("BAGS_API_KEY")!;

  try {
    const body = await req.json();
    const { action, wallet, mint } = body;

    if (!action || !wallet) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: action, wallet" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "claimable-positions") {
      // Proxy GET /token-launch/claimable-positions?wallet=<wallet>
      const res = await fetch(
        `${BAGS_API_BASE}/token-launch/claimable-positions?wallet=${encodeURIComponent(wallet)}`,
        {
          headers: { Authorization: `Bearer ${BAGS_API_KEY}` },
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        return new Response(
          JSON.stringify({ error: `Bags API error: ${errText}` }),
          { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "claim") {
      if (!mint) {
        return new Response(
          JSON.stringify({ error: "Missing required field: mint" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Call POST /token-launch/claim-txs/v3
      // Returns a pre-signed transaction — must be returned as-is to frontend
      // Frontend will partial-sign via Privy (preserving Bags' signature)
      const res = await fetch(`${BAGS_API_BASE}/token-launch/claim-txs/v3`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${BAGS_API_KEY}`,
        },
        body: JSON.stringify({
          feeClaimer: wallet,
          mint,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return new Response(
          JSON.stringify({ error: `Bags API error: ${errText}` }),
          { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Return the pre-signed transaction exactly as received
      // CRITICAL: Do not modify, rebuild, or re-sign this transaction
      // It contains Bags' partial signature that must be preserved
      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "send") {
      // Proxy the signed transaction submission
      if (!body.transaction) {
        return new Response(
          JSON.stringify({ error: "Missing required field: transaction" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const res = await fetch(`${BAGS_API_BASE}/solana/send-transaction`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${BAGS_API_KEY}`,
        },
        body: JSON.stringify({ transaction: body.transaction }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return new Response(
          JSON.stringify({ error: `Send failed: ${errText}` }),
          { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: "Invalid action. Use: claimable-positions, claim, or send" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("claim-fees error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
