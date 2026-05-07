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
import { Launch, supabase, releaseLaunchLock } from "./db";
import { withCustodialLock } from "./custodialLock";

// =====================================================================
// Per-launch Pump.fun fee harvester.
//
// One-launch-at-a-time loop:
//   1. Atomically claim a launch via claim_launch_for_harvest (state -> harvesting).
//   2. Acquire the per-launch advisory lock (key = lightning wallet pubkey)
//      so user-claim flows can't race the harvester.
//   3. Peek the on-chain creator vault PDA. Skip if below 20x estimated gas.
//   4. Sign + send Pump.fun collect_creator_fee with the lightning keypair.
//   5. Compute split: 40% treasury, 60% contributors.
//   6. Send treasury transfer in the same critical section.
//   7. Build per-contributor allocations (proportional to amount_lamports).
//   8. Persist cycle + allocations atomically via record_harvest_cycle.
//
// Failure paths flip state -> harvest_failed (auto-resets after TTL).
// Empty vault paths bump the consecutive-empty counter (3 in a row -> 1h throttle).
// =====================================================================

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const TREASURY_WALLET = process.env.BAGS_PARTNER_WALLET!;
const PUMP_PROGRAM_ID = new PublicKey(
  process.env.PUMP_PROGRAM_ID || "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);

const WORKER_ID =
  process.env.WORKER_ID ||
  process.env.RAILWAY_REPLICA_ID ||
  "harvester-default";

const PRIORITY_FEE_MICRO_LAMPORTS = 50_000;
const TX_FEE_RESERVE = 5_000n;
const ESCROW_RENT_FLOOR_LAMPORTS = 2_000_000n;

// 20x estimated gas. Estimated gas = collect tx + treasury transfer +
// safety buffer ~110k lamports default.
const GAS_ESTIMATE_LAMPORTS = BigInt(
  process.env.PER_LAUNCH_HARVEST_GAS_ESTIMATE_LAMPORTS || "110000"
);
const MIN_HARVEST_MULTIPLIER = BigInt(
  process.env.PER_LAUNCH_MIN_HARVEST_MULTIPLIER || "20"
);
const MIN_HARVEST_LAMPORTS = GAS_ESTIMATE_LAMPORTS * MIN_HARVEST_MULTIPLIER;

// Per-launch Pump.fun fee split: 70% to creator (launches.created_by_wallet),
// 30% to platform treasury. Sponsored launches follow the same routing —
// creator share NEVER re-routes to treasury based on sponsor identity.
const CREATOR_BPS = 7000; // 70%
const TREASURY_BPS = 3000; // 30%

const COLLECT_CREATOR_FEE_DISCRIMINATOR = Buffer.from([
  20, 22, 86, 123, 198, 28, 219, 132,
]);

function getCreatorVaultPda(creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creator.toBuffer()],
    PUMP_PROGRAM_ID
  )[0];
}

function tryParsePubkey(s: string | null | undefined): PublicKey | null {
  if (!s || typeof s !== "string") return null;
  const trimmed = s.trim();
  if (trimmed.length < 32 || trimmed.length > 44) return null;
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed)) return null;
  try {
    return new PublicKey(trimmed);
  } catch {
    return null;
  }
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

async function claimNextLaunch(): Promise<Launch | null> {
  const { data, error } = await supabase.rpc("claim_launch_for_harvest", {
    p_worker_id: WORKER_ID,
    p_lock_ttl_seconds: 300,
    p_min_interval_seconds: 600,
  });
  if (error) {
    console.error("[HARVEST] claim_launch_for_harvest error:", error.message);
    return null;
  }
  return (data?.[0] as Launch) || null;
}

async function recordEmpty(launchId: string): Promise<void> {
  const { error } = await supabase.rpc("record_harvest_empty", {
    p_launch_id: launchId,
  });
  if (error) console.error("[HARVEST] record_harvest_empty error:", error.message);
}

async function recordFailure(launchId: string, msg: string): Promise<void> {
  const { error } = await supabase.rpc("record_harvest_failure", {
    p_launch_id: launchId,
    p_error: msg,
  });
  if (error) console.error("[HARVEST] record_harvest_failure error:", error.message);
}

interface AllocInput {
  contribution_id: string;
  wallet_address: string;
  basis_points: number;
  lamports: string; // bigint as string for jsonb
}

async function recordCycle(args: {
  launchId: string;
  gross: bigint;
  treasury: bigint;
  contributor: bigint;
  claimSig: string;
  treasurySig: string;
  vaultBefore: bigint;
  escrowBefore: bigint;
  escrowAfter: bigint;
  allocations: AllocInput[];
  notes?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("record_harvest_cycle", {
    p_launch_id: args.launchId,
    p_gross_lamports: args.gross.toString() as any,
    p_treasury_lamports: args.treasury.toString() as any,
    p_contributor_lamports: args.contributor.toString() as any,
    p_claim_tx_signature: args.claimSig,
    p_treasury_tx_signature: args.treasurySig,
    p_vault_balance_before: args.vaultBefore.toString() as any,
    p_escrow_balance_before: args.escrowBefore.toString() as any,
    p_escrow_balance_after: args.escrowAfter.toString() as any,
    p_allocations: args.allocations as any,
    p_notes: args.notes ?? null,
  });
  if (error) {
    throw new Error(`record_harvest_cycle failed: ${error.message}`);
  }
}

export async function harvestPerLaunchFees(): Promise<void> {
  if (!TREASURY_WALLET) {
    console.error("[HARVEST] BAGS_PARTNER_WALLET not set; skipping");
    return;
  }
  let treasuryPubkey: PublicKey;
  try {
    treasuryPubkey = new PublicKey(TREASURY_WALLET);
  } catch (err: any) {
    console.error(`[HARVEST] BAGS_PARTNER_WALLET invalid: ${err?.message ?? err}`);
    return;
  }

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");

  // Up to 10 launches per cycle to avoid runaway loops.
  for (let i = 0; i < 10; i++) {
    const launch = await claimNextLaunch();
    if (!launch) break;
    try {
      await harvestOne(launch, connection, treasuryPubkey);
    } catch (err: any) {
      const msg = `Unexpected: ${err?.message ?? err}`;
      console.error(`[HARVEST] ${launch.id}: ${msg}`);
      await recordFailure(launch.id, msg);
    }
  }
}

async function harvestOne(
  launch: Launch,
  connection: Connection,
  treasuryPubkey: PublicKey
): Promise<void> {
  if (!launch.lightning_wallet_public_key || !launch.lightning_wallet_encrypted_private_key) {
    await recordFailure(launch.id, "Missing lightning wallet credentials");
    return;
  }

  let lightningKp: Keypair;
  try {
    const secret = decryptEscrowKey(launch.lightning_wallet_encrypted_private_key);
    lightningKp = Keypair.fromSecretKey(new Uint8Array(secret));
  } catch (err: any) {
    await recordFailure(launch.id, `Decrypt lightning key failed: ${err?.message ?? err}`);
    return;
  }
  if (lightningKp.publicKey.toBase58() !== launch.lightning_wallet_public_key) {
    await recordFailure(
      launch.id,
      `Lightning keypair mismatch: derived ${lightningKp.publicKey.toBase58()} != stored ${launch.lightning_wallet_public_key}`
    );
    return;
  }

  const lockKey = lightningKp.publicKey.toBase58();

  try {
    await withCustodialLock(
      lockKey,
      WORKER_ID,
      async () => {
        await runHarvestCriticalSection(launch, lightningKp, connection, treasuryPubkey);
      },
      { timeoutMs: 60_000, ttlSeconds: 180 }
    );
  } catch (lockErr: any) {
    console.warn(
      `[HARVEST] ${launch.id}: could not acquire wallet lock: ${lockErr?.message ?? lockErr}`
    );
    // Release the harvest state so another tick can pick it up.
    await supabase.rpc("release_harvest_lock", { p_launch_id: launch.id });
  }
}

async function runHarvestCriticalSection(
  launch: Launch,
  lightningKp: Keypair,
  connection: Connection,
  treasuryPubkey: PublicKey
): Promise<void> {
  // Resolve creator pubkey BEFORE signing anything.
  // - Sponsored launches: prefer creator_delivery_wallet (entered by the
  //   influencer at claim time), fall back to created_by_wallet.
  // - Non-sponsored launches: created_by_wallet.
  // Legacy sponsored rows sometimes have a URL string in created_by_wallet
  // (e.g. STARBY) — tryParsePubkey returns null on those instead of throwing.
  const isSponsored = !!(launch as any).is_sponsored;
  const createdByRaw = (launch as any).created_by_wallet ?? null;
  const deliveryRaw = (launch as any).creator_delivery_wallet ?? null;

  let creatorPubkey: PublicKey | null = null;
  let resolutionPath = "unresolved";
  if (isSponsored) {
    const fromDelivery = tryParsePubkey(deliveryRaw);
    if (fromDelivery) {
      creatorPubkey = fromDelivery;
      resolutionPath = "sponsored:creator_delivery_wallet";
    } else {
      const fromCreated = tryParsePubkey(createdByRaw);
      if (fromCreated) {
        creatorPubkey = fromCreated;
        resolutionPath = "sponsored:created_by_wallet";
      }
    }
  } else {
    const fromCreated = tryParsePubkey(createdByRaw);
    if (fromCreated) {
      creatorPubkey = fromCreated;
      resolutionPath = "non_sponsored:created_by_wallet";
    }
  }

  if (!creatorPubkey) {
    console.error(
      `[HARVEST][CREATOR_RESOLVE] launch=${launch.id} sponsored=${isSponsored} result=unresolved ` +
        `created_by_wallet=${JSON.stringify(createdByRaw)} creator_delivery_wallet=${JSON.stringify(deliveryRaw)}`
    );
    await recordFailure(
      launch.id,
      "Could not resolve creator destination wallet for 70% share"
    );
    return;
  }

  console.log(
    `[HARVEST][CREATOR_RESOLVE] launch=${launch.id} sponsored=${isSponsored} ` +
      `path=${resolutionPath} creator=${creatorPubkey.toBase58()}`
  );

  const vaultPda = getCreatorVaultPda(lightningKp.publicKey);
  let vaultLamports = 0n;
  try {
    vaultLamports = BigInt(await connection.getBalance(vaultPda, "confirmed"));
  } catch (err: any) {
    console.warn(`[HARVEST] ${launch.id}: vault read failed: ${err?.message ?? err}`);
  }

  if (vaultLamports < MIN_HARVEST_LAMPORTS) {
    console.log(
      `[HARVEST] ${launch.id}: vault ${vaultLamports} < threshold ${MIN_HARVEST_LAMPORTS} (20x gas) — skip`
    );
    await recordEmpty(launch.id);
    return;
  }

  // Wallet health gate
  const escrowBefore = BigInt(
    await connection.getBalance(lightningKp.publicKey, "confirmed")
  );
  // Need to cover claim tx + creator transfer tx + treasury transfer tx
  // (3 tx fees + priority).
  const requiredBudget = TX_FEE_RESERVE * 3n + 100_000n;
  if (escrowBefore < requiredBudget) {
    await recordFailure(
      launch.id,
      `Lightning wallet balance ${escrowBefore} below required ${requiredBudget} for claim+creator+treasury tx fees`
    );
    return;
  }

  // ---- Claim ----
  const collectIx = buildCollectCreatorFeeIx(lightningKp.publicKey);
  const claimTx = new Transaction()
    .add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: PRIORITY_FEE_MICRO_LAMPORTS,
      })
    )
    .add(collectIx);
  claimTx.feePayer = lightningKp.publicKey;

  let claimSig: string;
  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    claimTx.recentBlockhash = blockhash;
    claimTx.sign(lightningKp);
    claimSig = await connection.sendRawTransaction(claimTx.serialize(), {
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(
      { signature: claimSig, blockhash, lastValidBlockHeight },
      "confirmed"
    );
    console.log(`[HARVEST] ${launch.id}: collect tx https://solscan.io/tx/${claimSig}`);
  } catch (err: any) {
    await recordFailure(launch.id, `collect_creator_fee tx failed: ${err?.message ?? err}`);
    return;
  }

  // ---- Compute gross from balance delta ----
  const escrowAfterClaim = BigInt(
    await connection.getBalance(lightningKp.publicKey, "confirmed")
  );
  // Balance delta accounts for claim tx fee implicitly. Add back the tx fee
  // to estimate gross fees claimed.
  const txFeeApprox = TX_FEE_RESERVE; // approximate
  const gross = escrowAfterClaim + txFeeApprox - escrowBefore;
  if (gross <= 0n) {
    console.log(`[HARVEST] ${launch.id}: claim landed but gross<=0 (delta=${escrowAfterClaim - escrowBefore})`);
    await recordEmpty(launch.id);
    return;
  }

  // 70/30 split. Treasury absorbs the rounding remainder so creator gets
  // exactly floor(gross * 0.7) and treasury gets the rest.
  const creatorLamports = (gross * BigInt(CREATOR_BPS)) / 10000n;
  const treasuryLamports = gross - creatorLamports;

  // ---- Creator transfer (paid first) ----
  let creatorSig: string;
  try {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: lightningKp.publicKey,
        toPubkey: creatorPubkey,
        lamports: Number(creatorLamports),
      })
    );
    tx.feePayer = lightningKp.publicKey;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.sign(lightningKp);
    creatorSig = await connection.sendRawTransaction(tx.serialize(), {
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(
      { signature: creatorSig, blockhash, lastValidBlockHeight },
      "confirmed"
    );
    console.log(`[HARVEST] ${launch.id}: creator tx https://solscan.io/tx/${creatorSig}`);
  } catch (err: any) {
    await recordFailure(
      launch.id,
      `Creator transfer failed (claim landed ${claimSig}): ${err?.message ?? err}`
    );
    return;
  }

  // ---- Treasury transfer ----
  let treasurySig: string;
  try {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: lightningKp.publicKey,
        toPubkey: treasuryPubkey,
        lamports: Number(treasuryLamports),
      })
    );
    tx.feePayer = lightningKp.publicKey;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.sign(lightningKp);
    treasurySig = await connection.sendRawTransaction(tx.serialize(), {
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(
      { signature: treasurySig, blockhash, lastValidBlockHeight },
      "confirmed"
    );
    console.log(`[HARVEST] ${launch.id}: treasury tx https://solscan.io/tx/${treasurySig}`);
  } catch (err: any) {
    await recordFailure(
      launch.id,
      `Treasury transfer failed (claim ${claimSig}, creator ${creatorSig}): ${err?.message ?? err}`
    );
    return;
  }

  const escrowAfter = BigInt(
    await connection.getBalance(lightningKp.publicKey, "confirmed")
  );

  // Creator is paid directly on-chain — no per-contributor allocation rows.
  const allocations: AllocInput[] = [];

  await recordCycle({
    launchId: launch.id,
    gross,
    treasury: treasuryLamports,
    // contributor column repurposed to record creator share (no schema change).
    contributor: creatorLamports,
    claimSig,
    treasurySig,
    vaultBefore: vaultLamports,
    escrowBefore,
    escrowAfter,
    allocations,
    notes: `path=${resolutionPath} creator=${creatorPubkey.toBase58()} creator_tx=${creatorSig}`,
  });

  console.log(
    `[HARVEST][SPLIT] launch=${launch.id} sponsored=${!!launch.is_sponsored} gross=${gross.toString()} ` +
      `creator_bps=${CREATOR_BPS} creator_lamports=${creatorLamports.toString()} ` +
      `creator_wallet=${creatorPubkey.toBase58()} creator_tx=${creatorSig} ` +
      `treasury_bps=${TREASURY_BPS} treasury_lamports=${treasuryLamports.toString()} ` +
      `treasury_wallet=${treasuryPubkey.toBase58()} treasury_tx=${treasurySig}`
  );

  console.log(
    `[HARVEST] ${launch.id}: cycle done. gross=${Number(gross) / LAMPORTS_PER_SOL} SOL, creator=${
      Number(creatorLamports) / LAMPORTS_PER_SOL
    } SOL (70%), treasury=${Number(treasuryLamports) / LAMPORTS_PER_SOL} SOL (30%)`
  );
}