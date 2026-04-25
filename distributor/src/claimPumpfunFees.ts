import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import bs58 from "bs58";
import { decryptEscrowKey } from "./decrypt";
import { Launch, getPumpfunLaunchesForFeeClaim, updatePumpfunFeesClaimed } from "./db";
import { withCustodialLock } from "./custodialLock";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const ERYS_PLATFORM_WALLET = process.env.BAGS_PARTNER_WALLET!;
const PUMPPORTAL_API_KEY = process.env.PUMPPORTAL_API_KEY;
const PUMPPORTAL_CUSTODIAL_PRIVATE_KEY = process.env.PUMPPORTAL_CUSTODIAL_PRIVATE_KEY;
const PUMPPORTAL_CUSTODIAL_WALLET = process.env.PUMPPORTAL_CUSTODIAL_WALLET;
const WORKER_ID =
  process.env.WORKER_ID || process.env.RAILWAY_REPLICA_ID || "distributor-default";

// Erys takes 50% of Pump.fun creator fees
const PLATFORM_SHARE = 0.5;

// Reserve for the two outgoing SystemProgram.transfer txs (~5000 lamports each)
const TX_FEE_RESERVE = 10_000;

// Floor we leave in the custodial wallet so it stays rent-exempt and ready
// for the next launch / next fee-claim cycle. Mirrors executor constant.
const CUSTODIAL_SOL_FLOOR_LAMPORTS = 2_000_000n; // 0.002 SOL

let cachedCustodialKeypair: Keypair | null = null;
function getCustodialKeypair(): Keypair {
  if (cachedCustodialKeypair) return cachedCustodialKeypair;
  if (!PUMPPORTAL_CUSTODIAL_PRIVATE_KEY) {
    throw new Error("PUMPPORTAL_CUSTODIAL_PRIVATE_KEY env var is not set");
  }
  const secret = bs58.decode(PUMPPORTAL_CUSTODIAL_PRIVATE_KEY);
  if (secret.length !== 64) {
    throw new Error(
      `PUMPPORTAL_CUSTODIAL_PRIVATE_KEY decoded to ${secret.length} bytes, expected 64`
    );
  }
  cachedCustodialKeypair = Keypair.fromSecretKey(new Uint8Array(secret));
  if (
    PUMPPORTAL_CUSTODIAL_WALLET &&
    cachedCustodialKeypair.publicKey.toBase58() !== PUMPPORTAL_CUSTODIAL_WALLET
  ) {
    throw new Error(
      `PUMPPORTAL_CUSTODIAL_PRIVATE_KEY pubkey mismatch with PUMPPORTAL_CUSTODIAL_WALLET`
    );
  }
  return cachedCustodialKeypair;
}

export async function claimPumpfunFeesForLaunch(launch: Launch): Promise<void> {
  console.log(`\nChecking Pump.fun fees for launch ${launch.id} (${launch.token_name})`);

  if (!PUMPPORTAL_API_KEY) {
    console.error(
      `PUMPPORTAL_API_KEY not set; skipping fee claim for launch ${launch.id}`
    );
    return;
  }

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

  // Custodial wallet = on-chain creator since launch was executed via Lightning.
  // Read its pre-claim balance so we can measure how much was actually claimed.
  let custodialKeypair: Keypair;
  try {
    custodialKeypair = getCustodialKeypair();
  } catch (err: any) {
    console.error(
      `Custodial wallet not configured for launch ${launch.id}:`,
      err?.message ?? err
    );
    return;
  }

  // ============================================================
  // CRITICAL SECTION: serialize custodial-wallet operations.
  // The collectCreatorFee + custodial→escrow sweep must run atomically
  // so concurrent launches/claims don't sweep each other's SOL. The
  // escrow→platform/creator split is OUTSIDE the lock — by then funds
  // are in the per-launch escrow and no longer shared.
  // ============================================================
  const lockKey = custodialKeypair.publicKey.toBase58();
  let claimedLamports = 0;
  let sweptToEscrowLamports = 0;
  try {
    await withCustodialLock(lockKey, WORKER_ID, async () => {
      const result = await runFeeClaimCriticalSection(
        launch,
        connection,
        escrowKeypair,
        custodialKeypair
      );
      if (result) {
        claimedLamports = result.claimedLamports;
        sweptToEscrowLamports = result.sweptToEscrowLamports;
      }
    });
  } catch (lockErr: any) {
    console.error(
      `Could not acquire custodial lock for fee claim ${launch.id}: ${
        lockErr?.message ?? lockErr
      }. Will retry next cycle.`
    );
    return;
  }

  if (sweptToEscrowLamports <= 0) {
    // Nothing made it into escrow (no fees claimed or sweep skipped). The
    // critical section already logged the reason.
    return;
  }

  // Reserve ~5000 lamports per outgoing transfer so the second tx doesn't
  // run out of funds after the first transfer's fee is deducted.
  const distributableLamports = sweptToEscrowLamports - TX_FEE_RESERVE;
  if (distributableLamports <= 0) {
    console.log(
      `Claimed amount too small to distribute after tx fees for launch ${launch.id}. Fees will accumulate and be claimed next cycle.`
    );
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
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    platformTx.recentBlockhash = blockhash;
    platformTx.sign(escrowKeypair);

    const platformSig = await connection.sendRawTransaction(platformTx.serialize(), {
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(
      { signature: platformSig, blockhash, lastValidBlockHeight },
      "confirmed"
    );
    console.log(`Platform fee sent: https://solscan.io/tx/${platformSig}`);
    platformSent = true;
  } catch (err: any) {
    console.error(`Failed to send platform share for launch ${launch.id}:`, err.message);
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
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    creatorTx.recentBlockhash = blockhash;
    creatorTx.sign(escrowKeypair);

    const creatorSig = await connection.sendRawTransaction(creatorTx.serialize(), {
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(
      { signature: creatorSig, blockhash, lastValidBlockHeight },
      "confirmed"
    );
    console.log(`Creator fee sent: https://solscan.io/tx/${creatorSig}`);
    creatorSent = true;
  } catch (err: any) {
    console.error(`Failed to send creator share for launch ${launch.id}:`, err.message);
  }

  if (platformSent && creatorSent) {
    await updatePumpfunFeesClaimed(launch.id, claimedLamports);
    console.log(`Fee claim complete for launch ${launch.id}`);
  } else {
    console.error(
      `Fee claim incomplete for launch ${launch.id}. Platform sent: ${platformSent}, Creator sent: ${creatorSent}. Will retry next cycle.`
    );
  }
}

// Holds the custodial lock for the duration. Returns null on any non-fatal
// early exit (no fees, sweep failed, etc.). On success returns the amounts
// so the caller can run the escrow→platform/creator split outside the lock.
async function runFeeClaimCriticalSection(
  launch: Launch,
  connection: Connection,
  escrowKeypair: Keypair,
  custodialKeypair: Keypair
): Promise<{ claimedLamports: number; sweptToEscrowLamports: number } | null> {
  let custodialBalanceBefore: number;
  try {
    custodialBalanceBefore = await connection.getBalance(
      custodialKeypair.publicKey,
      "confirmed"
    );
    console.log(
      `Custodial wallet balance (pre-claim): ${custodialBalanceBefore / LAMPORTS_PER_SOL} SOL`
    );
  } catch (err: any) {
    console.error(
      `Failed to get custodial balance for launch ${launch.id}:`,
      err.message
    );
    return null;
  }

  // Call PumpPortal Lightning collectCreatorFee. PumpPortal signs + submits
  // with the custodial wallet (now the on-chain creator) and sweeps fees
  // into that same wallet.
  console.log(
    `Claiming creator fees via Lightning for ${launch.token_mint_address}`
  );
  let claimedLamports = 0;
  try {
    const response = await fetch(
      `https://pumpportal.fun/api/trade?api-key=${encodeURIComponent(
        PUMPPORTAL_API_KEY!
      )}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "collectCreatorFee",
          mint: launch.token_mint_address,
          priorityFee: 0.00005,
          pool: "pump",
        }),
      }
    );

    const json: any = await response.json().catch(() => ({}));
    if (!response.ok || json?.errors) {
      const summary =
        json?.errors?.join(" | ") ||
        JSON.stringify(json).slice(0, 300) ||
        response.statusText;
      console.error(
        `Lightning collectCreatorFee failed for launch ${launch.id} [${response.status}]: ${summary}`
      );
      return null;
    }
    const claimSignature: string | undefined = json?.signature;
    if (claimSignature) {
      console.log(`Creator fee claim submitted: ${claimSignature}`);
      console.log(`Solscan: https://solscan.io/tx/${claimSignature}`);
      try {
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");
        await connection.confirmTransaction(
          { signature: claimSignature, blockhash, lastValidBlockHeight },
          "confirmed"
        );
      } catch (confErr: any) {
        console.warn(
          `confirmTransaction warning: ${confErr?.message ?? confErr}`
        );
      }
    }

    // Re-read custodial balance to compute the actual claimed amount.
    const newCustodialBalance = await connection.getBalance(
      custodialKeypair.publicKey,
      "confirmed"
    );
    claimedLamports = newCustodialBalance - custodialBalanceBefore;
    if (claimedLamports <= 0) {
      // No real claim happened — do NOT stamp the timestamp, otherwise this
      // launch is locked out of the next 24h of poll cycles for no reason.
      console.log(`No fees were actually claimed for launch ${launch.id}`);
      return null;
    }
    console.log(`Claimed ${claimedLamports / LAMPORTS_PER_SOL} SOL in creator fees`);
  } catch (err: any) {
    console.error(
      `Lightning collectCreatorFee threw for launch ${launch.id}:`,
      err?.message ?? err
    );
    return null;
  }

  // Sweep the claimed SOL from custodial → escrow. Leave the rent-exempt
  // floor behind. This is what makes the rest of this function (escrow-based
  // 50/50 split) work unchanged.
  let sweptToEscrowLamports = 0;
  try {
    const custodialNow = BigInt(
      await connection.getBalance(custodialKeypair.publicKey, "confirmed")
    );
    const sweepTxFee = 5_000n;
    if (custodialNow <= CUSTODIAL_SOL_FLOOR_LAMPORTS + sweepTxFee) {
      console.error(
        `Custodial balance below sweep threshold for launch ${launch.id}, cannot move claimed fees to escrow`
      );
      return null;
    }
    const sweepAmount = custodialNow - CUSTODIAL_SOL_FLOOR_LAMPORTS - sweepTxFee;
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: custodialKeypair.publicKey,
        toPubkey: escrowKeypair.publicKey,
        lamports: Number(sweepAmount),
      })
    );
    tx.feePayer = custodialKeypair.publicKey;
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.sign(custodialKeypair);
    const sweepSig = await connection.sendRawTransaction(tx.serialize(), {
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(
      { signature: sweepSig, blockhash, lastValidBlockHeight },
      "confirmed"
    );
    console.log(
      `Swept ${Number(sweepAmount) / LAMPORTS_PER_SOL} SOL from custodial to escrow: ${sweepSig}`
    );
    sweptToEscrowLamports = Number(sweepAmount);
  } catch (err: any) {
    console.error(
      `Failed to sweep custodial fees to escrow for launch ${launch.id}:`,
      err?.message ?? err
    );
    return null;
  }

  return { claimedLamports, sweptToEscrowLamports };
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