// Slim sponsored-claim handler.
//
// Responsibilities:
//   1. Validate input + window
//   2. Look up the sponsor_pending row by token, check expiry
//   3. Generate escrow + mint keypairs (inline crypto.subtle, no esm.sh deps)
//   4. Encrypt both keys with AES-GCM
//   5. Upload metadata JSON to storage
//   6. Allocate a Pump.fun slot under the schedule lock
//   7. Update the row with token data + status='sponsor_pending_funding'
//
// On-chain escrow funding is performed asynchronously by the Railway
// executor (see executor/src/fundSponsoredEscrow.ts). The frontend polls
// get_launch_public(launch_id) until status flips to 'scheduled'.
//
// Heavy Solana JS imports were removed because they exceeded Deno
// edge-runtime's boot CPU budget ("CPU Time exceeded" on cold start).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import {
  findNextAvailableSlot,
  withScheduleLock,
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

  const ESCROW_ENCRYPTION_KEY = Deno.env.get("ESCROW_ENCRYPTION_KEY")!;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const {
      link_token,
      token_name,
      token_symbol,
      description,
      image_url,
      twitter_url,
      telegram_url,
      website_url,
      launch_datetime,
      creator_delivery_wallet,
    } = await req.json();

    if (!link_token || !token_name || !token_symbol || !launch_datetime) {
      return errorResponse("Missing required fields", 400);
    }

    // Optional creator_delivery_wallet: where the influencer wants their
    // tokens delivered after launch. Validated as a plausible base58
    // Solana pubkey; an empty/undefined value is allowed.
    let normalizedDeliveryWallet: string | null = null;
    if (
      creator_delivery_wallet !== undefined &&
      creator_delivery_wallet !== null &&
      creator_delivery_wallet !== ""
    ) {
      if (typeof creator_delivery_wallet !== "string") {
        return errorResponse("creator_delivery_wallet must be a string", 400);
      }
      const trimmed = creator_delivery_wallet.trim();
      if (trimmed.length < 32 || trimmed.length > 44) {
        return errorResponse(
          "creator_delivery_wallet must be a valid Solana wallet address",
          400,
        );
      }
      if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed)) {
        return errorResponse(
          "creator_delivery_wallet contains invalid characters",
          400,
        );
      }
      normalizedDeliveryWallet = trimmed;
    }

    // Validate launch time is 1-72h ahead
    const launchTime = new Date(launch_datetime);
    const nowDate = new Date();
    const diffHours =
      (launchTime.getTime() - nowDate.getTime()) / (1000 * 60 * 60);
    if (Number.isNaN(diffHours) || diffHours < 1 || diffHours > 72) {
      return errorResponse(
        "Launch must be between 1 and 72 hours from now",
        400,
      );
    }

    // Lookup
    const { data: launch, error: fetchError } = await supabase
      .from("launches")
      .select("*")
      .eq("sponsor_link_token", link_token)
      .eq("status", "sponsor_pending")
      .single();

    if (fetchError || !launch) {
      return errorResponse("Sponsored link not found or already used", 404);
    }

    if (new Date(launch.sponsor_link_expires_at) < new Date()) {
      await supabase
        .from("launches")
        .update({ status: "cancelled" })
        .eq("id", launch.id);
      return errorResponse("This sponsored link has expired", 410);
    }

    // Build & upload metadata
    const metadataObj = {
      name: token_name,
      symbol: String(token_symbol).toUpperCase(),
      description: "Community launch powered by https://erys.live",
      image: image_url || "",
      twitter: twitter_url || "",
      telegram: telegram_url || "",
      website: website_url || "",
    };
    const metadataFileName = `${crypto.randomUUID()}.json`;
    const metadataBytes = new TextEncoder().encode(JSON.stringify(metadataObj));

    const { error: uploadErr } = await supabase.storage
      .from("token-metadata")
      .upload(metadataFileName, metadataBytes, {
        contentType: "application/json",
        upsert: false,
      });
    if (uploadErr) {
      return errorResponse(
        `Failed to upload metadata: ${uploadErr.message}`,
        500,
      );
    }

    const { data: urlData } = supabase.storage
      .from("token-metadata")
      .getPublicUrl(metadataFileName);
    const ipfsMetadataUrl = urlData.publicUrl;

    try {
      const verifyRes = await fetch(ipfsMetadataUrl, { method: "HEAD" });
      if (!verifyRes.ok) {
        return errorResponse(
          "Metadata URL not publicly accessible",
          500,
        );
      }
    } catch (e: any) {
      return errorResponse(
        `Failed to verify metadata URL: ${e.message}`,
        500,
      );
    }

    // Provision a fresh PumpPortal Lightning wallet — it doubles as the
    // escrow (contributors send SOL to it) AND as the wallet PumpPortal
    // uses to launch / accrue fees. This puts sponsored launches on the
    // same per-launch fee-harvest path as create-launch-pumpfun.
    let lightning: { pubkey: string; secretKeyHex: string; apiKey: string };
    try {
      lightning = await createLightningWallet();
    } catch (e: any) {
      return errorResponse(
        `Failed to provision Lightning wallet: ${e?.message ?? e}`,
        502,
      );
    }
    const mint = await generateSolanaKeypair();

    const encryptedLightningPk = await encryptKey(
      lightning.secretKeyHex,
      ESCROW_ENCRYPTION_KEY,
    );
    const encryptedLightningApi = await encryptKey(
      uint8ArrayToHex(new TextEncoder().encode(lightning.apiKey)),
      ESCROW_ENCRYPTION_KEY,
    );
    const encryptedMintPk = await encryptKey(
      uint8ArrayToHex(mint.secretKey),
      ESCROW_ENCRYPTION_KEY,
    );

    // Allocate Pump.fun slot under the schedule lock and persist the row.
    // Status is set to 'sponsor_pending_funding' so the Railway executor
    // can pick it up and fund the escrow with 0.1 SOL from the platform
    // wallet. Once funded, the executor flips status to 'scheduled'.
    const slot = await withScheduleLock(supabase, "pumpfun", async () => {
      const allocated = await findNextAvailableSlot(
        supabase,
        "pumpfun",
        launch_datetime,
      );
      const { error: updateError } = await supabase
        .from("launches")
        .update({
          token_name,
          token_symbol: String(token_symbol).toUpperCase(),
          description: description || null,
          image_url: image_url || null,
          twitter_url: twitter_url || null,
          telegram_url: telegram_url || null,
          website_url: website_url || null,
          ipfs_metadata_url: ipfsMetadataUrl,
          token_mint_address: mint.publicKey,
            escrow_wallet_public_key: lightning.pubkey,
            escrow_wallet_encrypted_private_key: encryptedLightningPk,
            lightning_wallet_public_key: lightning.pubkey,
            lightning_wallet_encrypted_private_key: encryptedLightningPk,
            lightning_wallet_encrypted_api_key: encryptedLightningApi,
          pumpfun_mint_keypair_encrypted: encryptedMintPk,
          sponsor_link_claimed_at: new Date().toISOString(),
          launch_datetime: allocated.adjustedTime,
          status: "sponsor_pending_funding",
          sponsor_funding_attempts: 0,
          sponsor_funding_error: null,
          creator_delivery_wallet: normalizedDeliveryWallet,
        })
        .eq("id", launch.id);
      if (updateError) {
        throw new Error(
          `Failed to finalize launch: ${updateError.message}`,
        );
      }
      return allocated;
    });

    return new Response(
      JSON.stringify({
        success: true,
        launch_id: launch.id,
        launch_url: `/launch/${launch.id}`,
        mint_address: mint.publicKey,
        adjusted_launch_datetime: slot.adjustedTime,
        original_launch_datetime: slot.originalTime,
        was_adjusted: slot.wasAdjusted,
        offset_minutes: slot.offsetMinutes,
        status: "sponsor_pending_funding",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("claim-sponsored-slot error:", err);
    return errorResponse(err.message || "Unknown error", 500);
  }
});

async function generateSolanaKeypair(): Promise<{
  publicKey: string;
  secretKey: Uint8Array;
}> {
  const ed25519KeyPair = await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  );
  const privateKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey(
      "pkcs8",
      (ed25519KeyPair as CryptoKeyPair).privateKey,
    ),
  );
  const publicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey(
      "raw",
      (ed25519KeyPair as CryptoKeyPair).publicKey,
    ),
  );
  const privateSeed = privateKeyRaw.slice(16, 48);
  const solanaSecretKey = new Uint8Array(64);
  solanaSecretKey.set(privateSeed);
  solanaSecretKey.set(publicKeyRaw, 32);
  return {
    publicKey: base58Encode(publicKeyRaw),
    secretKey: solanaSecretKey,
  };
}

async function encryptKey(
  dataHex: string,
  encryptionKeyHex: string,
): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const keyBytes = hexToUint8Array(encryptionKeyHex);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const dataBytes = hexToUint8Array(dataHex);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      dataBytes as BufferSource,
    ),
  );
  const ciphertext = encrypted.slice(0, encrypted.length - 16);
  const authTag = encrypted.slice(encrypted.length - 16);
  return `${uint8ArrayToHex(iv)}:${uint8ArrayToHex(authTag)}:${
    uint8ArrayToHex(ciphertext)
  }`;
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
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
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function base58Decode(s: string): Uint8Array {
  const map = new Map<string, number>();
  for (let i = 0; i < BASE58_ALPHABET.length; i++) map.set(BASE58_ALPHABET[i], i);
  const bytes: number[] = [];
  for (const ch of s) {
    const val = map.get(ch);
    if (val === undefined) throw new Error(`invalid base58 char: ${ch}`);
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < s.length && s[i] === BASE58_ALPHABET[0]; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

async function createLightningWallet(): Promise<{
  pubkey: string;
  secretKeyHex: string;
  apiKey: string;
}> {
  const url = "https://pumpportal.fun/api/create-wallet";
  let lastErr: any = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(url, { method: "GET", signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} ${res.statusText}`);
        continue;
      }
      const json: any = await res.json();
      const pubkey = String(json?.walletPublicKey ?? "").trim();
      const privateKey = String(json?.privateKey ?? "").trim();
      const apiKey = String(json?.apiKey ?? "").trim();
      if (
        !pubkey ||
        pubkey.length < 32 ||
        pubkey.length > 44 ||
        !/^[1-9A-HJ-NP-Za-km-z]+$/.test(pubkey)
      ) {
        lastErr = new Error(`invalid walletPublicKey`);
        continue;
      }
      if (!privateKey || !apiKey) {
        lastErr = new Error(`missing privateKey or apiKey in response`);
        continue;
      }
      let secret: Uint8Array;
      try {
        secret = base58Decode(privateKey);
      } catch (e: any) {
        lastErr = new Error(`privateKey not valid base58: ${e?.message ?? e}`);
        continue;
      }
      if (secret.length !== 64) {
        lastErr = new Error(`privateKey decoded to ${secret.length} bytes, expected 64`);
        continue;
      }
      const derivedPub = base58Encode(secret.slice(32));
      if (derivedPub !== pubkey) {
        lastErr = new Error(`privateKey does not match walletPublicKey`);
        continue;
      }
      return { pubkey, secretKeyHex: uint8ArrayToHex(secret), apiKey };
    } catch (err: any) {
      clearTimeout(t);
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("unknown error provisioning lightning wallet");
}
