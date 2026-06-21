import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import {
  findNextAvailableSlot,
  withScheduleLock,
} from "../_shared/scheduleCapacity.ts";

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

  const ESCROW_ENCRYPTION_KEY = Deno.env.get("ESCROW_ENCRYPTION_KEY")!;

  try {
    const body = await req.json();

    // Admin kill-switch: pause new Bags launches without a code deploy.
    {
      const { data: setting } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "launches_bags_enabled")
        .maybeSingle();
      if (setting && setting.value !== "true") {
        return errorResponse(
          "Bags.fm launches are temporarily paused for maintenance. Please try again shortly.",
          503
        );
      }
    }

    const {
      token_name,
      token_symbol,
      description,
      image_url,
      twitter_url,
      telegram_url,
      website_url,
      launch_datetime,
      created_by_wallet,
    } = body;

    if (!token_name || !token_symbol || !launch_datetime || !created_by_wallet) {
      return errorResponse("Missing required fields", 400);
    }

    // NOTE: We intentionally do NOT call Bags' create-token-info here.
    // Bags' mint reservation has a TTL and would expire between scheduling
    // and execution. The executor calls create-token-info immediately
    // before fee-share/config + create-launch-transaction so the
    // reservation is always fresh. token_mint_address and
    // ipfs_metadata_url are therefore inserted as null and populated by
    // the executor at launch time.

    // Step 1: Generate escrow keypair using Web Crypto (Ed25519 via raw bytes)
    const keyPairBytes = new Uint8Array(64);
    crypto.getRandomValues(keyPairBytes);

    // Use ed25519 key generation via subtle crypto
    const ed25519KeyPair = await crypto.subtle.generateKey(
      "Ed25519",
      true,
      ["sign", "verify"]
    );

    const privateKeyRaw = new Uint8Array(
      await crypto.subtle.exportKey("pkcs8", ed25519KeyPair.privateKey)
    );
    const publicKeyRaw = new Uint8Array(
      await crypto.subtle.exportKey("raw", ed25519KeyPair.publicKey)
    );

    // Solana expects 64-byte secret key = [private seed (32) + public key (32)]
    // PKCS8 for Ed25519 is: 16 bytes header + 34 bytes (2 byte length prefix + 32 byte seed)
    const privateSeed = privateKeyRaw.slice(16, 48);
    const solanaSecretKey = new Uint8Array(64);
    solanaSecretKey.set(privateSeed);
    solanaSecretKey.set(publicKeyRaw, 32);

    // Encode public key as base58
    const escrowPublicKey = base58Encode(publicKeyRaw);

    // Step 3: Encrypt private key with AES-256-GCM
    const encryptedPrivateKey = await encryptKey(
      uint8ArrayToHex(solanaSecretKey),
      ESCROW_ENCRYPTION_KEY
    );

    // Look up affiliate attribution (if the creator wallet was attributed
    // via a referral link). Snapshotted onto the launch row so revoking the
    // affiliate later does not change the split for past launches.
    let referredByAffiliateId: string | null = null;
    try {
      const { data: affId } = await supabase.rpc("get_wallet_affiliate", {
        p_wallet: created_by_wallet,
      });
      if (typeof affId === "string") referredByAffiliateId = affId;
    } catch (e) {
      console.warn("[create-launch] affiliate lookup failed", e);
    }

    // Step 3: Allocate a slot + insert atomically under platform lock so two
    // concurrent submissions can't both grab the same minute.
    const { data, slot } = await withScheduleLock(supabase, "bags", async () => {
      const slot = await findNextAvailableSlot(supabase, "bags", launch_datetime);
      const inserted = await supabase.from("launches").insert({
        token_name,
        token_symbol: token_symbol.toUpperCase(),
        description: description || null,
        image_url: image_url || null,
        twitter_url: twitter_url || null,
        telegram_url: telegram_url || null,
        website_url: website_url || null,
        launch_datetime: slot.adjustedTime,
        min_contribution_lamports: 100_000_000, // platform-enforced 0.1 SOL
        max_contribution_lamports: null,
        escrow_wallet_public_key: escrowPublicKey,
        escrow_wallet_encrypted_private_key: encryptedPrivateKey,
        created_by_wallet,
        token_mint_address: null,
        ipfs_metadata_url: null,
        status: "scheduled",
        referred_by_affiliate_id: referredByAffiliateId,
      }).select("id").single();
      if (inserted.error) {
        throw new Error(`Failed to create launch: ${inserted.error.message}`);
      }
      return { data: inserted.data, slot };
    });

    return new Response(
      JSON.stringify({
        success: true,
        launch_id: data.id,
        url: `/launch/${data.id}`,
        escrow_wallet: escrowPublicKey,
        adjusted_launch_datetime: slot.adjustedTime,
        original_launch_datetime: slot.originalTime,
        was_adjusted: slot.wasAdjusted,
        offset_minutes: slot.offsetMinutes,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("create-launch error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function encryptKey(dataHex: string, encryptionKeyHex: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const keyBytes = hexToUint8Array(encryptionKeyHex);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const dataBytes = hexToUint8Array(dataHex);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, dataBytes)
  );

  // AES-GCM appends 16-byte auth tag
  const ciphertext = encrypted.slice(0, encrypted.length - 16);
  const authTag = encrypted.slice(encrypted.length - 16);

  return `${uint8ArrayToHex(iv)}:${uint8ArrayToHex(authTag)}:${uint8ArrayToHex(ciphertext)}`;
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = "";
  for (const byte of bytes) {
    if (byte === 0) result += BASE58_ALPHABET[0];
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

function errorResponse(msg: string, status: number) {
  return new Response(
    JSON.stringify({ error: msg }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}
