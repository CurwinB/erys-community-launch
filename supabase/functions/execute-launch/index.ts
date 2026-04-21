import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { Keypair, Transaction, VersionedTransaction } from "https://esm.sh/@solana/web3.js@1.91.1";
import bs58 from "https://esm.sh/bs58@5.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BAGS_API_BASE = "https://public-api-v2.bags.fm/api/v1";
const TX_FEE_PER_TRANSFER = 5_000n; // 0.000005 SOL per SPL token transfer
const ATA_COST_PER_CONTRIBUTOR = 2_039_280n; // 0.00203928 SOL per ATA creation

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const BAGS_API_KEY = Deno.env.get("BAGS_API_KEY")!;
  const BAGS_PARTNER_WALLET = Deno.env.get("BAGS_PARTNER_WALLET")!;
  const BAGS_PARTNER_CONFIG = Deno.env.get("BAGS_PARTNER_CONFIG")!;
  const ESCROW_ENCRYPTION_KEY = Deno.env.get("ESCROW_ENCRYPTION_KEY")!;
  

  try {
    // Find launches ready to execute
    const { data: launches, error: fetchErr } = await supabase
      .from("launches")
      .select("*")
      .or("status.eq.scheduled,status.eq.execution_failed")
      .lte("launch_datetime", new Date().toISOString())
      .lt("execution_attempts", 3)
      .order("launch_datetime", { ascending: true })
      .limit(1);

    if (fetchErr) throw fetchErr;
    if (!launches || launches.length === 0) {
      return new Response(JSON.stringify({ message: "No launches to execute" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const launch = launches[0];

    // Platform routing — Pump.fun has its own execution flow
    if (launch.platform === "pumpfun") {
      return await executePumpfunLaunch(launch, supabase, ESCROW_ENCRYPTION_KEY);
    }

    // Set status to executing
    await supabase
      .from("launches")
      .update({ status: "executing", execution_attempts: launch.execution_attempts + 1 })
      .eq("id", launch.id);

    // Get all contributions sorted by amount descending
    const { data: contributions, error: contribErr } = await supabase
      .from("contributions")
      .select("*")
      .eq("launch_id", launch.id)
      .order("amount_lamports", { ascending: false });

    if (contribErr) throw contribErr;
    if (!contributions || contributions.length === 0) {
      await setFailed(supabase, launch.id, "No contributions found for launch");
      return errorResponse("No contributions found");
    }

    // Handle >100 contributors: take top 100, mark rest as excluded
    let activeClaims = contributions;
    let excludedCount = 0;

    if (contributions.length > 100) {
      activeClaims = contributions.slice(0, 100);
      const excludedIds = contributions.slice(100).map((c: any) => c.id);
      excludedCount = excludedIds.length;

      for (const id of excludedIds) {
        await supabase
          .from("contributions")
          .update({ is_fee_claimer: false })
          .eq("id", id);
      }
    }

    // Calculate basis points with creator minimum guarantee
    const totalLamports = activeClaims.reduce(
      (sum: bigint, c: any) => sum + BigInt(c.amount_lamports),
      0n
    );

    // Identify creator
    const creatorWallet = launch.created_by_wallet;
    const creatorIndex = activeClaims.findIndex((c: any) => c.wallet_address === creatorWallet);

    let basisPoints = activeClaims.map((c: any) =>
      Math.floor((Number(BigInt(c.amount_lamports)) / Number(totalLamports)) * 10000)
    );

    // Remove contributors with 0 basis points
    let filtered = activeClaims
      .map((c: any, i: number) => ({ contribution: c, bp: basisPoints[i] }))
      .filter((entry) => entry.bp > 0);

    if (filtered.length === 0) {
      await setFailed(supabase, launch.id, "All contributors rounded to 0 basis points");
      return errorResponse("All contributors rounded to 0 basis points");
    }

    // Recalculate after filtering
    const filteredTotal = filtered.reduce(
      (sum: bigint, entry) => sum + BigInt(entry.contribution.amount_lamports),
      0n
    );

    basisPoints = filtered.map((entry) =>
      Math.floor(
        (Number(BigInt(entry.contribution.amount_lamports)) / Number(filteredTotal)) * 10000
      )
    );

    // Apply creator minimum: 750 BP (10% of 7500 community pool)
    const CREATOR_MIN_BP = 750;
    const filteredCreatorIdx = filtered.findIndex(
      (f) => f.contribution.wallet_address === creatorWallet
    );

    if (filteredCreatorIdx >= 0 && basisPoints[filteredCreatorIdx] < CREATOR_MIN_BP) {
      const deficit = CREATOR_MIN_BP - basisPoints[filteredCreatorIdx];
      basisPoints[filteredCreatorIdx] = CREATOR_MIN_BP;

      // Redistribute deficit proportionally among non-creator contributors
      const nonCreatorTotal = basisPoints.reduce(
        (sum, bp, i) => (i !== filteredCreatorIdx ? sum + bp : sum),
        0
      );
      if (nonCreatorTotal > 0) {
        let redistributed = 0;
        for (let i = 0; i < basisPoints.length; i++) {
          if (i === filteredCreatorIdx) continue;
          const reduction = Math.floor((basisPoints[i] / nonCreatorTotal) * deficit);
          basisPoints[i] -= reduction;
          redistributed += reduction;
        }
        // Handle any remaining deficit from rounding
        const remaining = deficit - redistributed;
        for (let i = 0; i < basisPoints.length && remaining > 0; i++) {
          if (i === filteredCreatorIdx) continue;
          if (basisPoints[i] > 1) {
            basisPoints[i] -= 1;
            break;
          }
        }
      }
    }

    // Handle rounding remainder — add to largest contributor
    const currentSum = basisPoints.reduce((a, b) => a + b, 0);
    const remainder = 10000 - currentSum;
    basisPoints[0] += remainder;

    // Verify sum
    const finalSum = basisPoints.reduce((a, b) => a + b, 0);
    if (finalSum !== 10000) {
      await setFailed(supabase, launch.id, `Basis points sum ${finalSum} !== 10000`);
      return errorResponse("Basis points calculation failed");
    }

    // Update each contribution with basis_points
    for (let i = 0; i < filtered.length; i++) {
      await supabase
        .from("contributions")
        .update({ basis_points: basisPoints[i], is_fee_claimer: true })
        .eq("id", filtered[i].contribution.id);
    }

    // Pre-calculate proportional token amounts for Railway distributor
    const totalLamportsForTokenCalc = filtered.reduce(
      (sum: bigint, f) => sum + BigInt(f.contribution.amount_lamports),
      0n
    );

    for (let i = 0; i < filtered.length; i++) {
      const proportionalBps = Math.floor(
        (Number(BigInt(filtered[i].contribution.amount_lamports)) / Number(totalLamportsForTokenCalc)) * 10000
      );
      await supabase
        .from("contributions")
        .update({ token_amount: proportionalBps })
        .eq("id", filtered[i].contribution.id);
    }

    // Mark any filtered-out (0 BP) contributors from activeClaims
    const filteredIds = new Set(filtered.map((f) => f.contribution.id));
    for (const c of activeClaims) {
      if (!filteredIds.has(c.id)) {
        await supabase
          .from("contributions")
          .update({ is_fee_claimer: false, basis_points: 0 })
          .eq("id", c.id);
        excludedCount++;
      }
    }

    const claimersArray = filtered.map((f) => f.contribution.wallet_address);
    const basisPointsArray = basisPoints;

    // Decrypt escrow wallet private key
    const escrowPrivateKey = await decryptEscrowKey(
      launch.escrow_wallet_encrypted_private_key,
      ESCROW_ENCRYPTION_KEY
    );

    // Reserve enough SOL for:
    // - ATA creation + tx fee per contributor
    // - Lookup table rent when >15 claimers
    // - Base tx fees (fee-share config + launch)
    const ATA_COST_PER_CONTRIBUTOR = 2_039_280n;
    const TX_FEE_PER_CONTRIBUTOR = 5_000n;
    const BASE_TX_FEES = 20_000n; // fee-share config tx + launch tx
    const LOOKUP_TABLE_RENT = 2_550_000n; // rent for lookup table when >15 claimers

    const allContribTotal = contributions.reduce(
      (sum: bigint, c: any) => sum + BigInt(c.amount_lamports),
      0n
    );
    const contributorCount = BigInt(contributions.length);
    const ataReserve = contributorCount * (ATA_COST_PER_CONTRIBUTOR + TX_FEE_PER_CONTRIBUTOR);
    const needsLookupTable = contributorCount > 15n;
    const lookupTableReserve = needsLookupTable ? LOOKUP_TABLE_RENT : 0n;
    const netBuyLamports = allContribTotal - ataReserve - lookupTableReserve - BASE_TX_FEES;

    if (netBuyLamports < 10_000_000n) {
      await setFailed(
        supabase,
        launch.id,
        `Insufficient SOL after gas reserve. Total: ${allContribTotal}, ATA reserve: ${ataReserve}, Lookup table: ${lookupTableReserve}, Net: ${netBuyLamports}`
      );
      return errorResponse("Not enough SOL to cover gas costs and initial buy");
    }
    console.log(`Gas reserve: ATA ${ataReserve}, LUT ${lookupTableReserve}, Base fees ${BASE_TX_FEES}. Net buy: ${netBuyLamports}`);

    // STEP 1: fee-share/config — MUST be first
    const feeShareRes = await fetch(`${BAGS_API_BASE}/fee-share/config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": BAGS_API_KEY,
      },
      body: JSON.stringify({
        payer: launch.escrow_wallet_public_key,
        baseMint: launch.token_mint_address,
        claimersArray,
        basisPointsArray,
        partner: BAGS_PARTNER_WALLET,
        partnerConfig: BAGS_PARTNER_CONFIG,
      }),
    });

    if (!feeShareRes.ok) {
      const errText = await feeShareRes.text();
      await setFailed(supabase, launch.id, `fee-share/config failed: ${errText}`);
      return errorResponse(`fee-share/config failed: ${errText}`);
    }

    const feeShareData = await feeShareRes.json();
    const configKey = feeShareData.response?.meteoraConfigKey;

    if (!configKey) {
      await setFailed(supabase, launch.id, "fee-share/config returned no configKey");
      return errorResponse("No configKey returned");
    }

    // Submit all fee-share transactions returned by Bags before launch tx.
    // With >15 claimers, Bags returns multiple txs (lookup tables, etc.)
    const feeShareTransactions = feeShareData.response?.transactions || [];
    console.log(`fee-share/config returned ${feeShareTransactions.length} transactions`);

    // Reconstruct escrow keypair once for signing all txs (escrowPrivateKey is hex of 64-byte secret)
    const escrowKeypair = Keypair.fromSecretKey(hexToUint8Array(escrowPrivateKey));

    for (let i = 0; i < feeShareTransactions.length; i++) {
      const txObj = feeShareTransactions[i];
      const signedTxBase58 = signWithKeypair(txObj.transaction, escrowKeypair);
      const sendRes = await fetch(`${BAGS_API_BASE}/solana/send-transaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": BAGS_API_KEY },
        body: JSON.stringify({ transaction: signedTxBase58 }),
      });
      if (!sendRes.ok) {
        const errText = await sendRes.text();
        await setFailed(supabase, launch.id, `fee-share tx ${i + 1}/${feeShareTransactions.length} failed: ${errText}`);
        return errorResponse(`fee-share transaction failed: ${errText}`);
      }
      const sendData = await sendRes.json();
      const feeShareSig = sendData.response ?? sendData.signature;
      console.log(`fee-share tx ${i + 1}/${feeShareTransactions.length} confirmed: ${feeShareSig}`);
      await new Promise((r) => setTimeout(r, 500));
    }

    // Store configKey
    await supabase
      .from("launches")
      .update({
        fee_share_config_key: configKey,
        claimer_count: claimersArray.length,
        excluded_contributors: excludedCount,
      })
      .eq("id", launch.id);

    // STEP 2: create-launch-transaction (using netBuyLamports, not allContribTotal)
    if (!launch.ipfs_metadata_url || !launch.token_mint_address) {
      await setFailed(supabase, launch.id, "Missing ipfs_metadata_url or token_mint_address — cannot build launch transaction");
      return errorResponse("Launch is missing IPFS URI or token mint");
    }

    const createTxRes = await fetch(`${BAGS_API_BASE}/token-launch/create-launch-transaction`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": BAGS_API_KEY,
      },
      body: JSON.stringify({
        ipfs: launch.ipfs_metadata_url,
        tokenMint: launch.token_mint_address,
        wallet: launch.escrow_wallet_public_key,
        initialBuyLamports: Number(netBuyLamports),
        configKey,
      }),
    });

    if (!createTxRes.ok) {
      const errText = await createTxRes.text();
      await setFailed(supabase, launch.id, `create-launch-transaction failed: ${errText}`);
      return errorResponse(`create-launch-transaction failed: ${errText}`);
    }

    const createTxData = await createTxRes.json();
    const transaction = createTxData.response;

    if (!transaction || typeof transaction !== "string") {
      await setFailed(supabase, launch.id, "create-launch-transaction returned no transaction string");
      return errorResponse("create-launch-transaction returned no transaction");
    }

    // STEP 3: send-transaction
    const signedLaunchTx = signWithKeypair(transaction, escrowKeypair);
    const sendTxRes = await fetch(`${BAGS_API_BASE}/solana/send-transaction`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": BAGS_API_KEY,
      },
      body: JSON.stringify({ transaction: signedLaunchTx }),
    });

    if (!sendTxRes.ok) {
      const errText = await sendTxRes.text();
      await setFailed(supabase, launch.id, `send-transaction failed: ${errText}`);
      return errorResponse(`send-transaction failed: ${errText}`);
    }

    const sendTxData = await sendTxRes.json();

    await supabase
      .from("launches")
      .update({ status: "launched" })
      .eq("id", launch.id);


    return new Response(
      JSON.stringify({
        success: true,
        launchId: launch.id,
        txSignature: sendTxData.response ?? sendTxData.signature ?? sendTxData.txSignature,
        configKey,
        claimerCount: claimersArray.length,
        excludedContributors: excludedCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("execute-launch error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});



// =========================================
// Utility Functions
// =========================================

async function setFailed(supabase: any, launchId: string, errorMsg: string) {
  await supabase
    .from("launches")
    .update({ status: "execution_failed", execution_error: errorMsg })
    .eq("id", launchId);
}

function errorResponse(msg: string) {
  return new Response(
    JSON.stringify({ error: msg }),
    {
      status: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Content-Type": "application/json",
      },
    }
  );
}

async function decryptEscrowKey(
  encryptedData: string,
  encryptionKeyHex: string
): Promise<string> {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format. Expected iv:authTag:ciphertext");
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

// Safely encode large Uint8Arrays as base64 without spreading the whole array
// onto the JS call stack (which can blow up for big transactions).
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 1024;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

// Sign a base58-encoded transaction (versioned or legacy) with the given keypair
// and return the base58-encoded signed transaction.
function signWithKeypair(txBase58: string, keypair: Keypair): string {
  const txBytes = bs58.decode(txBase58);
  try {
    const tx = VersionedTransaction.deserialize(txBytes);
    tx.sign([keypair]);
    return bs58.encode(tx.serialize());
  } catch {
    const tx = Transaction.from(txBytes);
    tx.partialSign(keypair);
    return bs58.encode(tx.serialize());
  }
}

// =========================================
// Pump.fun Execution
// =========================================

async function executePumpfunLaunch(
  launch: any,
  supabase: any,
  ESCROW_ENCRYPTION_KEY: string
) {
  const SOLANA_RPC_URL = Deno.env.get("SOLANA_RPC_URL")!;

  try {
    // Mark as executing
    await supabase
      .from("launches")
      .update({ status: "executing", execution_attempts: launch.execution_attempts + 1 })
      .eq("id", launch.id);

    // Decrypt both keypairs (returns hex of 64-byte secret keys)
    const escrowSecretHex = await decryptEscrowKey(
      launch.escrow_wallet_encrypted_private_key,
      ESCROW_ENCRYPTION_KEY
    );
    const mintSecretHex = await decryptEscrowKey(
      launch.pumpfun_mint_keypair_encrypted,
      ESCROW_ENCRYPTION_KEY
    );
    const escrowSecret = hexToUint8Array(escrowSecretHex);
    const mintSecret = hexToUint8Array(mintSecretHex);

    // Fetch contributions
    const { data: contributions, error: contribErr } = await supabase
      .from("contributions")
      .select("*")
      .eq("launch_id", launch.id)
      .order("amount_lamports", { ascending: false });

    if (contribErr) throw contribErr;
    if (!contributions || contributions.length === 0) {
      await setFailed(supabase, launch.id, "No contributions found for launch");
      return errorResponse("No contributions found");
    }

    // Sum total lamports — no ATA reserve since Pump.fun founders get tokens, not fee shares
    const totalLamports = contributions.reduce(
      (sum: bigint, c: any) => sum + BigInt(c.amount_lamports),
      0n
    );

    // Pre-calculate proportional token amounts (basis points) for Railway distributor
    for (const c of contributions) {
      const proportionalBps = Math.floor(
        (Number(BigInt(c.amount_lamports)) / Number(totalLamports)) * 10000
      );
      await supabase
        .from("contributions")
        .update({ token_amount: proportionalBps })
        .eq("id", c.id);
    }

    // Reserve SOL for ATA creation + tx fee per contributor (token distribution)
    const ATA_COST_PER_CONTRIBUTOR = 2_039_280n;
    const TX_FEE_PER_CONTRIBUTOR = 5_000n;
    const PRIORITY_FEE_LAMPORTS = 50_000n;

    const contributorCount = BigInt(contributions.length);
    const ataReserve = contributorCount * (ATA_COST_PER_CONTRIBUTOR + TX_FEE_PER_CONTRIBUTOR);
    const initialBuyLamports = totalLamports - ataReserve - PRIORITY_FEE_LAMPORTS;

    if (initialBuyLamports < 10_000_000n) {
      await setFailed(
        supabase,
        launch.id,
        `Insufficient SOL after ATA reserve. Total: ${totalLamports}, Reserve: ${ataReserve}, Net: ${initialBuyLamports}`
      );
      return errorResponse("Not enough SOL to cover token distribution costs and initial buy");
    }

    // Call PumpPortal local API to create token transaction
    const response = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: launch.escrow_wallet_public_key,
        action: "create",
        tokenMetadata: {
          name: launch.token_name,
          symbol: launch.token_symbol.toUpperCase(),
          uri: launch.ipfs_metadata_url,
        },
        mint: launch.token_mint_address,
        denominatedInSol: "true",
        amount: Number(initialBuyLamports) / 1e9,
        slippage: 15,
        priorityFee: 0.00005,
        pool: "pump",
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      await setFailed(supabase, launch.id, `PumpPortal create failed: ${errText}`);
      return errorResponse(`PumpPortal create failed: ${errText}`);
    }

    const txData = await response.arrayBuffer();
    const txBytes = new Uint8Array(txData);

    // Sign with both escrow + mint keypairs using @solana/web3.js
    const escrowKeypair = Keypair.fromSecretKey(escrowSecret);
    const mintKeypair = Keypair.fromSecretKey(mintSecret);

    const tx = VersionedTransaction.deserialize(txBytes);
    tx.sign([mintKeypair, escrowKeypair]);

    const signedBytes = tx.serialize();
    const txBase64 = uint8ArrayToBase64(signedBytes);

    // Submit via Alchemy RPC
    const rpcRes = await fetch(SOLANA_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [txBase64, { encoding: "base64", preflightCommitment: "confirmed" }],
      }),
    });

    const rpcData = await rpcRes.json();
    if (rpcData.error) {
      await setFailed(supabase, launch.id, `Send failed: ${JSON.stringify(rpcData.error)}`);
      return errorResponse("Transaction submission failed");
    }

    const txSignature = rpcData.result;

    console.log(`Pump.fun tx submitted: ${txSignature}`);
    console.log(`Solscan: https://solscan.io/tx/${txSignature}`);

    // Poll for on-chain confirmation before marking launched
    let confirmed = false;
    let attempts = 0;
    const maxAttempts = 30; // 30 x 2s = 60s max

    while (!confirmed && attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 2000));
      attempts++;

      const statusRes = await fetch(SOLANA_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getSignatureStatuses",
          params: [[txSignature], { searchTransactionHistory: true }],
        }),
      });

      const statusData = await statusRes.json();
      const status = statusData.result?.value?.[0];

      if (status?.err) {
        await setFailed(
          supabase,
          launch.id,
          `Transaction failed on-chain: ${JSON.stringify(status.err)}`
        );
        return errorResponse("Pump.fun transaction failed on-chain");
      }

      if (
        status?.confirmationStatus === "confirmed" ||
        status?.confirmationStatus === "finalized"
      ) {
        confirmed = true;
        console.log(`Transaction confirmed after ${attempts} attempts`);
      }
    }

    if (!confirmed) {
      await setFailed(
        supabase,
        launch.id,
        `Transaction not confirmed after 60 seconds: ${txSignature}`
      );
      return errorResponse("Transaction confirmation timeout");
    }

    await supabase
      .from("launches")
      .update({ status: "launched" })
      .eq("id", launch.id);

    return new Response(
      JSON.stringify({
        success: true,
        launchId: launch.id,
        txSignature,
        platform: "pumpfun",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("executePumpfunLaunch error:", error);
    await setFailed(supabase, launch.id, error.message || "Pump.fun execution error");
    return errorResponse(error.message || "Pump.fun execution failed");
  }
}
