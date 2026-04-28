import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  BagsSDK,
  BAGS_FEE_SHARE_V2_MAX_CLAIMERS_NON_LUT,
  BAGS_FEE_SHARE_V2_PROGRAM_ID,
  WRAPPED_SOL_MINT,
  waitForSlotsToPass,
  signAndSendTransaction,
  sendBundleAndConfirm,
  createTipTransaction,
} from "@bagsfm/bags-sdk";
import { decryptEscrowKey } from "./decrypt";
import fetch from "node-fetch";
import {
  Launch,
  Contribution,
  supabase,
  setFailed,
  setFailedNoRefund,
  setLaunched,
  storeFeeShareConfig,
} from "./db";
import {
  shouldChargeProcessingFee,
  chargeProcessingFee,
} from "./processingFee";

const BAGS_API_KEY = process.env.BAGS_API_KEY!;
const BAGS_PARTNER_WALLET = process.env.BAGS_PARTNER_WALLET!;
const BAGS_PARTNER_CONFIG = process.env.BAGS_PARTNER_CONFIG!;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;

// Bags fee-share v2 program is re-exported from the SDK (resolved from the
// IDL). We use it together with the WSOL quote mint to derive the
// fee_share_config PDA as a final fallback when the Bags API tells us a
// config exists but does not surface its key.
const BAGS_API_BASE_URL = "https://public-api-v2.bags.fm/api/v1";
const BAGS_DEFAULT_CONFIG_TYPE = "fa29606e-5e48-4c37-827f-4b03d58ee23d";

// HTTP-polling confirmation tunables. Mirrors the proven pattern in
// pumpportalCustodial.ts. We deliberately avoid the Bags SDK's
// `signAndSendTransaction` (and web3's `confirmTransaction`) because both
// rely on `signatureSubscribe` over WebSocket. Our Railway RPC endpoint
// returns -32601 ("Method 'signatureSubscribe' not found"), so confirmations
// silently fall through and the SDK throws opaque errors. HTTP polling via
// `getSignatureStatuses` is supported on every RPC tier and is idempotent.
const BAGS_POLL_INTERVAL_MS = 2_000;
const BAGS_REBROADCAST_EVERY_MS = 5_000;
const BAGS_PER_ATTEMPT_TIMEOUT_MS = 90_000;
const BAGS_MAX_BLOCKHASH_REFRESH_ATTEMPTS = 3;

function isNonZeroSignature(sig: Uint8Array): boolean {
  return sig.some((byte) => byte !== 0);
}

// ---------------------------------------------------------------------------
// Metadata URL handling
//
// Per the official Bags example
// (https://docs.bags.fm/how-to-guides/launch-token), the value returned by
// `sdk.tokenLaunch.createTokenInfoAndMetadata()` as `tokenMetadata` MUST be
// passed back verbatim to `createLaunchTransaction({ metadataUrl })`. Bags'
// backend validates against the URL it pinned to; rewriting it to another
// gateway causes opaque 500s.
// ---------------------------------------------------------------------------

function logTransactionSignatureState(
  tx: VersionedTransaction,
  signer: PublicKey,
  label: string,
): void {
  const requiredSigners = tx.message.header.numRequiredSignatures;
  const existingSignatures = tx.signatures.filter(isNonZeroSignature).length;
  const staticAccountKeys: PublicKey[] =
    (tx.message as any).staticAccountKeys ?? (tx.message as any).accountKeys ?? [];
  const signerIndex = staticAccountKeys
    .slice(0, requiredSigners)
    .findIndex((key) => key.equals(signer));
  const signerHasSignature =
    signerIndex >= 0 && isNonZeroSignature(tx.signatures[signerIndex]);

  console.log(
    `[${label}] signatures ${existingSignatures}/${requiredSigners}; escrowRequired=${
      signerIndex >= 0
    }; escrowSigned=${signerHasSignature}`,
  );
}

async function describeSolanaSendError(
  err: any,
  connection: Connection,
): Promise<string> {
  const parts = [err?.message ?? String(err)];
  const logs = err?.logs;
  if (Array.isArray(logs) && logs.length > 0) {
    parts.push(`logs=${JSON.stringify(logs)}`);
  } else if (typeof err?.getLogs === "function") {
    try {
      const fetchedLogs = await err.getLogs(connection);
      if (Array.isArray(fetchedLogs) && fetchedLogs.length > 0) {
        parts.push(`logs=${JSON.stringify(fetchedLogs)}`);
      }
    } catch {
      /* logs unavailable */
    }
  }
  if (err?.code) parts.push(`code=${err.code}`);
  return parts.join(" | ").slice(0, 1500);
}

/**
 * Sign + send + HTTP-confirm a transaction we fully own/build locally.
 * - Re-signs with a fresh recent blockhash on each attempt so we don't get
 *   stuck on `block height exceeded` after a slow leader.
 * - Polls `getSignatureStatuses` and rebroadcasts the same signed bytes
 *   periodically; Solana de-dupes so it costs us nothing extra.
 * - Throws on permanent on-chain errors instead of retrying.
 *
 * Do NOT use this for transactions returned by Bags. Those may include
 * Bags/program-side signatures tied to the original message + blockhash.
 */
async function sendVersionedTransactionWithHttpConfirm(
  connection: Connection,
  tx: VersionedTransaction,
  signer: Keypair,
  label: string,
): Promise<string> {
  let lastSignature: string | null = null;
  let lastErr: any = null;

  for (
    let attempt = 1;
    attempt <= BAGS_MAX_BLOCKHASH_REFRESH_ATTEMPTS;
    attempt++
  ) {
    // Refresh blockhash on each attempt. A VersionedTransaction's
    // signatures are tied to its message + blockhash, so we must wipe and
    // re-sign whenever we change the blockhash.
    try {
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      tx.message.recentBlockhash = blockhash;
      // Reset signatures before re-signing.
      tx.signatures = tx.signatures.map(() => new Uint8Array(64));
      tx.sign([signer]);
    } catch (refreshErr: any) {
      lastErr = refreshErr;
      console.warn(
        `[${label}] blockhash refresh attempt ${attempt} failed: ${
          refreshErr?.message ?? refreshErr
        }`,
      );
      continue;
    }

    const rawTx = tx.serialize();
    let signature: string;
    try {
      signature = await connection.sendRawTransaction(rawTx, {
        preflightCommitment: "confirmed",
        skipPreflight: false,
      });
    } catch (sendErr: any) {
      lastErr = sendErr;
      const details = await describeSolanaSendError(sendErr, connection);
      console.warn(
        `[${label}] sendRawTransaction attempt ${attempt} failed: ${details}`,
      );
      continue;
    }
    lastSignature = signature;
    console.log(`[${label}] submitted ${signature} (attempt ${attempt})`);

    const start = Date.now();
    let lastRebroadcast = start;
    while (Date.now() - start < BAGS_PER_ATTEMPT_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, BAGS_POLL_INTERVAL_MS));
      try {
        const statuses = await connection.getSignatureStatuses([signature], {
          searchTransactionHistory: false,
        });
        const status = statuses?.value?.[0];
        if (status) {
          if (status.err) {
            throw new Error(
              `tx ${signature} on-chain error: ${JSON.stringify(status.err)}`,
            );
          }
          if (
            status.confirmationStatus === "confirmed" ||
            status.confirmationStatus === "finalized"
          ) {
            return signature;
          }
        }
      } catch (pollErr: any) {
        if (/on-chain error/.test(pollErr?.message ?? "")) {
          throw pollErr;
        }
        console.warn(
          `[${label}] getSignatureStatuses transient error: ${
            pollErr?.message ?? pollErr
          }`,
        );
      }

      if (Date.now() - lastRebroadcast >= BAGS_REBROADCAST_EVERY_MS) {
        lastRebroadcast = Date.now();
        try {
          await connection.sendRawTransaction(rawTx, {
            preflightCommitment: "confirmed",
            skipPreflight: true,
          });
        } catch {
          /* leader may already have it */
        }
      }
    }

    // One final searched status check before giving up on this attempt.
    try {
      const finalStatuses = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const final = finalStatuses?.value?.[0];
      if (
        final &&
        !final.err &&
        (final.confirmationStatus === "confirmed" ||
          final.confirmationStatus === "finalized")
      ) {
        return signature;
      }
    } catch {
      /* fall through to retry */
    }

    lastErr = new Error(
      `tx ${signature} not confirmed within ${BAGS_PER_ATTEMPT_TIMEOUT_MS}ms; retrying with fresh blockhash`,
    );
    console.warn(`[${label}] ${(lastErr as Error).message}`);
  }

  throw new Error(
    `[${label}] failed after ${BAGS_MAX_BLOCKHASH_REFRESH_ATTEMPTS} blockhash-refresh attempts. Last signature: ${
      lastSignature ?? "<none>"
    }. Last error: ${lastErr?.message ?? lastErr}`,
  );
}

/**
 * Sign + send + HTTP-confirm a prebuilt transaction returned by Bags.
 *
 * Critical difference from the local sender above: we NEVER mutate the
 * message/blockhash and NEVER wipe signatures. Bags transactions can already
 * contain required signatures. Replacing the blockhash or signature array
 * invalidates them and causes `Transaction did not pass signature verification`.
 */
async function sendBagsPrebuiltTransactionWithHttpConfirm(
  connection: Connection,
  tx: VersionedTransaction,
  signer: Keypair,
  label: string,
): Promise<string> {
  logTransactionSignatureState(tx, signer.publicKey, `${label}:before-sign`);
  tx.sign([signer]);
  logTransactionSignatureState(tx, signer.publicKey, `${label}:after-sign`);

  const rawTx = tx.serialize();
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(rawTx, {
      preflightCommitment: "confirmed",
      skipPreflight: false,
    });
  } catch (sendErr: any) {
    const details = await describeSolanaSendError(sendErr, connection);
    throw new Error(`[${label}] sendRawTransaction failed: ${details}`);
  }

  console.log(`[${label}] submitted ${signature}`);

  const start = Date.now();
  let lastRebroadcast = start;
  while (Date.now() - start < BAGS_PER_ATTEMPT_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, BAGS_POLL_INTERVAL_MS));
    try {
      const statuses = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: false,
      });
      const status = statuses?.value?.[0];
      if (status) {
        if (status.err) {
          throw new Error(
            `tx ${signature} on-chain error: ${JSON.stringify(status.err)}`,
          );
        }
        if (
          status.confirmationStatus === "confirmed" ||
          status.confirmationStatus === "finalized"
        ) {
          return signature;
        }
      }
    } catch (pollErr: any) {
      if (/on-chain error/.test(pollErr?.message ?? "")) {
        throw pollErr;
      }
      console.warn(
        `[${label}] getSignatureStatuses transient error: ${
          pollErr?.message ?? pollErr
        }`,
      );
    }

    if (Date.now() - lastRebroadcast >= BAGS_REBROADCAST_EVERY_MS) {
      lastRebroadcast = Date.now();
      try {
        await connection.sendRawTransaction(rawTx, {
          preflightCommitment: "confirmed",
          skipPreflight: true,
        });
      } catch {
        /* leader may already have it */
      }
    }
  }

  try {
    const finalStatuses = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const final = finalStatuses?.value?.[0];
    if (
      final &&
      !final.err &&
      (final.confirmationStatus === "confirmed" ||
        final.confirmationStatus === "finalized")
    ) {
      return signature;
    }
  } catch {
    /* fall through */
  }

  throw new Error(
    `[${label}] tx ${signature} not confirmed within ${BAGS_PER_ATTEMPT_TIMEOUT_MS}ms; rebuild from Bags before retrying`,
  );
}

/**
 * Best-effort extractor for Bags SDK / fetch / axios-style errors so the
 * `execution_error` row stored in Postgres actually reveals the underlying
 * 4xx body instead of a generic "Request failed with status 400".
 */
function describeBagsError(err: any): string {
  if (!err) return "unknown error";
  const parts: string[] = [];
  if (err.message) parts.push(err.message);
  const resp = err.response;
  if (resp) {
    if (resp.status) parts.push(`status=${resp.status}`);
    const body = resp.data ?? resp.body;
    if (body !== undefined) {
      try {
        parts.push(
          `body=${typeof body === "string" ? body : JSON.stringify(body)}`,
        );
      } catch {
        /* ignore */
      }
    }
  }
  // Bags SDK sometimes attaches the raw fetch Response on err.cause or
  // exposes responseBody / data directly. Capture whatever we can find so
  // 5xx failures stop showing up as opaque "Request failed with status 500".
  const extraBody =
    err.responseBody ?? err.data ?? err.body ?? err.cause?.responseBody;
  if (extraBody !== undefined && !parts.some((p) => p.startsWith("body="))) {
    try {
      parts.push(
        `body=${typeof extraBody === "string" ? extraBody : JSON.stringify(extraBody)}`,
      );
    } catch {
      /* ignore */
    }
  }
  if (err.status && !parts.some((p) => p.startsWith("status="))) {
    parts.push(`status=${err.status}`);
  }
  if (err.code) parts.push(`code=${err.code}`);
  return parts.join(" | ").slice(0, 1500);
}

/**
 * Returns true when the error is *guaranteed* to be a pre-flight rejection,
 * meaning no transaction landed on-chain and no fee-share PDA was created.
 * In that case it is safe to auto-refund contributors. We deliberately keep
 * this narrow: anything ambiguous (timeout, expiry after broadcast, unknown
 * RPC error after send) must fall through to the no-refund path so we don't
 * drain the escrow on top of partial on-chain state.
 */
function isPreflightOnlyError(msg: string): boolean {
  if (!msg) return false;
  return (
    /Transaction did not pass signature verification/i.test(msg) ||
    /Simulation failed/i.test(msg) ||
    /Config already exists/i.test(msg) ||
    /Request failed with status 4\d\d/i.test(msg) ||
    /createLaunchTransaction failed/i.test(msg)
  );
}

function deriveBagsFeeShareConfigPda(baseMint: PublicKey): PublicKey {
  const programId =
    typeof BAGS_FEE_SHARE_V2_PROGRAM_ID === "string"
      ? new PublicKey(BAGS_FEE_SHARE_V2_PROGRAM_ID)
      : (BAGS_FEE_SHARE_V2_PROGRAM_ID as unknown as PublicKey);
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("fee_share_config"),
      baseMint.toBuffer(),
      WRAPPED_SOL_MINT.toBuffer(),
    ],
    programId,
  );
  return pda;
}

const CREATOR_MIN_BPS = 750;
const TOTAL_BPS = 10_000;
const MAX_CLAIMERS = 100;

/**
 * Build a deterministic fee-claimers array per the official Bags docs.
 *
 * Bags requires that the launch creator is explicitly included in the
 * `feeClaimers` array. We put the launch wallet (escrow) FIRST with at
 * least CREATOR_MIN_BPS, then distribute the remainder proportionally
 * across contributors by lamport amount. Final pass adjusts the creator's
 * BPS so the total is exactly TOTAL_BPS (10000).
 *
 * Capped at MAX_CLAIMERS entries (Bags limit). If the same wallet appears
 * as both creator and a contributor, we merge them into a single entry to
 * avoid Bags rejecting duplicate claimers.
 */
function buildFeeClaimers(
  creatorWallet: PublicKey,
  contributions: Contribution[],
): Array<{ user: PublicKey; userBps: number }> {
  // Reserve slot 0 for the creator. Cap remaining contributors so total
  // entries (creator + contributors) never exceed MAX_CLAIMERS.
  const creatorStr = creatorWallet.toBase58();
  const contributorEntries = contributions
    .filter((c) => (c.token_delivery_wallet || c.wallet_address) !== creatorStr)
    .slice(0, MAX_CLAIMERS - 1);

  const totalLamports = contributorEntries.reduce(
    (sum, c) => sum + BigInt(c.amount_lamports),
    0n,
  );
  const totalNum = Number(totalLamports);

  // If there are no other contributors, creator gets all 10000 BPS.
  if (contributorEntries.length === 0 || totalNum === 0) {
    return [{ user: creatorWallet, userBps: TOTAL_BPS }];
  }

  // Allocate (TOTAL_BPS - CREATOR_MIN_BPS) proportionally across contributors.
  const distributable = TOTAL_BPS - CREATOR_MIN_BPS;
  const contributorBps = contributorEntries.map((c) =>
    Math.floor((Number(BigInt(c.amount_lamports)) / totalNum) * distributable),
  );
  const sumContrib = contributorBps.reduce((a, b) => a + b, 0);
  const creatorBps = TOTAL_BPS - sumContrib;

  const result: Array<{ user: PublicKey; userBps: number }> = [
    { user: creatorWallet, userBps: creatorBps },
  ];
  contributorEntries.forEach((c, i) => {
    if (contributorBps[i] > 0) {
      result.push({
        user: new PublicKey(c.token_delivery_wallet || c.wallet_address),
        userBps: contributorBps[i],
      });
    }
  });

  // If rounding dropped some BPS into the creator slot only, that's fine.
  // Re-balance to ensure exact 10000 (defensive).
  const finalSum = result.reduce((s, r) => s + r.userBps, 0);
  if (finalSum !== TOTAL_BPS) {
    result[0].userBps += TOTAL_BPS - finalSum;
  }
  return result;
}

/**
 * Strict preflight validation per Bags' documented limits. Failing locally
 * with a clear error is far better than getting a Bags 500 with no body.
 */
function validateBagsMetadata(launch: Launch): string | null {
  const name = launch.token_name?.trim() ?? "";
  const symbol = launch.token_symbol?.trim() ?? "";
  const description = launch.description?.trim() ?? "";
  if (!name || name.length > 32) return `Invalid name length (${name.length}); must be 1..32`;
  if (!symbol || symbol.length > 10) return `Invalid symbol length (${symbol.length}); must be 1..10`;
  if (description.length > 1000) return `Description too long (${description.length}); max 1000`;
  if (!launch.image_url) return `Missing image_url`;
  return null;
}

export async function executeBagsLaunch(
  launch: Launch,
  contributions: Contribution[],
): Promise<void> {
  console.log(`Executing Bags launch ${launch.id} (${launch.token_name})`);

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  // Per Bags official docs: instantiate the SDK with "processed" commitment.
  // The SDK helpers (signAndSendTransaction / sendBundleAndConfirm) use this
  // for their internal confirmation polling.
  const sdk = new BagsSDK(BAGS_API_KEY, connection, "processed");
  const commitment = sdk.state.getCommitment();

  // Strict local preflight before we ever talk to Bags.
  const validationErr = validateBagsMetadata(launch);
  if (validationErr) {
    await setFailed(launch.id, `Bags metadata validation failed: ${validationErr}`);
    return;
  }

  // Decrypt escrow keypair
  const escrowSecret = decryptEscrowKey(
    launch.escrow_wallet_encrypted_private_key,
  );
  const escrowKeypair = Keypair.fromSecretKey(new Uint8Array(escrowSecret));
  const escrowPubkey = escrowKeypair.publicKey;

  // STEP 0: Always get a fresh mint reservation. Bags' reservation has a TTL
  // and stale ones cause launch failures on the retry path.
  console.log("Step 0: createTokenInfoAndMetadata for fresh mint");
  let tokenInfo;
  try {
    tokenInfo = await sdk.tokenLaunch.createTokenInfoAndMetadata({
      name: launch.token_name,
      symbol: launch.token_symbol.toUpperCase(),
      description: launch.description || "",
      imageUrl: launch.image_url || "",
      twitter: launch.twitter_url || undefined,
      telegram: launch.telegram_url || undefined,
      website: launch.website_url || undefined,
    });
  } catch (err: any) {
    await setFailed(launch.id, `createTokenInfoAndMetadata failed: ${err.message}`);
    return;
  }

  const tokenMint = new PublicKey(tokenInfo.tokenMint);
  // Log the full tokenInfo so we can see every URL/CID Bags returns. Helps
  // diagnose Step-3 500s where Bags' backend can't fetch our metadata URL.
  try {
    console.log(`tokenInfo keys: ${JSON.stringify(Object.keys(tokenInfo))}`);
    console.log(`tokenInfo full: ${JSON.stringify(tokenInfo)}`);
  } catch {
    // ignore stringify errors
  }
  // Per Bags docs: pass `tokenMetadata` back verbatim. Do not rewrite.
  const ipfsMetadataUrl: string = tokenInfo?.tokenMetadata ?? "";
  console.log(`Fresh tokenMint: ${tokenMint.toBase58()}`);
  console.log(`Fresh metadataUrl: ${ipfsMetadataUrl}`);

  // Persist fresh mint + IPFS. Only clear `fee_share_config_key` if the mint
  // actually changed — otherwise we'd lose a key from a prior partial run
  // and trip Bags' "Config already exists" guard on retry.
  const mintChanged =
    !launch.token_mint_address ||
    launch.token_mint_address !== tokenMint.toBase58();
  const updatePayload: Record<string, unknown> = {
    token_mint_address: tokenMint.toBase58(),
    ipfs_metadata_url: ipfsMetadataUrl,
  };
  if (mintChanged) {
    updatePayload.fee_share_config_key = null;
    updatePayload.claimer_count = null;
  }
  const { error: updateErr } = await supabase
    .from("launches")
    .update(updatePayload)
    .eq("id", launch.id);
  if (updateErr) {
    await setFailed(
      launch.id,
      `Failed to persist fresh mint/IPFS: ${updateErr.message}`,
    );
    return;
  }
  if (mintChanged) {
    launch.fee_share_config_key = null;
    launch.claimer_count = null;
  }

  // Compute net buy lamports (subtract reserves for ATAs, lookup table, fees)
  const totalLamports = contributions.reduce(
    (sum, c) => sum + BigInt(c.amount_lamports),
    0n,
  );

  // Charge hidden processing fee BEFORE reserve math when total raised
  // meets the threshold. Funds go from escrow → platform treasury.
  // Fee-claimer BPS (below) still uses original contribution amounts so
  // contributors are not penalized in their fee-share allocation.
  let processingFeeLamports = 0n;
  if (shouldChargeProcessingFee(totalLamports)) {
    try {
      const feeResult = await chargeProcessingFee(
        connection,
        escrowKeypair,
        BAGS_PARTNER_WALLET,
        launch.id,
        (launch as any).processing_fee_tx_signature ?? null,
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
          console.warn(
            `Processing fee tx ${feeResult.signature} succeeded but failed to persist on launch row: ${feeUpdateErr.message}`,
          );
        }
      }
    } catch (feeErr: any) {
      await setFailed(
        launch.id,
        `Processing fee transfer failed: ${feeErr?.message ?? feeErr}`,
      );
      return;
    }
  }

  // SOL available for the actual launch buy after the processing fee debit.
  const availableLamports = totalLamports - processingFeeLamports;

  const ATA_COST = 2_039_280n;
  const TX_FEE = 5_000n;
  const PRIORITY_FEE_PER_CONTRIBUTOR = 10_000n;
  const BASE_TX_FEES = 20_000n;
  const LOOKUP_TABLE_RENT = 2_550_000n;
  const contributorCount = BigInt(contributions.length);
  const ataReserve =
    contributorCount * (ATA_COST + TX_FEE + PRIORITY_FEE_PER_CONTRIBUTOR);
  const lookupTableReserve = contributorCount > 15n ? LOOKUP_TABLE_RENT : 0n;
  const netBuyLamports =
    availableLamports - ataReserve - lookupTableReserve - BASE_TX_FEES;

  if (netBuyLamports < 10_000_000n) {
    await setFailed(
      launch.id,
      `Insufficient SOL. Total: ${totalLamports}, Processing fee: ${processingFeeLamports}, Available: ${availableLamports}, Reserve: ${
        ataReserve + lookupTableReserve + BASE_TX_FEES
      }, Net: ${netBuyLamports}`,
    );
    return;
  }

  // Build fee claimers (deterministic BPS summing to exactly 10000).
  // Per Bags docs the launch wallet (creator) is included explicitly first.
  const feeClaimers = buildFeeClaimers(escrowPubkey, contributions);
  const bpsSum = feeClaimers.reduce((s, c) => s + c.userBps, 0);
  console.log(
    `Built ${feeClaimers.length} fee claimers; BPS sum = ${bpsSum} (must be ${TOTAL_BPS})`,
  );
  if (bpsSum !== TOTAL_BPS) {
    await setFailed(
      launch.id,
      `Fee claimers BPS sum ${bpsSum} !== ${TOTAL_BPS}`,
    );
    return;
  }

  // STEP 1: If >15 claimers, create a Lookup Table first
  let additionalLookupTables: PublicKey[] | undefined;
  if (feeClaimers.length > BAGS_FEE_SHARE_V2_MAX_CLAIMERS_NON_LUT) {
    console.log(
      `Step 1a: ${feeClaimers.length} claimers exceeds ${BAGS_FEE_SHARE_V2_MAX_CLAIMERS_NON_LUT} — creating Lookup Tables`,
    );
    let lutResult;
    try {
      lutResult = await sdk.config.getConfigCreationLookupTableTransactions({
        payer: escrowPubkey,
        baseMint: tokenMint,
        feeClaimers,
      } as any);
    } catch (err: any) {
      await setFailed(launch.id, `LUT create-tx fetch failed: ${err.message}`);
      return;
    }

    if (!lutResult) {
      await setFailed(launch.id, "LUT result was null");
      return;
    }

    try {
      // Create the LUT first
      const createSig = await sendVersionedTransactionWithHttpConfirm(
        connection,
        lutResult.creationTransaction,
        escrowKeypair,
        "lut-create",
      );
      console.log(`LUT created: ${createSig}`);

      // Solana requires LUT to be created in a previous slot before extending
      console.log("Waiting one slot before extending LUT...");
      await waitForSlotsToPass(connection, commitment, 1);

      // Extend with claimer addresses
      for (let i = 0; i < lutResult.extendTransactions.length; i++) {
        const sig = await sendVersionedTransactionWithHttpConfirm(
          connection,
          lutResult.extendTransactions[i],
          escrowKeypair,
          `lut-extend-${i + 1}`,
        );
        console.log(
          `LUT extend ${i + 1}/${lutResult.extendTransactions.length}: ${sig}`,
        );
      }
      additionalLookupTables = lutResult.lutAddresses;
    } catch (err: any) {
      await setFailed(launch.id, `LUT setup failed: ${err.message}`);
      return;
    }
  }

  // STEP 2: Create fee-share config (handle bundles vs single transactions)
  console.log("Step 2: createBagsFeeShareConfig");
  let configKeyStr: string | undefined;
  if (launch.fee_share_config_key) {
    console.log(
      `Reusing existing fee_share_config_key from previous attempt: ${launch.fee_share_config_key}`,
    );
    configKeyStr = launch.fee_share_config_key;
  } else {
    // We bypass sdk.config.createBagsFeeShareConfig() here and call the Bags
    // REST API directly. The SDK throws a generic `Error('Config already
    // exists')` when needsCreation=false and discards the meteoraConfigKey,
    // so it's impossible to recover the existing key through the SDK.
    // Calling the REST endpoint ourselves lets us:
    //   - get the existing meteoraConfigKey when needsCreation=false
    //   - decode/sign/send the returned txs/bundles when needsCreation=true
    //   - fall back to the deterministic PDA if Bags returns a malformed body
    const MAX_FEESHARE_ATTEMPTS = 3;
    const isExpiryError = (msg: string) =>
      /block height exceeded|blockhash not found|TransactionExpiredBlockheightExceededError|expired/i.test(
        msg,
      ) || /not confirmed within/i.test(msg);

    const restBody = {
      payer: escrowPubkey.toBase58(),
      baseMint: tokenMint.toBase58(),
      claimersArray: feeClaimers.map((c) => c.user.toBase58()),
      basisPointsArray: feeClaimers.map((c) => c.userBps),
      partner: BAGS_PARTNER_WALLET,
      partnerConfig: BAGS_PARTNER_CONFIG,
      additionalLookupTables: additionalLookupTables?.map((lut) => lut.toBase58()),
      bagsConfigType: BAGS_DEFAULT_CONFIG_TYPE,
    };

    let lastErr: any = null;
    let submitted = false;

    for (let attempt = 1; attempt <= MAX_FEESHARE_ATTEMPTS; attempt++) {
      let restJson: any;
      try {
        const resp = await fetch(`${BAGS_API_BASE_URL}/fee-share/config`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": BAGS_API_KEY,
          },
          body: JSON.stringify(restBody),
        });
        const text = await resp.text();
        try {
          restJson = JSON.parse(text);
        } catch {
          await setFailed(
            launch.id,
            `Bags fee-share/config returned non-JSON (status ${resp.status}): ${text.slice(0, 500)}`,
          );
          return;
        }
        if (!resp.ok || restJson?.success === false) {
          const apiErrMsg =
            restJson?.error ??
            restJson?.message ??
            `HTTP ${resp.status}`;
          // Build-time API errors are not retryable (auth, schema, partner config…).
          await setFailed(
            launch.id,
            `Bags fee-share/config API error: ${apiErrMsg}`,
          );
          return;
        }
      } catch (err: any) {
        await setFailed(
          launch.id,
          `Bags fee-share/config fetch failed: ${err?.message ?? String(err)}`,
        );
        return;
      }

      const responseBody = restJson?.response ?? restJson;
      const needsCreation: boolean = responseBody?.needsCreation === true;
      let candidateKey: string | undefined =
        responseBody?.meteoraConfigKey ?? undefined;

      console.log(
        `Fee-share attempt ${attempt}/${MAX_FEESHARE_ATTEMPTS}: needsCreation=${needsCreation} key=${
          candidateKey ?? "<missing>"
        } txs=${responseBody?.transactions?.length ?? 0} bundles=${responseBody?.bundles?.length ?? 0}`,
      );

      // Fast path: config already on-chain. No SOL spent by us. Reuse the key
      // and continue to the launch tx step. This is the primary fix for
      // "Config already exists" failures on retried launches.
      if (!needsCreation) {
        if (!candidateKey) {
          // Final fallback: derive the deterministic PDA and verify it exists.
          try {
            const derived = deriveBagsFeeShareConfigPda(tokenMint);
            const acc = await connection.getAccountInfo(derived, "confirmed");
            if (acc) {
              candidateKey = derived.toBase58();
              console.log(
                `Recovered fee_share_config via PDA derivation: ${candidateKey}`,
              );
            }
          } catch (deriveErr: any) {
            console.warn(
              `PDA derivation fallback failed: ${deriveErr?.message ?? deriveErr}`,
            );
          }
        }
        if (!candidateKey) {
          // No on-chain SOL was spent by this attempt, so refunding is safe.
          await setFailed(
            launch.id,
            `Bags says fee-share config already exists but did not return meteoraConfigKey and PDA derivation could not confirm it on-chain. Mint ${tokenMint.toBase58()}.`,
          );
          return;
        }
        configKeyStr = candidateKey;
        await storeFeeShareConfig(launch.id, configKeyStr, feeClaimers.length);
        submitted = true;
        break;
      }

      // needsCreation=true: decode txs/bundles and submit on-chain.
      let txs: VersionedTransaction[] = [];
      let bundles: VersionedTransaction[][] = [];
      try {
        const bs58Mod: any = await import("bs58");
        const bs58 = bs58Mod.default ?? bs58Mod;
        txs = (responseBody?.transactions ?? []).map((t: any) =>
          VersionedTransaction.deserialize(bs58.decode(t.transaction)),
        );
        bundles = (responseBody?.bundles ?? []).map((bundle: any[]) =>
          bundle.map((t: any) =>
            VersionedTransaction.deserialize(bs58.decode(t.transaction)),
          ),
        );
      } catch (decErr: any) {
        await setFailed(
          launch.id,
          `Failed to decode Bags fee-share txs: ${decErr?.message ?? decErr}`,
        );
        return;
      }

      if (!candidateKey) {
        // Defensive: still try to derive even on the create path so we don't
        // submit on-chain work without a key to persist.
        try {
          candidateKey = deriveBagsFeeShareConfigPda(tokenMint).toBase58();
        } catch {
          await setFailed(
            launch.id,
            `Bags response missing meteoraConfigKey on creation path; refusing to submit txs.`,
          );
          return;
        }
      }

      try {
        for (let bIdx = 0; bIdx < bundles.length; bIdx++) {
          const bundle = bundles[bIdx];
          console.log(
            `Sending Bags bundle ${bIdx + 1}/${bundles.length} (${bundle.length} txs) via HTTP polling`,
          );
          for (let txIdx = 0; txIdx < bundle.length; txIdx++) {
            const sig = await sendBagsPrebuiltTransactionWithHttpConfirm(
              connection,
              bundle[txIdx],
              escrowKeypair,
              `fee-share-bundle-${bIdx + 1}-tx-${txIdx + 1}`,
            );
            console.log(
              `Bundle ${bIdx + 1} tx ${txIdx + 1}/${bundle.length}: ${sig}`,
            );
          }
        }

        for (let i = 0; i < txs.length; i++) {
          const sig = await sendBagsPrebuiltTransactionWithHttpConfirm(
            connection,
            txs[i],
            escrowKeypair,
            `fee-share-tx-${i + 1}`,
          );
          console.log(`Fee-share tx ${i + 1}/${txs.length}: ${sig}`);
        }

        configKeyStr = candidateKey;
        await storeFeeShareConfig(launch.id, configKeyStr, feeClaimers.length);
        submitted = true;
        break;
      } catch (err: any) {
        lastErr = err;
        const msg = err?.message ?? String(err);
        if (isExpiryError(msg) && attempt < MAX_FEESHARE_ATTEMPTS) {
          console.warn(
            `Fee-share submission expired on attempt ${attempt} (${msg}). Rebuilding with fresh blockhash...`,
          );
          continue;
        }
        // Pre-flight rejections (signature verification, simulation
        // failure, Bags 4xx) never land on-chain — safe to auto-refund.
        // Anything else may have partially landed, so keep the escrow
        // intact for manual review / retry.
        if (isPreflightOnlyError(msg)) {
          await setFailed(
            launch.id,
            `Fee-share tx rejected pre-flight (no on-chain state, contributors will be auto-refunded): ${msg}`,
          );
        } else {
          await setFailedNoRefund(
            launch.id,
            `Fee-share submission failed (escrow may hold partial on-chain state — manual review): ${msg}`,
          );
        }
        return;
      }
    }

    if (!submitted || !configKeyStr) {
      const msg = lastErr?.message ?? String(lastErr);
      if (isPreflightOnlyError(msg)) {
        await setFailed(
          launch.id,
          `Fee-share rejected pre-flight after ${MAX_FEESHARE_ATTEMPTS} attempts (no on-chain state, auto-refunding): ${msg}`,
        );
      } else {
        await setFailedNoRefund(
          launch.id,
          `Fee-share submission failed after ${MAX_FEESHARE_ATTEMPTS} attempts: ${msg}`,
        );
      }
      return;
    }
  }

  // Wait for Bags' off-chain indexer to catch up to the on-chain fee-share
  // config. Even when the PDA exists immediately, Bags' API will return 500
  // until its indexer sees the account, so we both sleep AND verify.
  console.log("Waiting 25s for Bags indexer to see fee-share config...");
  await new Promise((r) => setTimeout(r, 25_000));

  // Belt-and-braces: confirm the fee_share_config PDA actually exists on
  // mainnet before we hammer Bags. If the RPC can't see it, the API
  // certainly can't either.
  try {
    const configPubkey = new PublicKey(configKeyStr);
    const cfgAcc = await connection.getAccountInfo(configPubkey, "confirmed");
    if (!cfgAcc) {
      console.warn(
        `fee_share_config ${configKeyStr} not visible to RPC after wait; proceeding anyway`,
      );
    } else {
      console.log(
        `fee_share_config ${configKeyStr} confirmed on-chain (${cfgAcc.data.length} bytes)`,
      );
    }
  } catch (verifyErr: any) {
    console.warn(
      `fee_share_config verification failed: ${verifyErr?.message ?? verifyErr}`,
    );
  }

  // STEP 3: createLaunchTransaction
  console.log(
    `Step 3: createLaunchTransaction (mint=${tokenMint.toBase58()} configKey=${configKeyStr} netBuyLamports=${netBuyLamports.toString()} claimers=${feeClaimers.length})`,
  );
  let launchTx!: VersionedTransaction;
  // createLaunchTransaction is a build-only HTTP call (no broadcast). Per
  // Bags docs we pass `tokenInfo.tokenMetadata` verbatim and treat 5xx as
  // terminal — retrying an identical payload against the same backend
  // doesn't help. We keep a tiny safety net for genuine transport blips
  // (network / 429 / 503).
  {
    const MAX_LAUNCH_TX_ATTEMPTS = 3;
    const ATTEMPT_BACKOFFS_MS = [5_000, 15_000];
    const isTransientBagsError = (err: any, msg: string): boolean => {
      const status = err?.response?.status ?? err?.status;
      // 500 is terminal — Bags either rejected the payload or is genuinely
      // broken; either way retrying is useless and just burns the worker
      // lock. Only retry on rate-limit / temporary unavailability.
      if (typeof status === "number" && (status === 429 || status === 503)) {
        return true;
      }
      if (typeof status === "number" && status >= 400) {
        return false;
      }
      return /status\s*429|status\s*503|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up/i.test(
        msg,
      );
    };

    let lastLaunchErr: any = null;
    let built = false;
    for (let attempt = 1; attempt <= MAX_LAUNCH_TX_ATTEMPTS; attempt++) {
      console.log(
        `Step 3 payload (attempt ${attempt}): ${JSON.stringify({
          metadataUrl: ipfsMetadataUrl,
          tokenMint: tokenMint.toBase58(),
          launchWallet: escrowPubkey.toBase58(),
          initialBuyLamports: Number(netBuyLamports),
          configKey: configKeyStr,
          claimerCount: feeClaimers.length,
        })}`,
      );
      try {
        launchTx = await sdk.tokenLaunch.createLaunchTransaction({
          metadataUrl: ipfsMetadataUrl,
          tokenMint,
          launchWallet: escrowPubkey,
          initialBuyLamports: Number(netBuyLamports),
          configKey: new PublicKey(configKeyStr),
        });
        built = true;
        break;
      } catch (err: any) {
        lastLaunchErr = err;
        const msg = describeBagsError(err);
        const transient = isTransientBagsError(err, msg);
        if (
          attempt < MAX_LAUNCH_TX_ATTEMPTS &&
          transient
        ) {
          const backoffMs =
            ATTEMPT_BACKOFFS_MS[attempt - 1] ?? 15_000;
          console.warn(
            `createLaunchTransaction transient failure on attempt ${attempt}/${MAX_LAUNCH_TX_ATTEMPTS} (${msg}); retrying in ${backoffMs}ms`,
          );
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        // No on-chain launch tx was ever broadcast at this point, so
        // contributor SOL is still in escrow. Auto-refund regardless of
        // error class — keeping funds locked never helps and the fee-share
        // config PDA stays on-chain harmlessly.
        const reason = `createLaunchTransaction failed after ${attempt} attempt(s) (configKey=${configKeyStr}, retry can reuse config): ${msg}`;
        await setFailed(launch.id, reason);
        return;
      }
    }
    if (!built) {
      const reason = `createLaunchTransaction exhausted ${MAX_LAUNCH_TX_ATTEMPTS} attempts (configKey=${configKeyStr}): ${describeBagsError(lastLaunchErr)}`;
      await setFailed(launch.id, reason);
      return;
    }
  }

  // STEP 4: sign + send launch tx
  console.log("Step 4: sign + send launch tx");
  try {
    const sig = await sendBagsPrebuiltTransactionWithHttpConfirm(
      connection,
      launchTx,
      escrowKeypair,
      "bags-launch-tx",
    );
    console.log(`Bags launch confirmed: ${sig}`);
    console.log(`Solscan: https://solscan.io/tx/${sig}`);
    await setLaunched(launch.id);
  } catch (err: any) {
    const msg = describeBagsError(err);
    // Pre-flight rejection on the final launch tx never lands the mint
    // on-chain, so contributor SOL was never spent into a bonding curve —
    // safe to refund. Timeouts/expiry after broadcast stay no-refund
    // because the mint may have actually landed.
    if (isPreflightOnlyError(msg)) {
      await setFailed(
        launch.id,
        `Launch tx rejected pre-flight (configKey=${configKeyStr}, no mint on-chain, auto-refunding): ${msg}`,
      );
    } else {
      await setFailedNoRefund(
        launch.id,
        `Launch tx failed (configKey=${configKeyStr}): ${msg}`,
      );
    }
  }
}
