import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SOLANA_RPC = Deno.env.get("SOLANA_RPC_URL")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const { launch_id, wallet_address, amount_lamports, tx_signature } = body;
    let { token_delivery_wallet } = body;

    // 1. Validate required fields
    if (!launch_id || !wallet_address || !amount_lamports || !tx_signature) {
      return errorResponse("Missing required fields: launch_id, wallet_address, amount_lamports, tx_signature", 400);
    }

    // Optional token_delivery_wallet — if provided, must be a plausible base58 Solana pubkey.
    if (token_delivery_wallet !== undefined && token_delivery_wallet !== null && token_delivery_wallet !== "") {
      if (typeof token_delivery_wallet !== "string") {
        return errorResponse("token_delivery_wallet must be a string", 400);
      }
      token_delivery_wallet = token_delivery_wallet.trim();
      if (token_delivery_wallet.length < 32 || token_delivery_wallet.length > 44) {
        return errorResponse("token_delivery_wallet must be a valid Solana wallet address", 400);
      }
      if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(token_delivery_wallet)) {
        return errorResponse("token_delivery_wallet contains invalid characters", 400);
      }
    } else {
      token_delivery_wallet = null;
    }

    // 2. Verify launch exists. State checks (status, window) happen AFTER
    //    on-chain verification so that if SOL has already moved we can
    //    queue an orphan-refund row instead of stranding it.
    const { data: launch, error: launchErr } = await supabase
      .from("launches")
      .select("*")
      .eq("id", launch_id)
      .single();

    if (launchErr || !launch) {
      return errorResponse("Launch not found", 404);
    }

    // 3. Validate amount against platform-enforced minimum (0.1 SOL).
    // Per-launch min/max overrides have been removed in favour of a
    // single platform floor for consistency across all launches.
    const PLATFORM_MIN_CONTRIBUTION = 100_000_000; // 0.1 SOL
    const amount = Number(amount_lamports);
    if (amount < PLATFORM_MIN_CONTRIBUTION) {
      return errorResponse(
        `Minimum contribution is 0.1 SOL. You sent ${amount / 1e9} SOL.`,
        400,
      );
    }

    // 4. On-chain verification with retry (3 attempts, 2s gaps)
    let txData: any = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      const rpcRes = await fetch(SOLANA_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [
            tx_signature,
            {
              commitment: "confirmed",
              maxSupportedTransactionVersion: 0,
              encoding: "jsonParsed",
            },
          ],
        }),
      });

      const rpcResult = await rpcRes.json();

      if (rpcResult.result) {
        txData = rpcResult.result;
        break;
      }

      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    if (!txData) {
      return errorResponse("Transaction not confirmed yet. Please wait a moment and try again.", 422);
    }

    // 5. Verify signer — fee payer (first account key) must match wallet_address
    const accountKeys = txData.transaction?.message?.accountKeys;
    if (!accountKeys || accountKeys.length === 0) {
      return errorResponse("Could not read transaction account keys", 500);
    }

    // accountKeys can be objects with .pubkey (jsonParsed) or plain strings
    const feePayer = typeof accountKeys[0] === "string"
      ? accountKeys[0]
      : accountKeys[0]?.pubkey;

    if (!feePayer || feePayer !== wallet_address) {
      return errorResponse(
        `Signer mismatch: transaction fee payer '${feePayer}' does not match wallet '${wallet_address}'`,
        400
      );
    }

    // 6. Verify destination and amount — look for SOL transfer to escrow wallet
    const instructions = txData.transaction?.message?.instructions || [];
    let foundTransfer = false;

    for (const ix of instructions) {
      // System program transfer (jsonParsed format)
      if (
        ix.program === "system" &&
        ix.parsed?.type === "transfer" &&
        ix.parsed?.info?.destination === launch.escrow_wallet_public_key
      ) {
        const transferredLamports = Number(ix.parsed.info.lamports);
        if (transferredLamports !== amount) {
          return errorResponse(
            `Amount mismatch: on-chain transfer ${transferredLamports} != claimed ${amount}`,
            400
          );
        }
        foundTransfer = true;
        break;
      }
    }

    // Also check inner instructions if not found at top level
    if (!foundTransfer) {
      const innerInstructions = txData.meta?.innerInstructions || [];
      for (const inner of innerInstructions) {
        for (const ix of inner.instructions || []) {
          if (
            ix.program === "system" &&
            ix.parsed?.type === "transfer" &&
            ix.parsed?.info?.destination === launch.escrow_wallet_public_key
          ) {
            const transferredLamports = Number(ix.parsed.info.lamports);
            if (transferredLamports !== amount) {
              return errorResponse(
                `Amount mismatch: on-chain transfer ${transferredLamports} != claimed ${amount}`,
                400
              );
            }
            foundTransfer = true;
            break;
          }
        }
        if (foundTransfer) break;
      }
    }

    if (!foundTransfer) {
      return errorResponse(
        `No SOL transfer to escrow wallet '${launch.escrow_wallet_public_key}' found in transaction`,
        400
      );
    }

    // 6.5 Race-condition state check (post on-chain verification).
    // SOL has already landed in escrow. If launch state has changed since
    // the user signed (status flipped, window closed), we must STILL record
    // the contribution — flagged for orphan refund — so the executor can
    // return the SOL automatically.
    const launchTime = new Date(launch.launch_datetime).getTime();
    const stateInvalidReason =
      launch.status !== "scheduled"
        ? `This launch is no longer accepting apes (status: ${launch.status}).`
        : new Date(launch.launch_datetime) <= new Date()
        ? "Contribution window has closed (launch datetime has passed)."
        : launchTime - Date.now() < 5 * 60 * 1000
        ? "Contribution window is closed. This launch executes in less than 5 minutes."
        : null;

    // 7. Insert contribution (unique constraint on tx_signature prevents duplicates)
    const { data: contribution, error: insertErr } = await supabase
      .from("contributions")
      .insert({
        launch_id,
        wallet_address,
        amount_lamports: amount,
        tx_signature,
        token_delivery_wallet,
        pending_orphan_refund: stateInvalidReason !== null,
      })
      .select("id")
      .single();

    if (insertErr) {
      // Unique constraint violation
      if (insertErr.code === "23505") {
        return errorResponse("This transaction has already been recorded", 409);
      }
      console.error("Insert contribution error:", insertErr);
      return errorResponse(`Failed to record contribution: ${insertErr.message}`, 500);
    }

    if (stateInvalidReason) {
      return new Response(
        JSON.stringify({
          error: `${stateInvalidReason} Your SOL has been queued for an automatic refund.`,
          queued_for_refund: true,
          contribution_id: contribution.id,
        }),
        {
          status: 202,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        contribution_id: contribution.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("contribute error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function errorResponse(msg: string, status: number) {
  return new Response(
    JSON.stringify({ error: msg }),
    {
      status,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Content-Type": "application/json",
      },
    }
  );
}
