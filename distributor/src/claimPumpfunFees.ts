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
  getPumpfunLaunchesForFeeClaim,
  updatePumpfunFeesClaimed,
  markPumpfunFeeClaimAttempt,
  recordPumpfunFeeClaimFailure,
} from "./db";
import { withCustodialLock } from "./custodialLock";
import {
  getWalletByPubkey,
  getWalletForLaunch,
  type PumpPortalWallet,
} from "./pumpportalWalletPool";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const ERYS_PLATFORM_WALLET = process.env.BAGS_PARTNER_WALLET!;
const WORKER_ID =
  process.env.WORKER_ID || process.env.RAILWAY_REPLICA_ID || "distributor-default";

// Erys takes 100% of Pump.fun creator fees
// Reserve for the single outgoing SystemProgram.transfer tx (~5000 lamports)
const TX_FEE_RESERVE = 5_000;

// Floor we leave in the custodial wallet so it stays rent-exempt and ready
// for the next launch / next fee-claim cycle. Mirrors executor constant.
const CUSTODIAL_SOL_FLOOR_LAMPORTS = 2_000_000n; // 0.002 SOL

/**
 * Resolve which wallet handles fee claiming for this launch. Honors the
 * `pumpportal_wallet_pubkey` binding stored on the launch row; falls back
 * to the deterministic pool selection when missing.
 */
function resolveWalletForLaunch(launch: Launch): PumpPortalWallet {
  const stored = (launch as any).pumpportal_wallet_pubkey as string | null;
  if (stored) {
    const w = getWalletByPubkey(stored);
    if (!w) {
      throw new Error(
        `Launch ${launch.id} bound to wallet ${stored}, but it is not in the configured pool`,
      );
    }
    return w;
  }
  return getWalletForLaunch(launch.id);
}

export async function claimPumpfunFeesForLaunch(launch: Launch): Promise<void> {
  console.log(`\nChecking Pump.fun fees for launch ${launch.id} (${launch.token_name})`);

  let wallet: PumpPortalWallet;
  try {
    wallet = resolveWalletForLaunch(launch);
  } catch (err: any) {
    console.error(
      `No wallet available for launch ${launch.id}:`,
      err?.message ?? err,
    );
    await recordPumpfunFeeClaimFailure(
      launch.id,
      `No PumpPortal wallet available: ${err?.message ?? err}`,
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
    await recordPumpfunFeeClaimFailure(
      launch.id,
      `Failed to decrypt escrow key: ${err?.message ?? err}`
    );
    return;
  }

  // Custodial wallet = on-chain creator since launch was executed via Lightning.
  // Read its pre-claim balance so we can measure how much was actually claimed.
  const custodialKeypair: Keypair = wallet.keypair;

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
  let claimSucceededButVaultEmpty = false;
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
        claimSucceededButVaultEmpty = result.vaultEmpty;
      }
    });
  } catch (lockErr: any) {
    console.error(
      `Could not acquire custodial lock for fee claim ${launch.id}: ${
        lockErr?.message ?? lockErr
      }. Will retry next cycle.`
    );
    // Don't stamp throttle here — lock contention is transient and we want
    // the next poll to retry fast once another worker releases the lock.
    return;
  }

  // Vault was empty — the on-chain CollectCreatorFee call ran successfully but
  // returned "No creator fee to collect". Stamp the timestamp so the SQL
  // claim function won't re-pick this launch for another 10 minutes. Without
  // this, every poll cycle re-fires the no-op claim and burns ~55k lamports
  // of priority fee out of the custodial wallet.
  if (claimSucceededButVaultEmpty) {
    await markPumpfunFeeClaimAttempt(launch.id);
    console.log(
      `Stamped no-op fee-claim attempt for launch ${launch.id}; next attempt in 10m`
    );
    return;
  }

  if (sweptToEscrowLamports <= 0) {
    // Nothing made it into escrow (no fees claimed or sweep skipped). The
    // critical section already logged the reason and recorded the failure.
    return;
  }

  // Reserve ~5000 lamports for the single outgoing platform transfer fee.
  const distributableLamports = sweptToEscrowLamports - TX_FEE_RESERVE;
  if (distributableLamports <= 0) {
    console.log(
      `Claimed amount too small to distribute after tx fees for launch ${launch.id}. Fees will accumulate and be claimed next cycle.`
    );
    return;
  }

  // Platform claims 100% of creator fees.
  const platformShareLamports = distributableLamports;
  console.log(
    `Platform claiming 100% of creator fees: ${platformShareLamports / LAMPORTS_PER_SOL} SOL`
  );

  let platformSent = false;

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

  if (platformSent) {
    await updatePumpfunFeesClaimed(launch.id, claimedLamports);
    console.log(`Fee claim complete for launch ${launch.id}`);
  } else {
    console.error(
      `Fee claim failed for launch ${launch.id}. Platform transfer did not land. Will retry next cycle.`
    );
    await recordPumpfunFeeClaimFailure(
      launch.id,
      "Platform transfer from escrow failed after successful claim+sweep"
    );
  }
}

// Holds the custodial lock for the duration. Returns null on any non-fatal
// early exit (RPC failure, sweep failed, etc.). On success returns the
// amounts so the caller can run the escrow→platform split outside the lock.
// `vaultEmpty=true` means the on-chain claim succeeded but the creator vault
// had nothing to pay out — caller should stamp the throttle timestamp.
async function runFeeClaimCriticalSection(
  launch: Launch,
  connection: Connection,
  escrowKeypair: Keypair,
  custodialKeypair: Keypair
): Promise<{
  claimedLamports: number;
  sweptToEscrowLamports: number;
  vaultEmpty: boolean;
} | null> {
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
    await recordPumpfunFeeClaimFailure(
      launch.id,
      `Failed to get custodial balance: ${err?.message ?? err}`
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
        wallet.apiKey
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
    // PumpPortal returns 200 with `errors: []` on success. The empty array
    // is truthy in JS, so we MUST check length, not the array itself.
    const errorList = Array.isArray(json?.errors) ? json.errors : [];
    if (!response.ok || errorList.length > 0) {
      const summary =
        errorList.join(" | ") ||
        JSON.stringify(json).slice(0, 300) ||
        response.statusText;
      console.error(
        `Lightning collectCreatorFee failed for launch ${launch.id} [${response.status}]: ${summary}`
      );
      await recordPumpfunFeeClaimFailure(
        launch.id,
        `PumpPortal collectCreatorFee HTTP ${response.status}: ${summary}`
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
      // The on-chain CollectCreatorFee call succeeded (we have a confirmed
      // signature, no PumpPortal errors) but the creator vault was empty —
      // i.e. "No creator fee to collect". This is the normal steady state
      // for any low/zero-volume launch. Signal to the caller that we should
      // stamp pumpfun_fees_last_claimed_at to throttle the next attempt to
      // 10 minutes from now (rather than re-firing every poll cycle).
      console.log(
        `Claim succeeded but creator vault was empty for launch ${launch.id} (no fees accrued since last claim)`
      );
      return {
        claimedLamports: 0,
        sweptToEscrowLamports: 0,
        vaultEmpty: true,
      };
    }
    console.log(`Claimed ${claimedLamports / LAMPORTS_PER_SOL} SOL in creator fees`);
  } catch (err: any) {
    console.error(
      `Lightning collectCreatorFee threw for launch ${launch.id}:`,
      err?.message ?? err
    );
    await recordPumpfunFeeClaimFailure(
      launch.id,
      `PumpPortal collectCreatorFee threw: ${err?.message ?? err}`
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
      await recordPumpfunFeeClaimFailure(
        launch.id,
        `Custodial balance ${custodialNow} below sweep threshold (floor ${CUSTODIAL_SOL_FLOOR_LAMPORTS} + fee ${sweepTxFee}); top up the custodial wallet`
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
    await recordPumpfunFeeClaimFailure(
      launch.id,
      `Failed to sweep custodial → escrow: ${err?.message ?? err}`
    );
    return null;
  }

  return { claimedLamports, sweptToEscrowLamports, vaultEmpty: false };
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