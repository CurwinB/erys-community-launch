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
  getLaunchFeeSplit,
  recordAffiliateEarning,
  recordCodevBatch,
  accrueCodevPending,
  CodevAllocation,
  CodevPayoutRecord,
} from "./db";
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
// safety buffer ~110k lamports default. This is the base (no co-dev) case;
// launches with co-dev sharing enabled compute a bigger, dynamic estimate —
// see estimateGasLamports() below — that scales with batch count instead of
// using this fixed constant directly.
const GAS_ESTIMATE_LAMPORTS = BigInt(
  process.env.PER_LAUNCH_HARVEST_GAS_ESTIMATE_LAMPORTS || "110000"
);
const MIN_HARVEST_MULTIPLIER = BigInt(
  process.env.PER_LAUNCH_MIN_HARVEST_MULTIPLIER || "20"
);
const MIN_HARVEST_LAMPORTS = GAS_ESTIMATE_LAMPORTS * MIN_HARVEST_MULTIPLIER;

// =====================================================================
// Co-dev fee sharing constants.
//
// Single source of truth: PER_TX_GAS_LAMPORTS is the only tunable. Every
// other gas figure (per-recipient floor, per-launch dynamic estimate) is
// derived from it so they can never drift out of sync with each other.
// =====================================================================
const PER_TX_GAS_LAMPORTS = BigInt(
  process.env.PER_TX_GAS_LAMPORTS || "50000"
);
const CODEV_BATCH_SIZE = 15;
// Derived, never independently configured.
const PER_RECIPIENT_BATCH_GAS_LAMPORTS =
  PER_TX_GAS_LAMPORTS / BigInt(CODEV_BATCH_SIZE);
// Layer 2 floor: a co-dev's share (current + accrued pending) must be worth
// at least 20x their pro-rata slice of batch gas, or it accrues instead of
// being sent this cycle.
const PER_CODEV_FLOOR_LAMPORTS =
  MIN_HARVEST_MULTIPLIER * PER_RECIPIENT_BATCH_GAS_LAMPORTS;

// Dynamic per-cycle gas estimate: claim + creator + treasury (+ affiliate)
// + however many 15-wide co-dev batches this launch needs this cycle.
// Replaces the flat GAS_ESTIMATE_LAMPORTS whenever codevCount > 0.
function estimateGasLamports(codevCount: number, hasAffiliate: boolean): bigint {
  const batchCount = Math.ceil(codevCount / CODEV_BATCH_SIZE);
  const totalTxs = 1n /* claim */ + 1n /* creator */ +
    (hasAffiliate ? 1n : 0n) +
    BigInt(batchCount) +
    1n /* treasury */;
  return totalTxs * PER_TX_GAS_LAMPORTS;
}

// Default per-launch Pump.fun fee split: 70% to creator (launches.created_by_wallet),
// 30% to platform treasury. This is the fallback used only if the
// get_launch_fee_split RPC call fails. Normal operation reads the live
// split from that RPC instead, which becomes 70/15/15 with an affiliate cut
// when the launch is affiliate-attributed. Sponsored launches follow the
// same routing — creator share NEVER re-routes to treasury based on sponsor
// identity.
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

// Proportional share of the co-dev pool, BigInt math, remainder dumped to
// the largest contributor. Mirrors calculateSharesFromBalance in
// distributor/src/distribute.ts. Adds each wallet's currently-accrued
// pending_lamports on top of their new share for this cycle, since accrual
// is "owed but not yet paid," not a separate pool.
function computeCodevShares(
  allocations: CodevAllocation[],
  codevPoolLamports: bigint
): Map<string, bigint> {
  const shares = new Map<string, bigint>();
  if (codevPoolLamports <= 0n || allocations.length === 0) return shares;

  const totalWeight = allocations.reduce(
    (sum, a) => sum + BigInt(a.weight || "0"),
    0n
  );
  if (totalWeight === 0n) return shares;

  const rawShares = allocations.map((a) => ({
    wallet: a.wallet_address,
    share:
      (BigInt(a.weight || "0") * codevPoolLamports) / totalWeight +
      BigInt(a.pending_lamports || "0"),
    weight: BigInt(a.weight || "0"),
  }));

  // Remainder from the pool-only (non-pending) portion goes to the largest
  // contributor by weight, so the full pool is always distributed with no
  // dead bps regardless of roster size.
  const poolOnlyTotal = rawShares.reduce(
    (sum, s) => sum + (s.weight * codevPoolLamports) / totalWeight,
    0n
  );
  const remainder = codevPoolLamports - poolOnlyTotal;
  if (remainder > 0n && rawShares.length > 0) {
    const largest = rawShares.reduce((a, b) => (b.weight > a.weight ? b : a));
    largest.share += remainder;
  }

  for (const s of rawShares) shares.set(s.wallet, s.share);
  return shares;
}

// Sends one batch (up to CODEV_BATCH_SIZE recipients) as a single tx with
// N transfer instructions. Batches are atomic on Solana: if one recipient
// in the batch is bad, the whole batch fails together, but other batches
// are unaffected — the caller re-accrues a failed batch's wallets rather
// than losing their share.
async function sendCodevBatch(
  connection: Connection,
  payerKp: Keypair,
  recipients: { wallet: string; amount: bigint }[]
): Promise<string> {
  const tx = new Transaction();
  tx.add(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: PRIORITY_FEE_MICRO_LAMPORTS,
    })
  );
  for (const r of recipients) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: payerKp.publicKey,
        toPubkey: new PublicKey(r.wallet),
        lamports: Number(r.amount),
      })
    );
  }
  tx.feePayer = payerKp.publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(
    "confirmed"
  );
  tx.recentBlockhash = blockhash;
  tx.sign(payerKp);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  return sig;
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

  // ---- Resolve fee split (creator/treasury/affiliate) ----
  // Reads the live split from Supabase. Falls back to the hardcoded 70/30
  // default if the RPC call fails, so a transient DB issue never blocks a
  // harvest, it just means an affiliate-attributed launch would (rarely,
  // and only on RPC failure) skip its affiliate cut for that one cycle
  // rather than misroute funds on bad data.
  const liveSplit = await getLaunchFeeSplit(launch.id);
  const creatorBps = liveSplit?.creator_bps ?? CREATOR_BPS;
  const treasuryBps = liveSplit?.treasury_bps ?? TREASURY_BPS;
  const affiliateBps = liveSplit?.affiliate_bps ?? 0;
  let affiliatePubkey: PublicKey | null = null;
  if (affiliateBps > 0) {
    affiliatePubkey = tryParsePubkey(liveSplit?.affiliate_wallet);
    if (!affiliatePubkey) {
      console.error(
        `[HARVEST][AFFILIATE_RESOLVE] launch=${launch.id} affiliate_bps=${affiliateBps} ` +
          `but affiliate_wallet is missing or unparseable: ${JSON.stringify(liveSplit?.affiliate_wallet)}`
      );
      await recordFailure(
        launch.id,
        "Affiliate split present but affiliate destination wallet could not be resolved"
      );
      return;
    }
  }
  const hasAffiliate = affiliatePubkey !== null;

  // ---- Co-dev allocations (read once, reused for threshold + payout) ----
  const codevBps = liveSplit?.codev_bps ?? 0;
  const codevAllocations: CodevAllocation[] = codevBps > 0
    ? (liveSplit?.codev_allocations ?? [])
    : [];
  const hasCodevs = codevBps > 0 && codevAllocations.length > 0;

  const vaultPda = getCreatorVaultPda(lightningKp.publicKey);
  let vaultLamports = 0n;
  try {
    vaultLamports = BigInt(await connection.getBalance(vaultPda, "confirmed"));
  } catch (err: any) {
    console.warn(`[HARVEST] ${launch.id}: vault read failed: ${err?.message ?? err}`);
  }

  // Dynamic threshold: launches with co-dev sharing enabled need a bigger
  // vault balance before it's worth harvesting, since more batch txs are
  // required. Non-codev launches keep the existing flat 20x-gas gate.
  const minHarvestLamports = hasCodevs
    ? estimateGasLamports(codevAllocations.length, hasAffiliate) * MIN_HARVEST_MULTIPLIER
    : MIN_HARVEST_LAMPORTS;

  if (vaultLamports < minHarvestLamports) {
    console.log(
      `[HARVEST] ${launch.id}: vault ${vaultLamports} < threshold ${minHarvestLamports} (20x gas${
        hasCodevs ? `, ${codevAllocations.length} co-devs` : ""
      }) — skip`
    );
    await recordEmpty(launch.id);
    return;
  }

  // Wallet health gate
  const escrowBefore = BigInt(
    await connection.getBalance(lightningKp.publicKey, "confirmed")
  );
  // Need to cover claim tx + creator transfer tx + treasury transfer tx,
  // plus a 4th affiliate transfer tx when this launch is affiliate-attributed,
  // plus one tx per 15-wide co-dev batch when co-dev sharing is enabled.
  const codevBatchCount = hasCodevs
    ? Math.ceil(codevAllocations.length / CODEV_BATCH_SIZE)
    : 0;
  const requiredTxCount =
    (hasAffiliate ? 4n : 3n) + BigInt(codevBatchCount);
  const requiredBudget = TX_FEE_RESERVE * requiredTxCount + 100_000n;
  if (escrowBefore < requiredBudget) {
    await recordFailure(
      launch.id,
      `Lightning wallet balance ${escrowBefore} below required ${requiredBudget} for claim+creator+treasury${
        hasAffiliate ? "+affiliate" : ""
      } tx fees`
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

  // Gas comes off the top of gross BEFORE any bps math runs, so every
  // party's payout equals their bps of NET (gross minus gas), not their bps
  // minus their own gas. The cost is genuinely shared across everyone since
  // it's deducted once here, not nickel-and-dimed per transfer. Treasury
  // absorbs both the gas cost and the rounding remainder.
  const cycleGasEstimate = hasCodevs
    ? estimateGasLamports(codevAllocations.length, hasAffiliate)
    : GAS_ESTIMATE_LAMPORTS;
  const netGross = gross > cycleGasEstimate ? gross - cycleGasEstimate : 0n;

  const creatorLamports = (netGross * BigInt(creatorBps)) / 10000n;
  const affiliateLamports = hasAffiliate
    ? (netGross * BigInt(affiliateBps)) / 10000n
    : 0n;
  const codevPoolLamports = hasCodevs
    ? (netGross * BigInt(codevBps)) / 10000n
    : 0n;
  const treasuryLamports =
    gross - creatorLamports - affiliateLamports - codevPoolLamports;

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

  // ---- Affiliate transfer (only when this launch is affiliate-attributed) ----
  let affiliateSig: string | null = null;
  if (hasAffiliate && affiliatePubkey) {
    let broadcastSig: string | null = null;
    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: lightningKp.publicKey,
          toPubkey: affiliatePubkey,
          lamports: Number(affiliateLamports),
        })
      );
      tx.feePayer = lightningKp.publicKey;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.sign(lightningKp);
      const sentSig: string = await connection.sendRawTransaction(tx.serialize(), {
        preflightCommitment: "confirmed",
      });
      broadcastSig = sentSig;
      await connection.confirmTransaction(
        { signature: sentSig, blockhash, lastValidBlockHeight },
        "confirmed"
      );
      console.log(`[HARVEST] ${launch.id}: affiliate tx https://solscan.io/tx/${sentSig}`);
      await recordAffiliateEarning({
        launchId: launch.id,
        amountLamports: affiliateLamports,
        txSignature: sentSig,
        status: "paid",
      });
      affiliateSig = sentSig;
    } catch (err: any) {
      // Affiliate transfer failing should NOT block creator/treasury, the
      // creator has already been paid above. Fail closed: this cycle's
      // affiliate cut is NEVER rolled into the treasury transfer below. It
      // stays unsent in the lightning wallet and is logged as pending/failed
      // for manual reconciliation or a future retry job, the affiliate is
      // still owed it rather than having it quietly absorbed by treasury.
      console.error(
        `[HARVEST] ${launch.id}: affiliate transfer failed (claim ${claimSig}, creator ${creatorSig}): ${
          err?.message ?? err
        }`
      );
      await recordAffiliateEarning({
        launchId: launch.id,
        amountLamports: affiliateLamports,
        // broadcastSig set means a tx was actually sent but didn't confirm
        // or reverted ("failed"); null means it never made it onto the
        // chain at all, still owed and awaiting a retry ("pending").
        txSignature: broadcastSig,
        status: broadcastSig ? "failed" : "pending",
      });
      affiliateSig = null;
    }
  }

  // ---- Co-dev batch payouts (only when this launch has co-dev sharing) ----
  // Runs after creator/affiliate, before treasury, so treasury always ends
  // up with "whatever's left" — consistent with how it already absorbs gas
  // and rounding.
  let codevSig: string | null = null; // last successful batch tx, for cycle notes
  let codevPaidTotal = 0n;
  if (hasCodevs && codevPoolLamports > 0n) {
    const shares = computeCodevShares(codevAllocations, codevPoolLamports);

    const toPay: { wallet: string; amount: bigint }[] = [];
    const toAccrue: CodevPayoutRecord[] = [];
    for (const [wallet, amount] of shares) {
      if (amount >= PER_CODEV_FLOOR_LAMPORTS) {
        toPay.push({ wallet, amount });
      } else if (amount > 0n) {
        // Below floor — don't spend gas moving dust. Accrue it; it's
        // re-evaluated against the floor next cycle, never dropped.
        toAccrue.push({ wallet_address: wallet, amount_lamports: amount.toString() });
      }
    }

    if (toAccrue.length > 0) {
      await accrueCodevPending(launch.id, toAccrue);
      console.log(
        `[HARVEST][CODEV] ${launch.id}: ${toAccrue.length} wallet(s) below floor (${PER_CODEV_FLOOR_LAMPORTS} lamports), accrued for next cycle`
      );
    }

    for (let i = 0; i < toPay.length; i += CODEV_BATCH_SIZE) {
      const batch = toPay.slice(i, i + CODEV_BATCH_SIZE);
      try {
        const sig = await sendCodevBatch(connection, lightningKp, batch);
        codevSig = sig;
        const paidRecords: CodevPayoutRecord[] = batch.map((b) => ({
          wallet_address: b.wallet,
          amount_lamports: b.amount.toString(),
        }));
        await recordCodevBatch({
          launchId: launch.id,
          cycleId: null,
          txSignature: sig,
          payouts: paidRecords,
        });
        codevPaidTotal += batch.reduce((sum, b) => sum + b.amount, 0n);
        console.log(
          `[HARVEST][CODEV] ${launch.id}: batch of ${batch.length} paid, tx https://solscan.io/tx/${sig}`
        );
      } catch (err: any) {
        // Batch failed — every wallet in it stays owed. Re-accrue the whole
        // batch rather than letting a single bad recipient silently cost
        // 14 good ones their payout; they'll clear on the next cycle's
        // batching pass (possibly grouped differently).
        console.error(
          `[HARVEST][CODEV] ${launch.id}: batch of ${batch.length} failed (claim ${claimSig}, creator ${creatorSig}): ${
            err?.message ?? err
          }`
        );
        await accrueCodevPending(
          launch.id,
          batch.map((b) => ({
            wallet_address: b.wallet,
            amount_lamports: b.amount.toString(),
          }))
        );
      }
      // Small delay between batches, same courtesy as the distributor's
      // per-contributor loop, to avoid hammering the RPC.
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // ---- Treasury transfer ----
  // Always exactly treasuryLamports — never absorbs a failed/pending
  // affiliate cut. That amount stays in the lightning wallet, owed to the
  // affiliate, until it's retried.
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
    notes:
      `path=${resolutionPath} creator=${creatorPubkey.toBase58()} creator_tx=${creatorSig}` +
      (hasAffiliate
        ? ` affiliate=${affiliatePubkey?.toBase58()} affiliate_tx=${affiliateSig ?? "FAILED_pending_retry_in_lightning_wallet"}`
        : "") +
      (hasCodevs
        ? ` codev_pool=${codevPoolLamports.toString()} codev_paid=${codevPaidTotal.toString()} codev_last_tx=${codevSig ?? "none"}`
        : ""),
  });

  console.log(
    `[HARVEST][SPLIT] launch=${launch.id} sponsored=${!!launch.is_sponsored} gross=${gross.toString()} gas=${cycleGasEstimate.toString()} net=${netGross.toString()} ` +
      `creator_bps=${creatorBps} creator_lamports=${creatorLamports.toString()} ` +
      `creator_wallet=${creatorPubkey.toBase58()} creator_tx=${creatorSig} ` +
      (hasAffiliate
        ? `affiliate_bps=${affiliateBps} affiliate_lamports=${affiliateLamports.toString()} ` +
          `affiliate_wallet=${affiliatePubkey?.toBase58()} affiliate_tx=${affiliateSig ?? "FAILED_PENDING_RETRY"} `
        : "") +
      (hasCodevs
        ? `codev_bps=${codevBps} codev_pool_lamports=${codevPoolLamports.toString()} codev_paid_lamports=${codevPaidTotal.toString()} codev_recipients=${codevAllocations.length} `
        : "") +
      `treasury_bps=${treasuryBps} treasury_lamports=${treasuryLamports.toString()} ` +
      `treasury_wallet=${treasuryPubkey.toBase58()} treasury_tx=${treasurySig}`
  );

  console.log(
    `[HARVEST] ${launch.id}: cycle done. gross=${Number(gross) / LAMPORTS_PER_SOL} SOL, creator=${
      Number(creatorLamports) / LAMPORTS_PER_SOL
    } SOL (${creatorBps / 100}%), treasury=${
      Number(treasuryLamports) / LAMPORTS_PER_SOL
    } SOL (${treasuryBps / 100}%)` +
      (hasAffiliate
        ? `, affiliate=${Number(affiliateLamports) / LAMPORTS_PER_SOL} SOL (${
            affiliateBps / 100
          }%)${affiliateSig ? "" : " [transfer failed, still owed, left in lightning wallet pending retry]"}`
        : "") +
      (hasCodevs
        ? `, codev_pool=${Number(codevPoolLamports) / LAMPORTS_PER_SOL} SOL (${
            codevBps / 100
          }%), codev_paid=${Number(codevPaidTotal) / LAMPORTS_PER_SOL} SOL to ${codevAllocations.length} recipient(s)`
        : "")
  );
}
