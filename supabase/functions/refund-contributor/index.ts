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

    const escrowKeyBytes = await decryptEscrowKey(
      launch.escrow_wallet_encrypted_private_key,
      ESCROW_ENCRYPTION_KEY,
    );

    if (escrowKeyBytes.length !== 64) {
      return errorResponse(
        `Invalid escrow secret key length: ${escrowKeyBytes.length} (expected 64)`,
        200,
      );
    }

    const TX_FEE = 5_000n;
    const RENT_EXEMPT_RESERVE = 890_880n;
    const requested = BigInt(contribution.amount_lamports) - TX_FEE;

    if (requested <= 0n) {
      return errorResponse(
        "Contribution too small to refund after network fee",
        400,
      );
    }

    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const escrowKeypair = Keypair.fromSecretKey(escrowKeyBytes);

    // Read live escrow balance and reserve the rent-exempt minimum + tx fee.
    const escrowBalance = BigInt(
      await connection.getBalance(escrowKeypair.publicKey, "confirmed"),
    );
    const available = escrowBalance - RENT_EXEMPT_RESERVE - TX_FEE;

    if (available <= 0n) {
      return new Response(
        JSON.stringify({
          error:
            "Escrow is depleted; nothing recoverable after reserving rent-exempt minimum",
          escrowBalance: Number(escrowBalance),
          rentExemptReserve: Number(RENT_EXEMPT_RESERVE),
          requested: Number(requested),
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const payout = requested < available ? requested : available;
    const shortfall = requested - payout;

    let txSignature: string;
    try {
      txSignature = await sendRefundWithRetry(
        connection,
        escrowKeypair,
        new PublicKey(contribution.wallet_address),
        Number(payout),
      );
    } catch (sendErr: any) {
      return errorResponse(
        sendErr?.message ?? String(sendErr),
        200,
      );
    }

    await supabase
      .from("contributions")
      .update({
        refund_tx_signature: txSignature,
        refund_shortfall_lamports: Number(shortfall),
      })
      .eq("id", contribution_id);

    return new Response(
      JSON.stringify({
        success: true,
        partial: shortfall > 0n,
        txSignature,
        refundedLamports: Number(payout),
        shortfallLamports: Number(shortfall),
        solscan: `https://solscan.io/tx/${txSignature}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("refund-contributor error:", error);
    return new Response(
      JSON.stringify({ error: error?.message ?? String(error) }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
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
  let lastSignature: string | undefined;
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
      lastSignature = signature;
    } catch (sendErr: any) {
      lastErr = sendErr;
      const msg = sendErr?.message ?? String(sendErr);
      // Deterministic failures — do not retry
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

      // Defensive check: did it actually land?
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
        // ignore status lookup failure
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
  encryptionKeyHex: string,
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
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}