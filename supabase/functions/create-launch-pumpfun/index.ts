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
      description: "Community launch powered by https://erys.live",
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

    // Step 2: Acquire a vanity `…pump` mint keypair from the pre-ground pool.
    // Falls back to a random keypair if the pool is empty so launches are
    // never blocked on grinder availability.
    let mintPublicKey: string;
    let encryptedMintPk: string;
    let claimedPoolRowId: string | null = null;
    try {
      const { data: claimed, error: claimErr } = await supabase.rpc(
        "claim_pump_keypair_from_pool",
        { p_launch_id: null }
      );
      if (claimErr) {
        console.warn("[create-launch-pumpfun] pool claim RPC failed:", claimErr.message);
      } else if (Array.isArray(claimed) && claimed.length > 0) {
        const row = claimed[0] as { id: string; public_key: string; encrypted_private_key: string };
        try {
          const decryptedHex = await decryptKey(row.encrypted_private_key, ESCROW_ENCRYPTION_KEY);
          const secret = hexToUint8Array(decryptedHex);
          const derivedPub = base58Encode(secret.slice(32));
          if (
            secret.length === 64 &&
            derivedPub === row.public_key &&
            /pump$/i.test(row.public_key)
          ) {
            mintPublicKey = row.public_key;
            encryptedMintPk = row.encrypted_private_key;
            claimedPoolRowId = row.id;
            console.log(`[create-launch-pumpfun] using pooled vanity mint ${mintPublicKey}`);
          } else {
            console.warn(
              `[create-launch-pumpfun] pool row ${row.id} failed verification (derived=${derivedPub} stored=${row.public_key}); falling back to random`
            );
          }
        } catch (verifyErr: any) {
          console.warn(
            `[create-launch-pumpfun] pool row ${row.id} decrypt/verify threw: ${verifyErr?.message ?? verifyErr}`
          );
        }
      }
    } catch (err: any) {
      console.warn("[create-launch-pumpfun] pool claim threw:", err?.message ?? err);
    }

    if (!claimedPoolRowId) {
      console.warn("[create-launch-pumpfun] pump_keypair_pool unavailable — generating random mint (no `pump` suffix)");
      const mint = await generateSolanaKeypair();
      mintPublicKey = mint.publicKey;
      encryptedMintPk = await encryptKey(
        uint8ArrayToHex(mint.secretKey),
        ESCROW_ENCRYPTION_KEY
      );
    }

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
          token_mint_address: mintPublicKey,
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

    // Patch the pool row with the launch id so we can audit which launch
    // consumed which keypair. Best-effort: a failure here is non-fatal.
    if (claimedPoolRowId) {
      const { error: patchErr } = await supabase
        .from("pump_keypair_pool")
        .update({ claimed_by_launch_id: data.id })
        .eq("id", claimedPoolRowId);
      if (patchErr) {
        console.warn(
          `[create-launch-pumpfun] failed to backfill claimed_by_launch_id on pool row ${claimedPoolRowId}: ${patchErr.message}`
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        launch_id: data.id,
        url: `/launch/${data.id}`,
        escrow_wallet: lightning.pubkey,
        mint_address: mintPublicKey,
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

async function decryptKey(blob: string, encryptionKeyHex: string): Promise<string> {
  const parts = blob.split(":");
  if (parts.length !== 3) throw new Error("invalid encrypted blob format");
  const [ivHex, tagHex, ctHex] = parts;
  const iv = hexToUint8Array(ivHex);
  const authTag = hexToUint8Array(tagHex);
  const ciphertext = hexToUint8Array(ctHex);
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    hexToUint8Array(encryptionKeyHex),
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  const decrypted = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, combined)
  );
  return uint8ArrayToHex(decrypted);
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

function utf8ToHex(s: string): string {
  return uint8ArrayToHex(new TextEncoder().encode(s));
}

function base58Decode(s: string): Uint8Array {
  if (!s) return new Uint8Array();
  const bytes: number[] = [];
  for (const ch of s) {
    const idx = BASE58_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base58 character: ${ch}`);
    let carry = idx;
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
  // Leading '1's in base58 → leading zero bytes.
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
        lastErr = new Error(`invalid walletPublicKey: ${JSON.stringify(json).slice(0, 200)}`);
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
      // Sanity-check: last 32 bytes of the secret == public key bytes.
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
  throw lastErr ?? new Error("unknown error");
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