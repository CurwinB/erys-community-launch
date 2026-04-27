// Read-only endpoint: given a requested launch time + platform, return the
// next available slot. Does not write anything. Used by the scheduling UI to
// preview slot availability as the user picks a time.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import {
  findNextAvailableSlot,
  PLATFORM_CAPS,
  type Platform,
} from "../_shared/scheduleCapacity.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { platform, launch_datetime } = body as {
      platform?: string;
      launch_datetime?: string;
    };

    if (!platform || (platform !== "bags" && platform !== "pumpfun")) {
      return json({ error: "platform must be 'bags' or 'pumpfun'" }, 400);
    }
    if (!launch_datetime || isNaN(new Date(launch_datetime).getTime())) {
      return json({ error: "launch_datetime must be a valid ISO timestamp" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const slot = await findNextAvailableSlot(
      supabase,
      platform as Platform,
      launch_datetime
    );

    return json({
      ...slot,
      platform,
      cap_per_minute: PLATFORM_CAPS[platform as Platform],
    });
  } catch (err: any) {
    console.error("check-launch-slot error:", err);
    return json({ error: err.message ?? "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}