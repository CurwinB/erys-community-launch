import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import bs58 from "https://esm.sh/bs58@5.0.0";
import { Keypair } from "https://esm.sh/@solana/web3.js@1.95.3";

/**
 * Idempotent seeder: copies the legacy single Lightning wallet from Railway
 * env vars (PUMPPORTAL_CUSTODIAL_WALLET / _PRIVATE_KEY / API_KEY) into the
 * lightning_wallets table at slot 1, encrypting the secret + api key with
 * ESCROW_ENCRYPTION_KEY. Safe to call repeatedly — second call is a no-op.
 *
 * Auto-invoked from the admin page mount and from the executor's boot
 * routine so the seed runs the first time the new code is deployed,
 * without any manual step.
 */

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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const ESCROW_ENCRYPTION_KEY = Deno.env.get("ESCROW_ENCRYPTION_KEY");
    const envPubkey = Deno.env.get("PUMPPORTAL_CUSTODIAL_WALLET");
    const envSecret = Deno.env.get("PUMPPORTAL_CUSTODIAL_PRIVATE_KEY");
    const envApiKey = Deno.env.get("PUMPPORTAL_API_KEY");

    if (!ESCROW_ENCRYPTION_KEY) {
      return json({ ok: false, reason: "ESCROW_ENCRYPTION_KEY not set" }, 500);
    }
    if (!envPubkey || !envSecret || !envApiKey) {
      return json({
        ok: false,
        seeded: false,
        reason: "PUMPPORTAL_* env vars not all set; nothing to seed",
      });
    }

    // Validate the env keypair before touching the DB.
    let secretBytes: Uint8Array;
    try {
      secretBytes = bs58.decode(envSecret);
    } catch {
      return json({ ok: false, reason: "env private key not valid base58" }, 500);
    }
    if (secretBytes.length !== 64) {
      return json(
        { ok: false, reason: `env secret decoded to ${secretBytes.length} bytes (need 64)` },
        500,
      );
    }
    const derivedPubkey = Keypair.fromSecretKey(secretBytes).publicKey.toBase58();
    if (derivedPubkey !== envPubkey) {
      return json(
        {
          ok: false,
          reason: `env pubkey ${envPubkey} does not match derived ${derivedPubkey}`,
        },
        500,
      );
    }

    // Already seeded?
    const { data: existing } = await supabase
      .from("lightning_wallets")
      .select("id, slot")
      .eq("pubkey", envPubkey)
      .maybeSingle();
    if (existing) {
      return json({ ok: true, seeded: false, slot: existing.slot, alreadyPresent: true });
    }

    const encryptedSecret = await encryptString(envSecret, ESCROW_ENCRYPTION_KEY);
    const encryptedApi = await encryptString(envApiKey, ESCROW_ENCRYPTION_KEY);

    // Always seed at slot 1 (or next available if slot 1 is taken by another row).
    const { data: slot1 } = await supabase
      .from("lightning_wallets")
      .select("id")
      .eq("slot", 1)
      .maybeSingle();
    let targetSlot = 1;
    if (slot1) {
      const { data: maxRow } = await supabase
        .from("lightning_wallets")
        .select("slot")
        .order("slot", { ascending: false })
        .limit(1)
        .maybeSingle();
      targetSlot = (maxRow?.slot ?? 0) + 1;
    }

    const { error: insertErr } = await supabase.from("lightning_wallets").insert({
      slot: targetSlot,
      pubkey: envPubkey,
      encrypted_secret_key: encryptedSecret,
      encrypted_api_key: encryptedApi,
      status: "active",
      notes: "Seeded from Railway env vars",
    });
    if (insertErr) {
      return json({ ok: false, reason: insertErr.message }, 500);
    }

    return json({ ok: true, seeded: true, slot: targetSlot, pubkey: envPubkey });
  } catch (err) {
    return json({ ok: false, reason: (err as Error).message ?? String(err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function encryptString(plaintext: string, encryptionKeyHex: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const keyBytes = hexToUint8Array(encryptionKeyHex);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const dataBytes = new TextEncoder().encode(plaintext);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, dataBytes),
  );
  const ciphertext = encrypted.slice(0, encrypted.length - 16);
  const authTag = encrypted.slice(encrypted.length - 16);
  return `${toHex(iv)}:${toHex(authTag)}:${toHex(ciphertext)}`;
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}