import {
  Connection,
  PublicKey,
  Transaction,
  Keypair,
  ComputeBudgetProgram,
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
  releaseLaunchLock,
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

// Hard invariant: the launch creator MUST receive at least 5% (500 bps) of
// the token supply we bought at launch. Math is done in BigInt so there is
// no float drift. After this function returns, the caller asserts the
// invariant a second time as a belt-and-suspenders check.
const CREATOR_MIN_BPS = 500n;
const TOTAL_BPS = 10000n;

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

  const CREATOR_MIN = (actualBalance * CREATOR_MIN_BPS) / TOTAL_BPS;
  const creatorEntry = rawShares.find((s) => s.wallet === creatorWallet);

  // Edge case: creator is not in the contributor list. We cannot enforce the
  // floor (nobody to credit). Log loudly so it shows up in Railway and the
  // post-calc invariant check downstream stays accurate.
  if (!creatorEntry) {
    console.error(
      `Creator wallet ${creatorWallet} is not among the contributors for this launch — 5% creator floor cannot be applied.`
    );
  }

  // Edge case: creator is the only contributor → they get 100%. Skip the
  // proportional-redistribution loop entirely (no one else to take from).
  if (creatorEntry && rawShares.length === 1) {
    creatorEntry.share = actualBalance;
    shares.set(creatorEntry.id, creatorEntry.share);
    return shares;
  }

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
        // Clamp to zero — never let a contributor go negative due to BigInt
        // flooring. Any rounding leftover is absorbed by the remainder dump
        // below, which lands on rawShares[0] (highest contributor by
        // amount_lamports per the DB ordering — usually the creator).
        entry.share = entry.share > reduction ? entry.share - reduction : 0n;
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

  // Priority fee to ensure timely landing during network congestion
  tx.add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 })
  );

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
      tokenAmount,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  tx.feePayer = escrowKeypair.publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(escrowKeypair);

  const serialized = tx.serialize();
  const signature = await connection.sendRawTransaction(serialized, {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  return signature;
}

export async function distributeTokensForLaunch(launch: Launch): Promise<void> {
  console.log(`\nStarting distribution for launch ${launch.id} (${launch.token_name})`);

  try {
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

  // Reconstruct the original distributable total to keep proportional shares
  // stable across retry cycles. Using only the current escrow balance would
  // inflate remaining contributors' shares after a partial-failure retry.
  const { data: alreadyDistributed } = await supabase
    .from("contributions")
    .select("token_amount")
    .eq("launch_id", launch.id)
    .eq("tokens_distributed", true);

  const previouslyDistributed = (alreadyDistributed || []).reduce(
    (sum: bigint, c: any) => sum + BigInt(c.token_amount || "0"),
    0n
  );

  const originalTotalBalance = tokenBalance + previouslyDistributed;

  console.log(`Token balance in escrow: ${tokenBalance}`);
  console.log(`Previously distributed: ${previouslyDistributed}`);
  console.log(`Original total for share calc: ${originalTotalBalance}`);

  const shares = calculateSharesFromBalance(
    contributions,
    originalTotalBalance,
    launch.created_by_wallet
  );

  // Invariant guard: if the creator is among contributors, their final
  // share must be >= 5% of the original total. If this fails, something in
  // the math regressed — abort the entire distribution before sending so we
  // can fix it instead of silently shorting the creator. The lock is
  // released by the outer finally and the launch will be retried.
  const creatorContrib = contributions.find(
    (c) => c.wallet_address === launch.created_by_wallet
  );
  if (creatorContrib) {
    const creatorMin = (originalTotalBalance * CREATOR_MIN_BPS) / TOTAL_BPS;
    const creatorShare = shares.get(creatorContrib.id) ?? 0n;
    if (creatorShare < creatorMin) {
      throw new Error(
        `Creator share invariant violated for launch ${launch.id}: ` +
          `got ${creatorShare}, need >= ${creatorMin} (5% of ${originalTotalBalance}). Aborting distribution.`
      );
    }
    console.log(
      `Creator share OK: ${creatorShare} (>= 5% floor ${creatorMin})`
    );
  }

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

    const recipientWallet =
      contribution.token_delivery_wallet || contribution.wallet_address;
    if (recipientWallet !== contribution.wallet_address) {
      console.log(
        `Sending ${tokenAmount.toString()} tokens to ${recipientWallet} (delivery override; contributor: ${contribution.wallet_address})`
      );
    } else {
      console.log(
        `Sending ${tokenAmount.toString()} tokens to ${recipientWallet}`
      );
    }

    try {
      const txSignature = await sendTokensToContributor(
        connection,
        escrowKeypair,
        escrowAta,
        mintPubkey,
        recipientWallet,
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
  if (allAttempted && failCount === 0) {
    // All contributors successfully received tokens
    await markLaunchDistributionComplete(launch.id, Number(totalDistributed));
  } else if (allAttempted && failCount > 0) {
    // Some distributions failed — do NOT mark complete so Railway retries on next poll
    console.error(
      `Distribution incomplete for launch ${launch.id}. Success: ${successCount}, Failed: ${failCount}. Will retry on next poll.`
    );
  } else {
    console.log(
      `Distribution still in progress for launch ${launch.id}. Success: ${successCount}, Failed: ${failCount}`
    );
  }
  } finally {
    // Always release the worker lock so another replica (or this one on its
    // next poll) can re-process the launch if anything failed mid-flight.
    await releaseLaunchLock(launch.id);
  }
}
