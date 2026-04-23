import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "npm:@solana/web3.js@1.95.3";

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
    const { launch_id, wallet_address } = body;

    if (!launch_id || !wallet_address) {
      return errorResponse("Missing launch_id or wallet_address", 400);
    }

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

    await supabase
      .from("launches")
      .update({ status: "cancelled" })
      .eq("id", launch_id);

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

    const escrowKeyBytes = await decryptEscrowKey(
      launch.escrow_wallet_encrypted_private_key,
      ESCROW_ENCRYPTION_KEY
    );

    if (escrowKeyBytes.length !== 64) {
      return errorResponse(
        `Invalid escrow secret key length: ${escrowKeyBytes.length} (expected 64)`,
        200,
      );
    }

    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const escrowKeypair = Keypair.fromSecretKey(escrowKeyBytes);
    const TX_FEE = 5_000n;

    let refundedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const contrib of contributions) {
      try {
        if (contrib.refund_tx_signature) {
          continue;
        }
        const refundLamports = BigInt(contrib.amount_lamports) - TX_FEE;
        if (refundLamports <= 0n) {
          failedCount++;
          errors.push(`${contrib.wallet_address}: amount too small after fee`);
          continue;
        }

        const txSignature = await sendRefundWithRetry(
          connection,
          escrowKeypair,
          new PublicKey(contrib.wallet_address),
          Number(refundLamports),
        );

        await supabase
          .from("contributions")
          .update({ refund_tx_signature: txSignature })
          .eq("id", contrib.id);

        refundedCount++;
      } catch (err: any) {
        console.error(`Refund failed for ${contrib.wallet_address}:`, err?.message ?? err);
        failedCount++;
        errors.push(`${contrib.wallet_address}: ${err?.message ?? String(err)}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        refunded: refundedCount,
        failed: failedCount,
        total: contributions.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("refund-launch error:", error);
    return new Response(
      JSON.stringify({ error: error?.message ?? String(error) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function sendRefundWithRetry(
  connection: Connection,
  escrowKeypair: Keypair,
  recipient: PublicKey,
  lamports: number,
  maxAttempts = 3,
): Promise<string> {
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({
      feePayer: escrowKeypair.publicKey,
      blockhash,
      lastValidBlockHeight,
    }).add(
      SystemProgram.transfer({
        fromPubkey: escrowKeypair.publicKey,
        toPubkey: recipient,
        lamports,
      }),
    );
    tx.sign(escrowKeypair);
    const raw = tx.serialize();
    let signature: string;
    try {
      signature = await connection.sendRawTransaction(raw, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 5,
      });
    } catch (sendErr: any) {
      lastErr = sendErr;
      const msg = sendErr?.message ?? String(sendErr);
      if (
        /insufficient/i.test(msg) ||
        /invalid/i.test(msg) ||
        /unauthorized/i.test(msg) ||
        /forbidden/i.test(msg)
      ) {
        throw new Error(`Refund send failed: ${msg}`);
      }
      if (attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }
      throw new Error(`Refund send failed after ${maxAttempts} attempts: ${msg}`);
    }

    try {
      const result = await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
      );
      if (result.value.err) {
        throw new Error(
          `Refund transaction failed on-chain: ${JSON.stringify(result.value.err)}`,
        );
      }
      return signature;
    } catch (confirmErr: any) {
      lastErr = confirmErr;
      const msg = confirmErr?.message ?? String(confirmErr);
      const expired =
        /block height exceeded/i.test(msg) ||
        /TransactionExpired/i.test(msg) ||
        confirmErr?.name === "TransactionExpiredBlockheightExceededError";

      try {
        const status = await connection.getSignatureStatus(signature, {
          searchTransactionHistory: true,
        });
        const conf = status?.value?.confirmationStatus;
        if (
          status?.value &&
          !status.value.err &&
          (conf === "confirmed" || conf === "finalized")
        ) {
          return signature;
        }
      } catch (_) {
        // ignore
      }

      if (expired && attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }
      if (expired) {
        throw new Error(
          `Refund failed after ${maxAttempts} attempts due to blockhash expiry`,
        );
      }
      throw new Error(`Refund confirmation failed: ${msg}`);
    }
  }
  throw lastErr ?? new Error("Refund failed: unknown error");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function decryptEscrowKey(
  encryptedData: string,
  encryptionKeyHex: string
): Promise<Uint8Array> {
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

  return new Uint8Array(decrypted);
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function errorResponse(msg: string, status: number) {
  return new Response(
    JSON.stringify({ error: msg }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
