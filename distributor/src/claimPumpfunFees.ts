import { Connection, PublicKey, SystemProgram, Transaction, Keypair, LAMPORTS_PER_SOL, VersionedTransaction } from "@solana/web3.js";
import { decryptEscrowKey } from "./decrypt";
import { Launch, getPumpfunLaunchesForFeeClaim, updatePumpfunFeesClaimed } from "./db";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const ERYS_PLATFORM_WALLET = process.env.BAGS_PARTNER_WALLET!;

// Erys takes 50% of Pump.fun creator fees
const PLATFORM_SHARE = 0.5;

// Reserve for the two outgoing SystemProgram.transfer txs (~5000 lamports each)
const TX_FEE_RESERVE = 10_000;

export async function claimPumpfunFeesForLaunch(launch: Launch): Promise<void> {
  console.log(`\nChecking Pump.fun fees for launch ${launch.id} (${launch.token_name})`);

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");

  // Decrypt escrow private key
  let escrowKeypair: Keypair;
  try {
    const decrypted = decryptEscrowKey(launch.escrow_wallet_encrypted_private_key);
    escrowKeypair = Keypair.fromSecretKey(new Uint8Array(decrypted));
  } catch (err: any) {
    console.error(`Failed to decrypt escrow key for launch ${launch.id}:`, err.message);
    return;
  }

  // Check current SOL balance of escrow wallet
  // Creator fees from Pump.fun accumulate as SOL in the escrow wallet
  let escrowBalance: number;
  try {
    escrowBalance = await connection.getBalance(escrowKeypair.publicKey, "confirmed");
    console.log(`Escrow wallet balance: ${escrowBalance / LAMPORTS_PER_SOL} SOL`);
  } catch (err: any) {
    console.error(`Failed to get escrow balance for launch ${launch.id}:`, err.message);
    return;
  }

  // Check if balance meets minimum threshold
  if (escrowBalance < MIN_CLAIM_THRESHOLD) {
    console.log(
      `Escrow balance ${escrowBalance} lamports below threshold ${MIN_CLAIM_THRESHOLD}. Skipping.`
    );
    // Still update last claimed timestamp so we don't check every poll cycle
    await updatePumpfunFeesClaimed(launch.id, 0);
    return;
  }

  // Call PumpPortal collectCreatorFee endpoint
  // This generates a claim transaction for all unclaimed creator fees
  console.log(`Claiming creator fees via PumpPortal for ${launch.token_mint_address}`);

  let claimTxBytes: Uint8Array;
  try {
    const response = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: escrowKeypair.publicKey.toBase58(),
        action: "collectCreatorFee",
        priorityFee: 0.000001,
        pool: "pump",
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`PumpPortal collectCreatorFee failed for launch ${launch.id}:`, errText);
      return;
    }

    const txData = await response.arrayBuffer();
    claimTxBytes = new Uint8Array(txData);
  } catch (err: any) {
    console.error(`Failed to get claim transaction for launch ${launch.id}:`, err.message);
    return;
  }

  // Sign and submit the claim transaction
  let claimedLamports = 0;
  try {
    const tx = VersionedTransaction.deserialize(claimTxBytes);
    tx.sign([escrowKeypair]);

    const serialized = tx.serialize();
    const signature = await connection.sendRawTransaction(serialized, {
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(signature, "confirmed");

    console.log(`Creator fee claim confirmed: ${signature}`);
    console.log(`Solscan: https://solscan.io/tx/${signature}`);

    // Get new balance after claim to calculate how much was claimed
    const newBalance = await connection.getBalance(escrowKeypair.publicKey, "confirmed");
    claimedLamports = newBalance - escrowBalance;

    if (claimedLamports <= 0) {
      console.log(`No fees were actually claimed for launch ${launch.id}`);
      await updatePumpfunFeesClaimed(launch.id, 0);
      return;
    }

    console.log(`Claimed ${claimedLamports / LAMPORTS_PER_SOL} SOL in creator fees`);
  } catch (err: any) {
    console.error(`Failed to submit claim transaction for launch ${launch.id}:`, err.message);
    return;
  }

  // Split fees: 50% to Erys platform, 50% to creator
  const platformShareLamports = Math.floor(claimedLamports * PLATFORM_SHARE);
  const creatorShareLamports = claimedLamports - platformShareLamports;

  console.log(`Platform share: ${platformShareLamports / LAMPORTS_PER_SOL} SOL`);
  console.log(`Creator share: ${creatorShareLamports / LAMPORTS_PER_SOL} SOL`);

  // Send platform share to Erys platform wallet
  try {
    const platformTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: escrowKeypair.publicKey,
        toPubkey: new PublicKey(ERYS_PLATFORM_WALLET),
        lamports: platformShareLamports,
      })
    );
    platformTx.feePayer = escrowKeypair.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    platformTx.recentBlockhash = blockhash;
    platformTx.sign(escrowKeypair);

    const platformSig = await connection.sendRawTransaction(platformTx.serialize(), {
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(platformSig, "confirmed");
    console.log(`Platform fee sent: https://solscan.io/tx/${platformSig}`);
  } catch (err: any) {
    console.error(`Failed to send platform share for launch ${launch.id}:`, err.message);
    // Continue to try sending creator share even if platform send fails
  }

  // Send creator share to token creator wallet
  try {
    const creatorTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: escrowKeypair.publicKey,
        toPubkey: new PublicKey(launch.created_by_wallet),
        lamports: creatorShareLamports,
      })
    );
    creatorTx.feePayer = escrowKeypair.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    creatorTx.recentBlockhash = blockhash;
    creatorTx.sign(escrowKeypair);

    const creatorSig = await connection.sendRawTransaction(creatorTx.serialize(), {
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(creatorSig, "confirmed");
    console.log(`Creator fee sent: https://solscan.io/tx/${creatorSig}`);
  } catch (err: any) {
    console.error(`Failed to send creator share for launch ${launch.id}:`, err.message);
  }

  // Update database with claimed amount
  await updatePumpfunFeesClaimed(launch.id, claimedLamports);
  console.log(`Fee claim complete for launch ${launch.id}`);
}

export async function claimAllPumpfunFees(): Promise<void> {
  const launches = await getPumpfunLaunchesForFeeClaim();

  if (launches.length === 0) {
    return;
  }

  console.log(`Found ${launches.length} Pump.fun launches to check for fees`);

  for (const launch of launches) {
    try {
      await claimPumpfunFeesForLaunch(launch);
      // Small delay between launches to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (err: any) {
      console.error(`Unhandled error claiming fees for launch ${launch.id}:`, err.message);
    }
  }
}