Diagnosis

The latest failed Pump.fun launch is `9caf31b8-af12-4feb-8f72-32539e903461` (`ETEST`, mint `JAQch38...`). The token was minted on-chain, but the tokens are still not with contributors because the launch is currently `execution_failed`, not `launched`, so the distributor never picks it up.

Root causes found:

1. The executor that ran this launch was still using the old sweep path and looked for a legacy SPL token account. The mint is Token-2022, so it failed with: `Custodial wallet has no token account...`.
2. The launch row still has `pumpfun_launch_signature = null`, even though the signature is embedded in `execution_error`. That means the robust signature persistence patch had not been deployed when this launch ran.
3. Auto-refunds already partially ran on this launch before the no-refund patch was active, so contribution rows now contain refund/shortfall records. Those must be reconciled carefully when tokens are distributed.
4. Even after the executor patch, the distributor still only uses the legacy SPL Token program. For future Pump.fun Token-2022 launches, even if the executor sweeps tokens into escrow successfully, distribution from escrow to contributors would fail unless the distributor is updated too.

Plan

1. Harden the distributor for Token-2022
   - Update `distributor/src/distribute.ts` to detect the mint owner program (`TOKEN_PROGRAM_ID` vs `TOKEN_2022_PROGRAM_ID`).
   - Use the detected token program for:
     - escrow ATA derivation,
     - contributor destination ATA derivation,
     - ATA creation,
     - token transfers,
     - token balance lookup.
   - Replace the remaining `confirmTransaction` call with the same HTTP polling / rebroadcast pattern used in the executor so RPCs without WebSocket support do not cause false failures or log floods.

2. Add a safe recovery path for minted-but-not-distributed Pump.fun launches
   - Add a small recovery script/tooling path under the worker codebase that can process one launch ID.
   - For this launch it will:
     - parse/persist the missing Pump.fun signature from the existing error if needed,
     - run the Token-2022-aware custodial sweep from PumpPortal custodial wallet to the launch escrow,
     - set the launch to `launched` so the distributor can pick it up,
     - clear stale worker locks.
   - It will not blindly refund anyone; the source of truth after a successful mint is the token balance, not SOL refunds.

3. Reconcile the existing bad refund metadata for `ETEST`
   - Clear the erroneous `refund_tx_signature` / `refund_shortfall_lamports` records for the affected contributions after confirming tokens are being delivered instead of SOL refunds.
   - Preserve the original contribution amounts and token delivery wallet overrides.
   - Keep token allocation based on the existing contributions, including the 5% creator floor and the delivery override to `F46Ai...`.

4. Prevent this from happening again at the database/state level
   - Add a dedicated recovery state to the launch status enum, for example `sweep_recovery`, for cases where mint succeeded but the custodial-to-escrow sweep failed.
   - Update executor failure routing so post-mint sweep failures are not just generic `execution_failed`; they become recoverable and are excluded from automatic refund logic.
   - Update distributor/admin recovery visibility to show these launches as token-recovery cases, not refund cases.

5. Add guardrails against incorrect refunds after a mint
   - In executor auto-refund logic and refund edge functions, check whether a Pump.fun launch has a persisted signature or an error that indicates Lightning create succeeded.
   - If a mint likely succeeded, block SOL refunds and return an explicit message: tokens must be recovered/distributed instead.
   - This prevents future partial refunds when SOL is already in the bonding curve.

6. Document the invariant
   - Update project memory/docs to state:
     - Pump.fun mints are Token-2022-aware end-to-end.
     - Post-mint failures must enter recovery/no-refund handling.
     - Distribution must not assume legacy SPL Token program.

Technical details

Current pipeline should become:

```text
PumpPortal create succeeds
  -> persist launch signature
  -> detect Token-2022 or legacy SPL mint
  -> sweep custodial tokens to escrow using detected token program
  -> mark launch launched
  -> distributor detects token program again
  -> distribute escrow tokens to contributor delivery wallets
  -> mark distribution complete
```

For the stuck `ETEST` launch specifically:

```text
current: execution_failed + tokens in custodial + stale refund metadata
recovery: sweep custodial -> escrow, mark launched, clear stale refund metadata
distribution: escrow -> F46Ai... and BvpGu... according to calculated token shares
```

After approval, I will implement the code changes and provide the exact operational steps needed to run the one-shot recovery on Railway/local worker environment for the already-stranded launch.