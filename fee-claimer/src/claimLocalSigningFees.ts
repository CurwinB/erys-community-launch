import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  Keypair,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { decryptEscrowKey } from "./decrypt";
import {
  Launch,
  supabase,
  releaseLaunchLock,
  recordPumpfunEmptyClaim,
  recordPumpfunFeeClaimFailure,
  recordPumpfunFeeTreasurySweep,
  recordPumpfunCreatorVaultBalance,
} from "./db";

// =====================================================================
// Creator-fee claiming for launches executed via the LOCAL SIGNING path.
//
// Local-signing launches are different from Lightning launches in one
// crucial way: the on-chain creator IS the per-launch escrow wallet, not
// a shared PumpPortal custodial wallet. That means:
//   - There is no shared PumpPortal API key that can claim these fees
//     (PumpPortal's `collectCreatorFee` is keyed by API-key → wallet).
//   - Each launch's creator vault PDA is unique (one per escrow).
//   - We must call Pump.fun's on-chain `collect_creator_fee` instruction
//     ourselves, signed by the decrypted escrow keypair.
//
// After claim, the escrow holds the fees. We sweep escrow → treasury in
// the same tx so per-launch SOL accounting is clean.
//
// All economic gates and throttle behavior mirror claimPumpfunFeesBatch.ts:
//   - PUMPFUN_MIN_CLAIM_LAMPORTS gate on the vault PDA balance
//   - empty-claim counter via record_pumpfun_empty_claim (3 in a row → 1h throttle)
//   - 10-min minimum between attempts (enforced by the worker-claim SQL fn)
// =====================================================================

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const TREASURY_WALLET = process.env.BAGS_PARTNER_WALLET!;
const PUMP_PROGRAM_ID = new PublicKey(
  process.env.PUMP_PROGRAM_ID || "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);

const WORKER_ID =
  process.env.WORKER_ID || process.env.RAILWAY_REPLICA_ID || "distributor-default";

// One claim + one sweep tx per launch. Combine into a single tx where
// possible to halve the fee burden.
const BATCH_SIZE = parseInt(process.env.PUMPFUN_LOCAL_CLAIM_BATCH_SIZE || "10", 10);
const TX_FEE_RESERVE = 5_000;
const PRIORITY_FEE_LAMPORTS = 50_000;
const ESCROW_RENT_FLOOR_LAMPORTS = 2_000_000n; // keep escrow rent-exempt

const PUMPFUN_MIN_CLAIM_LAMPORTS = BigInt(
  process.env.PUMPFUN_MIN_CLAIM_LAMPORTS || "600000"
);
const PUMPFUN_MIN_CLAIM_HARD_FLOOR_LAMPORTS = 100_000n;

// Pump.fun on-chain `collect_creator_fee` instruction discriminator
// Source: pump-public-docs / pump-sdk IDL.
const COLLECT_CREATOR_FEE_DISCRIMINATOR = Buffer.from([
  20, 22, 86, 123, 198, 28, 219, 132,
]);

function getCreatorVaultPda(creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creator.toBuffer()],
    PUMP_PROGRAM_ID
  )[0];
}

function getEventAuthorityPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM_ID
  )[0];
}

function buildCollectCreatorFeeIx(creator: PublicKey): TransactionInstruction {
  const creatorVault = getCreatorVaultPda(creator);
  const eventAuthority = getEventAuthorityPda();
  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: [
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: creatorVault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: COLLECT_CREATOR_FEE_DISCRIMINATOR,
  });
}

async function claimLocalSigningBatch(workerId: string, limit: number): Promise<Launch[]> {
  const { data, error } = await supabase.rpc(
    "claim_local_signing_pumpfun_launches_batch_for_worker",
    {
      p_worker_id: workerId,
      p_limit: limit,
      p_lock_expiry_seconds: 300,
    }
  );
  if (error) {
    console.error("Error claiming local-signing fee batch:", error.message);
    return [];
  }
  return (data as Launch[]) || [];
}

export async function claimLocalSigningFeesBatch(): Promise<void> {
  if (!TREASURY_WALLET) {
    console.error(
      "BAGS_PARTNER_WALLET (treasury) not set; skipping local-signing fee claim"
    );
    return;
  }
  let treasuryPubkey: PublicKey;
  try {
    treasuryPubkey = new PublicKey(TREASURY_WALLET);
  } catch (err: any) {
    console.error(
      `BAGS_PARTNER_WALLET invalid: ${err?.message ?? err}`
    );
    return;
  }

  const launches = await claimLocalSigningBatch(WORKER_ID, BATCH_SIZE);
  if (launches.length === 0) return;

  console.log(
    `[LOCAL_SIGNING_CLAIM] Worker ${WORKER_ID} claimed ${launches.length} launch(es)`
  );

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");

  // Process launches sequentially. Each has its own escrow keypair so
  // there is no shared lock to coordinate, but we keep RPC fan-out bounded.
  for (const launch of launches) {
    try {
      await claimForLaunch(launch, connection, treasuryPubkey);
    } catch (err: any) {
      const msg = `Unexpected error: ${err?.message ?? err}`;
      console.error(
        `[LOCAL_SIGNING_CLAIM] Launch ${launch.id} failed: ${msg}`
      );
      await recordPumpfunFeeClaimFailure(launch.id, msg);
    } finally {
      await releaseLaunchLock(launch.id);
    }
  }
}

async function claimForLaunch(
  launch: Launch,
  connection: Connection,
  treasuryPubkey: PublicKey
): Promise<void> {
  // ---- Decrypt escrow keypair (the on-chain creator) ----
  let escrowKeypair: Keypair;
  try {
    const secret = decryptEscrowKey(launch.escrow_wallet_encrypted_private_key);
    escrowKeypair = Keypair.fromSecretKey(new Uint8Array(secret));
  } catch (err: any) {
    const msg = `Failed to decrypt escrow key: ${err?.message ?? err}`;
    console.error(`[LOCAL_SIGNING_CLAIM] ${launch.id}: ${msg}`);
    await recordPumpfunFeeClaimFailure(launch.id, msg);
    return;
  }
  if (escrowKeypair.publicKey.toBase58() !== launch.escrow_wallet_public_key) {
    const msg = `Escrow keypair mismatch: derived ${escrowKeypair.publicKey.toBase58()} != stored ${launch.escrow_wallet_public_key}`;
    console.error(`[LOCAL_SIGNING_CLAIM] ${launch.id}: ${msg}`);
    await recordPumpfunFeeClaimFailure(launch.id, msg);
    return;
  }

  // ---- Peek the creator vault PDA balance ----
  const vaultPda = getCreatorVaultPda(escrowKeypair.publicKey);
  let vaultLamports = 0n;
  try {
    vaultLamports = BigInt(await connection.getBalance(vaultPda, "confirmed"));
  } catch (err: any) {
    console.warn(
      `[LOCAL_SIGNING_CLAIM] ${launch.id}: vault balance read failed: ${err?.message ?? err}`
    );
  }
  await recordPumpfunCreatorVaultBalance([launch.id], Number(vaultLamports));

  const minClaim =
    PUMPFUN_MIN_CLAIM_LAMPORTS < PUMPFUN_MIN_CLAIM_HARD_FLOOR_LAMPORTS
      ? PUMPFUN_MIN_CLAIM_HARD_FLOOR_LAMPORTS
      : PUMPFUN_MIN_CLAIM_LAMPORTS;

  if (vaultLamports < minClaim) {
    console.log(
      `[LOCAL_SIGNING_CLAIM] ${launch.id}: vault ${vaultLamports} < threshold ${minClaim} — skip (empty claim)`
    );
    await recordPumpfunEmptyClaim(launch.id);
    return;
  }

  // ---- Wallet-health gate on the escrow ----
  const preEscrow = BigInt(
    await connection.getBalance(escrowKeypair.publicKey, "confirmed")
  );
  const requiredEscrowBudget =
    BigInt(PRIORITY_FEE_LAMPORTS) + BigInt(TX_FEE_RESERVE);
  if (preEscrow < requiredEscrowBudget) {
    const msg = `Escrow balance ${preEscrow} below required ${requiredEscrowBudget} for collect+sweep tx fees`;
    console.error(`[LOCAL_SIGNING_CLAIM] ${launch.id}: ${msg}`);
    await recordPumpfunFeeClaimFailure(launch.id, msg);
    return;
  }

  console.log(
    `[LOCAL_SIGNING_CLAIM] ${launch.id}: claiming ${
      Number(vaultLamports) / LAMPORTS_PER_SOL
    } SOL (escrow ${escrowKeypair.publicKey.toBase58().slice(0, 8)})`
  );

  // ---- Build single tx: collect_creator_fee + sweep escrow → treasury ----
  // Sweep amount is computed from current escrow + expected vault inflow,
  // minus rent floor and tx fees. We do NOT include the vault delta in the
  // sweep — instead we sweep ALL of post-claim escrow above the floor in a
  // follow-up tx, so we know the exact figure.
  //
  // Why two txs: putting the SystemProgram.transfer in the same tx as
  // collect_creator_fee would require us to know the vault payout amount in
  // advance (transfer takes a fixed lamport amount). Instead: claim first,
  // then sweep the resulting balance. Costs 2 txs per launch.
  const collectIx = buildCollectCreatorFeeIx(escrowKeypair.publicKey);
  const claimTx = new Transaction()
    .add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: PRIORITY_FEE_LAMPORTS,
      })
    )
    .add(collectIx);
  claimTx.feePayer = escrowKeypair.publicKey;

  let claimSig: string;
  try {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    claimTx.recentBlockhash = blockhash;
    claimTx.sign(escrowKeypair);
    claimSig = await connection.sendRawTransaction(claimTx.serialize(), {
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(
      { signature: claimSig, blockhash, lastValidBlockHeight },
      "confirmed"
    );
    console.log(
      `[LOCAL_SIGNING_CLAIM] ${launch.id}: collect tx https://solscan.io/tx/${claimSig}`
    );
  } catch (err: any) {
    const msg = `collect_creator_fee tx failed: ${err?.message ?? err}`;
    console.error(`[LOCAL_SIGNING_CLAIM] ${launch.id}: ${msg}`);
    await recordPumpfunFeeClaimFailure(launch.id, msg);
    return;
  }

  // ---- Sweep escrow → treasury (everything above rent floor + tx fee) ----
  const postEscrow = BigInt(
    await connection.getBalance(escrowKeypair.publicKey, "confirmed")
  );
  const sweepable =
    postEscrow - ESCROW_RENT_FLOOR_LAMPORTS - BigInt(TX_FEE_RESERVE);
  if (sweepable <= 0n) {
    console.log(
      `[LOCAL_SIGNING_CLAIM] ${launch.id}: nothing sweepable post-claim (post=${postEscrow})`
    );
    return;
  }

  let sweepSig: string;
  try {
    const sweepTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: escrowKeypair.publicKey,
        toPubkey: treasuryPubkey,
        lamports: Number(sweepable),
      })
    );
    sweepTx.feePayer = escrowKeypair.publicKey;
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    sweepTx.recentBlockhash = blockhash;
    sweepTx.sign(escrowKeypair);
    sweepSig = await connection.sendRawTransaction(sweepTx.serialize(), {
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(
      { signature: sweepSig, blockhash, lastValidBlockHeight },
      "confirmed"
    );
    console.log(
      `[LOCAL_SIGNING_CLAIM] ${launch.id}: sweep tx https://solscan.io/tx/${sweepSig} (${
        Number(sweepable) / LAMPORTS_PER_SOL
      } SOL)`
    );
  } catch (err: any) {
    const msg = `Treasury sweep failed (claim landed ${claimSig}): ${err?.message ?? err}`;
    console.error(`[LOCAL_SIGNING_CLAIM] ${launch.id}: ${msg}`);
    await recordPumpfunFeeClaimFailure(launch.id, msg);
    return;
  }

  await recordPumpfunFeeTreasurySweep({
    launchId: launch.id,
    sourceWallet: escrowKeypair.publicKey.toBase58(),
    treasuryWallet: treasuryPubkey.toBase58(),
    amountLamports: Number(sweepable),
    txSignature: sweepSig,
    notes: `Local-signing claim. collect_creator_fee tx: ${claimSig}`,
  });
}