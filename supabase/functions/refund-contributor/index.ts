import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

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
  const SOLANA_RPC_URL = Deno.env.get("SOLANA_RPC_URL");

  try {
    if (!SOLANA_RPC_URL) {
      return errorResponse("SOLANA_RPC_URL secret is not configured", 200);
    }
    if (SOLANA_RPC_URL.includes("api.mainnet-beta.solana.com")) {
      return errorResponse(
        "SOLANA_RPC_URL is set to the public mainnet endpoint, which is rate-limited and unreliable. Configure a Helius/QuickNode endpoint.",
        200,
      );
    }

    const body = await req.json();
    const { contribution_id, launch_id } = body;

    if (!contribution_id || !launch_id) {
      return errorResponse("Missing contribution_id or launch_id", 400);
    }

    const { data: contribution, error: contribErr } = await supabase
      .from("contributions")
      .select("*")
      .eq("id", contribution_id)
      .eq("launch_id", launch_id)
      .single();

    if (contribErr || !contribution) {
      return errorResponse("Contribution not found", 404);
    }

    if (contribution.refund_tx_signature) {
      return new Response(
        JSON.stringify({
          error: "Contribution already refunded",
          tx: contribution.refund_tx_signature,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: launch, error: launchErr } = await supabase
      .from("launches")
      .select("escrow_wallet_encrypted_private_key, escrow_wallet_public_key")
      .eq("id", launch_id)
      .single();

    if (launchErr || !launch) {
      return errorResponse("Launch not found", 404);
    }

    const escrowPrivateKey = await decryptEscrowKey(
      launch.escrow_wallet_encrypted_private_key,
      ESCROW_ENCRYPTION_KEY,
    );
    const escrowKeyBytes = hexToUint8Array(escrowPrivateKey);

    const TX_FEE = 5_000n;
    const refundLamports = BigInt(contribution.amount_lamports) - TX_FEE;

    if (refundLamports <= 0n) {
      return errorResponse(
        "Contribution too small to refund after network fee",
        400,
      );
    }

    const { blockhash } = await getLatestBlockhash(SOLANA_RPC_URL);

    const txSignature = await buildAndSendTransfer(
      SOLANA_RPC_URL,
      escrowKeyBytes,
      launch.escrow_wallet_public_key,
      contribution.wallet_address,
      refundLamports,
      blockhash,
    );

    // Poll for confirmation (~30s max)
    await waitForConfirmation(SOLANA_RPC_URL, txSignature, 30);

    await supabase
      .from("contributions")
      .update({ refund_tx_signature: txSignature })
      .eq("id", contribution_id);

    return new Response(
      JSON.stringify({
        success: true,
        txSignature,
        refundedLamports: Number(refundLamports),
        solscan: `https://solscan.io/tx/${txSignature}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("refund-contributor error:", error);
    return new Response(JSON.stringify({ error: error?.message ?? String(error) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function rpcCall(
  rpcUrl: string,
  method: string,
  params: any[],
): Promise<any> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `RPC ${method} HTTP ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `RPC ${method} returned non-JSON: ${text.slice(0, 200)}`,
    );
  }
  if (parsed.error) {
    throw new Error(`RPC ${method} error: ${JSON.stringify(parsed.error)}`);
  }
  return parsed.result;
}

async function getLatestBlockhash(
  rpcUrl: string,
): Promise<{ blockhash: string }> {
  const result = await rpcCall(rpcUrl, "getLatestBlockhash", [
    { commitment: "confirmed" },
  ]);
  return { blockhash: result.value.blockhash };
}

async function waitForConfirmation(
  rpcUrl: string,
  signature: string,
  maxSeconds: number,
): Promise<void> {
  const start = Date.now();
  while ((Date.now() - start) / 1000 < maxSeconds) {
    let result: any;
    try {
      result = await rpcCall(rpcUrl, "getSignatureStatuses", [
        [signature],
        { searchTransactionHistory: true },
      ]);
    } catch (e) {
      console.warn(`getSignatureStatuses transient error: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    const status = result?.value?.[0];
    if (status) {
      if (status.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      }
      if (
        status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized"
      ) {
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  // Don't throw — tx is submitted, just not yet confirmed in our window
  console.warn(`Confirmation timeout for ${signature}, but tx is submitted`);
}

async function buildAndSendTransfer(
  rpcUrl: string,
  escrowKeyBytes: Uint8Array,
  fromPubkey: string,
  toPubkey: string,
  lamports: bigint,
  blockhash: string,
): Promise<string> {
  const privateSeed = escrowKeyBytes.slice(0, 32);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    privateSeed,
    "Ed25519",
    false,
    ["sign"],
  );

  const fromBytes = base58DecodeProper(fromPubkey);
  const toBytes = base58DecodeProper(toPubkey);
  const systemProgram = new Uint8Array(32);

  const instrData = new Uint8Array(12);
  const instrView = new DataView(instrData.buffer);
  instrView.setUint32(0, 2, true);
  instrView.setBigUint64(4, lamports, true);

  const header = new Uint8Array([1, 0, 1]);

  const accountKeys = new Uint8Array(96);
  accountKeys.set(fromBytes, 0);
  accountKeys.set(toBytes, 32);
  accountKeys.set(systemProgram, 64);

  const blockhashBytes = base58DecodeProper(blockhash);

  const instruction = new Uint8Array([
    2,
    2,
    0,
    1,
    instrData.length,
    ...instrData,
  ]);

  const numAccountKeys = new Uint8Array([3]);
  const numInstructions = new Uint8Array([1]);

  const message = concatBytes([
    header,
    numAccountKeys,
    accountKeys,
    blockhashBytes,
    numInstructions,
    instruction,
  ]);

  const signature = new Uint8Array(
    await crypto.subtle.sign("Ed25519", cryptoKey, message),
  );

  const tx = concatBytes([new Uint8Array([1]), signature, message]);

  const txBase64 = btoa(String.fromCharCode(...tx));
  const result = await rpcCall(rpcUrl, "sendTransaction", [
    txBase64,
    { encoding: "base64", preflightCommitment: "confirmed" },
  ]);
  return result;
}

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

async function decryptEscrowKey(
  encryptedData: string,
  encryptionKeyHex: string,
): Promise<string> {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = hexToUint8Array(ivHex);
  const authTag = hexToUint8Array(authTagHex);
  const ciphertext = hexToUint8Array(ciphertextHex);
  const keyBytes = hexToUint8Array(encryptionKeyHex);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    combined,
  );

  return new TextDecoder().decode(decrypted);
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58DecodeProper(str: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of str) {
    const value = BASE58_ALPHABET.indexOf(char);
    if (value < 0) throw new Error(`Invalid base58 char: ${char}`);
    let carry = value;
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
  let leadingZeros = 0;
  for (const char of str) {
    if (char === "1") leadingZeros++;
    else break;
  }
  const result = new Uint8Array(leadingZeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[leadingZeros + bytes.length - 1 - i] = bytes[i];
  }
  return result;
}

function errorResponse(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}