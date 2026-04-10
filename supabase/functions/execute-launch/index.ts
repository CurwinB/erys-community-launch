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

    // Calculate basis points
    const totalLamports = activeClaims.reduce(
      (sum: bigint, c: any) => sum + BigInt(c.amount_lamports),
      0n
    );

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
      await setFailed(supabase, launch.id, "fee-share/config returned no configKey (meteoraConfigKey missing from response)");
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

    // Calculate total escrowed SOL
    const allContribTotal = contributions.reduce(
      (sum: bigint, c: any) => sum + BigInt(c.amount_lamports),
      0n
    );

    // STEP 2: create-launch-transaction
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
        initialBuyLamports: Number(allContribTotal).toString(),
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
