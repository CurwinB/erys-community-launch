import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

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
    const {
      token_name,
      token_symbol,
      description,
      image_url,
      twitter_url,
      telegram_url,
      website_url,
      launch_datetime,
      min_contribution_lamports,
      max_contribution_lamports,
      created_by_wallet,
    } = body;

    if (!token_name || !token_symbol || !launch_datetime || !min_contribution_lamports || !created_by_wallet) {
      return errorResponse("Missing required fields", 400);
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

        const imgForm = new FormData();
        imgForm.append("file", imgBlob, imgFileName);
        imgForm.append("pinataMetadata", JSON.stringify({ name: imgFileName }));

        const imgPinRes = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
          method: "POST",
          headers: { Authorization: `Bearer ${PINATA_JWT}` },
          body: imgForm,
        });

        if (!imgPinRes.ok) {
          const errText = await imgPinRes.text();
          return errorResponse(`Pinata image upload failed: ${errText}`, 500);
        }

        const imgPinData = await imgPinRes.json();
        finalImageUrl = `https://gateway.pinata.cloud/ipfs/${imgPinData.IpfsHash}`;
      } catch (err: any) {
        return errorResponse(`Image IPFS upload failed: ${err.message}`, 500);
      }
    }

    // Step 2: Build metadata JSON and pin to Pinata IPFS
    const metadataObj = {
      name: token_name,
      symbol: token_symbol.toUpperCase(),
      description: description || "",
      image: finalImageUrl,
      twitter: twitter_url || "",
      telegram: telegram_url || "",
      website: website_url || "",
    };

    let ipfsMetadataUrl: string;
    try {
      const metaPinRes = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PINATA_JWT}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pinataContent: metadataObj,
          pinataMetadata: { name: `${token_symbol.toUpperCase()}-metadata.json` },
        }),
      });

      if (!metaPinRes.ok) {
        const errText = await metaPinRes.text();
        return errorResponse(`Pinata metadata upload failed: ${errText}`, 500);
      }

      const metaPinData = await metaPinRes.json();
      ipfsMetadataUrl = `https://gateway.pinata.cloud/ipfs/${metaPinData.IpfsHash}`;
    } catch (err: any) {
      return errorResponse(`Metadata IPFS upload failed: ${err.message}`, 500);
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

    // Step 4: Insert into launches table
    const { data, error } = await supabase.from("launches").insert({
      token_name,
      token_symbol: token_symbol.toUpperCase(),
      description: description || null,
      image_url: image_url || null,
      twitter_url: twitter_url || null,
      telegram_url: telegram_url || null,
      website_url: website_url || null,
      launch_datetime,
      min_contribution_lamports,
      max_contribution_lamports: max_contribution_lamports || null,
      escrow_wallet_public_key: escrow.publicKey,
      escrow_wallet_encrypted_private_key: encryptedEscrowPk,
      created_by_wallet,
      token_mint_address: mint.publicKey,
      ipfs_metadata_url: ipfsMetadataUrl,
      platform: "pumpfun",
      pumpfun_mint_keypair_encrypted: encryptedMintPk,
      status: "scheduled",
    }).select("id").single();

    if (error) {
      console.error("Insert error:", error);
      return errorResponse(`Failed to create launch: ${error.message}`, 500);
    }

    return new Response(
      JSON.stringify({
        success: true,
        launch_id: data.id,
        url: `/launch/${data.id}`,
        escrow_wallet: escrow.publicKey,
        mint_address: mint.publicKey,
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
  return new Response(
    JSON.stringify({ error: msg }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}