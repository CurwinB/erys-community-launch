import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { Keypair, Transaction, VersionedTransaction } from "https://esm.sh/@solana/web3.js@1.91.1";
import bs58 from "https://esm.sh/bs58@5.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BAGS_API_BASE = "https://public-api-v2.bags.fm/api/v1";
const CLAIM_THRESHOLD_LAMPORTS = 100_000_000; // 0.1 SOL

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
  const ERYS_PLATFORM_PRIVATE_KEY = Deno.env.get("ERYS_PLATFORM_PRIVATE_KEY")!;

  try {
    // Step 1: Check unclaimed partner fees
    const statsRes = await fetch(
      `${BAGS_API_BASE}/fee-share/partner-config/stats?partner=${encodeURIComponent(BAGS_PARTNER_WALLET)}`,
      {
        headers: { "x-api-key": BAGS_API_KEY },
      }
    );

    if (!statsRes.ok) {
      const errText = await statsRes.text();
      console.error("Partner stats fetch failed:", errText);
      return new Response(
        JSON.stringify({ error: `Stats fetch failed: ${errText}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stats = await statsRes.json();
    const unclaimedLamports = Number(stats.response?.unclaimedFees ?? 0);

    if (Number(unclaimedLamports) < CLAIM_THRESHOLD_LAMPORTS) {
      return new Response(
        JSON.stringify({
          message: "Below threshold",
          unclaimed: Number(unclaimedLamports),
          threshold: CLAIM_THRESHOLD_LAMPORTS,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Generate claim transaction(s)
    const claimTxRes = await fetch(`${BAGS_API_BASE}/fee-share/partner-config/claim-tx`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": BAGS_API_KEY,
      },
      body: JSON.stringify({
        partnerWallet: BAGS_PARTNER_WALLET,
      }),
    });

    if (!claimTxRes.ok) {
      const errText = await claimTxRes.text();
      console.error("Partner claim tx generation failed:", errText);
      return new Response(
        JSON.stringify({ error: `Claim tx generation failed: ${errText}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const claimTxData = await claimTxRes.json();
    const claimTransactions = claimTxData.response?.transactions || [];

    if (claimTransactions.length === 0) {
      return new Response(
        JSON.stringify({ message: "No partner claim transactions returned" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 3: Sign each tx locally with platform key (base58-encoded secret) and submit
    const platformKeypair = Keypair.fromSecretKey(bs58.decode(ERYS_PLATFORM_PRIVATE_KEY));
    const signatures: string[] = [];

    for (const txObj of claimTransactions) {
      const txBytes = bs58.decode(txObj.transaction);
      let signedTxBase58: string;
      try {
        const tx = VersionedTransaction.deserialize(txBytes);
        tx.sign([platformKeypair]);
        signedTxBase58 = bs58.encode(tx.serialize());
      } catch {
        const tx = Transaction.from(txBytes);
        tx.partialSign(platformKeypair);
        signedTxBase58 = bs58.encode(tx.serialize());
      }

      const sendRes = await fetch(`${BAGS_API_BASE}/solana/send-transaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": BAGS_API_KEY },
        body: JSON.stringify({ transaction: signedTxBase58 }),
      });

      if (!sendRes.ok) {
        const errText = await sendRes.text();
        console.error("Partner claim send failed:", errText);
        return new Response(
          JSON.stringify({ error: `Send failed: ${errText}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const sendData = await sendRes.json();
      const sig = sendData.response || sendData.signature || sendData.txSignature;
      if (sig) signatures.push(sig);
      await new Promise((r) => setTimeout(r, 500));
    }

    const txSignature = signatures.join(",");

    // Step 4: Log to platform_fee_claims table
    const { error: insertErr } = await supabase
      .from("platform_fee_claims")
      .insert({
        amount_lamports: Number(unclaimedLamports),
        tx_signature: txSignature,
      });

    if (insertErr) {
      console.error("Failed to log platform fee claim:", insertErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        claimed: Number(unclaimedLamports),
        txSignatures: signatures,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("claim-partner-fees error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
