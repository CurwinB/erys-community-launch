import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import fetch from "node-fetch";
import { decryptEscrowKey } from "./decrypt";
import {
  Launch,
  Contribution,
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

  if (!launch.ipfs_metadata_url || !launch.token_mint_address) {
    await setFailed(launch.id, "Missing ipfs_metadata_url or token_mint_address");
    return;
  }

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
  const BASE_TX_FEES = 20_000n;
  const LOOKUP_TABLE_RENT = 2_550_000n;
  const contributorCount = BigInt(contributions.length);
  const ataReserve = contributorCount * (ATA_COST + TX_FEE);
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
  const PLATFORM_BPS = 2500;
  const CREATOR_MIN_BPS = 750;
  const remaining = 10000 - PLATFORM_BPS;
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
  for (let i = 1; i < Math.min(contributions.length, 99); i++) {
    const bps = Math.floor(
      (Number(BigInt(contributions[i].amount_lamports)) / totalNum) * remaining
    );
    claimersArray.push(contributions[i].wallet_address);
    basisPointsArray.push(bps);
    usedBps += bps;
  }

  // Adjust to ensure sum equals remaining
  basisPointsArray[0] += remaining - usedBps;

  // Step 1: fee-share/config
  console.log(`Calling fee-share/config with ${claimersArray.length} claimers`);
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
    await setFailed(
      launch.id,
      `fee-share/config failed: ${await feeShareRes.text()}`
    );
    return;
  }

  const feeShareData = (await feeShareRes.json()) as any;
  const configKey = feeShareData.response?.meteoraConfigKey;
  const feeShareTxs = feeShareData.response?.transactions || [];

  if (!configKey) {
    await setFailed(launch.id, "fee-share/config returned no configKey");
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
    await new Promise((r) => setTimeout(r, 500));
  }

  await storeFeeShareConfig(launch.id, configKey, claimersArray.length);

  // Step 2: create-launch-transaction
  console.log("Calling create-launch-transaction");
  const createTxRes = await fetch(
    `${BAGS_API_BASE}/token-launch/create-launch-transaction`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": BAGS_API_KEY,
      },
      body: JSON.stringify({
        ipfs: launch.ipfs_metadata_url,
        tokenMint: launch.token_mint_address,
        wallet: launch.escrow_wallet_public_key,
        initialBuyLamports: Number(netBuyLamports),
        configKey,
      }),
    }
  );

  if (!createTxRes.ok) {
    await setFailed(
      launch.id,
      `create-launch-transaction failed: ${await createTxRes.text()}`
    );
    return;
  }

  const createTxData = (await createTxRes.json()) as any;
  const launchTx = createTxData.response;

  if (!launchTx) {
    await setFailed(launch.id, "create-launch-transaction returned no transaction");
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