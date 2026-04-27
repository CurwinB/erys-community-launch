import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  Launch,
  claimPumpfunFeeBatchForWorker,
  releaseLaunchLock,
  recordPumpfunEmptyClaim,
  recordPumpfunFeeClaimFailure,
  recordPumpfunWalletStarved,
  recordPumpfunFeeTreasurySweep,
  recordPumpfunCreatorVaultBalance,
} from "./db";
import { withCustodialLock } from "./custodialLock";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const ERYS_PLATFORM_WALLET = process.env.BAGS_PARTNER_WALLET!;
const PUMPPORTAL_API_KEY = process.env.PUMPPORTAL_API_KEY;
const PUMPPORTAL_CUSTODIAL_PRIVATE_KEY = process.env.PUMPPORTAL_CUSTODIAL_PRIVATE_KEY;
const PUMPPORTAL_CUSTODIAL_WALLET = process.env.PUMPPORTAL_CUSTODIAL_WALLET;
const PUMP_PROGRAM_ID = new PublicKey(
  process.env.PUMP_PROGRAM_ID || "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);

const WORKER_ID =
  process.env.WORKER_ID || process.env.RAILWAY_REPLICA_ID || "distributor-default";

// Tunables
const BATCH_SIZE = parseInt(process.env.PUMPFUN_FEE_BATCH_SIZE || "50", 10);
// Single collectCreatorFee call sweeps ALL of our coins' creator vaults at
// once (PumpPortal `pool: "pump"` semantics — see memory file
// pumpfun-creator-fees.md §31). So one cycle = one priority fee.
const SINGLE_CLAIM_PRIORITY_FEE_LAMPORTS = 55_000;
const TX_FEE_RESERVE = 5_000;
const CUSTODIAL_SOL_FLOOR_LAMPORTS = 2_000_000n; // 0.002 SOL

// Economic gate: only spend gas to claim when the on-chain creator vault
// holds at least this much above its rent-exempt minimum. Default 600,000
// lamports (0.0006 SOL) ≈ 10× the ~60k lamport per-cycle cost. Tunable via
// env so we can lower it once on-chain volume picks up. There is also a
// hard floor of 100,000 lamports — no matter what env value is set, we
// will never claim dust below that level.
const PUMPFUN_MIN_CLAIM_LAMPORTS = BigInt(
  process.env.PUMPFUN_MIN_CLAIM_LAMPORTS || "600000"
);
const PUMPFUN_MIN_CLAIM_HARD_FLOOR_LAMPORTS = 100_000n;

function getCreatorVaultPda(creator: PublicKey): PublicKey {
  // Pump program seeds: ["creator-vault", creator_pubkey]
  return PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creator.toBuffer()],
    PUMP_PROGRAM_ID
  )[0];
}

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

interface PerLaunchResult {
  launch: Launch;
  claimedLamports: number; // share of the batch-claim total attributed to this launch
  vaultEmpty: boolean;
  errored?: string;
}

/**
 * Batched Pump.fun creator-fee claim.
 *
 * One pass per cycle:
 *   1. Atomically claim up to BATCH_SIZE eligible launches from the DB.
 *   2. Acquire the custodial lock ONCE.
 *   3. Issue ONE collectCreatorFee call. PumpPortal sweeps every creator
 *      vault our custodial wallet owns into the wallet in a single on-chain
 *      tx, so a batch of N launches still only costs ONE priority fee.
 *   4. Attribute the total claimed delta to each launch in proportion to
 *      its all-time fee accrual estimate (we use equal-share fallback if we
 *      have no per-launch volume data — fees-then-rebalance is acceptable
 *      because the platform takes 100% of creator fees anyway and the
 *      escrow wallets are intermediate routing).
 *   5. Fan out via MAX_FANOUT_PER_TX-instruction txs to each launch's escrow.
 *   6. Release the custodial lock.
 *   7. In parallel, run each launch's escrow → platform-wallet transfer.
 *
 * Wallet-health budget: before claiming, we make sure the custodial wallet
 * holds enough SOL to pay the single claim priority fee PLUS the fan-out
 * tx fees. If not, we abort the cycle and surface the failure on each
 * launch row so it shows up in the admin panel.
 */
export async function claimPumpfunFeesBatch(): Promise<void> {
  if (!PUMPPORTAL_API_KEY) {
    console.error("PUMPPORTAL_API_KEY not set; skipping batched fee claim");
    return;
  }
  if (!ERYS_PLATFORM_WALLET) {
    console.error(
      "BAGS_PARTNER_WALLET (treasury) not set; skipping batched fee claim"
    );
    return;
  }
  let treasuryPubkey: PublicKey;
  try {
    treasuryPubkey = new PublicKey(ERYS_PLATFORM_WALLET);
  } catch (err: any) {
    console.error(
      `BAGS_PARTNER_WALLET is not a valid Solana address: ${
        err?.message ?? err
      }`
    );
    return;
  }

  let custodialKeypair: Keypair;
  try {
    custodialKeypair = getCustodialKeypair();
  } catch (err: any) {
    console.error("Custodial wallet not configured:", err?.message ?? err);
    return;
  }

  const launches = await claimPumpfunFeeBatchForWorker(WORKER_ID, BATCH_SIZE);
  if (launches.length === 0) return;

  console.log(
    `Worker ${WORKER_ID} batched ${launches.length} Pump.fun launch(es) for fee claim`
  );

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");

  // We no longer need escrow keys for the sweep — claimed creator fees are
  // sent directly from the custodial wallet to the platform treasury. We
  // still iterate through the claimed launches so we can attribute the sweep
  // proportionally and stamp per-launch accounting rows.
  const candidates: PerLaunchResult[] = [];
  for (const launch of launches) {
    candidates.push({
      launch,
      claimedLamports: 0,
      vaultEmpty: false,
    });
  }

  if (candidates.length === 0) return;

  // ============================================================
  // CRITICAL SECTION: hold the custodial lock for the WHOLE batch.
  // This is the bottleneck-buster: instead of N lock acquisitions
  // serialized across all replicas, we do ONE.
  // ============================================================
  const lockKey = custodialKeypair.publicKey.toBase58();
  let preBalance = 0n;
  let postClaimBalance = 0n;
  let sweepableLamports = 0n;
  let sweepSignature: string | null = null;
  try {
    await withCustodialLock(
      lockKey,
      WORKER_ID,
      async () => {
        // Wallet-health budget gate
        preBalance = BigInt(
          await connection.getBalance(custodialKeypair.publicKey, "confirmed")
        );
        // We send a single SystemProgram.transfer to the treasury, so reserve
        // exactly one tx fee on top of the claim priority fee + floor.
        const requiredForClaims =
          BigInt(SINGLE_CLAIM_PRIORITY_FEE_LAMPORTS) +
          BigInt(TX_FEE_RESERVE) +
          CUSTODIAL_SOL_FLOOR_LAMPORTS;
        if (preBalance < requiredForClaims) {
          const msg = `Custodial wallet balance ${preBalance} below required ${requiredForClaims} for batch of ${candidates.length} (need ~${
            Number(requiredForClaims) / LAMPORTS_PER_SOL
          } SOL). Aborting cycle.`;
          console.error(msg);
          // Surface the error in the admin panel BUT don't stamp the 10-min
          // throttle — top up the wallet and the next 30s poll will retry.
          // Also release the row-locks so any replica can pick them up.
          for (const c of candidates) {
            await recordPumpfunWalletStarved(c.launch.id, msg);
            await releaseLaunchLock(c.launch.id);
          }
          return;
        }
        console.log(
          `Custodial pre-batch balance: ${
            Number(preBalance) / LAMPORTS_PER_SOL
          } SOL (budget ${
            Number(requiredForClaims) / LAMPORTS_PER_SOL
          } SOL — 1 claim sweeps all ${candidates.length} vaults)`
        );

        // ============================================================
        // ECONOMIC GATE: peek at the creator vault PDA on-chain BEFORE
        // burning ~55k lamports of priority fee. The vault is a single
        // PDA owned by our custodial wallet that holds fees from EVERY
        // coin we've created (pool: "pump" claims sweep all of them).
        // If the claimable balance is below our minimum, skip the API
        // call entirely and stamp the empty-claim throttle.
        // ============================================================
        const vaultPda = getCreatorVaultPda(custodialKeypair.publicKey);
        let vaultLamports = 0n;
        try {
          vaultLamports = BigInt(
            await connection.getBalance(vaultPda, "confirmed")
          );
        } catch (err: any) {
          console.warn(
            `Failed to read creator vault PDA ${vaultPda.toBase58()}: ${
              err?.message ?? err
            } — proceeding with claim anyway`
          );
        }
        // Persist for admin visibility regardless of outcome.
        await recordPumpfunCreatorVaultBalance(
          candidates.map((c) => c.launch.id),
          Number(vaultLamports)
        );

        const minClaim =
          PUMPFUN_MIN_CLAIM_LAMPORTS < PUMPFUN_MIN_CLAIM_HARD_FLOOR_LAMPORTS
            ? PUMPFUN_MIN_CLAIM_HARD_FLOOR_LAMPORTS
            : PUMPFUN_MIN_CLAIM_LAMPORTS;
        if (vaultLamports > 0n && vaultLamports < minClaim) {
          console.log(
            `Creator vault holds ${
              Number(vaultLamports) / LAMPORTS_PER_SOL
            } SOL (${vaultLamports} lamports), below threshold ${minClaim} — skipping claim to avoid burning gas on dust`
          );
          for (const c of candidates) c.vaultEmpty = true;
          return;
        }
        if (vaultLamports >= minClaim) {
          console.log(
            `Creator vault has ${
              Number(vaultLamports) / LAMPORTS_PER_SOL
            } SOL — above threshold ${
              Number(minClaim) / LAMPORTS_PER_SOL
            } SOL, proceeding with claim`
          );
        }

        // ONE collectCreatorFee call drains every creator vault our wallet
        // owns. `mint` is ignored when pool === "pump".
        const claimRes = await collectAllCreatorFees(connection);
        if (!claimRes.success) {
          console.error(`Batch collectCreatorFee failed: ${claimRes.error}`);
          for (const c of candidates) {
            await recordPumpfunFeeClaimFailure(c.launch.id, claimRes.error);
          }
          return;
        }

        postClaimBalance = BigInt(
          await connection.getBalance(custodialKeypair.publicKey, "confirmed")
        );

        // SWEEP RULE: send everything above the rent-exempt floor + one tx
        // fee from the custodial wallet straight to the treasury. This
        // captures both newly claimed fees AND any leftover SOL from prior
        // cycles (e.g. successful claims whose downstream sweep failed). We
        // do not need per-launch escrow routing — the platform takes 100% of
        // Pump.fun creator fees, so the funds belong directly to treasury.
        sweepableLamports =
          postClaimBalance -
          CUSTODIAL_SOL_FLOOR_LAMPORTS -
          BigInt(TX_FEE_RESERVE);
        if (sweepableLamports <= 0n) {
          console.log(
            `Nothing sweepable this cycle (post=${postClaimBalance}, floor=${CUSTODIAL_SOL_FLOOR_LAMPORTS})`
          );
          for (const c of candidates) c.vaultEmpty = true;
          return;
        }
        console.log(
          `Sweeping ${
            Number(sweepableLamports) / LAMPORTS_PER_SOL
          } SOL from custodial → treasury (${treasuryPubkey.toBase58()})`
        );

        try {
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: custodialKeypair.publicKey,
              toPubkey: treasuryPubkey,
              lamports: Number(sweepableLamports),
            })
          );
          tx.feePayer = custodialKeypair.publicKey;
          const { blockhash, lastValidBlockHeight } =
            await connection.getLatestBlockhash("confirmed");
          tx.recentBlockhash = blockhash;
          tx.sign(custodialKeypair);
          sweepSignature = await connection.sendRawTransaction(
            tx.serialize(),
            { preflightCommitment: "confirmed" }
          );
          await connection.confirmTransaction(
            {
              signature: sweepSignature,
              blockhash,
              lastValidBlockHeight,
            },
            "confirmed"
          );
          console.log(
            `Treasury sweep landed: https://solscan.io/tx/${sweepSignature}`
          );

          // Attribute the sweep equally across the batched launches so
          // per-launch accounting totals stay meaningful.
          const share =
            sweepableLamports / BigInt(Math.max(candidates.length, 1));
          const remainder =
            sweepableLamports - share * BigInt(candidates.length);
          candidates.forEach((c, i) => {
            c.claimedLamports = Number(share + (i === 0 ? remainder : 0n));
          });
        } catch (err: any) {
          sweepSignature = null;
          const msg = `Treasury sweep failed: ${err?.message ?? err}`;
          console.error(msg);
          for (const c of candidates) {
            c.errored = msg;
            await recordPumpfunFeeClaimFailure(c.launch.id, msg);
          }
        }
      },
      { timeoutMs: 180_000, ttlSeconds: 240 }
    );
  } catch (lockErr: any) {
    console.error(
      `Could not acquire custodial lock for batch fee claim: ${
        lockErr?.message ?? lockErr
      }`
    );
    // Release all the row-locks so another worker can pick them up.
    for (const c of candidates) await releaseLaunchLock(c.launch.id);
    return;
  }

  // ===== Outside the custodial lock: per-launch accounting =====
  await Promise.all(
    candidates.map(async (c) => {
      try {
        if (c.errored) return; // already recorded
        if (c.vaultEmpty) {
          await recordPumpfunEmptyClaim(c.launch.id);
          return;
        }
        if (c.claimedLamports <= 0 || !sweepSignature) return;
        await recordPumpfunFeeTreasurySweep({
          launchId: c.launch.id,
          sourceWallet: custodialKeypair.publicKey.toBase58(),
          treasuryWallet: treasuryPubkey.toBase58(),
          amountLamports: c.claimedLamports,
          txSignature: sweepSignature,
          notes: `Batch sweep across ${candidates.length} launch(es)`,
        });
      } finally {
        await releaseLaunchLock(c.launch.id);
      }
    })
  );

  console.log(
    `Batch complete. Processed ${candidates.length} launch(es); swept ${
      Number(sweepableLamports) / LAMPORTS_PER_SOL
    } SOL to treasury.`
  );
}

async function collectAllCreatorFees(
  connection: Connection
): Promise<{ success: true } | { success: false; error: string }> {
  const response = await fetch(
    `https://pumpportal.fun/api/trade?api-key=${encodeURIComponent(
      PUMPPORTAL_API_KEY!
    )}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "collectCreatorFee",
        priorityFee: 0.00005,
        pool: "pump",
      }),
    }
  );
  const json: any = await response.json().catch(() => ({}));
  // PumpPortal returns 200 with `errors: []` on success. The empty array is
  // truthy in JS, so we MUST check length, not the array itself.
  const errorList = Array.isArray(json?.errors) ? json.errors : [];
  if (!response.ok || errorList.length > 0) {
    const summary =
      errorList.join(" | ") ||
      JSON.stringify(json).slice(0, 300) ||
      response.statusText;
    return {
      success: false,
      error: `PumpPortal collectCreatorFee HTTP ${response.status}: ${summary}`,
    };
  }
  const sig: string | undefined = json?.signature;
  if (sig) {
    try {
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
      );
    } catch {
      // confirmation timeout is non-fatal — the balance check will tell us
      // whether it landed.
    }
  }
  return { success: true };
}
