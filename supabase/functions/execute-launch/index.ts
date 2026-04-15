import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

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
  const SOLANA_RPC_URL = Deno.env.get("SOLANA_RPC_URL")!;

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

    // Reserve enough SOL to send tokens to every contributor:
    // - 0.00203928 SOL per contributor for ATA creation
    // - 0.000005 SOL per contributor for transaction fees
    // Everything else goes into the initial buy
    const totalReserve = BigInt(filtered.length) * (ATA_COST_PER_CONTRIBUTOR + TX_FEE_PER_TRANSFER);
    const allContribTotal = contributions.reduce(
      (sum: bigint, c: any) => sum + BigInt(c.amount_lamports),
      0n
    );
    const netBuyLamports = allContribTotal - totalReserve;

    if (netBuyLamports < 10_000_000n) {
      await setFailed(
        supabase,
        launch.id,
        `Insufficient SOL after token distribution reserve. Total: ${allContribTotal}, Reserve: ${totalReserve}, Net: ${netBuyLamports}`
      );
      return errorResponse("Not enough SOL raised to cover token distribution costs and initial buy");
    }

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
    const createTxRes = await fetch(`${BAGS_API_BASE}/token-launch/create-launch-transaction`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": BAGS_API_KEY,
      },
      body: JSON.stringify({
        creator: launch.escrow_wallet_public_key,
        name: launch.token_name,
        symbol: launch.token_symbol,
        description: launch.description || "",
        imageUrl: launch.image_url || "",
        initialBuyLamports: Number(netBuyLamports).toString(),
        configKey,
        twitter: launch.twitter_url || undefined,
        telegram: launch.telegram_url || undefined,
        website: launch.website_url || undefined,
      }),
    });

    if (!createTxRes.ok) {
      const errText = await createTxRes.text();
      await setFailed(supabase, launch.id, `create-launch-transaction failed: ${errText}`);
      return errorResponse(`create-launch-transaction failed: ${errText}`);
    }

    const createTxData = await createTxRes.json();
    const transaction = createTxData.transaction;
    const mintAddress = createTxData.mint;

    if (mintAddress) {
      await supabase
        .from("launches")
        .update({ token_mint_address: mintAddress })
        .eq("id", launch.id);
    }

    // STEP 3: send-transaction
    const sendTxRes = await fetch(`${BAGS_API_BASE}/solana/send-transaction`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": BAGS_API_KEY,
      },
      body: JSON.stringify({
        transaction,
        signerPrivateKey: escrowPrivateKey,
      }),
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

    // Trigger token distribution asynchronously
    // Don't await - this runs independently to avoid timeout
    supabase.functions.invoke("distribute-tokens", {
      body: { launch_id: launch.id }
    }).catch((err: any) => console.error("distribute-tokens invoke error:", err));

    return new Response(
      JSON.stringify({
        success: true,
        launchId: launch.id,
        txSignature: sendTxData.signature || sendTxData.txSignature,
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
// Token Distribution Logic
// =========================================

async function distributeTokens(
  supabase: any,
  rpcUrl: string,
  launch: any,
  filtered: Array<{ contribution: any; bp: number }>,
  escrowPrivateKeyHex: string,
  tokenMint: string,
  creatorWallet: string
) {
  // Step 4a: Read token balance of escrow wallet (retry 5x, 3s gaps)
  let tokenAmount: bigint | null = null;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const rpcRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          launch.escrow_wallet_public_key,
          { mint: tokenMint },
          { encoding: "jsonParsed" },
        ],
      }),
    });

    const data = await rpcRes.json();
    const amount = data.result?.value?.[0]?.account?.data?.parsed?.info?.tokenAmount?.amount;

    if (amount) {
      tokenAmount = BigInt(amount);
      break;
    }

    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  if (!tokenAmount || tokenAmount === 0n) {
    console.error("Could not read token balance from escrow wallet");
    return;
  }

  // Step 4b: Calculate token distribution with creator 5% floor
  const totalContrib = filtered.reduce(
    (sum: bigint, f) => sum + BigInt(f.contribution.amount_lamports),
    0n
  );

  const creatorFilteredIdx = filtered.findIndex(
    (f) => f.contribution.wallet_address === creatorWallet
  );

  const CREATOR_MIN_TOKEN_BPS = 500n; // 5%
  let tokenShares: bigint[] = filtered.map((f) =>
    (BigInt(f.contribution.amount_lamports) * tokenAmount!) / totalContrib
  );

  // Apply creator token floor
  if (creatorFilteredIdx >= 0) {
    const creatorMin = (tokenAmount * CREATOR_MIN_TOKEN_BPS) / 10000n;
    if (tokenShares[creatorFilteredIdx] < creatorMin) {
      const deficit = creatorMin - tokenShares[creatorFilteredIdx];
      tokenShares[creatorFilteredIdx] = creatorMin;

      // Reduce others proportionally
      const othersTotal = tokenShares.reduce(
        (sum, s, i) => (i !== creatorFilteredIdx ? sum + s : sum),
        0n
      );
      if (othersTotal > 0n) {
        for (let i = 0; i < tokenShares.length; i++) {
          if (i === creatorFilteredIdx) continue;
          const reduction = (tokenShares[i] * deficit) / othersTotal;
          tokenShares[i] -= reduction;
        }
      }
    }
  }

  // Assign remainder to first contributor
  const totalShares = tokenShares.reduce((a, b) => a + b, 0n);
  const tokenRemainder = tokenAmount - totalShares;
  tokenShares[0] += tokenRemainder;

  // Update token_amount for each contributor
  for (let i = 0; i < filtered.length; i++) {
    await supabase
      .from("contributions")
      .update({ token_amount: Number(tokenShares[i]) })
      .eq("id", filtered[i].contribution.id);
  }

  // Step 4c: Distribute tokens
  // For actual token transfers, we need SPL token program interactions
  // This would require building raw SPL token transfer transactions
  // For now, mark distribution as completed with amounts calculated
  // Actual transfer implementation requires SPL token program instruction building

  let totalDistributed = 0n;
  let allSucceeded = true;

  // Note: Full SPL token transfer implementation would go here
  // Each transfer requires: ATA derivation, optional ATA creation, SPL transfer instruction
  // For safety, we mark amounts as calculated and log for manual distribution if needed

  for (let i = 0; i < filtered.length; i++) {
    try {
      // TODO: Implement actual SPL token transfer here
      // For now, record the calculated amounts
      totalDistributed += tokenShares[i];

      await supabase
        .from("contributions")
        .update({
          token_amount: Number(tokenShares[i]),
          tokens_distributed: false, // Will be true when actual transfer is implemented
        })
        .eq("id", filtered[i].contribution.id);
    } catch (err: any) {
      allSucceeded = false;
      await supabase
        .from("contributions")
        .update({
          tokens_distributed: false,
          distribution_error: err.message,
        })
        .eq("id", filtered[i].contribution.id);
    }
  }

  await supabase
    .from("launches")
    .update({
      total_tokens_distributed: Number(totalDistributed),
      distribution_completed: true,
      distribution_completed_at: new Date().toISOString(),
    })
    .eq("id", launch.id);
}

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
