// Brand-new edge function for the Launch Profile cosmetic metadata.
// IMPORTANT: This function only writes the additive profile columns on
// public.launches. It never touches escrow keys, mint/keypair fields,
// on-chain status, sponsor / worker fields, or anything in the launch
// execution pipeline.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_CATEGORIES = new Set(["meme", "community", "tech", "other"]);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function cleanTwitterHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handle = value.trim().replace(/^@+/, "").replace(/^https?:\/\/(?:www\.)?(?:twitter|x)\.com\//i, "");
  if (!handle) return null;
  if (!/^[A-Za-z0-9_]{1,32}$/.test(handle)) return null;
  return handle;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const launch_id = typeof body?.launch_id === "string" ? body.launch_id : null;
  const created_by_wallet =
    typeof body?.created_by_wallet === "string"
      ? body.created_by_wallet.trim()
      : null;
  const profile = body?.profile;

  if (!launch_id || !created_by_wallet || !profile || typeof profile !== "object") {
    return json(400, { error: "launch_id, created_by_wallet, and profile are required" });
  }

  // Verify the launch row exists and the caller created it.
  const { data: row, error: fetchErr } = await supabase
    .from("launches")
    .select("id, created_by_wallet")
    .eq("id", launch_id)
    .maybeSingle();

  if (fetchErr) return json(500, { error: fetchErr.message });
  if (!row) return json(404, { error: "Launch not found" });
  if (
    String(row.created_by_wallet).toLowerCase() !==
    created_by_wallet.toLowerCase()
  ) {
    return json(403, { error: "Wallet does not match the launch creator" });
  }

  // Build a sanitized update — only known profile columns.
  const update: Record<string, unknown> = {};

  const hook = cleanString(profile.hook, 100);
  if (profile.hook !== undefined) update.hook = hook;

  const description = cleanString(profile.profile_description, 500);
  if (profile.profile_description !== undefined) update.profile_description = description;

  if (profile.twitter_handle !== undefined) {
    update.twitter_handle = cleanTwitterHandle(profile.twitter_handle);
  }

  if (profile.category !== undefined) {
    if (profile.category === null || profile.category === "") {
      update.category = null;
    } else if (
      typeof profile.category === "string" &&
      ALLOWED_CATEGORIES.has(profile.category)
    ) {
      update.category = profile.category;
    } else {
      return json(400, { error: "Invalid category" });
    }
  }

  if (profile.website_url !== undefined) {
    if (profile.website_url === null || profile.website_url === "") {
      update.website_url = null;
    } else if (isHttpUrl(profile.website_url)) {
      update.website_url = profile.website_url;
    } else {
      return json(400, { error: "website_url must be http(s)" });
    }
  }

  if (profile.meme_images !== undefined) {
    if (!Array.isArray(profile.meme_images)) {
      return json(400, { error: "meme_images must be an array" });
    }
    const filtered = profile.meme_images.filter(isHttpUrl).slice(0, 3);
    update.meme_images = filtered;
  }

  if (profile.launch_checklist !== undefined) {
    const c = profile.launch_checklist;
    if (c === null) {
      update.launch_checklist = null;
    } else if (c && typeof c === "object") {
      update.launch_checklist = {
        memes_ready: Boolean((c as any).memes_ready),
        posts_scheduled: Boolean((c as any).posts_scheduled),
        community_notified: Boolean((c as any).community_notified),
      };
    } else {
      return json(400, { error: "launch_checklist must be an object" });
    }
  }

  if (profile.launch_window !== undefined) {
    update.launch_window = cleanString(profile.launch_window, 120);
  }

  if (Object.keys(update).length === 0) {
    return json(200, { ok: true, updated: false });
  }

  const { error: updErr } = await supabase
    .from("launches")
    .update(update)
    .eq("id", launch_id);

  if (updErr) return json(500, { error: updErr.message });

  return json(200, { ok: true, updated: true });
});