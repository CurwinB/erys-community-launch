import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  BagsSDK,
  BAGS_FEE_SHARE_V2_MAX_CLAIMERS_NON_LUT,
  signAndSendTransaction,
  sendBundleAndConfirm,
  waitForSlotsToPass,
} from "@bagsfm/bags-sdk";
import { decryptEscrowKey } from "./decrypt";
import {
  Launch,
  Contribution,
  supabase,
  setFailed,
  setLaunched,
  storeFeeShareConfig,
} from "./db";

const BAGS_API_KEY = process.env.BAGS_API_KEY!;
const BAGS_PARTNER_WALLET = process.env.BAGS_PARTNER_WALLET!;
const BAGS_PARTNER_CONFIG = process.env.BAGS_PARTNER_CONFIG!;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;

const CREATOR_MIN_BPS = 750;
const TOTAL_BPS = 10_000;
const MAX_CLAIMERS = 100;

/**
 * Build a deterministic fee-claimers array.
 * - First entry is the creator (contributions[0]) and gets at least CREATOR_MIN_BPS.
 * - Remaining contributors get share proportional to their lamport amount.
 * - Final pass adjusts the creator's BPS so the total is exactly TOTAL_BPS.
 * - Capped at MAX_CLAIMERS entries (Bags limit).
 */
function buildFeeClaimers(
  contributions: Contribution[],
): Array<{ user: PublicKey; userBps: number }> {
  const capped = contributions.slice(0, MAX_CLAIMERS);
  const totalLamports = capped.reduce(
    (sum, c) => sum + BigInt(c.amount_lamports),
    0n,
  );
  const totalNum = Number(totalLamports);

  // Initial proportional allocation (floored), creator gets the floor minimum
  const allocations: number[] = capped.map((c, idx) => {
    const raw = Math.floor(
      (Number(BigInt(c.amount_lamports)) / totalNum) * TOTAL_BPS,
    );
    return idx === 0 ? Math.max(CREATOR_MIN_BPS, raw) : raw;
  });

  // Adjust creator to make sum exactly TOTAL_BPS
  const sumExceptCreator = allocations
    .slice(1)
    .reduce((a, b) => a + b, 0);
  allocations[0] = TOTAL_BPS - sumExceptCreator;

  // Safety: if creator ended up below floor due to many small contributors,
  // pull from the largest non-creator until creator is at the floor.
  if (allocations[0] < CREATOR_MIN_BPS) {
    let deficit = CREATOR_MIN_BPS - allocations[0];
    // Iterate from largest contributor downward (already sorted desc by db.ts)
    for (let i = 1; i < allocations.length && deficit > 0; i++) {
      const take = Math.min(allocations[i] - 1, deficit);
      if (take > 0) {
        allocations[i] -= take;
        allocations[0] += take;
        deficit -= take;
      }
    }
  }

  return capped.map((c, idx) => ({
    user: new PublicKey(c.wallet_address),
    userBps: allocations[idx],
  }));
}

export async function executeBagsLaunch(
  launch: Launch,
  contributions: Contribution[],
): Promise<void> {
  console.log(`Executing Bags launch ${launch.id} (${launch.token_name})`);

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const sdk = new BagsSDK(BAGS_API_KEY, connection, "confirmed");
  const commitment = sdk.state.getCommitment();

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
  const ipfsMetadataUrl = tokenInfo.tokenMetadata;
  console.log(`Fresh tokenMint: ${tokenMint.toBase58()}`);
  console.log(`Fresh metadataUrl: ${ipfsMetadataUrl}`);

  // Persist fresh mint + IPFS, clear any stale fee-share config
  const { error: updateErr } = await supabase
    .from("launches")
    .update({
      token_mint_address: tokenMint.toBase58(),
      ipfs_metadata_url: ipfsMetadataUrl,
      fee_share_config_key: null,
      claimer_count: null,
    })
    .eq("id", launch.id);
  if (updateErr) {
    await setFailed(
      launch.id,
      `Failed to persist fresh mint/IPFS: ${updateErr.message}`,
    );
    return;
  }
  launch.fee_share_config_key = null;
  launch.claimer_count = null;

  // Compute net buy lamports (subtract reserves for ATAs, lookup table, fees)
  const totalLamports = contributions.reduce(
    (sum, c) => sum + BigInt(c.amount_lamports),
    0n,
  );
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
    totalLamports - ataReserve - lookupTableReserve - BASE_TX_FEES;

  if (netBuyLamports < 10_000_000n) {
    await setFailed(
      launch.id,
      `Insufficient SOL. Total: ${totalLamports}, Reserve: ${
        ataReserve + lookupTableReserve + BASE_TX_FEES
      }, Net: ${netBuyLamports}`,
    );
    return;
  }

  // Build fee claimers (deterministic BPS summing to exactly 10000)
  const feeClaimers = buildFeeClaimers(contributions);
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
        feeClaimers,
      });
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
      const createSig = await signAndSendTransaction(
        connection,
        commitment,
        lutResult.creationTransaction,
        escrowKeypair,
      );
      console.log(`LUT created: ${createSig}`);

      // Solana requires LUT to be created in a previous slot before extending
      console.log("Waiting one slot before extending LUT...");
      await waitForSlotsToPass(connection, commitment, 1);

      // Extend with claimer addresses
      for (let i = 0; i < lutResult.extendTransactions.length; i++) {
        const sig = await signAndSendTransaction(
          connection,
          commitment,
          lutResult.extendTransactions[i],
          escrowKeypair,
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
  let configKeyStr: string;
  if (launch.fee_share_config_key) {
    console.log(
      `Reusing existing fee_share_config_key from previous attempt: ${launch.fee_share_config_key}`,
    );
    configKeyStr = launch.fee_share_config_key;
  } else {
    let cfgResult;
    try {
      cfgResult = await sdk.config.createBagsFeeShareConfig({
        feeClaimers,
        payer: escrowPubkey,
        baseMint: tokenMint,
        partner: new PublicKey(BAGS_PARTNER_WALLET),
        partnerConfig: new PublicKey(BAGS_PARTNER_CONFIG),
        additionalLookupTables,
      });
    } catch (err: any) {
      await setFailed(
        launch.id,
        `createBagsFeeShareConfig failed: ${err.message}`,
      );
      return;
    }

    console.log(
      `Fee-share config: ${cfgResult.transactions.length} txs, ${cfgResult.bundles.length} bundles`,
    );
    configKeyStr = cfgResult.meteoraConfigKey.toBase58();

    // Send bundles atomically via Jito (each bundle is signed and sent together)
    try {
      for (let bIdx = 0; bIdx < cfgResult.bundles.length; bIdx++) {
        const bundle = cfgResult.bundles[bIdx];
        const signed: VersionedTransaction[] = bundle.map((tx) => {
          tx.sign([escrowKeypair]);
          return tx;
        });
        console.log(
          `Sending Jito bundle ${bIdx + 1}/${cfgResult.bundles.length} (${signed.length} txs)`,
        );
        const sig = await sendBundleAndConfirm(signed, sdk);
        console.log(`Bundle ${bIdx + 1} confirmed: ${sig}`);
      }

      // Send any non-bundled transactions sequentially
      for (let i = 0; i < cfgResult.transactions.length; i++) {
        const sig = await signAndSendTransaction(
          connection,
          commitment,
          cfgResult.transactions[i],
          escrowKeypair,
        );
        console.log(
          `Fee-share tx ${i + 1}/${cfgResult.transactions.length}: ${sig}`,
        );
      }
    } catch (err: any) {
      await setFailed(launch.id, `Fee-share submission failed: ${err.message}`);
      return;
    }

    await storeFeeShareConfig(launch.id, configKeyStr, feeClaimers.length);
  }

  // Wait for Bags to index the fee-share config on-chain
  console.log("Waiting 10s for fee-share config to settle on-chain...");
  await new Promise((r) => setTimeout(r, 10_000));

  // STEP 3: createLaunchTransaction
  console.log("Step 3: createLaunchTransaction");
  let launchTx: VersionedTransaction;
  try {
    launchTx = await sdk.tokenLaunch.createLaunchTransaction({
      metadataUrl: ipfsMetadataUrl,
      tokenMint,
      launchWallet: escrowPubkey,
      initialBuyLamports: Number(netBuyLamports),
      configKey: new PublicKey(configKeyStr),
    });
  } catch (err: any) {
    await setFailed(
      launch.id,
      `createLaunchTransaction failed: ${err.message}`,
    );
    return;
  }

  // STEP 4: sign + send launch tx
  console.log("Step 4: sign + send launch tx");
  try {
    const sig = await signAndSendTransaction(
      connection,
      commitment,
      launchTx,
      escrowKeypair,
    );
    console.log(`Bags launch confirmed: ${sig}`);
    console.log(`Solscan: https://solscan.io/tx/${sig}`);
    await setLaunched(launch.id);
  } catch (err: any) {
    await setFailed(launch.id, `Launch tx failed: ${err.message}`);
  }
}
