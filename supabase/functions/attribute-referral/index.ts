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
    const { wallet, code } = await req.json();
    if (
      typeof wallet !== "string" || wallet.length < 32 ||
      typeof code !== "string" || code.length < 4 || code.length > 32
    ) {
      return json({ ok: false, reason: "invalid_input" }, 400);
    }

    const { data, error } = await supabase.rpc(
      "attribute_wallet_to_affiliate",
      { p_wallet: wallet, p_code: code },
    );
    if (error) {
      console.error("[attribute-referral]", error);
      return json({ ok: false, reason: "rpc_error", error: error.message }, 500);
    }
    return json(data ?? { ok: false, reason: "unknown" }, 200);
  } catch (err: any) {
    console.error("[attribute-referral] error", err);
    return json({ ok: false, reason: "exception", error: err?.message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}