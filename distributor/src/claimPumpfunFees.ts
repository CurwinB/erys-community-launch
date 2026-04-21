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

  // Read pre-claim balance for delta math only. Do NOT gate on this — the
  // escrow may hold dust SOL unrelated to unclaimed creator fees, and Pump.fun
  // fees may exist even when escrow balance is low. Always attempt the claim
  // and let the post-claim delta tell us whether anything was actually claimed.
  let escrowBalanceBefore: number;
  try {
    escrowBalanceBefore = await connection.getBalance(escrowKeypair.publicKey, "confirmed");
    console.log(`Escrow wallet balance (pre-claim): ${escrowBalanceBefore / LAMPORTS_PER_SOL} SOL`);
  } catch (err: any) {
    console.error(`Failed to get escrow balance for launch ${launch.id}:`, err.message);
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
        priorityFee: 0.00005,
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
    claimedLamports = newBalance - escrowBalanceBefore;

    if (claimedLamports <= 0) {
      // No real claim happened — do NOT stamp the timestamp, otherwise this
      // launch is locked out of the next 24h of poll cycles for no reason.
      console.log(`No fees were actually claimed for launch ${launch.id}`);
      return;
    }

    console.log(`Claimed ${claimedLamports / LAMPORTS_PER_SOL} SOL in creator fees`);
  } catch (err: any) {
    console.error(`Failed to submit claim transaction for launch ${launch.id}:`, err.message);
    return;
  }

  // Reserve ~5000 lamports per outgoing transfer so the second tx doesn't
  // run out of funds after the first transfer's fee is deducted.
  const distributableLamports = claimedLamports - TX_FEE_RESERVE;
  if (distributableLamports <= 0) {
    console.log(
      `Claimed amount too small to distribute after tx fees for launch ${launch.id}`
    );
    await updatePumpfunFeesClaimed(launch.id, claimedLamports);
    return;
  }

  // Split distributable amount: 50% to Erys platform, 50% to creator
  const platformShareLamports = Math.floor(distributableLamports * PLATFORM_SHARE);
  const creatorShareLamports = distributableLamports - platformShareLamports;

  console.log(`Platform share: ${platformShareLamports / LAMPORTS_PER_SOL} SOL`);
  console.log(`Creator share: ${creatorShareLamports / LAMPORTS_PER_SOL} SOL`);

  let platformSent = false;
  let creatorSent = false;

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
    platformSent = true;
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
    creatorSent = true;
  } catch (err: any) {
    console.error(`Failed to send creator share for launch ${launch.id}:`, err.message);
  }

  // Only stamp timestamp if both transfers succeeded — otherwise next 6h cycle retries
  if (platformSent && creatorSent) {
    await updatePumpfunFeesClaimed(launch.id, claimedLamports);
    console.log(`Fee claim complete for launch ${launch.id}`);
  } else {
    console.error(
      `Fee claim incomplete for launch ${launch.id}. Platform sent: ${platformSent}, Creator sent: ${creatorSent}. Will retry next cycle.`
    );
  }
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