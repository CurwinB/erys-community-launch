import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "https://esm.sh/@solana/web3.js@1.91.1";
import bs58 from "https://esm.sh/bs58@5.0.0";
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

  const ESCROW_ENCRYPTION_KEY = Deno.env.get("ESCROW_ENCRYPTION_KEY")!;
  const SOLANA_RPC_URL = Deno.env.get("SOLANA_RPC_URL")!;
  const ERYS_PLATFORM_PRIVATE_KEY = Deno.env.get("ERYS_PLATFORM_PRIVATE_KEY")!;

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
    } = await req.json();

    if (!link_token || !token_name || !token_symbol || !launch_datetime) {
      return errorResponse("Missing required fields", 400);
    }

    // Validate launch time is 1-72h ahead
    const launchTime = new Date(launch_datetime);
    const nowDate = new Date();
    const diffHours = (launchTime.getTime() - nowDate.getTime()) / (1000 * 60 * 60);
    if (Number.isNaN(diffHours) || diffHours < 1 || diffHours > 72) {
      return errorResponse("Launch must be between 1 and 72 hours from now", 400);
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
      await supabase.from("launches").update({ status: "cancelled" }).eq("id", launch.id);
      return errorResponse("This sponsored link has expired", 410);
    }

    // Build & upload metadata
    const metadataObj = {
      name: token_name,
      symbol: String(token_symbol).toUpperCase(),
      description: description || "",
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
    if (uploadErr) return errorResponse(`Failed to upload metadata: ${uploadErr.message}`, 500);

    const { data: urlData } = supabase.storage.from("token-metadata").getPublicUrl(metadataFileName);
    const ipfsMetadataUrl = urlData.publicUrl;

    try {
      const verifyRes = await fetch(ipfsMetadataUrl, { method: "HEAD" });
      if (!verifyRes.ok) return errorResponse("Metadata URL not publicly accessible", 500);
    } catch (e: any) {
      return errorResponse(`Failed to verify metadata URL: ${e.message}`, 500);
    }

    // Generate escrow + mint keypairs
    const escrow = await generateSolanaKeypair();
    const mint = await generateSolanaKeypair();

    const encryptedEscrowPk = await encryptKey(uint8ArrayToHex(escrow.secretKey), ESCROW_ENCRYPTION_KEY);
    const encryptedMintPk = await encryptKey(uint8ArrayToHex(mint.secretKey), ESCROW_ENCRYPTION_KEY);

    // Fund escrow with 0.1 SOL from platform wallet
    const platformSecretBytes = bs58.decode(ERYS_PLATFORM_PRIVATE_KEY);
    const platformKeypair = Keypair.fromSecretKey(new Uint8Array(platformSecretBytes));

    const SPONSORED_AMOUNT = 100_000_000; // 0.1 SOL
    const TX_FEE = 5_000;
    const transferAmount = SPONSORED_AMOUNT - TX_FEE;

    // Get latest blockhash
    const blockhashRes = await fetch(SOLANA_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getLatestBlockhash",
        params: [{ commitment: "confirmed" }],
      }),
    });
    const blockhashData = await blockhashRes.json() as any;
    if (blockhashData.error) {
      return errorResponse(`Failed to fetch blockhash: ${JSON.stringify(blockhashData.error)}`, 500);
    }
    const { blockhash } = blockhashData.result.value;

    const tx = new Transaction();
    tx.add(
      SystemProgram.transfer({
        fromPubkey: platformKeypair.publicKey,
        toPubkey: new PublicKey(escrow.publicKey),
        lamports: transferAmount,
      }),
    );
    tx.feePayer = platformKeypair.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(platformKeypair);

    const serialized = tx.serialize();
    const txBase64 = uint8ToBase64(new Uint8Array(serialized));

    const sendRes = await fetch(SOLANA_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [txBase64, { encoding: "base64", preflightCommitment: "confirmed" }],
      }),
    });
    const sendData = await sendRes.json() as any;
    if (sendData.error) {
      console.error("sendTransaction error:", sendData.error);
      return errorResponse(`Failed to seed escrow: ${JSON.stringify(sendData.error)}`, 500);
    }
    const sponsoredTxSignature = sendData.result;
    console.log(`Sponsored escrow funded: ${sponsoredTxSignature}`);

    // Allocate a Pump.fun launch slot under the platform schedule lock so we
    // can't double-book the same minute. The influencer picked launch_datetime;
    // if that minute is full, we slide forward to the next open slot.
    const slot = await withScheduleLock(supabase, "pumpfun", async () => {
      const allocated = await findNextAvailableSlot(supabase, "pumpfun", launch_datetime);
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
          escrow_wallet_public_key: escrow.publicKey,
          escrow_wallet_encrypted_private_key: encryptedEscrowPk,
          pumpfun_mint_keypair_encrypted: encryptedMintPk,
          sponsored_tx_signature: sponsoredTxSignature,
          sponsor_link_claimed_at: new Date().toISOString(),
          launch_datetime: allocated.adjustedTime,
          status: "scheduled",
        })
        .eq("id", launch.id);
      if (updateError) {
        throw new Error(`Failed to finalize launch: ${updateError.message}`);
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
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("claim-sponsored-slot error:", err);
    return errorResponse(err.message || "Unknown error", 500);
  }
});

async function generateSolanaKeypair(): Promise<{ publicKey: string; secretKey: Uint8Array }> {
  const ed25519KeyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const privateKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", (ed25519KeyPair as CryptoKeyPair).privateKey),
  );
  const publicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", (ed25519KeyPair as CryptoKeyPair).publicKey),
  );
  const privateSeed = privateKeyRaw.slice(16, 48);
  const solanaSecretKey = new Uint8Array(64);
  solanaSecretKey.set(privateSeed);
  solanaSecretKey.set(publicKeyRaw, 32);
  return { publicKey: base58Encode(publicKeyRaw), secretKey: solanaSecretKey };
}

async function encryptKey(dataHex: string, encryptionKeyHex: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const keyBytes = hexToUint8Array(encryptionKeyHex);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "AES-GCM" }, false, ["encrypt"]);
  const dataBytes = hexToUint8Array(dataHex);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, dataBytes as BufferSource),
  );
  const ciphertext = encrypted.slice(0, encrypted.length - 16);
  const authTag = encrypted.slice(encrypted.length - 16);
  return `${uint8ArrayToHex(iv)}:${uint8ArrayToHex(authTag)}:${uint8ArrayToHex(ciphertext)}`;
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1024) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 1024));
  }
  return btoa(binary);
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
  for (let i = digits.length - 1; i >= 0; i--) result += BASE58_ALPHABET[digits[i]];
  return result;
}

function errorResponse(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}