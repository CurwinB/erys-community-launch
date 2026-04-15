import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "https://esm.sh/@solana/spl-token@0.3.8";
import {
  Connection,
  PublicKey,
  Transaction,
  Keypair,
} from "https://esm.sh/@solana/web3.js@1.91.1";

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
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const SOLANA_RPC_URL = Deno.env.get("SOLANA_RPC_URL")!;
  const ESCROW_ENCRYPTION_KEY = Deno.env.get("ESCROW_ENCRYPTION_KEY")!;

  try {
    // Parse input — accept { launch_id } or empty body (auto-find)
    let launchId: string | null = null;
    try {
      const body = await req.json();
      launchId = body.launch_id || null;
    } catch {
      // empty body is fine
    }

    let launch: any;

    if (launchId) {
      const { data, error } = await supabase
        .from("launches")
        .select("*")
        .eq("id", launchId)
        .single();
      if (error) throw error;
      launch = data;
    } else {
      // Auto-find oldest incomplete distribution within last 24 hours
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("launches")
        .select("*")
        .eq("status", "launched")
        .eq("distribution_completed", false)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(1);
      if (error) throw error;
      if (!data || data.length === 0) {
        return jsonResponse({ message: "No pending distributions" });
      }
      launch = data[0];
    }

    if (launch.status !== "launched") {
      return jsonResponse({ message: "Launch not in launched status" });
    }

    if (!launch.token_mint_address) {
      return errorResponse("Launch has no token mint address");
    }

    // Step 1: Query pending contributions
    const { data: contributions, error: contribErr } = await supabase
      .from("contributions")
      .select("*")
      .eq("launch_id", launch.id)
      .eq("tokens_distributed", false)
      .not("token_amount", "is", null)
      .order("amount_lamports", { ascending: false });

    if (contribErr) throw contribErr;

    if (!contributions || contributions.length === 0) {
      // Nothing to distribute — mark complete
      await supabase
        .from("launches")
        .update({
          distribution_completed: true,
          distribution_completed_at: new Date().toISOString(),
        })
        .eq("id", launch.id);
      return jsonResponse({ message: "No pending distributions" });
    }

    // Step 2: Decrypt escrow key and reconstruct keypair
    const decryptedHex = await decryptEscrowKey(
      launch.escrow_wallet_encrypted_private_key,
      ESCROW_ENCRYPTION_KEY
    );
    const escrowKeyBytes = hexToUint8Array(decryptedHex);
    const escrowKeypair = Keypair.fromSecretKey(escrowKeyBytes);

    // Step 3: Read token balance (retry 5x, 3s gaps)
    const mintPubkey = new PublicKey(launch.token_mint_address);
    let tokenBalance = 0n;

    for (let attempt = 1; attempt <= 5; attempt++) {
      const rpcRes = await fetch(SOLANA_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTokenAccountsByOwner",
          params: [
            escrowKeypair.publicKey.toBase58(),
            { mint: launch.token_mint_address },
            { encoding: "jsonParsed" },
          ],
        }),
      });

      const data = await rpcRes.json();
      const amount =
        data.result?.value?.[0]?.account?.data?.parsed?.info?.tokenAmount
          ?.amount;

      if (amount && BigInt(amount) > 0n) {
        tokenBalance = BigInt(amount);
        break;
      }

      if (attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }

    if (tokenBalance === 0n) {
      console.error(
        "Could not read token balance from escrow wallet after 5 attempts"
      );
      return errorResponse("Escrow wallet has zero token balance");
    }

    // Step 4: Verify token amounts match, redistribute if mismatch
    const storedTotal = contributions.reduce(
      (sum: bigint, c: any) => sum + BigInt(c.token_amount),
      0n
    );

    let tokenAmounts: bigint[];
    const tolerance = BigInt(contributions.length); // allow 1 lamport per contributor rounding

    if (
      storedTotal > tokenBalance + tolerance ||
      storedTotal < tokenBalance - tolerance
    ) {
      // Redistribute proportionally from actual balance
      console.log(
        `Token amount mismatch: stored=${storedTotal}, actual=${tokenBalance}. Redistributing.`
      );
      const totalContrib = contributions.reduce(
        (sum: bigint, c: any) => sum + BigInt(c.amount_lamports),
        0n
      );
      tokenAmounts = contributions.map((c: any) =>
        (BigInt(c.amount_lamports) * tokenBalance) / totalContrib
      );
      // Assign remainder to first contributor
      const distributed = tokenAmounts.reduce((a, b) => a + b, 0n);
      tokenAmounts[0] += tokenBalance - distributed;

      // Update stored amounts
      for (let i = 0; i < contributions.length; i++) {
        await supabase
          .from("contributions")
          .update({ token_amount: Number(tokenAmounts[i]) })
          .eq("id", contributions[i].id);
      }
    } else {
      tokenAmounts = contributions.map((c: any) => BigInt(c.token_amount));
      // Fix any small rounding difference
      const diff = tokenBalance - storedTotal;
      if (diff !== 0n) {
        tokenAmounts[0] += diff;
        await supabase
          .from("contributions")
          .update({ token_amount: Number(tokenAmounts[0]) })
          .eq("id", contributions[0].id);
      }
    }

    // Step 5: Derive escrow's ATA
    const escrowAta = await getAssociatedTokenAddress(
      mintPubkey,
      escrowKeypair.publicKey
    );

    // Step 6: Distribute tokens
    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    let allSucceeded = true;
    let totalDistributed = 0n;

    for (let i = 0; i < contributions.length; i++) {
      const contribution = contributions[i];
      const tokenAmount = tokenAmounts[i];

      if (tokenAmount === 0n) {
        await supabase
          .from("contributions")
          .update({ tokens_distributed: true, token_amount: 0 })
          .eq("id", contribution.id);
        continue;
      }

      try {
        const contributorPubkey = new PublicKey(contribution.wallet_address);

        // Derive contributor's ATA
        const ata = await getAssociatedTokenAddress(
          mintPubkey,
          contributorPubkey
        );

        // Check if ATA exists
        const ataInfo = await connection.getAccountInfo(ata);

        // Build transaction
        const tx = new Transaction();

        if (!ataInfo) {
          tx.add(
            createAssociatedTokenAccountInstruction(
              escrowKeypair.publicKey, // payer
              ata, // associated token account
              contributorPubkey, // owner
              mintPubkey // mint
            )
          );
        }

        tx.add(
          createTransferInstruction(
            escrowAta, // source
            ata, // destination
            escrowKeypair.publicKey, // authority
            Number(tokenAmount)
          )
        );

        tx.feePayer = escrowKeypair.publicKey;
        tx.recentBlockhash = (
          await connection.getLatestBlockhash()
        ).blockhash;

        // Sign
        tx.sign(escrowKeypair);

        // Send via RPC
        const serialized = tx.serialize();
        const txBase64 = btoa(
          String.fromCharCode(...new Uint8Array(serialized))
        );

        const sendRes = await fetch(SOLANA_RPC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "sendTransaction",
            params: [
              txBase64,
              { encoding: "base64", preflightCommitment: "confirmed" },
            ],
          }),
        });

        const sendData = await sendRes.json();
        if (sendData.error) {
          throw new Error(sendData.error.message);
        }

        const txSignature = sendData.result;
        totalDistributed += tokenAmount;

        await supabase
          .from("contributions")
          .update({
            tokens_distributed: true,
            distribution_tx_signature: txSignature,
          })
          .eq("id", contribution.id);

        console.log(
          `Distributed ${tokenAmount} tokens to ${contribution.wallet_address}: ${txSignature}`
        );
      } catch (err: any) {
        console.error(
          `Distribution failed for ${contribution.wallet_address}:`,
          err.message
        );
        allSucceeded = false;

        await supabase
          .from("contributions")
          .update({
            tokens_distributed: false,
            distribution_error: err.message,
          })
          .eq("id", contribution.id);
      }
    }

    // Step 7: Mark distribution completed only if all succeeded
    if (allSucceeded) {
      await supabase
        .from("launches")
        .update({
          distribution_completed: true,
          distribution_completed_at: new Date().toISOString(),
          total_tokens_distributed: Number(totalDistributed),
        })
        .eq("id", launch.id);
    }

    return jsonResponse({
      success: true,
      launchId: launch.id,
      distributed: contributions.length,
      allSucceeded,
      totalDistributed: totalDistributed.toString(),
    });
  } catch (error: any) {
    console.error("distribute-tokens error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// =========================================
// Utility Functions
// =========================================

function jsonResponse(data: any) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(msg: string) {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function decryptEscrowKey(
  encryptedData: string,
  encryptionKeyHex: string
): Promise<string> {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new Error(
      "Invalid encrypted data format. Expected iv:authTag:ciphertext"
    );
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
    ["decrypt"]
  );

  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    combined
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
