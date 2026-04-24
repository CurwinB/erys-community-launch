import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import fetch from "node-fetch";
import { decryptEscrowKey } from "./decrypt";
import {
  Launch,
  Contribution,
  supabase,
  setFailed,
  setLaunched,
  storeFeeShareConfig,
} from "./db";

const BAGS_API_BASE = "https://public-api-v2.bags.fm/api/v1";
const BAGS_API_KEY = process.env.BAGS_API_KEY!;
const BAGS_PARTNER_WALLET = process.env.BAGS_PARTNER_WALLET!;
const BAGS_PARTNER_CONFIG = process.env.BAGS_PARTNER_CONFIG!;

async function signAndSendToBags(
  txBase58: string,
  ...signers: Keypair[]
): Promise<string> {
  const txBytes = bs58.decode(txBase58);

  let signedBase58: string;
  try {
    const tx = VersionedTransaction.deserialize(txBytes);
    tx.sign(signers);
    signedBase58 = bs58.encode(tx.serialize());
  } catch {
    const tx = Transaction.from(txBytes);
    tx.sign(...signers);
    signedBase58 = bs58.encode(tx.serialize());
  }

  const res = await fetch(`${BAGS_API_BASE}/solana/send-transaction`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": BAGS_API_KEY,
    },
    body: JSON.stringify({ transaction: signedBase58 }),
  });

  const data = (await res.json()) as any;
  if (!res.ok || data.error) {
    throw new Error(`send-transaction failed: ${JSON.stringify(data)}`);
  }

  return data.response;
}

export async function executeBagsLaunch(
  launch: Launch,
  contributions: Contribution[]
): Promise<void> {
  console.log(`Executing Bags launch ${launch.id} (${launch.token_name})`);

  // Step 0: ALWAYS call create-token-info to get a fresh mint reservation.
  // Bags' mint reservation has a TTL — calling this at scheduling time leads to
  // stale reservations by the time the executor runs. We do this on every
  // attempt (including retries) so a fresh reservation is always used.
  console.log("Calling create-token-info for fresh mint reservation");
  const tokenInfoForm = new FormData();
  tokenInfoForm.append("name", launch.token_name);
  tokenInfoForm.append("symbol", launch.token_symbol.toUpperCase());
  tokenInfoForm.append("description", launch.description || "");
  if (launch.image_url) tokenInfoForm.append("imageUrl", launch.image_url);
  if (launch.twitter_url) tokenInfoForm.append("twitter", launch.twitter_url);
  if (launch.telegram_url) tokenInfoForm.append("telegram", launch.telegram_url);
  if (launch.website_url) tokenInfoForm.append("website", launch.website_url);

  let tokenInfoRes: any;
  try {
    tokenInfoRes = await fetch(
      `${BAGS_API_BASE}/token-launch/create-token-info`,
      {
        method: "POST",
        headers: { "x-api-key": BAGS_API_KEY },
        body: tokenInfoForm as any,
      }
    );
  } catch (err: any) {
    await setFailed(launch.id, `create-token-info request failed: ${err.message}`);
    return;
  }

  if (!tokenInfoRes.ok) {
    const errText = await tokenInfoRes.text();
    console.error(
      `create-token-info HTTP ${tokenInfoRes.status}: ${errText}`
    );
    await setFailed(launch.id, `create-token-info failed: ${errText}`);
    return;
  }

  const tokenInfoData = (await tokenInfoRes.json()) as any;
  console.log("create-token-info response:", JSON.stringify(tokenInfoData));
  const tokenMint: string | undefined = tokenInfoData.response?.tokenMint;
  const ipfsMetadataUrl: string | undefined =
    tokenInfoData.response?.tokenMetadata ||
    tokenInfoData.response?.tokenLaunch?.uri;

  if (!tokenMint || !ipfsMetadataUrl) {
    const errText = JSON.stringify(tokenInfoData);
    console.error(`create-token-info returned no tokenMint or metadata URI: ${errText}`);
    await setFailed(
      launch.id,
      `create-token-info returned no tokenMint or metadata URI: ${errText}`
    );
    return;
  }

  console.log(`Fresh tokenMint: ${tokenMint}`);
  console.log(`Fresh ipfsMetadataUrl: ${ipfsMetadataUrl}`);

  // Persist fresh mint + IPFS URL, and clear any stale fee_share_config_key /
  // claimer_count from a previous attempt so fee-share/config is rebuilt
  // against the new mint.
  const { error: updateErr } = await supabase
    .from("launches")
    .update({
      token_mint_address: tokenMint,
      ipfs_metadata_url: ipfsMetadataUrl,
      fee_share_config_key: null,
      claimer_count: null,
    })
    .eq("id", launch.id);
  if (updateErr) {
    console.error(
      `Failed to persist fresh mint/IPFS for ${launch.id}: ${updateErr.message}`
    );
    await setFailed(
      launch.id,
      `Failed to persist fresh mint/IPFS: ${updateErr.message}`
    );
    return;
  }
  // Reflect the cleared stale config locally so the rest of the function
  // doesn't reuse it.
  launch.fee_share_config_key = null;
  launch.claimer_count = null;

  // Decrypt escrow keypair (decrypt.ts already returns the raw 64-byte secret key)
  const escrowSecret = decryptEscrowKey(launch.escrow_wallet_encrypted_private_key);
  const escrowKeypair = Keypair.fromSecretKey(new Uint8Array(escrowSecret));

  const totalLamports = contributions.reduce(
    (sum, c) => sum + BigInt(c.amount_lamports),
    0n
  );

  // Calculate reserves
  const ATA_COST = 2_039_280n;
  const TX_FEE = 5_000n;
  const PRIORITY_FEE_PER_CONTRIBUTOR = 10_000n; // buffer for ComputeBudgetProgram priority fee per distribution tx
  const BASE_TX_FEES = 20_000n;
  const LOOKUP_TABLE_RENT = 2_550_000n;
  const contributorCount = BigInt(contributions.length);
  const ataReserve = contributorCount * (ATA_COST + TX_FEE + PRIORITY_FEE_PER_CONTRIBUTOR);
  const lookupTableReserve = contributorCount > 15n ? LOOKUP_TABLE_RENT : 0n;
  const netBuyLamports =
    totalLamports - ataReserve - lookupTableReserve - BASE_TX_FEES;

  if (netBuyLamports < 10_000_000n) {
    await setFailed(
      launch.id,
      `Insufficient SOL. Total: ${totalLamports}, Reserve: ${
        ataReserve + lookupTableReserve + BASE_TX_FEES
      }, Net: ${netBuyLamports}`
    );
    return;
  }

  // Build fee share claimers
  const CREATOR_MIN_BPS = 750;
  const remaining = 10000; // claimers must sum to 10000; partner handled separately by Bags
  const totalNum = Number(totalLamports);

  const claimersArray: string[] = [];
  const basisPointsArray: number[] = [];

  // Creator gets minimum 750 BP of the 75% pool
  const creatorRaw = Math.floor(
    (Number(BigInt(contributions[0].amount_lamports)) / totalNum) * remaining
  );
  const creatorBps = Math.max(CREATOR_MIN_BPS, creatorRaw);
  claimersArray.push(launch.created_by_wallet);
  basisPointsArray.push(creatorBps);

  let usedBps = creatorBps;
  for (let i = 1; i < Math.min(contributions.length, 100); i++) {
    const bps = Math.floor(
      (Number(BigInt(contributions[i].amount_lamports)) / totalNum) * remaining
    );
    claimersArray.push(contributions[i].wallet_address);
    basisPointsArray.push(bps);
    usedBps += bps;
  }

  // Adjust to ensure sum equals remaining
  basisPointsArray[0] += remaining - usedBps;

  // Step 1: fee-share/config (skipped on retry if a configKey already exists for this launch)
  let configKey: string;

  if (launch.fee_share_config_key) {
    console.log(
      `Using existing fee_share_config_key from previous attempt: ${launch.fee_share_config_key}`
    );
    configKey = launch.fee_share_config_key;
  } else {
    console.log(`Calling fee-share/config with ${claimersArray.length} claimers`);
    const feeShareController = new AbortController();
    const feeShareTimeout = setTimeout(() => feeShareController.abort(), 30_000);
    let feeShareRes: any;
    try {
      feeShareRes = await fetch(`${BAGS_API_BASE}/fee-share/config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": BAGS_API_KEY,
        },
        body: JSON.stringify({
          payer: launch.escrow_wallet_public_key,
          baseMint: tokenMint,
          claimersArray,
          basisPointsArray,
          partner: BAGS_PARTNER_WALLET,
          partnerConfig: BAGS_PARTNER_CONFIG,
        }),
        signal: feeShareController.signal,
      });
    } catch (err: any) {
      if (err.name === "AbortError") {
        await setFailed(
          launch.id,
          "Bags fee-share/config request timed out after 30 seconds"
        );
        return;
      }
      await setFailed(launch.id, `Bags fee-share/config request failed: ${err.message}`);
      return;
    } finally {
      clearTimeout(feeShareTimeout);
    }

    if (!feeShareRes.ok) {
      const errText = await feeShareRes.text();
      console.error(
        `fee-share/config HTTP ${feeShareRes.status}: ${errText}`
      );
      console.error(
        `Request body was: ${JSON.stringify({
          payer: launch.escrow_wallet_public_key,
          baseMint: tokenMint,
          claimersArray,
          basisPointsArray,
          partner: BAGS_PARTNER_WALLET,
          partnerConfig: BAGS_PARTNER_CONFIG,
        })}`
      );
      await setFailed(launch.id, `fee-share/config failed: ${errText}`);
      return;
    }

    const feeShareData = (await feeShareRes.json()) as any;
    const returnedConfigKey = feeShareData.response?.meteoraConfigKey;
    const feeShareTxs = feeShareData.response?.transactions || [];

    if (!returnedConfigKey) {
      const errText = JSON.stringify(feeShareData);
      console.error(`fee-share/config returned no configKey: ${errText}`);
      await setFailed(launch.id, `fee-share/config returned no configKey: ${errText}`);
      return;
    }

    console.log(`fee-share/config returned ${feeShareTxs.length} transactions`);

    for (let i = 0; i < feeShareTxs.length; i++) {
      try {
        const sig = await signAndSendToBags(feeShareTxs[i].transaction, escrowKeypair);
        console.log(`fee-share tx ${i + 1}/${feeShareTxs.length}: ${sig}`);
      } catch (err: any) {
        await setFailed(launch.id, `fee-share tx ${i + 1} failed: ${err.message}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }

    await storeFeeShareConfig(launch.id, returnedConfigKey, claimersArray.length);
    configKey = returnedConfigKey;
  }

  // Wait for Bags to index the fee-share config on-chain before proceeding
  console.log("Waiting 10 seconds for fee-share config to settle on-chain...");
  await new Promise((r) => setTimeout(r, 10_000));

  // Step 2: create-launch-transaction
  console.log("Calling create-launch-transaction");

  const createLaunchBody = {
    ipfs: ipfsMetadataUrl,
    tokenMint: tokenMint,
    wallet: launch.escrow_wallet_public_key,
    initialBuyLamports: Number(netBuyLamports),
    configKey,
  };

  const createTxController = new AbortController();
  const createTxTimeout = setTimeout(() => createTxController.abort(), 30_000);
  let createTxRes: any;
  try {
    createTxRes = await fetch(
      `${BAGS_API_BASE}/token-launch/create-launch-transaction`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": BAGS_API_KEY,
        },
        body: JSON.stringify(createLaunchBody),
        signal: createTxController.signal,
      }
    );
  } catch (err: any) {
    if (err.name === "AbortError") {
      await setFailed(
        launch.id,
        "Bags create-launch-transaction request timed out after 30 seconds"
      );
      return;
    }
    await setFailed(
      launch.id,
      `Bags create-launch-transaction request failed: ${err.message}`
    );
    return;
  } finally {
    clearTimeout(createTxTimeout);
  }

  if (!createTxRes.ok) {
    const errText = await createTxRes.text();
    console.error(
      `create-launch-transaction HTTP ${createTxRes.status}: ${errText}`
    );
    console.error(
      `Request body was: ${JSON.stringify(createLaunchBody)}`
    );
    await setFailed(launch.id, `create-launch-transaction failed: ${errText}`);
    return;
  }

  const createTxData = (await createTxRes.json()) as any;
  console.log(
    `create-launch-transaction response:`,
    JSON.stringify(createTxData)
  );
  const launchTx = createTxData.response;

  if (!launchTx) {
    const errText = JSON.stringify(createTxData);
    console.error(`create-launch-transaction returned no transaction: ${errText}`);
    await setFailed(
      launch.id,
      `create-launch-transaction returned no transaction: ${errText}`
    );
    return;
  }

  // Step 3: sign and send
  console.log("Signing and submitting launch transaction");
  try {
    const sig = await signAndSendToBags(launchTx, escrowKeypair);
    console.log(`Bags launch confirmed: ${sig}`);
    console.log(`Solscan: https://solscan.io/tx/${sig}`);
    await setLaunched(launch.id);
  } catch (err: any) {
    await setFailed(launch.id, `Launch tx failed: ${err.message}`);
  }
}