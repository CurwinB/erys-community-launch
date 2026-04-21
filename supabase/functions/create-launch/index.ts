import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BAGS_API_BASE = "https://public-api-v2.bags.fm/api/v1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const BAGS_API_KEY = Deno.env.get("BAGS_API_KEY")!;
  const ESCROW_ENCRYPTION_KEY = Deno.env.get("ESCROW_ENCRYPTION_KEY")!;

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

    // Step 1: Create token info on Bags API
    const tokenInfoRes = await fetch(`${BAGS_API_BASE}/token-launch/create-token-info`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": BAGS_API_KEY,
      },
      body: JSON.stringify({
        name: token_name,
        symbol: token_symbol,
        description: description || "",
        imageUrl: image_url || "",
        twitter: twitter_url || undefined,
        telegram: telegram_url || undefined,
        website: website_url || undefined,
      }),
    });

    let tokenMint: string | null = null;
    let ipfsMetadataUrl: string | null = null;

    if (tokenInfoRes.ok) {
      const tokenInfoData = await tokenInfoRes.json();
      console.log("create-token-info response:", JSON.stringify(tokenInfoData));
      tokenMint = tokenInfoData.response?.tokenMint || null;
      ipfsMetadataUrl = tokenInfoData.response?.tokenLaunch?.uri || null;
      console.log("tokenMint:", tokenMint, "ipfsMetadataUrl:", ipfsMetadataUrl);
    } else {
      const errText = await tokenInfoRes.text();
      console.error("create-token-info failed:", errText);
      return errorResponse(`Bags create-token-info failed: ${errText}`, 500);
    }

    if (!tokenMint || !ipfsMetadataUrl) {
      return errorResponse("Bags API did not return tokenMint or metadata URI. Cannot create launch.", 500);
    }

    // Step 2: Generate escrow keypair using Web Crypto (Ed25519 via raw bytes)
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
      escrow_wallet_public_key: escrowPublicKey,
      escrow_wallet_encrypted_private_key: encryptedPrivateKey,
      created_by_wallet,
      token_mint_address: tokenMint,
      ipfs_metadata_url: ipfsMetadataUrl,
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
        escrow_wallet: escrowPublicKey,
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
