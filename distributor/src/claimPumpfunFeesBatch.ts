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
const BATCH_SIZE = parseInt(process.env.PUMPFUN_FEE_BATCH_SIZE || "25", 10);
const PER_CLAIM_PRIORITY_FEE_LAMPORTS = 55_000; // mirrors collectCreatorFee priorityFee 0.00005 SOL
const TX_FEE_RESERVE = 5_000;
const CUSTODIAL_SOL_FLOOR_LAMPORTS = 2_000_000n; // 0.002 SOL
// Max SystemProgram.transfer instructions per single tx — well within Solana's
// 1232-byte tx size and 64 account limits.
const MAX_FANOUT_PER_TX = 10;
// Wait between PumpPortal Lightning calls so we don't trip the per-key rate limit.
const PUMPPORTAL_INTER_CALL_DELAY_MS = 250;

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
  claimedLamports: number; // delta seen in custodial wallet attributable to this claim
  vaultEmpty: boolean;
  errored?: string;
}

/**
 * Batched Pump.fun creator-fee claim.
 *
 * One pass per cycle:
 *   1. Atomically claim up to BATCH_SIZE eligible launches from the DB.
 *   2. Acquire the custodial lock ONCE.
 *   3. For each launch, call PumpPortal collectCreatorFee sequentially. Track
 *      the delta in the custodial wallet's balance to attribute claimed SOL
 *      to each launch.
 *   4. Fan out the total claimed SOL from custodial → each launch's escrow,
 *      proportional to its claimed delta. Pack up to MAX_FANOUT_PER_TX
 *      transfers into one tx.
 *   5. Release the custodial lock.
 *   6. In parallel, run each launch's escrow → platform-wallet transfer.
 *
 * Wallet-health budget: before claiming, we make sure the custodial wallet
 * holds enough SOL to pay priority fees for every claim attempt PLUS the
 * fan-out tx fees. If not, we abort the cycle entirely and surface the
 * failure on each launch row so it shows up in the admin panel.
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
        const requiredForClaims =
          BigInt(candidates.length) *
            BigInt(PER_CLAIM_PRIORITY_FEE_LAMPORTS) +
          BigInt(Math.ceil(candidates.length / MAX_FANOUT_PER_TX)) * BigInt(TX_FEE_RESERVE) +
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
          } SOL for ${candidates.length} claims)`
        );

        // Sequentially issue collectCreatorFee for each launch. Track per-launch
        // delta in custodial balance to attribute funds.
        let runningBalance = preBalance;
        for (const c of candidates) {
          try {
            const balBefore = runningBalance;
            const ok = await collectCreatorFeeOnce(c.launch, connection);
            if (!ok.success) {
              c.errored = ok.error;
              await recordPumpfunFeeClaimFailure(c.launch.id, ok.error);
              continue;
            }
            const balAfter = BigInt(
              await connection.getBalance(custodialKeypair.publicKey, "confirmed")
            );
            const delta = balAfter - balBefore;
            // priority fee was spent regardless; "claimed" is the positive
            // delta over what we'd have if no fees came in. We approximate by
            // delta + priority fee (since priority fee was paid out of this
            // wallet for this specific call).
            const grossClaimed =
              delta + BigInt(PER_CLAIM_PRIORITY_FEE_LAMPORTS);
            if (grossClaimed <= 0n) {
              c.vaultEmpty = true;
              console.log(
                `Vault empty for launch ${c.launch.id} (${c.launch.token_symbol})`
              );
            } else {
              c.claimedLamports = Number(grossClaimed);
              totalClaimedLamports += grossClaimed;
              console.log(
                `Claimed ${Number(grossClaimed) / LAMPORTS_PER_SOL} SOL for ${c.launch.token_symbol}`
              );
            }
            runningBalance = balAfter;
          } catch (err: any) {
            c.errored = `collectCreatorFee threw: ${err?.message ?? err}`;
            console.error(
              `collectCreatorFee threw for ${c.launch.id}: ${err?.message ?? err}`
            );
            await recordPumpfunFeeClaimFailure(c.launch.id, c.errored);
          }
          if (PUMPPORTAL_INTER_CALL_DELAY_MS > 0) {
            await new Promise((r) =>
              setTimeout(r, PUMPPORTAL_INTER_CALL_DELAY_MS)
            );
          }
        }

        postClaimBalance = BigInt(
          await connection.getBalance(custodialKeypair.publicKey, "confirmed")
        );

        // Fan out to per-launch escrows. Only include launches that actually
        // received funds.
        const fundedRecipients = candidates.filter(
          (c) => c.claimedLamports > 0 && !c.errored
        );
        if (fundedRecipients.length === 0) {
          console.log("No fees to fan out this batch.");
          return;
        }

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

async function collectCreatorFeeOnce(
  launch: Launch,
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