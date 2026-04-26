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
import {
  Launch,
  claimPumpfunFeeBatchForWorker,
  releaseLaunchLock,
  updatePumpfunFeesClaimed,
  recordPumpfunEmptyClaim,
  recordPumpfunFeeClaimFailure,
} from "./db";
import { withCustodialLock } from "./custodialLock";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const ERYS_PLATFORM_WALLET = process.env.BAGS_PARTNER_WALLET!;
const PUMPPORTAL_API_KEY = process.env.PUMPPORTAL_API_KEY;
const PUMPPORTAL_CUSTODIAL_PRIVATE_KEY = process.env.PUMPPORTAL_CUSTODIAL_PRIVATE_KEY;
const PUMPPORTAL_CUSTODIAL_WALLET = process.env.PUMPPORTAL_CUSTODIAL_WALLET;

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
// Max SystemProgram.transfer instructions per single tx — well within Solana's
// 1232-byte tx size and 64 account limits.
const MAX_FANOUT_PER_TX = 10;

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
  escrowKeypair: Keypair;
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

  // Decrypt all escrow keys up front. Failures are recorded and excluded.
  const candidates: PerLaunchResult[] = [];
  for (const launch of launches) {
    try {
      const decrypted = decryptEscrowKey(launch.escrow_wallet_encrypted_private_key);
      const escrowKeypair = Keypair.fromSecretKey(new Uint8Array(decrypted));
      candidates.push({
        launch,
        escrowKeypair,
        claimedLamports: 0,
        vaultEmpty: false,
      });
    } catch (err: any) {
      console.error(
        `Failed to decrypt escrow key for launch ${launch.id}: ${err?.message ?? err}`
      );
      await recordPumpfunFeeClaimFailure(
        launch.id,
        `Failed to decrypt escrow key: ${err?.message ?? err}`
      );
      await releaseLaunchLock(launch.id);
    }
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
  let totalClaimedLamports = 0n;
  try {
    await withCustodialLock(
      lockKey,
      WORKER_ID,
      async () => {
        // Wallet-health budget gate
        preBalance = BigInt(
          await connection.getBalance(custodialKeypair.publicKey, "confirmed")
        );
        const fanoutTxCount = Math.ceil(candidates.length / MAX_FANOUT_PER_TX);
        const requiredForClaims =
          BigInt(SINGLE_CLAIM_PRIORITY_FEE_LAMPORTS) +
          BigInt(fanoutTxCount) * BigInt(TX_FEE_RESERVE) +
          CUSTODIAL_SOL_FLOOR_LAMPORTS;
        if (preBalance < requiredForClaims) {
          const msg = `Custodial wallet balance ${preBalance} below required ${requiredForClaims} for batch of ${candidates.length} (need ~${
            Number(requiredForClaims) / LAMPORTS_PER_SOL
          } SOL). Aborting cycle.`;
          console.error(msg);
          for (const c of candidates) {
            await recordPumpfunFeeClaimFailure(c.launch.id, msg);
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
        const delta = postClaimBalance - preBalance;
        // The single claim tx burned its own priority fee from the custodial
        // wallet, so gross claimed = delta + priority fee.
        totalClaimedLamports =
          delta + BigInt(SINGLE_CLAIM_PRIORITY_FEE_LAMPORTS);
        if (totalClaimedLamports <= 0n) {
          console.log("All vaults empty this cycle — nothing to fan out.");
          // Mark every launch as an empty claim so chronically empty ones
          // back off to the 1h throttle.
          for (const c of candidates) c.vaultEmpty = true;
          return;
        }
        console.log(
          `Total claimed this batch: ${
            Number(totalClaimedLamports) / LAMPORTS_PER_SOL
          } SOL across ${candidates.length} launches`
        );

        // Attribute the gross claim equally across launches. We can't tell
        // per-launch shares from a single batched claim, but since the
        // platform takes 100% of creator fees anyway, the per-launch
        // attribution only affects accounting/auditing rows in `launches`.
        // Equal-share is the honest default given the API's batching.
        const share = totalClaimedLamports / BigInt(candidates.length);
        const remainder = totalClaimedLamports - share * BigInt(candidates.length);
        candidates.forEach((c, i) => {
          c.claimedLamports = Number(share + (i === 0 ? remainder : 0n));
        });
        const fundedRecipients = candidates.filter((c) => c.claimedLamports > 0);

        // Sanity: cap total fan-out to what's actually in the wallet above
        // the floor + tx fees we'll need.
        const txCount = Math.ceil(
          fundedRecipients.length / MAX_FANOUT_PER_TX
        );
        const maxFanout =
          postClaimBalance -
          CUSTODIAL_SOL_FLOOR_LAMPORTS -
          BigInt(txCount) * BigInt(TX_FEE_RESERVE);
        if (maxFanout <= 0n) {
          console.error(
            `Custodial balance too low after claims to fan out (post=${postClaimBalance})`
          );
          for (const c of fundedRecipients) {
            await recordPumpfunFeeClaimFailure(
              c.launch.id,
              `Insufficient custodial balance after batch claims to sweep`
            );
          }
          return;
        }

        // If for some reason the total claimed exceeds what's sweepable
        // (e.g. we over-attributed because of float in concurrent priority
        // fees), scale down proportionally.
        let scaleNum = 1;
        let scaleDen = 1;
        if (totalClaimedLamports > maxFanout) {
          scaleNum = Number(maxFanout);
          scaleDen = Number(totalClaimedLamports);
          console.warn(
            `Scaling fan-out by ${scaleNum}/${scaleDen} to fit custodial balance`
          );
        }

        for (let i = 0; i < fundedRecipients.length; i += MAX_FANOUT_PER_TX) {
          const slice = fundedRecipients.slice(i, i + MAX_FANOUT_PER_TX);
          const tx = new Transaction();
          for (const c of slice) {
            const lamports =
              scaleDen === 1
                ? c.claimedLamports
                : Math.floor((c.claimedLamports * scaleNum) / scaleDen);
            if (lamports <= 0) continue;
            // Mutate so the post-lock split uses the actually-sent amount.
            c.claimedLamports = lamports;
            tx.add(
              SystemProgram.transfer({
                fromPubkey: custodialKeypair.publicKey,
                toPubkey: c.escrowKeypair.publicKey,
                lamports,
              })
            );
          }
          if (tx.instructions.length === 0) continue;
          tx.feePayer = custodialKeypair.publicKey;
          try {
            const { blockhash, lastValidBlockHeight } =
              await connection.getLatestBlockhash("confirmed");
            tx.recentBlockhash = blockhash;
            tx.sign(custodialKeypair);
            const sig = await connection.sendRawTransaction(tx.serialize(), {
              preflightCommitment: "confirmed",
            });
            await connection.confirmTransaction(
              { signature: sig, blockhash, lastValidBlockHeight },
              "confirmed"
            );
            console.log(
              `Fan-out tx ${i / MAX_FANOUT_PER_TX + 1}/${txCount} sent: ${sig}`
            );
          } catch (err: any) {
            console.error(
              `Fan-out tx failed:`,
              err?.message ?? err
            );
            for (const c of slice) {
              c.errored = `Fan-out failed: ${err?.message ?? err}`;
              await recordPumpfunFeeClaimFailure(c.launch.id, c.errored);
            }
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

  // ===== Outside the custodial lock: per-launch escrow → platform =====
  // These run in parallel because each escrow is independent.
  await Promise.all(
    candidates.map(async (c) => {
      try {
        if (c.errored) return; // already recorded
        if (c.vaultEmpty) {
          await recordPumpfunEmptyClaim(c.launch.id);
          return;
        }
        if (c.claimedLamports <= 0) return;
        await sweepEscrowToPlatform(c, connection);
      } finally {
        await releaseLaunchLock(c.launch.id);
      }
    })
  );

  console.log(
    `Batch complete. Processed ${candidates.length} launch(es); claimed ~${
      Number(totalClaimedLamports) / LAMPORTS_PER_SOL
    } SOL gross.`
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
  if (!response.ok || json?.errors) {
    const summary =
      json?.errors?.join(" | ") ||
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

async function sweepEscrowToPlatform(
  c: PerLaunchResult,
  connection: Connection
): Promise<void> {
  const distributable = c.claimedLamports - TX_FEE_RESERVE;
  if (distributable <= 0) {
    console.log(
      `Claimed amount too small after tx fees for launch ${c.launch.id}; skipping treasury transfer`
    );
    return;
  }
  try {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: c.escrowKeypair.publicKey,
        toPubkey: new PublicKey(ERYS_PLATFORM_WALLET),
        lamports: distributable,
      })
    );
    tx.feePayer = c.escrowKeypair.publicKey;
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.sign(c.escrowKeypair);
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      "confirmed"
    );
    console.log(
      `Treasury transfer for ${c.launch.token_symbol}: https://solscan.io/tx/${sig}`
    );
    await updatePumpfunFeesClaimed(c.launch.id, c.claimedLamports);
  } catch (err: any) {
    console.error(
      `Failed escrow→platform for launch ${c.launch.id}: ${err?.message ?? err}`
    );
    await recordPumpfunFeeClaimFailure(
      c.launch.id,
      `Escrow→platform transfer failed: ${err?.message ?? err}`
    );
  }
}