import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
} from "@solana/spl-token";
import bs58 from "bs58";

/**
 * Helpers for working with the shared PumpPortal Lightning custodial wallet.
 *
 * The PumpPortal Lightning API signs and submits all create / buy / sell
 * transactions using a custodial wallet that PumpPortal generates for you.
 * Per their FAQ, the wallet is a normal Solana keypair — they give you the
 * private key on creation and we hold it as a secret. We use that private
 * key to sweep tokens and SOL back to the per-launch escrow wallet so the
 * rest of the system (distributor, fee claimer, refund flow) keeps working
 * exactly as it does today, with the escrow as the source of truth.
 */

const CUSTODIAL_PRIVATE_KEY_BS58 = process.env.PUMPPORTAL_CUSTODIAL_PRIVATE_KEY!;
const CUSTODIAL_PUBLIC_KEY = process.env.PUMPPORTAL_CUSTODIAL_WALLET!;

// Keep a small SOL floor in the custodial wallet so it stays rent-exempt
// and we don't need to fund a fresh account on the next launch.
export const CUSTODIAL_SOL_FLOOR_LAMPORTS = 2_000_000n; // 0.002 SOL

// Generous priority fee for sweeps so they land quickly even under load.
const SWEEP_PRIORITY_MICROLAMPORTS = 50_000;

let cachedKeypair: Keypair | null = null;

export function getCustodialKeypair(): Keypair {
  if (cachedKeypair) return cachedKeypair;
  if (!CUSTODIAL_PRIVATE_KEY_BS58) {
    throw new Error("PUMPPORTAL_CUSTODIAL_PRIVATE_KEY env var is not set");
  }
  const secret = bs58.decode(CUSTODIAL_PRIVATE_KEY_BS58);
  if (secret.length !== 64) {
    throw new Error(
      `PUMPPORTAL_CUSTODIAL_PRIVATE_KEY decoded to ${secret.length} bytes, expected 64`
    );
  }
  cachedKeypair = Keypair.fromSecretKey(new Uint8Array(secret));
  // Sanity-check: decoded pubkey must match the PUMPPORTAL_CUSTODIAL_WALLET
  // secret. Mismatched keypair vs wallet is an instant disaster, so fail loud.
  if (
    CUSTODIAL_PUBLIC_KEY &&
    cachedKeypair.publicKey.toBase58() !== CUSTODIAL_PUBLIC_KEY
  ) {
    throw new Error(
      `PUMPPORTAL_CUSTODIAL_PRIVATE_KEY pubkey ${cachedKeypair.publicKey.toBase58()} does not match PUMPPORTAL_CUSTODIAL_WALLET ${CUSTODIAL_PUBLIC_KEY}`
    );
  }
  return cachedKeypair;
}

export function getCustodialPublicKey(): PublicKey {
  return getCustodialKeypair().publicKey;
}

/**
 * Send SOL from the per-launch escrow wallet into the PumpPortal custodial
 * wallet to fund the upcoming Lightning create call. PumpPortal will spend
 * this SOL on the dev buy + on-chain tx fees. We add a small buffer for the
 * sweep transactions we'll do afterwards.
 */
export async function fundCustodialWallet(
  connection: Connection,
  escrowKeypair: Keypair,
  lamports: bigint
): Promise<string> {
  const ix = SystemProgram.transfer({
    fromPubkey: escrowKeypair.publicKey,
    toPubkey: getCustodialPublicKey(),
    lamports: Number(lamports),
  });
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: SWEEP_PRIORITY_MICROLAMPORTS,
    }),
    ix
  );
  tx.feePayer = escrowKeypair.publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(
    "confirmed"
  );
  tx.recentBlockhash = blockhash;
  tx.sign(escrowKeypair);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  return sig;
}

/**
 * Move all SPL tokens of `mint` held by the custodial wallet into the given
 * destination wallet's associated token account. Creates the destination ATA
 * if it doesn't exist, fee-paid by the custodial wallet.
 * Returns the tx signature and the amount of base units swept.
 */
export async function sweepTokensToWallet(
  connection: Connection,
  mintAddress: string,
  destinationOwner: PublicKey
): Promise<{ signature: string; amount: bigint }> {
  const custodial = getCustodialKeypair();
  const mintPubkey = new PublicKey(mintAddress);

  const sourceAta = await getAssociatedTokenAddress(
    mintPubkey,
    custodial.publicKey
  );
  const destAta = await getAssociatedTokenAddress(mintPubkey, destinationOwner);

  let amount = 0n;
  try {
    const sourceAccount = await getAccount(connection, sourceAta);
    amount = sourceAccount.amount;
  } catch (err: any) {
    throw new Error(
      `Custodial wallet has no token account for mint ${mintAddress}: ${
        err?.message ?? err
      }`
    );
  }

  if (amount === 0n) {
    throw new Error(
      `Custodial wallet token balance is 0 for mint ${mintAddress} — Lightning create may not have completed`
    );
  }

  const tx = new Transaction();
  tx.add(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: SWEEP_PRIORITY_MICROLAMPORTS,
    })
  );

  const destAtaInfo = await connection.getAccountInfo(destAta);
  if (!destAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        custodial.publicKey,
        destAta,
        destinationOwner,
        mintPubkey
      )
    );
  }

  tx.add(
    createTransferInstruction(
      sourceAta,
      destAta,
      custodial.publicKey,
      amount,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  tx.feePayer = custodial.publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(
    "confirmed"
  );
  tx.recentBlockhash = blockhash;
  tx.sign(custodial);
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  return { signature, amount };
}

/**
 * Sweep residual SOL from the custodial wallet into a destination wallet,
 * leaving CUSTODIAL_SOL_FLOOR_LAMPORTS behind so the wallet stays
 * rent-exempt and ready for the next launch. Returns the swept amount and
 * tx signature, or null if there's nothing meaningful to sweep.
 */
export async function sweepSolToWallet(
  connection: Connection,
  destination: PublicKey
): Promise<{ signature: string; amount: bigint } | null> {
  const custodial = getCustodialKeypair();
  const balance = BigInt(
    await connection.getBalance(custodial.publicKey, "confirmed")
  );

  // Reserve the floor + a tx fee for this sweep itself.
  const txFee = 5_000n;
  if (balance <= CUSTODIAL_SOL_FLOOR_LAMPORTS + txFee) {
    return null;
  }
  const sweepAmount = balance - CUSTODIAL_SOL_FLOOR_LAMPORTS - txFee;

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: SWEEP_PRIORITY_MICROLAMPORTS,
    }),
    SystemProgram.transfer({
      fromPubkey: custodial.publicKey,
      toPubkey: destination,
      lamports: Number(sweepAmount),
    })
  );
  tx.feePayer = custodial.publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(
    "confirmed"
  );
  tx.recentBlockhash = blockhash;
  tx.sign(custodial);
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  return { signature, amount: sweepAmount };
}

export function lamportsToSol(lamports: bigint | number): string {
  const n = typeof lamports === "bigint" ? Number(lamports) : lamports;
  return (n / LAMPORTS_PER_SOL).toFixed(6);
}