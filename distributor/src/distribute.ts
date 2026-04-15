import {
  Connection,
  PublicKey,
  Transaction,
  Keypair,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";
import { decryptEscrowKey } from "./decrypt";
import {
  Launch,
  Contribution,
  getPendingContributions,
  markDistributed,
  markDistributionFailed,
  markLaunchDistributionComplete,
  supabase,
} from "./db";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;

async function getTokenBalance(
  connection: Connection,
  walletPubkey: PublicKey,
  mintPubkey: PublicKey,
  retries = 5,
  delayMs = 3000
): Promise<bigint> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const accounts = await connection.getParsedTokenAccountsByOwner(
        walletPubkey,
        { mint: mintPubkey }
      );
      if (accounts.value.length > 0) {
        const amount = accounts.value[0].account.data.parsed.info.tokenAmount.amount;
        return BigInt(amount);
      }
    } catch (err) {
      console.warn(`Attempt ${attempt}/${retries} to read token balance failed:`, err);
    }
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return 0n;
}

function calculateSharesFromBalance(
  contributions: Contribution[],
  actualBalance: bigint,
  creatorWallet: string
): Map<string, bigint> {
  const shares = new Map<string, bigint>();
  const totalLamports = contributions.reduce(
    (sum, c) => sum + BigInt(c.amount_lamports),
    0n
  );
  if (totalLamports === 0n) return shares;

  const rawShares = contributions.map((c) => ({
    id: c.id,
    wallet: c.wallet_address,
    share: (BigInt(c.amount_lamports) * actualBalance) / totalLamports,
  }));

  const CREATOR_MIN = (actualBalance * 500n) / 10000n;
  const creatorEntry = rawShares.find((s) => s.wallet === creatorWallet);

  if (creatorEntry && creatorEntry.share < CREATOR_MIN) {
    const deficit = CREATOR_MIN - creatorEntry.share;
    creatorEntry.share = CREATOR_MIN;
    const othersTotal = rawShares
      .filter((s) => s.wallet !== creatorWallet)
      .reduce((sum, s) => sum + s.share, 0n);
    if (othersTotal > 0n) {
      for (const entry of rawShares) {
        if (entry.wallet === creatorWallet) continue;
        const reduction = (entry.share * deficit) / othersTotal;
        entry.share -= reduction;
      }
    }
  }

  const totalShares = rawShares.reduce((sum, s) => sum + s.share, 0n);
  const remainder = actualBalance - totalShares;
  if (rawShares.length > 0) rawShares[0].share += remainder;

  for (const entry of rawShares) shares.set(entry.id, entry.share);
  return shares;
}

async function sendTokensToContributor(
  connection: Connection,
  escrowKeypair: Keypair,
  escrowAta: PublicKey,
  mintPubkey: PublicKey,
  contributorWallet: string,
  tokenAmount: bigint
): Promise<string> {
  const contributorPubkey = new PublicKey(contributorWallet);
  const contributorAta = await getAssociatedTokenAddress(mintPubkey, contributorPubkey);
  const tx = new Transaction();

  const ataInfo = await connection.getAccountInfo(contributorAta);
  if (!ataInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        escrowKeypair.publicKey,
        contributorAta,
        contributorPubkey,
        mintPubkey
      )
    );
  }

  tx.add(
    createTransferInstruction(
      escrowAta,
      contributorAta,
      escrowKeypair.publicKey,
      Number(tokenAmount),
      [],
      TOKEN_PROGRAM_ID
    )
  );

  tx.feePayer = escrowKeypair.publicKey;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.sign(escrowKeypair);

  const serialized = tx.serialize();
  const signature = await connection.sendRawTransaction(serialized, {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}

export async function distributeTokensForLaunch(launch: Launch): Promise<void> {
  console.log(`\nStarting distribution for launch ${launch.id} (${launch.token_name})`);

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");

  let escrowKeypair: Keypair;
  try {
    const decrypted = decryptEscrowKey(launch.escrow_wallet_encrypted_private_key);
    escrowKeypair = Keypair.fromSecretKey(new Uint8Array(decrypted));
  } catch (err: any) {
    console.error(`Failed to decrypt escrow key for launch ${launch.id}:`, err.message);
    return;
  }

  const mintPubkey = new PublicKey(launch.token_mint_address);
  const tokenBalance = await getTokenBalance(
    connection,
    escrowKeypair.publicKey,
    mintPubkey
  );

  if (tokenBalance === 0n) {
    console.error(`No tokens found in escrow wallet for launch ${launch.id}. Skipping.`);
    return;
  }

  console.log(`Token balance: ${tokenBalance.toString()}`);

  const contributions = await getPendingContributions(launch.id);
  if (contributions.length === 0) {
    console.log(`No pending distributions for launch ${launch.id}`);
    await markLaunchDistributionComplete(launch.id, 0);
    return;
  }

  console.log(`Distributing to ${contributions.length} contributors`);

  const shares = calculateSharesFromBalance(
    contributions,
    tokenBalance,
    launch.created_by_wallet
  );

  for (const contribution of contributions) {
    const share = shares.get(contribution.id) || 0n;
    await supabase
      .from("contributions")
      .update({ token_amount: share.toString() })
      .eq("id", contribution.id);
  }

  const escrowAta = await getAssociatedTokenAddress(
    mintPubkey,
    escrowKeypair.publicKey
  );

  let totalDistributed = 0n;
  let successCount = 0;
  let failCount = 0;

  for (const contribution of contributions) {
    const tokenAmount = shares.get(contribution.id) || 0n;
    if (tokenAmount === 0n) {
      console.warn(`Zero token amount for contribution ${contribution.id}, skipping`);
      continue;
    }

    console.log(`Sending ${tokenAmount.toString()} tokens to ${contribution.wallet_address}`);

    try {
      const txSignature = await sendTokensToContributor(
        connection,
        escrowKeypair,
        escrowAta,
        mintPubkey,
        contribution.wallet_address,
        tokenAmount
      );
      console.log(`Success: ${txSignature}`);
      await markDistributed(contribution.id, txSignature);
      totalDistributed += tokenAmount;
      successCount++;
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (err: any) {
      console.error(`Failed to send tokens to ${contribution.wallet_address}:`, err.message);
      await markDistributionFailed(contribution.id, err.message);
      failCount++;
    }
  }

  console.log(
    `Distribution complete for ${launch.id}. Success: ${successCount}, Failed: ${failCount}`
  );

  const allAttempted = successCount + failCount === contributions.length;
  if (allAttempted) {
    await markLaunchDistributionComplete(launch.id, Number(totalDistributed));
  }
}
