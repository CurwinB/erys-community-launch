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
  const PINATA_JWT = Deno.env.get("PINATA_JWT")!;

  if (!PINATA_JWT) {
    return errorResponse("PINATA_JWT secret is not configured", 500);
  }

  // Pinata dedicated gateway (e.g. "your-name.mypinata.cloud"). Account-
  // isolated rate limits, much more reliable than ipfs.io for PumpPortal's
  // server-side fetch. Falls back to ipfs.io if not configured.
  const PINATA_GATEWAY_DOMAIN = (Deno.env.get("PINATA_GATEWAY_DOMAIN") ?? "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const buildIpfsUrl = (cid: string): string =>
    PINATA_GATEWAY_DOMAIN
      ? `https://${PINATA_GATEWAY_DOMAIN}/ipfs/${cid}`
      : `https://ipfs.io/ipfs/${cid}`;
  if (!PINATA_GATEWAY_DOMAIN) {
    console.warn("[create-launch-pumpfun] PINATA_GATEWAY_DOMAIN not set; falling back to ipfs.io (rate-limited)");
  }

  try {
    const body = await req.json();

    // Admin kill-switch: pause new Pump.fun launches without a code deploy.
    {
      const { data: setting } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "launches_pumpfun_enabled")
        .maybeSingle();
      if (setting && setting.value !== "true") {
        return errorResponse(
          "Pump.fun launches are temporarily paused for maintenance. Please try again shortly.",
          503
        );
      }
    }

    const {
      token_name: rawTokenName,
      token_symbol,
      description,
      image_url,
      twitter_url,
      telegram_url,
      website_url,
      launch_datetime,
      created_by_wallet,
    } = body;

    const token_name = (rawTokenName ?? "").trim();
    if (!token_name || !token_symbol || !launch_datetime || !created_by_wallet) {
      return errorResponse("Missing required fields", 400);
    }

    // Pump.fun validation: symbol must be alphanumeric, max 10 chars; name max 32 chars
    const symbolUpper = token_symbol.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,10}$/.test(symbolUpper)) {
      return errorResponse(
        "Token symbol must be 1-10 alphanumeric characters (A-Z, 0-9 only)",
        400
      );
    }
    if (token_name.length > 32) {
      return errorResponse("Token name must be 32 characters or fewer", 400);
    }

    // Step 1: If image_url is a Supabase storage URL (or any non-IPFS URL),
    // re-upload it to Pinata so the metadata references an ipfs:// gateway URL.
    let finalImageUrl = image_url || "";
    if (finalImageUrl && !finalImageUrl.includes("ipfs")) {
      try {
        const imgRes = await fetch(finalImageUrl);
        if (!imgRes.ok) {
          return errorResponse(`Failed to fetch image for IPFS upload: ${imgRes.status}`, 500);
        }
        const imgBlob = await imgRes.blob();
        const imgContentType = imgRes.headers.get("content-type") || "image/png";
        const ext = imgContentType.split("/")[1]?.split(";")[0] || "png";
        const imgFileName = `${crypto.randomUUID()}.${ext}`;

        // Use Pinata v3 Files API (per official Pump.fun integration examples)
        const imgForm = new FormData();
        imgForm.append("file", imgBlob, imgFileName);
        imgForm.append("network", "public");

        const imgPinRes = await fetch("https://uploads.pinata.cloud/v3/files", {
          method: "POST",
          headers: { Authorization: `Bearer ${PINATA_JWT}` },
          body: imgForm,
        });

        if (!imgPinRes.ok) {
          const errText = await imgPinRes.text();
          return errorResponse(`Pinata image upload failed (${imgPinRes.status}): ${errText}`, 500);
        }

        const imgPinData = await imgPinRes.json();
        const imgCid = imgPinData?.data?.cid || imgPinData?.IpfsHash;
        if (!imgCid) {
          return errorResponse(`Pinata image upload returned no CID: ${JSON.stringify(imgPinData)}`, 500);
        }
        // Use Pinata's dedicated gateway (account-isolated rate limits)
        // so PumpPortal's server-side fetch doesn't get 429/504'd by the
        // shared public-gateway pool.
        finalImageUrl = buildIpfsUrl(imgCid);
      } catch (err: any) {
        return errorResponse(`Image IPFS upload failed: ${err.message}`, 500);
      }
    }

    // Step 2: Build metadata JSON and pin to Pinata IPFS
    // Schema matches PumpPortal's official docs example:
    //   { name, symbol, image (HTTPS), description, twitter, telegram, website }
    // showName + createdOn are pump.fun frontend extras (harmless).
    const metadataObj: Record<string, unknown> = {
      name: token_name,
      symbol: symbolUpper,
      description: description || "",
      image: finalImageUrl,
      showName: true,
      createdOn: "https://pump.fun",
    };
    if (twitter_url) metadataObj.twitter = twitter_url;
    if (telegram_url) metadataObj.telegram = telegram_url;
    if (website_url) metadataObj.website = website_url;

    let ipfsMetadataUrl: string;
    let metadataCid: string;
    try {
      // Pinata v3 Files API: upload JSON as a file in one call
      const metaBlob = new Blob([JSON.stringify(metadataObj)], { type: "application/json" });
      const metaForm = new FormData();
      metaForm.append("file", metaBlob, `${symbolUpper}-metadata.json`);
      metaForm.append("network", "public");

      const metaPinRes = await fetch("https://uploads.pinata.cloud/v3/files", {
        method: "POST",
        headers: { Authorization: `Bearer ${PINATA_JWT}` },
        body: metaForm,
      });

      if (!metaPinRes.ok) {
        const errText = await metaPinRes.text();
        return errorResponse(`Pinata metadata upload failed (${metaPinRes.status}): ${errText}`, 500);
      }

      const metaPinData = await metaPinRes.json();
      metadataCid = metaPinData?.data?.cid || metaPinData?.IpfsHash;
      if (!metadataCid) {
        return errorResponse(`Pinata metadata upload returned no CID: ${JSON.stringify(metaPinData)}`, 500);
      }
      ipfsMetadataUrl = buildIpfsUrl(metadataCid);
    } catch (err: any) {
      return errorResponse(`Metadata IPFS upload failed: ${err.message}`, 500);
    }

    // Step 2a: Verify metadata via Pinata's AUTHENTICATED gateway. We
    // intentionally do NOT probe public gateways (ipfs.io / cloudflare)
    // from the Edge Function — Supabase's shared egress IPs get rate-
    // limited / 401'd by those gateways, which used to cause spurious
    // "Metadata URL not reachable" 503s on launches whose metadata was
    // actually fine. The executor (Railway) does the public-gateway
    // probe right before /trade-local, which is the network path that
    // actually matters (it mirrors PumpPortal's own fetch).
    //
    // Here we just sanity-check the JSON we uploaded by fetching it back
    // through Pinata's authenticated gateway with our JWT. If that
    // returns 200 + parses + has name/symbol/image, we know PumpPortal
    // will be able to read it from any working IPFS gateway.
    const reachable = await verifyMetadataViaPinata(metadataCid, PINATA_JWT);
    if (!reachable.ok) {
      return errorResponse(
        `Metadata verification failed: ${reachable.reason}. Please retry in a moment.`,
        503
      );
    }

    // Step 2: Generate the mint keypair locally (we sign create with it).
    const mint = await generateSolanaKeypair();
    const encryptedMintPk = await encryptKey(
      uint8ArrayToHex(mint.secretKey),
      ESCROW_ENCRYPTION_KEY
    );

    // Step 2b: Provision a fresh per-launch PumpPortal Lightning wallet.
    // This wallet IS the escrow for this launch — contributors send SOL
    // directly to it, PumpPortal uses it to launch the token, and creator
    // fees accrue to it. Replaces the previous shared-pool model.
    let lightning: { pubkey: string; secretKeyHex: string; apiKey: string };
    try {
      lightning = await createLightningWallet();
    } catch (err: any) {
      return errorResponse(
        `PumpPortal wallet provisioning unavailable: ${err?.message ?? err}. Please try again.`,
        503
      );
    }
    const encryptedLightningPk = await encryptKey(
      lightning.secretKeyHex,
      ESCROW_ENCRYPTION_KEY
    );
    const encryptedLightningApi = await encryptKey(
      utf8ToHex(lightning.apiKey),
      ESCROW_ENCRYPTION_KEY
    );

    // Step 4: Allocate slot + insert atomically under platform lock.
    const { data, slot } = await withScheduleLock(supabase, "pumpfun", async () => {
      const slot = await findNextAvailableSlot(supabase, "pumpfun", launch_datetime);
      const inserted = await supabase.from("launches").insert({
        token_name,
        token_symbol: symbolUpper,
        description: description || null,
        image_url: image_url || null,
        twitter_url: twitter_url || null,
        telegram_url: telegram_url || null,
        website_url: website_url || null,
        launch_datetime: slot.adjustedTime,
        min_contribution_lamports: 100_000_000, // platform-enforced 0.1 SOL
        max_contribution_lamports: null,
        // Lightning wallet doubles as escrow — contributors send SOL here
        // and the executor signs Lightning create with the same key.
        escrow_wallet_public_key: lightning.pubkey,
        escrow_wallet_encrypted_private_key: encryptedLightningPk,
        lightning_wallet_public_key: lightning.pubkey,
        lightning_wallet_encrypted_private_key: encryptedLightningPk,
        lightning_wallet_encrypted_api_key: encryptedLightningApi,
        created_by_wallet,
        token_mint_address: mint.publicKey,
        ipfs_metadata_url: ipfsMetadataUrl,
        platform: "pumpfun",
        pumpfun_mint_keypair_encrypted: encryptedMintPk,
        status: "scheduled",
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
        escrow_wallet: lightning.pubkey,
        mint_address: mint.publicKey,
        adjusted_launch_datetime: slot.adjustedTime,
        original_launch_datetime: slot.originalTime,
        was_adjusted: slot.wasAdjusted,
        offset_minutes: slot.offsetMinutes,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("create-launch-pumpfun error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function generateSolanaKeypair(): Promise<{ publicKey: string; secretKey: Uint8Array }> {
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

  // PKCS8 for Ed25519: 16 bytes header + 2 byte length prefix + 32 byte seed
  const privateSeed = privateKeyRaw.slice(16, 48);
  const solanaSecretKey = new Uint8Array(64);
  solanaSecretKey.set(privateSeed);
  solanaSecretKey.set(publicKeyRaw, 32);

  return {
    publicKey: base58Encode(publicKeyRaw),
    secretKey: solanaSecretKey,
  };
}

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
  console.error(`[create-launch-pumpfun] ${status}: ${msg}`);
  return new Response(
    JSON.stringify({ error: msg }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

// Verify the metadata JSON via Pinata's AUTHENTICATED gateway using the
// JWT we already use for uploads. Authenticated requests are not subject
// to the harsh anonymous rate-limits that cause `ipfs.io` / shared
// gateways to return 401/429 to Supabase Edge Function egress IPs.
//
// We try a few attempts because Pinata occasionally needs a couple of
// seconds for a freshly-pinned CID to be served by the gateway.
async function verifyMetadataViaPinata(
  cid: string,
  pinataJwt: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const url = `https://gateway.pinata.cloud/ipfs/${cid}`;
  const maxAttempts = 5;
  let lastReason = "no attempts made";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8_000);
      const res = await fetch(url, {
        method: "GET",
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${pinataJwt}` },
      });
      clearTimeout(t);
      if (!res.ok) {
        lastReason = `pinata GET ${res.status}`;
      } else {
        const text = await res.text();
        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          lastReason = "metadata not valid JSON";
          await new Promise((r) => setTimeout(r, 1_500));
          continue;
        }
        const name = typeof json?.name === "string" ? json.name.trim() : "";
        const symbol = typeof json?.symbol === "string" ? json.symbol.trim() : "";
        const image = typeof json?.image === "string" ? json.image.trim() : "";
        if (!name || !symbol || !image) {
          lastReason = `metadata missing fields (name=${!!name} symbol=${!!symbol} image=${!!image})`;
        } else {
          console.log(`[create-launch-pumpfun] Pinata verify OK on attempt ${attempt}`);
          return { ok: true };
        }
      }
    } catch (e: any) {
      lastReason = `pinata fetch threw: ${e?.message ?? e}`;
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  return { ok: false, reason: `${lastReason} (after ${maxAttempts} pinata attempts)` };
}