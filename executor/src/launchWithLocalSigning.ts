import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import fetch from "node-fetch";
import bs58 from "bs58";
import { decryptEscrowKey } from "./decrypt";
import {
  Launch,
  Contribution,
  supabase,
  setFailed,
  setLaunched,
  storeBasisPoints,
} from "./db";
import {
  shouldChargeProcessingFee,
  chargeProcessingFee,
} from "./processingFee";
import { cancelAndRefund } from "./cancelAndRefund";

// =====================================================================
// Parallel Pump.fun launch path: PumpPortal /trade-local + local signing.
//
// This file is wired in only when USE_LOCAL_SIGNING=true, OR when invoked
// directly by scripts/testLocalSigning.ts. The default Lightning path in
// executePumpfunLightning.ts is NOT modified by this file's existence.
//
// Signing keypairs (REUSED, never generated):
//   - escrowKeypair: decrypted from launch.escrow_wallet_encrypted_private_key
//                    (must sign as `publicKey` payer/buyer)
//   - mintKeypair:   decrypted from launch.pumpfun_mint_keypair_encrypted
//                    (must sign because `create` instantiates a new mint)
// No Keypair.generate() calls anywhere in this file. No secretKey bytes
// ever reach console.* — keypairs live in local consts and go out of scope
// when the function returns.
// =====================================================================

const MINIMUM_POOL_LAMPORTS = 300_000_000n; // 0.3 SOL
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const TREASURY_WALLET = process.env.BAGS_PARTNER_WALLET!;

const LOG = (msg: string, ...rest: any[]) =>
  console.log(`[LOCAL_SIGNING] ${msg}`, ...rest);
const ERR = (msg: string, ...rest: any[]) =>
  console.error(`[LOCAL_SIGNING] ${msg}`, ...rest);
const WARN = (msg: string, ...rest: any[]) =>
  console.warn(`[LOCAL_SIGNING] ${msg}`, ...rest);

export interface LocalSigningOptions {
  /**
   * If true, performs all keypair loading, validation, /trade-local fetch,
   * and local signing — but does NOT submit the signed tx to RPC and does
   * NOT mutate the DB (no setLaunched, no setFailed, no fee charge, no
   * BPS write, no cancelAndRefund). Used by the test CLI to validate the
   * pipeline without on-chain side effects.
   */
  dryRun?: boolean;
}

export async function launchWithLocalSigning(
  launch: Launch,
  contributions: Contribution[],
  opts: LocalSigningOptions = {}
): Promise<void> {
  const dryRun = !!opts.dryRun;
  LOG(
    `${dryRun ? "[DRY-RUN] " : ""}Executing Pump.fun launch ${launch.id} (${launch.token_name})`
  );

  // ---- Decrypt escrow keypair (REUSE — not generated) ----
  const escrowSecret = decryptEscrowKey(
    launch.escrow_wallet_encrypted_private_key
  );
  const escrowKeypair = Keypair.fromSecretKey(new Uint8Array(escrowSecret));
  LOG(`Loaded escrow keypair: ${escrowKeypair.publicKey.toBase58()}`);

  // ---- Decrypt mint keypair (REUSE — not generated) ----
  if (!launch.pumpfun_mint_keypair_encrypted) {
    const msg = "Missing pumpfun_mint_keypair_encrypted";
    ERR(msg);
    if (!dryRun) await setFailed(launch.id, msg);
    return;
  }
  const mintSecret = decryptEscrowKey(launch.pumpfun_mint_keypair_encrypted);
  const mintKeypair = Keypair.fromSecretKey(new Uint8Array(mintSecret));
  const derivedMint = mintKeypair.publicKey.toBase58();
  // ---- Mint keypair byte-level diagnostics ----
  // Generation path (for reference): create-launch-pumpfun/index.ts builds
  // a 64-byte Solana secret key as `seed(32) || pubkey(32)` from a PKCS8
  // Ed25519 export, hex-encodes those 64 bytes, then AES-GCM-encrypts.
  // decryptEscrowKey returns those raw 64 bytes. So secretKey.length must
  // be 64 and the bs58 round-trip must also be 64.
  LOG(`mintKeypair.secretKey length: ${mintKeypair.secretKey.length}`);
  LOG(
    `mintKeypair.secretKey bs58 roundtrip length: ${
      bs58.decode(bs58.encode(mintKeypair.secretKey)).length
    }`
  );
  LOG(`mintKeypair.publicKey: ${mintKeypair.publicKey.toBase58()}`);
  LOG(
    `mintKeypair.publicKey === launch.token_mint_address: ${
      mintKeypair.publicKey.toBase58() === launch.token_mint_address
    }`
  );
  if (derivedMint !== launch.token_mint_address) {
    const msg = `Mint keypair mismatch. Stored: ${launch.token_mint_address}, Derived: ${derivedMint}`;
    ERR(msg);
    if (!dryRun) await setFailed(launch.id, msg);
    return;
  }
  LOG(`Loaded mint keypair: ${derivedMint}`);

  const totalLamports = contributions.reduce(
    (sum, c) => sum + BigInt(c.amount_lamports),
    0n
  );
  LOG(
    `Pool total: ${Number(totalLamports) / 1e9} SOL across ${contributions.length} contribution(s)`
  );

  // ---- Auto-cancel + refund if below 0.3 SOL ----
  if (totalLamports < MINIMUM_POOL_LAMPORTS) {
    LOG(
      `Insufficient pool: ${Number(totalLamports) / 1e9} SOL. Minimum 0.3 SOL.`
    );
    if (dryRun) {
      LOG("[DRY-RUN] Would call cancelAndRefund — skipping");
      return;
    }
    await cancelAndRefund(launch, contributions);
    return;
  }

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");

  // ---- Passive PumpPortal reachability check ----
  // We previously POSTed `{action:"create"}` here as a "probe", but that's
  // exactly the malformed payload that triggers PumpPortal's `toBuffer`
  // crash — and doing it ~1s before the real call appears to poison the
  // next request from the same IP. Use a passive GET instead: any HTTP
  // response (including 4xx/405) means the host is reachable. Only a
  // 5xx or network error counts as "down". The processing fee is still
  // charged AFTER /trade-local succeeds, so this check is defense-in-depth
  // only — failure here aborts cleanly with no funds touched.
  if (!dryRun) {
    try {
      const probeCtrl = new AbortController();
      const probeTimeout = setTimeout(() => probeCtrl.abort(), 5_000);
      const probeRes = await fetch("https://pumpportal.fun/api/trade-local", {
        method: "GET",
        signal: probeCtrl.signal,
      });
      clearTimeout(probeTimeout);
      const probeText = await probeRes.text().catch(() => "");
      if (probeRes.status >= 500) {
        const msg = `PumpPortal reachability check returned ${probeRes.status}; aborting before committing funds. Body: ${probeText.slice(0, 300)}`;
        ERR(msg);
        await setFailed(launch.id, msg);
        return;
      }
      // GET /trade-local is not a supported method, so 400/405 here is
      // EXPECTED and means the host is up. Only 5xx counts as down.
      LOG(`PumpPortal endpoint up (GET status ${probeRes.status} is normal): ${probeText.slice(0, 200)}`);
    } catch (probeErr: any) {
      const msg = `PumpPortal reachability check threw: ${probeErr?.message ?? probeErr}`;
      ERR(msg);
      await setFailed(launch.id, msg);
      return;
    }
  }

  // Reserves are computed against the FULL pool — the processing fee
  // is charged after signing, from whatever residual the escrow holds
  // after the buy + ATA reserves. This guarantees full refundability
  // up until the moment we actually submit the on-chain launch.
  const availableLamports = totalLamports;

  // ---- Reserve math (matches executePumpfun.ts exactly) ----
  const ATA_COST = 2_039_280n;
  const TX_FEE = 5_000n;
  const PRIORITY_FEE = 50_000n;
  const PRIORITY_FEE_PER_CONTRIBUTOR = 10_000n;
  const contributorCount = BigInt(contributions.length);
  const ataReserve =
    contributorCount * (ATA_COST + TX_FEE + PRIORITY_FEE_PER_CONTRIBUTOR);
  const initialBuyLamports = availableLamports - ataReserve - PRIORITY_FEE;

  if (initialBuyLamports < 10_000_000n) {
    const msg = `Insufficient SOL after reserves. Net buy: ${initialBuyLamports}`;
    ERR(msg);
    if (!dryRun) await setFailed(launch.id, msg);
    return;
  }
  LOG(`Initial buy lamports: ${initialBuyLamports} (${Number(initialBuyLamports) / 1e9} SOL)`);

  // ---- Pre-flight metadata reachability check ----
  // Advisory only: public IPFS gateways (ipfs.io / cloudflare / even
  // dedicated Pinata subdomains) intermittently return 504/429/401 to
  // Railway's egress IPs. PumpPortal's own fetch runs from a different
  // network and very often succeeds when ours fails. Log the result but
  // never abort here — let /trade-local be the source of truth.
  if (!dryRun) {
    const metaCheck = await verifyMetadataReachable(launch.ipfs_metadata_url ?? "");
    if (!metaCheck.ok) {
      WARN(`Metadata pre-flight WARN (advisory only, proceeding to /trade-local): ${metaCheck.reason}`);
    } else {
      LOG("Metadata + image pre-flight check passed");
    }
  }

  // ---- Persist BPS (skipped on dry-run) ----
  if (!dryRun) {
    const totalNum = Number(totalLamports);
    for (const c of contributions) {
      const bps = Math.floor(
        (Number(BigInt(c.amount_lamports)) / totalNum) * 10000
      );
      await storeBasisPoints(c.id, bps);
    }
  } else {
    LOG("[DRY-RUN] Would persist basis points — skipping");
  }

  // ---- Call /trade-local with one automatic retry on transient errors ----
  // PumpPortal intermittently returns 5xx or a 400 with `toBuffer` /
  // undefined-property errors. A short backoff + single retry recovers
  // from these without manual intervention. Safe to retry: the processing
  // fee has not been charged yet, and the mint pubkey is deterministic
  // (re-using the same mint on retry is the correct behavior).
  // Defensive coercion + diagnostics. PumpPortal /trade-local responds 400
  // with `Cannot read properties of undefined (reading 'toBuffer')` when
  // either `mint` or `tokenMetadata.uri` is null/undefined or not a plain
  // base58 string — their handler tries to wrap it in a PublicKey/Buffer
  // and crashes. Force both to plain strings here and log types so any
  // future regression is immediately diagnosable in Railway logs.
  // PumpPortal /trade-local with action:"create" expects `mint` to be the
  // bs58-encoded SECRET KEY of the mint keypair (per their docs: `mint:
  // bs58.encode(mintKeypair.secretKey)`). Sending the public key here causes
  // their handler to crash with `Cannot read properties of undefined
  // (reading 'toBuffer')` returned as a generic 400. The Lightning path in
  // executePumpfunLightning.ts already does this correctly.
  const mintField = bs58.encode(mintKeypair.secretKey);
  const mintPubkey = mintKeypair.publicKey.toBase58();
  const uriField = String(launch.ipfs_metadata_url ?? "").trim();
  const pubkeyField = String(launch.escrow_wallet_public_key ?? "").trim();
  LOG(`mint secret bs58 len=${mintField.length} (pubkey=${mintPubkey})`);
  LOG(`uri=${uriField}`);
  LOG(`publicKey type=${typeof launch.escrow_wallet_public_key} len=${pubkeyField.length} value=${pubkeyField}`);

  // Inline diagnostic + fail-fast: confirm the URI we're about to hand to
  // PumpPortal returns valid JSON with non-empty name/symbol/image. If
  // any are missing, abort BEFORE /trade-local so we surface a clean
  // diagnostic instead of PumpPortal's cryptic toBuffer 400.
  // JSON-shape diagnostic. Only abort when the fetch SUCCEEDS but the
  // JSON is malformed/missing required fields — that's a deterministic
  // content bug. Network failures here are advisory; PumpPortal's egress
  // is what matters and we let /trade-local be the gate.
  {
    try {
      const diagRes = await fetch(uriField, { method: "GET" });
      const diagText = await diagRes.text().catch(() => "");
      LOG(`metadata URI diagnostic: status=${diagRes.status} bytes=${diagText.length} body=${diagText.slice(0, 600)}`);
      if (diagRes.ok) {
        try {
          const parsed = JSON.parse(diagText);
          const n = typeof parsed?.name === "string" ? parsed.name.trim() : "";
          const s = typeof parsed?.symbol === "string" ? parsed.symbol.trim() : "";
          const i = typeof parsed?.image === "string" ? parsed.image.trim() : "";
          LOG(`metadata fields: name=${n} symbol=${s} image=${i}`);
          if (!n || !s || !i) {
            const msg = `Aborting before /trade-local: metadata missing required fields (name=${!!n} symbol=${!!s} image=${!!i})`;
            ERR(msg);
            if (!dryRun) {
              await setFailed(launch.id, msg);
              return;
            }
          }
        } catch {
          WARN("metadata URI fetched OK but did NOT return valid JSON; proceeding (PumpPortal may still parse it)");
        }
      } else {
        WARN(`metadata URI diagnostic returned ${diagRes.status} (advisory only, proceeding to /trade-local)`);
      }
    } catch (e: any) {
      WARN(`metadata URI diagnostic fetch threw: ${e?.message ?? e} (advisory only, proceeding to /trade-local)`);
    }
  }
  if (!mintField || !uriField || !pubkeyField) {
    const msg = `Refusing /trade-local call: mintEmpty=${!mintField} uriEmpty=${!uriField} pubkeyEmpty=${!pubkeyField}`;
    ERR(msg);
    if (!dryRun) await setFailed(launch.id, msg);
    return;
  }
  const amountSol = Number(initialBuyLamports) / 1e9;
  LOG(
    `amount type=${typeof amountSol} value=${amountSol} initialBuyLamports=${initialBuyLamports} finite=${Number.isFinite(amountSol)} >0=${amountSol > 0}`
  );
  const requestBody = {
    publicKey: pubkeyField,
    action: "create",
    tokenMetadata: {
      name: (launch.token_name ?? "").trim(),
      symbol: (launch.token_symbol ?? "").trim().toUpperCase(),
      uri: uriField,
    },
    mint: mintField,
    denominatedInSol: "true",
    amount: amountSol,
    slippage: 15,
    priorityFee: 0.00005,
    pool: "pump",
  };
  const tradeLocalBody = JSON.stringify(requestBody);
  // Redact the mint secret key when logging.
  const safeBodyForLog = JSON.stringify({
    ...requestBody,
    mint: `<redacted ${mintField.length}-char bs58 secret, pubkey=${mintPubkey}>`,
  });
  LOG(`/trade-local request body: ${safeBodyForLog}`);

  const callTradeLocal = async (attempt: number): Promise<{
    ok: true;
    bytes: Uint8Array;
  } | { ok: false; transient: boolean; reason: string }> => {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 30_000);
    let res: any;
    try {
      res = await fetch("https://pumpportal.fun/api/trade-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: tradeLocalBody,
        signal: ctrl.signal,
      });
    } catch (err: any) {
      clearTimeout(timeout);
      const reason =
        err.name === "AbortError"
          ? "request timed out after 30 seconds"
          : `request failed: ${err.message}`;
      return { ok: false, transient: true, reason };
    }
    clearTimeout(timeout);
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      const statusText = res.statusText || "";
      const combined = [statusText, errBody].filter(Boolean).join(" | ");
      const transient =
        res.status >= 500 ||
        res.status === 429 ||
        /toBuffer|undefined/i.test(combined);
      return {
        ok: false,
        transient,
        reason: `${res.status} ${combined.slice(0, 800) || "no error body"}`,
      };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { ok: true, bytes };
  };

  LOG("Calling PumpPortal /trade-local [attempt 1/2]");
  let result = await callTradeLocal(1);
  if (!result.ok && result.transient) {
    WARN(`/trade-local attempt 1/2 failed transiently: ${result.reason}. Retrying in 2.5s`);
    await new Promise((r) => setTimeout(r, 2_500));
    LOG("Calling PumpPortal /trade-local [attempt 2/2]");
    result = await callTradeLocal(2);
  }
  if (!result.ok) {
    const msg = `PumpPortal /trade-local failed: ${result.reason}`;
    ERR(msg);
    if (!dryRun) await setFailed(launch.id, msg);
    return;
  }
  const txBytes = result.bytes;
  LOG(`Received ${txBytes.length}-byte unsigned transaction`);

  // ---- Local signing: mint then escrow (REUSED keypairs only) ----
  const tx = VersionedTransaction.deserialize(txBytes);
  tx.sign([mintKeypair, escrowKeypair]);
  const signedBytes = tx.serialize();
  LOG(`Locally signed transaction: ${signedBytes.length} bytes`);

  if (dryRun) {
    LOG(`Signed transaction size: ${signedBytes.length} bytes`);
    LOG(`Escrow public key: ${escrowKeypair.publicKey.toBase58()}`);
    LOG(`Mint public key:   ${mintKeypair.publicKey.toBase58()}`);
    if (mintKeypair.publicKey.toBase58() === launch.token_mint_address) {
      LOG(
        `Mint match confirmed: derived mint === launch.token_mint_address (${launch.token_mint_address})`
      );
    } else {
      ERR(
        `Mint MISMATCH: derived ${mintKeypair.publicKey.toBase58()} !== launch.token_mint_address ${launch.token_mint_address}`
      );
    }
    console.log("[DRY RUN] Transaction ready \u2014 not submitted");
    return;
  }

  // ---- Hidden processing fee (charged AFTER successful local sign,
  //      BEFORE on-chain submission). Order rationale: any failure in
  //      probe / /trade-local / sign leaves contributor SOL fully
  //      refundable. Once we charge the fee we submit immediately, so
  //      the only window where SOL can be stranded is a true on-chain
  //      send failure — which is logged as a fee-shortfall in
  //      refundFailedLaunch for manual treasury reimbursement.
  let processingFeeLamports = 0n;
  if (shouldChargeProcessingFee(totalLamports)) {
    try {
      const feeResult = await chargeProcessingFee(
        connection,
        escrowKeypair,
        TREASURY_WALLET,
        launch.id,
        totalLamports,
        (launch as any).processing_fee_tx_signature ?? null
      );
      if (feeResult.charged) {
        processingFeeLamports = feeResult.feeLamports!;
        const { error: feeUpdateErr } = await supabase
          .from("launches")
          .update({
            processing_fee_lamports: Number(processingFeeLamports),
            processing_fee_tx_signature: feeResult.signature ?? null,
          })
          .eq("id", launch.id);
        if (feeUpdateErr) {
          WARN(
            `Processing fee tx ${feeResult.signature} succeeded but failed to persist: ${feeUpdateErr.message}`
          );
        }
      }
    } catch (feeErr: any) {
      const msg = `Processing fee transfer failed: ${feeErr?.message ?? feeErr}`;
      ERR(msg);
      await setFailed(launch.id, msg);
      return;
    }
  }

  // ---- Submit via Connection.sendRawTransaction ----
  let txSignature: string;
  try {
    txSignature = await connection.sendRawTransaction(signedBytes, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });
  } catch (sendErr: any) {
    const msg = `sendRawTransaction failed: ${sendErr?.message ?? sendErr}`;
    ERR(msg);
    await setFailed(launch.id, msg);
    return;
  }

  LOG(`Submitted: ${txSignature}`);
  LOG(`Solscan: https://solscan.io/tx/${txSignature}`);

  await setLaunched(launch.id, txSignature);
  LOG(`Launch ${launch.id} complete`);
}

// Verify metadata URL + nested image URL are both 200 before handing off
// to PumpPortal. Returns quickly on success; retries up to ~12s before
// giving up.
async function verifyMetadataReachable(
  url: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!url || !/^https?:\/\//.test(url)) {
    return { ok: false, reason: `invalid metadata url: ${url}` };
  }
  const deadline = Date.now() + 32_000;
  let lastReason = "no attempts";
  let attempt = 0;
  while (Date.now() < deadline && attempt < 4) {
    attempt++;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8_000);
      const res = await fetch(url, { method: "GET", signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) {
        lastReason = `metadata GET ${res.status}`;
      } else {
        const text = await res.text();
        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          lastReason = "metadata not valid JSON";
          await new Promise((r) => setTimeout(r, 2_000));
          continue;
        }
        const imageUrl: string | undefined = json?.image;
        if (!imageUrl || !/^https?:\/\//.test(imageUrl)) {
          return { ok: true };
        }
        try {
          const ictrl = new AbortController();
          const it = setTimeout(() => ictrl.abort(), 8_000);
          const imgRes = await fetch(imageUrl, { method: "GET", signal: ictrl.signal });
          clearTimeout(it);
          await imgRes.arrayBuffer().catch(() => undefined);
          if (imgRes.ok) return { ok: true };
          lastReason = `image GET ${imgRes.status}`;
        } catch (e: any) {
          lastReason = `image fetch threw: ${e?.message ?? e}`;
        }
      }
    } catch (e: any) {
      lastReason = `metadata fetch threw: ${e?.message ?? e}`;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return { ok: false, reason: `${lastReason} (after ${attempt} attempts)` };
}
