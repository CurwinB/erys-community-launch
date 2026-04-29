import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { decryptEscrowKey } from "./decrypt";
import { Launch, supabase } from "./db";
import {
  sweepTokensToWallet,
  sweepSolToWallet,
  resolveLaunchWallet,
  lamportsToSol,
} from "./pumpportalCustodial";
import { withCustodialLock } from "./custodialLock";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const SOLANA_WSS_URL =
  process.env.SOLANA_WSS_URL ||
  SOLANA_RPC_URL.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
const WORKER_ID =
  process.env.WORKER_ID || process.env.RAILWAY_REPLICA_ID || "executor-default";

/**
 * Recovery path for Pump.fun launches that minted on-chain but whose
 * custodial -> escrow token sweep failed (typically because the executor
 * predated the Token-2022 detection fix). The mint signature must already
 * be persisted on launches.pumpfun_launch_signature; we only redo the
 * sweep portion of the original critical section, then flip the launch to
 * `launched` so the distributor picks it up.
 *
 * No SOL refund logic runs here — the contributor SOL has been spent into
 * the bonding curve, so the only correct payout is tokens.
 */
export async function recoverPumpfunSweep(launch: Launch): Promise<void> {
  console.log(
    `\n[recovery] Starting sweep recovery for launch ${launch.id} (${launch.token_name})`
  );

  if (!launch.token_mint_address) {
    console.error(`[recovery] launch ${launch.id} has no token_mint_address — cannot recover`);
    return;
  }
  if (!launch.pumpfun_launch_signature) {
    console.error(
      `[recovery] launch ${launch.id} has no pumpfun_launch_signature — refusing to recover (mint not confirmed)`
    );
    return;
  }

  let escrowKeypair: Keypair;
  try {
    const escrowSecret = decryptEscrowKey(
      launch.escrow_wallet_encrypted_private_key
    );
    escrowKeypair = Keypair.fromSecretKey(new Uint8Array(escrowSecret));
  } catch (err: any) {
    console.error(
      `[recovery] decrypt escrow key failed for ${launch.id}: ${err?.message ?? err}`
    );
    return;
  }

  let wallet;
  try {
    wallet = resolveLaunchWallet(
      launch.id,
      (launch as any).pumpportal_wallet_pubkey ?? null
    );
  } catch (err: any) {
    console.error(
      `[recovery] custodial wallet config invalid: ${err?.message ?? err}`
    );
    return;
  }
  const custodialPubkey: PublicKey = wallet.publicKey;

  const connection = new Connection(SOLANA_RPC_URL, {
    commitment: "confirmed",
    wsEndpoint: SOLANA_WSS_URL,
  });

  try {
    await withCustodialLock(custodialPubkey.toBase58(), WORKER_ID, async () => {
      // Token sweep with the same retry envelope as the original path. The
      // sweep helper auto-detects Token-2022 vs legacy SPL Token.
      let swept: { signature: string; amount: bigint } | null = null;
      let lastErr: any = null;
      for (let attempt = 1; attempt <= 6; attempt++) {
        try {
          swept = await sweepTokensToWallet(
            connection,
            launch.token_mint_address!,
            escrowKeypair.publicKey,
            wallet
          );
          break;
        } catch (err: any) {
          lastErr = err;
          console.warn(
            `[recovery] sweep attempt ${attempt}/6 failed: ${err?.message ?? err}`
          );
          await new Promise((r) => setTimeout(r, 4_000));
        }
      }

      if (!swept) {
        // Leave launch in sweep_recovery so the next poll retries.
        const reason = `[recovery] token sweep still failing: ${
          lastErr?.message ?? lastErr
        }`;
        console.error(reason);
        await supabase
          .from("launches")
          .update({ execution_error: reason })
          .eq("id", launch.id);
        return;
      }

      console.log(
        `[recovery] swept ${swept.amount} token base units to escrow: ${swept.signature}`
      );

      // Best-effort residual SOL sweep so we don't strand custodial SOL.
      try {
        const solSweep = await sweepSolToWallet(
          connection,
          escrowKeypair.publicKey,
          wallet
        );
        if (solSweep) {
          console.log(
            `[recovery] swept ${lamportsToSol(solSweep.amount)} SOL residual back to escrow: ${solSweep.signature}`
          );
        }
      } catch (err: any) {
        console.warn(
          `[recovery] non-fatal SOL residual sweep failed: ${err?.message ?? err}`
        );
      }

      // Flip to launched so distributor picks it up. Clear the prior
      // execution_error so admin UI shows the recovery succeeded.
      const { error: updateErr } = await supabase
        .from("launches")
        .update({
          status: "launched",
          execution_error: null,
        })
        .eq("id", launch.id);
      if (updateErr) {
        console.error(
          `[recovery] failed to mark ${launch.id} launched: ${updateErr.message}`
        );
        return;
      }
      console.log(
        `[recovery] launch ${launch.id} sweep recovered and marked launched`
      );
    });
  } catch (lockErr: any) {
    console.error(
      `[recovery] could not acquire custodial lock for ${launch.id}: ${
        lockErr?.message ?? lockErr
      }. Will retry on next poll.`
    );
  }
}