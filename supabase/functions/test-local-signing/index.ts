// Admin-only edge function that mirrors executor/src/launchWithLocalSigning.ts.
// Lets admins trigger the PumpPortal /trade-local + local-signing path from
// the admin panel for testing, without flipping USE_LOCAL_SIGNING or running
// the CLI on Railway.
//
// Auth: caller must be an admin wallet (verified via is_admin_wallet RPC).
// Dry-run: loads keypairs, calls /trade-local, signs locally, returns details.
//          NO RPC submission, NO DB mutation.
// Live:    submits via Connection.sendRawTransaction and updates the launch
//          row to status='launched' on success.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import {
  Connection,
  Keypair,
  VersionedTransaction,
} from "https://esm.sh/@solana/web3.js@1.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MINIMUM_POOL_LAMPORTS = 300_000_000n; // 0.3 SOL

interface ReqBody {
  launchId?: string;
  dryRun?: boolean;
  adminWallet?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const logs: string[] = [];
  const log = (msg: string) => {
    const line = `[LOCAL_SIGNING] ${msg}`;
    logs.push(line);
    console.log(line);
  };

  try {
    if (req.method !== "POST") {
      return json({ ok: false, error: "Method not allowed", logs }, 405);
    }

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const launchId = (body.launchId ?? "").trim();
    const adminWallet = (body.adminWallet ?? "").trim();
    const dryRun = body.dryRun !== false; // default true for safety

    if (!launchId) return json({ ok: false, error: "launchId required", logs }, 400);
    if (!adminWallet) return json({ ok: false, error: "adminWallet required", logs }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ---- Admin gate ----
    const { data: isAdmin, error: adminErr } = await supabase.rpc(
      "is_admin_wallet",
      { p_wallet: adminWallet }
    );
    if (adminErr) return json({ ok: false, error: `admin check failed: ${adminErr.message}`, logs }, 500);
    if (!isAdmin) return json({ ok: false, error: "unauthorized", logs }, 403);
    log(`Admin wallet verified: ${adminWallet.slice(0, 8)}...`);

    // ---- Load launch ----
    const { data: launch, error: launchErr } = await supabase
      .from("launches")
      .select("*")
      .eq("id", launchId)
      .single();
    if (launchErr || !launch) {
      return json({ ok: false, error: `launch not found: ${launchErr?.message ?? "missing"}`, logs }, 404);
    }

    if (launch.platform !== "pumpfun") {
      return json({ ok: false, error: `platform is '${launch.platform}', not pumpfun`, logs }, 400);
    }
    if (!launch.pumpfun_mint_keypair_encrypted) {
      return json({ ok: false, error: "missing pumpfun_mint_keypair_encrypted", logs }, 400);
    }
    if (!launch.escrow_wallet_encrypted_private_key) {
      return json({ ok: false, error: "missing escrow_wallet_encrypted_private_key", logs }, 400);
    }
    if (!dryRun && launch.status !== "executing") {
      return json(
        {
          ok: false,
          error: `launch status is '${launch.status}', not 'executing' — refuse live submit`,
          logs,
        },
        400
      );
    }
    log(`${dryRun ? "[DRY-RUN] " : ""}Launch ${launchId} (${launch.token_name})`);

    // ---- Decrypt keypairs (REUSE — never generate) ----
    const ENC_KEY_HEX = Deno.env.get("ESCROW_ENCRYPTION_KEY")!;
    if (!ENC_KEY_HEX) {
      return json({ ok: false, error: "ESCROW_ENCRYPTION_KEY not set", logs }, 500);
    }

    const escrowSecret = await decryptKey(
      launch.escrow_wallet_encrypted_private_key,
      ENC_KEY_HEX
    );
    const escrowKeypair = Keypair.fromSecretKey(escrowSecret);
    log(`Loaded escrow keypair: ${escrowKeypair.publicKey.toBase58()}`);

    const mintSecret = await decryptKey(
      launch.pumpfun_mint_keypair_encrypted,
      ENC_KEY_HEX
    );
    const mintKeypair = Keypair.fromSecretKey(mintSecret);
    const derivedMint = mintKeypair.publicKey.toBase58();
    if (derivedMint !== launch.token_mint_address) {
      return json(
        {
          ok: false,
          error: `mint keypair mismatch. stored=${launch.token_mint_address} derived=${derivedMint}`,
          logs,
        },
        400
      );
    }
    log(`Loaded mint keypair: ${derivedMint}`);

    // ---- Load contributions ----
    const { data: contributions, error: contribErr } = await supabase
      .from("contributions")
      .select("*")
      .eq("launch_id", launchId);
    if (contribErr) {
      return json({ ok: false, error: `contributions fetch failed: ${contribErr.message}`, logs }, 500);
    }
    if (!contributions || contributions.length === 0) {
      return json({ ok: false, error: "no contributions for launch", logs }, 400);
    }
    const totalLamports = contributions.reduce(
      (sum, c) => sum + BigInt(c.amount_lamports),
      0n
    );
    log(
      `Pool total: ${Number(totalLamports) / 1e9} SOL across ${contributions.length} contribution(s)`
    );

    if (totalLamports < MINIMUM_POOL_LAMPORTS) {
      return json(
        {
          ok: false,
          error: `pool below 0.3 SOL minimum (${Number(totalLamports) / 1e9} SOL)`,
          logs,
        },
        400
      );
    }

    // ---- Reserve math (matches executePumpfun.ts) ----
    const ATA_COST = 2_039_280n;
    const TX_FEE = 5_000n;
    const PRIORITY_FEE = 50_000n;
    const PRIORITY_FEE_PER_CONTRIBUTOR = 10_000n;
    const contributorCount = BigInt(contributions.length);
    const ataReserve =
      contributorCount * (ATA_COST + TX_FEE + PRIORITY_FEE_PER_CONTRIBUTOR);
    const initialBuyLamports = totalLamports - ataReserve - PRIORITY_FEE;

    if (initialBuyLamports < 10_000_000n) {
      return json(
        {
          ok: false,
          error: `insufficient SOL after reserves: ${initialBuyLamports}`,
          logs,
        },
        400
      );
    }
    log(`Initial buy lamports: ${initialBuyLamports} (${Number(initialBuyLamports) / 1e9} SOL)`);

    // ---- Call PumpPortal /trade-local ----
    log("Calling PumpPortal /trade-local");
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 30_000);
    let pumpRes: Response;
    try {
      pumpRes = await fetch("https://pumpportal.fun/api/trade-local", {
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
        signal: ctrl.signal,
      });
    } catch (err: any) {
      clearTimeout(timeout);
      const msg =
        err.name === "AbortError"
          ? "PumpPortal /trade-local timeout (30s)"
          : `PumpPortal /trade-local error: ${err.message}`;
      return json({ ok: false, error: msg, logs }, 502);
    }
    clearTimeout(timeout);

    if (!pumpRes.ok) {
      const errBody = await pumpRes.text().catch(() => "");
      return json(
        {
          ok: false,
          error: `PumpPortal /trade-local ${pumpRes.status}: ${errBody.slice(0, 800)}`,
          logs,
        },
        502
      );
    }

    const txBytes = new Uint8Array(await pumpRes.arrayBuffer());
    log(`Received ${txBytes.length}-byte unsigned transaction`);

    // ---- Local sign: mint then escrow ----
    const tx = VersionedTransaction.deserialize(txBytes);
    tx.sign([mintKeypair, escrowKeypair]);
    const signedBytes = tx.serialize();
    log(`Locally signed transaction: ${signedBytes.length} bytes`);

    const baseResult = {
      txSizeBytes: signedBytes.length,
      escrowPubkey: escrowKeypair.publicKey.toBase58(),
      mintPubkey: mintKeypair.publicKey.toBase58(),
      mintMatch: mintKeypair.publicKey.toBase58() === launch.token_mint_address,
      poolSol: Number(totalLamports) / 1e9,
      contributors: contributions.length,
      initialBuySol: Number(initialBuyLamports) / 1e9,
    };

    if (dryRun) {
      log("[DRY RUN] Transaction ready — not submitted");
      return json({ ok: true, dryRun: true, ...baseResult, logs }, 200);
    }

    // ---- Live submit ----
    const RPC_URL = Deno.env.get("SOLANA_RPC_URL")!;
    const connection = new Connection(RPC_URL, "confirmed");
    let txSignature: string;
    try {
      txSignature = await connection.sendRawTransaction(signedBytes, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 3,
      });
    } catch (sendErr: any) {
      return json(
        {
          ok: false,
          error: `sendRawTransaction failed: ${sendErr?.message ?? sendErr}`,
          logs,
        },
        502
      );
    }
    log(`Submitted: ${txSignature}`);
    const solscanUrl = `https://solscan.io/tx/${txSignature}`;
    log(`Solscan: ${solscanUrl}`);

    // Mark launched (mirror setLaunched). Worker lock is released by
    // the worker that originally claimed it; here we only flip status.
    const { error: updErr } = await supabase
      .from("launches")
      .update({
        status: "launched",
        pumpfun_launch_signature: txSignature,
      })
      .eq("id", launchId);
    if (updErr) {
      log(`WARN: tx submitted but DB update failed: ${updErr.message}`);
    } else {
      log(`Launch ${launchId} marked as launched`);
    }

    return json(
      { ok: true, dryRun: false, txSignature, solscanUrl, ...baseResult, logs },
      200
    );
  } catch (err: any) {
    logs.push(`[LOCAL_SIGNING] FATAL: ${err?.message ?? err}`);
    console.error("[LOCAL_SIGNING] Unhandled:", err);
    return json({ ok: false, error: err?.message ?? String(err), logs }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// AES-256-GCM decrypt mirroring executor/src/decrypt.ts. Returns the raw
// 64-byte Solana secret key (the plaintext IS the raw bytes — see decrypt.ts).
async function decryptKey(
  encryptedData: string,
  encryptionKeyHex: string
): Promise<Uint8Array> {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format. Expected iv:authTag:ciphertext");
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = hexToUint8Array(ivHex);
  const authTag = hexToUint8Array(authTagHex);
  const ciphertext = hexToUint8Array(ciphertextHex);
  const keyBytes = hexToUint8Array(encryptionKeyHex);

  // WebCrypto AES-GCM expects ciphertext || authTag concatenated.
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext, 0);
  combined.set(authTag, ciphertext.length);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, combined)
  );
  return plaintext;
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}