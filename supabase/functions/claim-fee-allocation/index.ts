import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SOLANA_RPC_URL = Deno.env.get("SOLANA_RPC_URL")!;
const ENC_KEY_HEX = Deno.env.get("ESCROW_ENCRYPTION_KEY")!;

function decryptKey(encryptedData: string): Uint8Array {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted data format");
  const [ivHex, tagHex, ctHex] = parts;
  const iv = hexToBytes(ivHex);
  const tag = hexToBytes(tagHex);
  const ct = hexToBytes(ctHex);
  const key = hexToBytes(ENC_KEY_HEX);
  // Use Node's crypto via Deno std (compatible). Use built-in WebCrypto AES-GCM.
  // WebCrypto expects ciphertext+tag concatenated.
  const ctTag = new Uint8Array(ct.length + tag.length);
  ctTag.set(ct);
  ctTag.set(tag, ct.length);
  return decryptGcm(key, iv, ctTag);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

async function decryptGcm(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertextWithTag: Uint8Array
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    ciphertextWithTag
  );
  return new Uint8Array(pt);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { allocation_ids, wallet, delivery_wallet } = await req.json();
    if (!Array.isArray(allocation_ids) || allocation_ids.length === 0) {
      return json({ error: "allocation_ids required" }, 400);
    }
    if (typeof wallet !== "string" || wallet.length < 32) {
      return json({ error: "wallet required" }, 400);
    }
    let deliveryPk: PublicKey;
    try {
      deliveryPk = new PublicKey(delivery_wallet || wallet);
    } catch {
      return json({ error: "invalid delivery_wallet" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const workerId = `claim-${crypto.randomUUID()}`;

    const results: Array<{
      allocation_id: string;
      ok: boolean;
      tx_signature?: string;
      error?: string;
    }> = [];

    // Decryption helper: cache the lightning keypair per launch within this
    // request to avoid re-decrypting when claiming multiple allocations on
    // the same launch.
    const kpCache = new Map<string, Keypair>();

    // Decrypt is async (WebCrypto); pre-decrypt would require a refactor of
    // claim_allocation_for_user. Inline async work per-allocation is fine —
    // payload should be small (typically 1-3 allocations).
    for (const allocId of allocation_ids) {
      const { data, error } = await supabase.rpc("claim_allocation_for_user", {
        p_allocation_id: allocId,
        p_wallet: wallet,
        p_worker_id: workerId,
        p_delivery_wallet: deliveryPk.toBase58(),
      });
      if (error) {
        results.push({ allocation_id: allocId, ok: false, error: error.message });
        continue;
      }
      const row = data?.[0];
      if (!row) {
        results.push({
          allocation_id: allocId,
          ok: false,
          error: "Allocation not found, not yours, or already claimed",
        });
        continue;
      }

      try {
        let kp = kpCache.get(row.launch_id);
        if (!kp) {
          const secret = await decryptKey(row.lightning_wallet_encrypted_private_key);
          kp = Keypair.fromSecretKey(secret);
          if (kp.publicKey.toBase58() !== row.lightning_wallet_public_key) {
            throw new Error("Lightning keypair mismatch");
          }
          kpCache.set(row.launch_id, kp);
        }

        const lamports = Number(row.lamports);
        if (!Number.isFinite(lamports) || lamports <= 0) {
          throw new Error("Invalid allocation amount");
        }

        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: kp.publicKey,
            toPubkey: deliveryPk,
            lamports,
          })
        );
        tx.feePayer = kp.publicKey;
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.sign(kp);
        const sig = await connection.sendRawTransaction(tx.serialize(), {
          preflightCommitment: "confirmed",
        });
        await connection.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          "confirmed"
        );

        await supabase.rpc("complete_allocation_claim", {
          p_allocation_id: allocId,
          p_tx_signature: sig,
        });
        results.push({ allocation_id: allocId, ok: true, tx_signature: sig });
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        await supabase.rpc("fail_allocation_claim", {
          p_allocation_id: allocId,
          p_error: msg,
        });
        results.push({ allocation_id: allocId, ok: false, error: msg });
      }
    }

    return json({ results });
  } catch (err: any) {
    return json({ error: err?.message ?? String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}