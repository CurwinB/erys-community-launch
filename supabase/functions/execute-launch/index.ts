import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// Lightweight scheduler: finds scheduled launches whose launch_datetime has
// passed and flips them to `executing` so the Railway executor service can
// pick them up. No Solana / Bags imports here — keeps cold-boot CPU under
// the edge-function budget.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: toExecute, error: fetchError } = await supabase
    .from("launches")
    .select("id, token_name, platform, execution_attempts")
    .eq("status", "scheduled")
    .lte("launch_datetime", new Date().toISOString())
    .lt("execution_attempts", 3);

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!toExecute || toExecute.length === 0) {
    return new Response(JSON.stringify({ message: "No launches to queue" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  for (const launch of toExecute) {
    await supabase
      .from("launches")
      .update({
        status: "executing",
        execution_attempts: launch.execution_attempts + 1,
      })
      .eq("id", launch.id)
      .eq("status", "scheduled"); // race-condition guard

    console.log(
      `Queued launch ${launch.id} (${launch.token_name}) for execution on Railway`
    );
  }

  return new Response(
    JSON.stringify({
      message: `${toExecute.length} launches queued for execution`,
      launches: toExecute.map((l) => ({
        id: l.id,
        name: l.token_name,
        platform: l.platform,
      })),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});