import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import bs58 from "https://esm.sh/bs58@5.0.0";
import { Keypair } from "https://esm.sh/@solana/web3.js@1.95.3";

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
  const ESCROW_ENCRYPTION_KEY = Deno.env.get("ESCROW_ENCRYPTION_KEY")!;

  try {
    const body = await req.json();
    const adminWallet = String(body?.adminWallet ?? "").trim().toLowerCase();
    const pubkey = String(body?.pubkey ?? "").trim();
    const secretKeyBase58 = String(body?.secretKeyBase58 ?? "").trim();
    const apiKey = String(body?.apiKey ?? "").trim();
    const notes = body?.notes ? String(body.notes).slice(0, 500) : null;

    if (!adminWallet || !pubkey || !secretKeyBase58 || !apiKey) {
      return json({ error: "Missing required fields" }, 400);
    }

    const { data: isAdmin, error: adminErr } = await supabase.rpc(
      "is_admin_wallet",
      { p_wallet: adminWallet },
    );
    if (adminErr) return json({ error: adminErr.message }, 500);
    if (!isAdmin) return json({ error: "unauthorized" }, 403);

    // Validate the keypair
    let secretBytes: Uint8Array;
    try {
      secretBytes = bs58.decode(secretKeyBase58);
    } catch {
      return json({ error: "secretKeyBase58 is not valid base58" }, 400);
    }
    if (secretBytes.length !== 64) {
      return json(
        { error: `Secret key must decode to 64 bytes, got ${secretBytes.length}` },
        400,
      );
    }
    let derivedPubkey: string;
    try {
      derivedPubkey = Keypair.fromSecretKey(secretBytes).publicKey.toBase58();
    } catch (err) {
      return json({ error: `Invalid secret key: ${(err as Error).message}` }, 400);
    }
    if (derivedPubkey !== pubkey) {
      return json(
        { error: `Public key mismatch. Provided ${pubkey}, derived ${derivedPubkey}` },
        400,
      );
    }

    const encryptedSecret = await encryptString(secretKeyBase58, ESCROW_ENCRYPTION_KEY);
    const encryptedApi = await encryptString(apiKey, ESCROW_ENCRYPTION_KEY);

    // Pick next slot
    const { data: slotRow } = await supabase
      .from("lightning_wallets")
      .select("slot")
      .order("slot", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSlot = (slotRow?.slot ?? 0) + 1;

    const { error: insertErr } = await supabase.from("lightning_wallets").insert({
      slot: nextSlot,
      pubkey,
      encrypted_secret_key: encryptedSecret,
      encrypted_api_key: encryptedApi,
      status: "active",
      notes,
    });
    if (insertErr) {
      if (insertErr.message?.includes("duplicate")) {
        return json({ error: "Wallet pubkey already registered" }, 409);
      }
      return json({ error: insertErr.message }, 500);
    }

    return json({ ok: true, slot: nextSlot, pubkey });
  } catch (err) {
    return json({ error: (err as Error).message ?? String(err) }, 500);
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