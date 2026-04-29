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
  sendBundleAndConfirm,
  createTipTransaction,
} from "@bagsfm/bags-sdk";
import { decryptEscrowKey } from "./decrypt";
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
// Optional explicit WebSocket endpoint. The Bags SDK uses
// connection.confirmTransaction internally (e.g. inside
// sendBundleAndConfirm), which calls signatureSubscribe over WS. Many
// providers (notably Alchemy's standard Solana tier) do NOT serve
// signatureSubscribe — point this at Helius/Triton/QuickNode if you see
// "Method 'signatureSubscribe' not found" warnings. Falls back to
// SOLANA_RPC_URL with https->wss scheme swap.
const SOLANA_WSS_URL =
  process.env.SOLANA_WSS_URL ||
  SOLANA_RPC_URL.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");

// Bags fee-share v2 program is re-exported from the SDK (resolved from the
// IDL). We use it together with the WSOL quote mint to derive the
// fee_share_config PDA as a final fallback when the Bags API tells us a
// config exists but does not surface its key.
const BAGS_DEFAULT_CONFIG_TYPE = "fa29606e-5e48-4c37-827f-4b03d58ee23d";

/**
 * Robust replacement for the Bags SDK `signAndSendTransaction` helper.
 *
 * The official helper does:
 *   sendTransaction(skipPreflight: true, maxRetries: 0)
 *   connection.confirmTransaction(...)
 * which uses `signatureSubscribe` over WebSocket. Our RPC tier throws
 * repeated `signatureSubscribe` errors, so confirmTransaction can report
 * a blockhash-expiry failure even after the transaction has actually
 * landed and finalized on-chain.
 *
 * This helper signs the VersionedTransaction with `keypair`, broadcasts it,
 * polls `getSignatureStatuses` over HTTP, periodically rebroadcasts, and
 * before declaring failure does a final history lookup. Returns the
 * signature on success; throws otherwise.
 */
async function sendVersionedTxWithPolling(
  connection: Connection,
  tx: VersionedTransaction,
  keypair: Keypair,
  label: string,
  opts: { timeoutMs?: number; intervalMs?: number; rebroadcastEveryMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const rebroadcastEveryMs = opts.rebroadcastEveryMs ?? 5_000;

  tx.sign([keypair]);
  const rawTx = tx.serialize();

  const signature = await connection.sendRawTransaction(rawTx, {
    skipPreflight: true,
    maxRetries: 0,
  });
  console.log(`[${label}] submitted ${signature}`);

  const start = Date.now();
  let lastRebroadcast = start;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      const statuses = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const s = statuses?.value?.[0];
      if (s) {
        if (s.err) {
          throw new Error(
            `tx ${signature} on-chain error: ${JSON.stringify(s.err)}`,
          );
        }
        if (
          s.confirmationStatus === "confirmed" ||
          s.confirmationStatus === "finalized"
        ) {
          return signature;
        }
      }
    } catch (pollErr: any) {
      if (/on-chain error/.test(pollErr?.message ?? "")) throw pollErr;
      console.warn(
        `[${label}] getSignatureStatuses transient error: ${pollErr?.message ?? pollErr}`,
      );
    }
    if (Date.now() - lastRebroadcast >= rebroadcastEveryMs) {
      lastRebroadcast = Date.now();
      try {
        await connection.sendRawTransaction(rawTx, {
          skipPreflight: true,
          maxRetries: 0,
        });
      } catch {
        /* ignore — leader may already have it */
      }
    }
  }

  // Final history lookup — the tx may have landed in the last poll window.
  try {
    const finalStatuses = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const finalStatus = finalStatuses?.value?.[0];
    if (
      finalStatus &&
      !finalStatus.err &&
      (finalStatus.confirmationStatus === "confirmed" ||
        finalStatus.confirmationStatus === "finalized")
    ) {
      return signature;
    }
  } catch {
    /* ignore */
  }
  throw new Error(
    `[${label}] tx ${signature} not confirmed within ${timeoutMs}ms`,
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

  const connection = new Connection(SOLANA_RPC_URL, {
    commitment: "confirmed",
    wsEndpoint: SOLANA_WSS_URL,
  });
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
      // Create the LUT first (use SDK helper per docs)
      const createSig = await sendVersionedTxWithPolling(
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
        const sig = await sendVersionedTxWithPolling(
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
    // Use the official Bags SDK exactly per docs:
    //   sdk.config.createBagsFeeShareConfig({ payer, baseMint, feeClaimers,
    //     partner, partnerConfig, additionalLookupTables })
    //
    // This returns { transactions, bundles, meteoraConfigKey }. We then send
    // them with the SDK helpers `sendBundleAndConfirm` (with a Jito tip) and
    // `signAndSendTransaction`, exactly mirroring the docs.
    //
    // Recovery rule: if the SDK throws "Config already exists" we derive the
    // deterministic PDA, verify it's on-chain, and reuse it.
    let createResult: {
      transactions: VersionedTransaction[];
      bundles: VersionedTransaction[][];
      meteoraConfigKey: PublicKey;
    } | null = null;
    try {
      createResult = await sdk.config.createBagsFeeShareConfig({
        payer: escrowPubkey,
        baseMint: tokenMint,
        feeClaimers,
        partner: BAGS_PARTNER_WALLET ? new PublicKey(BAGS_PARTNER_WALLET) : undefined,
        partnerConfig: BAGS_PARTNER_CONFIG ? new PublicKey(BAGS_PARTNER_CONFIG) : undefined,
        additionalLookupTables,
        bagsConfigType: BAGS_DEFAULT_CONFIG_TYPE as any,
      });
    } catch (err: any) {
      const msg = describeBagsError(err);
      if (/already exists/i.test(msg)) {
        // Recover via deterministic PDA derivation.
        try {
          const derived = deriveBagsFeeShareConfigPda(tokenMint);
          const acc = await connection.getAccountInfo(derived, "confirmed");
          if (acc) {
            configKeyStr = derived.toBase58();
            console.log(
              `Reusing existing on-chain fee_share_config via PDA derivation: ${configKeyStr}`,
            );
            await storeFeeShareConfig(launch.id, configKeyStr, feeClaimers.length);
          } else {
            await setFailed(
              launch.id,
              `Bags reports fee-share config exists but PDA ${derived.toBase58()} not visible on-chain.`,
            );
            return;
          }
        } catch (deriveErr: any) {
          await setFailed(
            launch.id,
            `createBagsFeeShareConfig failed and PDA recovery failed: ${msg} | ${deriveErr?.message ?? deriveErr}`,
          );
          return;
        }
      } else {
        await setFailed(launch.id, `createBagsFeeShareConfig failed: ${msg}`);
        return;
      }
    }

    if (createResult && !configKeyStr) {
      const { transactions: txs, bundles, meteoraConfigKey } = createResult;
      console.log(
        `Bags fee-share build: meteoraConfigKey=${meteoraConfigKey.toBase58()} txs=${txs.length} bundles=${bundles.length}`,
      );

      // Persist the meteoraConfigKey BEFORE submitting fee-share transactions.
      // This way, if confirmation fails after the tx actually lands on-chain,
      // an admin retry has the exact config key and we don't lose the
      // recovery handle.
      const earlyConfigKey = meteoraConfigKey.toBase58();
      try {
        await storeFeeShareConfig(launch.id, earlyConfigKey, feeClaimers.length);
      } catch (persistErr: any) {
        console.warn(
          `Failed to pre-persist meteoraConfigKey ${earlyConfigKey}: ${persistErr?.message ?? persistErr}`,
        );
      }

      try {
        // 1) Submit bundles via Jito (with tip tx) per docs.
        for (let bIdx = 0; bIdx < bundles.length; bIdx++) {
          const bundle = bundles[bIdx];
          // Build a tip tx and append it to the bundle (docs pattern).
          const tipTx = await createTipTransaction(
            connection,
            commitment,
            escrowPubkey,
            10_000, // 10k lamports tip — small but reliable for non-urgent bundles
          );
          tipTx.sign([escrowKeypair]);
          // Sign each bundle tx with the escrow keypair before bundling.
          for (const tx of bundle) {
            tx.sign([escrowKeypair]);
          }
          const signedBundle = [...bundle, tipTx];
          const bundleSig = await sendBundleAndConfirm(signedBundle, sdk);
          console.log(
            `fee-share bundle ${bIdx + 1}/${bundles.length} confirmed: ${bundleSig}`,
          );
        }

        // 2) Submit standalone transactions via our HTTP-polling helper.
        // The SDK's signAndSendTransaction relies on signatureSubscribe and
        // can false-fail with "block height exceeded" even when the tx
        // actually lands on-chain.
        for (let i = 0; i < txs.length; i++) {
          const sig = await sendVersionedTxWithPolling(
            connection,
            txs[i],
            escrowKeypair,
            `fee-share-tx-${i + 1}`,
          );
          console.log(`fee-share tx ${i + 1}/${txs.length} confirmed: ${sig}`);
        }

        configKeyStr = earlyConfigKey;
      } catch (err: any) {
        const msg = describeBagsError(err);
        // Recovery: even if our submission helper threw, the on-chain
        // create_fee_config tx may have actually landed. Derive the PDA
        // and verify with RPC. If it exists, treat the step as success
        // and continue to createLaunchTransaction.
        try {
          const derived = deriveBagsFeeShareConfigPda(tokenMint);
          const acc = await connection.getAccountInfo(derived, "confirmed");
          if (acc) {
            configKeyStr = derived.toBase58();
            console.log(
              `Fee-share submission threw (${msg}) but on-chain PDA ${configKeyStr} exists — recovering and continuing.`,
            );
            await storeFeeShareConfig(launch.id, configKeyStr, feeClaimers.length);
            // Fall through to STEP 3 (createLaunchTransaction).
          }
        } catch (recoverErr: any) {
          console.warn(
            `PDA recovery check failed: ${recoverErr?.message ?? recoverErr}`,
          );
        }
        if (configKeyStr) {
          // recovered — break out of the catch and proceed
        } else if (isPreflightOnlyError(msg)) {
          await setFailed(
            launch.id,
            `Fee-share submission rejected pre-flight (auto-refunding): ${msg}`,
          );
          return;
        } else {
          await setFailedNoRefund(
            launch.id,
            `Fee-share submission failed (escrow may hold partial state, manual review): ${msg}`,
          );
          return;
        }
      }
    }

    if (!configKeyStr) {
      await setFailed(launch.id, `Fee-share creation produced no configKey`);
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
        const fingerprint = JSON.stringify({
          mint: tokenMint.toBase58(),
          metadataUrl: ipfsMetadataUrl,
          configKey: configKeyStr,
          launchWallet: escrowPubkey.toBase58(),
          initialBuyLamports: Number(netBuyLamports),
          claimerCount: feeClaimers.length,
          bpsSum: feeClaimers.reduce((s, c) => s + c.userBps, 0),
          usedLut: !!additionalLookupTables,
        });
        const status = (lastLaunchErr?.response?.status ?? lastLaunchErr?.status) as number | undefined;
        const reason =
          typeof status === "number" && status >= 500
            ? `Bags createLaunchTransaction returned ${status} (Bags-side outage). Fee-share configKey=${configKeyStr} is reusable — retry from admin once Bags is healthy. ${msg} | fingerprint=${fingerprint}`
            : `createLaunchTransaction failed after ${attempt} attempt(s) (configKey=${configKeyStr}, retry can reuse config): ${msg} | fingerprint=${fingerprint}`;
        await setFailed(launch.id, reason);
        return;
      }
    }
    if (!built) {
      const status = (lastLaunchErr?.response?.status ?? lastLaunchErr?.status) as number | undefined;
      const baseMsg = describeBagsError(lastLaunchErr);
      const reason =
        typeof status === "number" && status >= 500
          ? `Bags createLaunchTransaction returned ${status} after ${MAX_LAUNCH_TX_ATTEMPTS} attempts (Bags-side outage). Fee-share configKey=${configKeyStr} is reusable — retry from admin once Bags is healthy. ${baseMsg}`
          : `createLaunchTransaction exhausted ${MAX_LAUNCH_TX_ATTEMPTS} attempts (configKey=${configKeyStr}): ${baseMsg}`;
      await setFailed(launch.id, reason);
      return;
    }
  }

  // STEP 4: sign + send launch tx
  console.log("Step 4: sign + send launch tx");
  try {
    // HTTP-polling helper instead of the SDK's signAndSendTransaction —
    // see comment on sendVersionedTxWithPolling for why.
    const sig = await sendVersionedTxWithPolling(
      connection,
      launchTx,
      escrowKeypair,
      "launch-tx",
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
