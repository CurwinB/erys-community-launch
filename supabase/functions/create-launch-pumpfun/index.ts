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
        // Use ipfs.io public gateway exactly as PumpPortal's official
        // /trade-local example does. gateway.pinata.cloud is the shared
        // free-tier gateway and frequently returns 429 / HTML challenges
        // to server-side fetchers like PumpPortal — when that happens
        // their create handler crashes with the cryptic
        // `Cannot read properties of undefined (reading 'toBuffer')` 400.
        finalImageUrl = `https://ipfs.io/ipfs/${imgCid}`;
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
      // Use ipfs.io — matches PumpPortal's official example exactly.
      // gateway.pinata.cloud rate-limits server-side fetchers and trips
      // PumpPortal's `undefined.toBuffer()` 400 path.
      ipfsMetadataUrl = `https://ipfs.io/ipfs/${metadataCid}`;
    } catch (err: any) {
      return errorResponse(`Metadata IPFS upload failed: ${err.message}`, 500);
    }

    // Step 2a: Verify the EXACT URL we're about to store is fully fetchable
    // (JSON parses + image field returns 200). PumpPortal fetches this URL
    // synchronously inside /trade-local; if it 404s or the `image` it
    // references is unreachable, PumpPortal crashes with the cryptic
    // `Cannot read properties of undefined (reading 'toBuffer')` 400. Fail
    // the create here so the user sees a clear error before contributions
    // open and funds get pooled.
    const reachable = await verifyMetadataReachable(ipfsMetadataUrl, 30_000);
    if (!reachable.ok) {
      return errorResponse(
        `Metadata URL not reachable in time: ${reachable.reason}. Please retry in a moment.`,
        503
      );
    }

    // Step 2: Generate two Ed25519 keypairs (escrow + mint)
    const escrow = await generateSolanaKeypair();
    const mint = await generateSolanaKeypair();

    // Step 3: Encrypt both private keys with AES-256-GCM
    const encryptedEscrowPk = await encryptKey(
      uint8ArrayToHex(escrow.secretKey),
      ESCROW_ENCRYPTION_KEY
    );
    const encryptedMintPk = await encryptKey(
      uint8ArrayToHex(mint.secretKey),
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
        escrow_wallet_public_key: escrow.publicKey,
        escrow_wallet_encrypted_private_key: encryptedEscrowPk,
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
        escrow_wallet: escrow.publicKey,
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

// Poll public IPFS gateways until the CID is retrievable, or timeout.
// Pump.fun validates the metadata URI inline and rejects launches whose
// JSON hasn't propagated yet, so we want at least one gateway to serve it
// before we hand the URL to PumpPortal.
async function waitForIpfsPropagation(cid: string, timeoutMs: number): Promise<boolean> {
  const gateways = [
    `https://ipfs.io/ipfs/${cid}`,
    `https://cloudflare-ipfs.com/ipfs/${cid}`,
    `https://gateway.pinata.cloud/ipfs/${cid}`,
  ];
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    for (const url of gateways) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3_000);
        const res = await fetch(url, { method: "GET", signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) {
          // Drain to avoid leaking the response body
          await res.text().catch(() => undefined);
          console.log(`IPFS propagation confirmed via ${url} (attempt ${attempt + 1})`);
          return true;
        }
      } catch {
        // try next gateway
      }
    }
    attempt++;
    await new Promise((r) => setTimeout(r, 1_500));
  }
  return false;
}

// Verify the metadata URL we're about to hand to PumpPortal is fully
// resolvable: the URL itself returns 200 with valid JSON, and the `image`
// field inside that JSON is also reachable (200). If either piece is not
// ready, PumpPortal's create handler will crash with `toBuffer` 400.
async function verifyMetadataReachable(
  url: string,
  timeoutMs: number
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastReason = "no attempts made";
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5_000);
      const res = await fetch(url, { method: "GET", signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) {
        lastReason = `metadata GET ${res.status}`;
      } else {
        const text = await res.text();
        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          lastReason = "metadata not valid JSON yet";
          await new Promise((r) => setTimeout(r, 1_500));
          continue;
        }
        // PumpPortal reads name/symbol/image synchronously to build the
        // Metaplex record. Any missing/empty value here will crash their
        // handler with `undefined.toBuffer()`. Reject early.
        const name = typeof json?.name === "string" ? json.name.trim() : "";
        const symbol = typeof json?.symbol === "string" ? json.symbol.trim() : "";
        const imageStr = typeof json?.image === "string" ? json.image.trim() : "";
        if (!name || !symbol || !imageStr) {
          lastReason = `metadata missing required fields (name=${!!name} symbol=${!!symbol} image=${!!imageStr})`;
          await new Promise((r) => setTimeout(r, 1_000));
          continue;
        }
        const imageUrl: string | undefined = json?.image;
        if (!imageUrl || !/^https?:\/\//.test(imageUrl)) {
          // No HTTP image to verify — JSON is enough.
          console.log(`Metadata reachable on attempt ${attempt} (no image to verify)`);
          return { ok: true };
        }
        try {
          const imgCtrl = new AbortController();
          const it = setTimeout(() => imgCtrl.abort(), 5_000);
          const imgRes = await fetch(imageUrl, { method: "GET", signal: imgCtrl.signal });
          clearTimeout(it);
          // Drain to free socket
          await imgRes.arrayBuffer().catch(() => undefined);
          if (imgRes.ok) {
            console.log(`Metadata + image reachable on attempt ${attempt}`);
            return { ok: true };
          }
          lastReason = `image GET ${imgRes.status}`;
        } catch (e: any) {
          lastReason = `image fetch threw: ${e?.message ?? e}`;
        }
      }
    } catch (e: any) {
      lastReason = `metadata fetch threw: ${e?.message ?? e}`;
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  return { ok: false, reason: `${lastReason} (after ${attempt} attempts in ${timeoutMs}ms)` };
}