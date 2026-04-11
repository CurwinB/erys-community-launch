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
  const SOLANA_RPC_URL = Deno.env.get("SOLANA_RPC_URL")!;

  try {
    const body = await req.json();
    const { launch_id, wallet_address } = body;

    if (!launch_id || !wallet_address) {
      return errorResponse("Missing launch_id or wallet_address", 400);
    }

    // Verify launch exists and is scheduled
    const { data: launch, error: launchErr } = await supabase
      .from("launches")
      .select("*")
      .eq("id", launch_id)
      .single();

    if (launchErr || !launch) {
      return errorResponse("Launch not found", 404);
    }

    if (launch.created_by_wallet !== wallet_address) {
      return errorResponse("Only the creator can cancel a launch", 403);
    }

    if (launch.status !== "scheduled") {
      return errorResponse(`Cannot cancel launch with status '${launch.status}'`, 400);
    }

    // Set status to cancelled
    await supabase
      .from("launches")
      .update({ status: "cancelled" })
      .eq("id", launch_id);

    // Get all contributions
    const { data: contributions, error: contribErr } = await supabase
      .from("contributions")
      .select("*")
      .eq("launch_id", launch_id);

    if (contribErr) throw contribErr;

    if (!contributions || contributions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "Launch cancelled. No contributions to refund." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Decrypt escrow wallet
    const escrowPrivateKey = await decryptEscrowKey(
      launch.escrow_wallet_encrypted_private_key,
      ESCROW_ENCRYPTION_KEY
    );

    const escrowKeyBytes = hexToUint8Array(escrowPrivateKey);

    let refundedCount = 0;
    let failedCount = 0;

    // Refund each contributor
    for (const contrib of contributions) {
      try {
        // Build SOL transfer from escrow to contributor
        const { blockhash } = await getLatestBlockhash(SOLANA_RPC_URL);

        const txSignature = await buildAndSendTransfer(
          SOLANA_RPC_URL,
          escrowKeyBytes,
          launch.escrow_wallet_public_key,
          contrib.wallet_address,
          BigInt(contrib.amount_lamports),
          blockhash
        );

        // Record refund tx
        await supabase
          .from("contributions")
          .update({ refund_tx_signature: txSignature })
          .eq("id", contrib.id);

        refundedCount++;
      } catch (err: any) {
        console.error(`Refund failed for ${contrib.wallet_address}:`, err.message);
        failedCount++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        refunded: refundedCount,
        failed: failedCount,
        total: contributions.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("refund-launch error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function getLatestBlockhash(rpcUrl: string): Promise<{ blockhash: string }> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getLatestBlockhash",
      params: [{ commitment: "confirmed" }],
    }),
  });
  const data = await res.json();
  return { blockhash: data.result.value.blockhash };
}

async function buildAndSendTransfer(
  rpcUrl: string,
  escrowKeyBytes: Uint8Array,
  fromPubkey: string,
  toPubkey: string,
  lamports: bigint,
  blockhash: string
): Promise<string> {
  // Import ed25519 signing via Web Crypto
  const privateSeed = escrowKeyBytes.slice(0, 32);
  const publicKeyBytes = escrowKeyBytes.slice(32, 64);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    privateSeed,
    "Ed25519",
    false,
    ["sign"]
  );

  // Build a minimal SOL transfer transaction (system program transfer)
  // Transaction format: signatures_count + signatures + message
  // Message: header + account_keys + recent_blockhash + instructions

  const fromBytes = base58Decode(fromPubkey);
  const toBytes = base58Decode(toPubkey);
  const systemProgram = new Uint8Array(32); // all zeros

  // Instruction data: transfer = u32(2) + u64(lamports)
  const instrData = new Uint8Array(12);
  const instrView = new DataView(instrData.buffer);
  instrView.setUint32(0, 2, true); // SystemInstruction::Transfer
  instrView.setBigUint64(4, lamports, true);

  // Message header
  const header = new Uint8Array([1, 0, 1]); // 1 signer, 0 readonly signed, 1 readonly unsigned

  // Account keys: from, to, system program
  const accountKeys = new Uint8Array(96);
  accountKeys.set(fromBytes, 0);
  accountKeys.set(toBytes, 32);
  accountKeys.set(systemProgram, 64);

  // Recent blockhash
  const blockhashBytes = base58Decode(blockhash);

  // Instruction: program_id_index=2, accounts=[0,1], data=instrData
  const instruction = new Uint8Array([
    2, // program ID index
    2, // num accounts
    0, 1, // account indices
    instrData.length, // data length
    ...instrData,
  ]);

  // Compile message
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

  // Sign
  const signature = new Uint8Array(
    await crypto.subtle.sign("Ed25519", cryptoKey, message)
  );

  // Full transaction: num_signatures(1) + signature(64) + message
  const tx = concatBytes([
    new Uint8Array([1]), // 1 signature
    signature,
    message,
  ]);

  // Send via RPC
  const txBase64 = btoa(String.fromCharCode(...tx));
  const sendRes = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: [txBase64, { encoding: "base64", preflightCommitment: "confirmed" }],
    }),
  });

  const sendData = await sendRes.json();
  if (sendData.error) {
    throw new Error(`sendTransaction failed: ${JSON.stringify(sendData.error)}`);
  }

  return sendData.result;
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
  encryptionKeyHex: string
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
    "raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]
  );

  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv }, cryptoKey, combined
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

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(str: string): Uint8Array {
  const bytes: number[] = [0];
  for (const char of str) {
    const value = BASE58_ALPHABET.indexOf(char);
    if (value < 0) throw new Error(`Invalid base58 character: ${char}`);
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] = bytes[j] * 58 + (j === 0 ? value : 0);
    }
    // Proper base58 decode
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
  // Re-implement properly
  return base58DecodeProper(str);
}

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
  // Count leading '1's
  let leadingZeros = 0;
  for (const char of str) {
    if (char === '1') leadingZeros++;
    else break;
  }
  const result = new Uint8Array(leadingZeros + bytes.length);
  // Leading zeros are already 0 in Uint8Array
  for (let i = 0; i < bytes.length; i++) {
    result[leadingZeros + bytes.length - 1 - i] = bytes[i];
  }
  return result;
}

function errorResponse(msg: string, status: number) {
  return new Response(
    JSON.stringify({ error: msg }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
