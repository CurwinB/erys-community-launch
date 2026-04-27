## Why no sweeps have happened

The active Pump.fun launch (`ETEST` / `9caf31b8…`) has this stamped on its row in the database:

> `Custodial wallet balance 2045924 below required 2060000 for batch of 1 (need ~0.00206 SOL). Aborting cycle.`

In plain English:

- The custodial wallet currently holds **0.002046 SOL**.
- The new wallet-health gate (added in the last batch refactor) requires it to hold at least **0.002060 SOL** before it will even attempt a claim — that's the 0.002 SOL rent-exempt floor + ~55,000 lamports priority fee + 5,000 lamports fan-out tx fee.
- The wallet is short by ~14,000 lamports (~$0.003), so every cycle the worker aborts immediately, never calls `collectCreatorFee`, never fans out to the escrow, and never sweeps to the treasury.

That gate is doing exactly what we designed it to do (don't drain the wallet below rent-exempt), but our budget threshold is set higher than the wallet's normal idle balance, so it permanently locks itself out.

There are also no other launches in the `launched` status (the other 7 are `execution_failed`), so this single under-funded wallet is the entire blocker.

## Fix — 3 parts

### 1. Top up the custodial wallet (immediate unblock — manual)

The wallet `PUMPPORTAL_CUSTODIAL_WALLET` needs SOL added to it on-chain. Recommend topping up to **~0.05 SOL** so it has enough headroom for many claim cycles plus priority fee surges. This is a manual on-chain action you'll do from your funding wallet — no code change needed for this step.

### 2. Make the budget gate self-healing instead of permanently aborting

Right now, when the gate fires, it stamps `pumpfun_last_claim_error` AND calls `recordPumpfunFeeClaimFailure`, which sets `pumpfun_fees_last_claimed_at = now()`. That means even after you top up, the launch won't be re-eligible for **10 minutes** because the throttle thinks a claim attempt just happened.

Change the under-budget path so it:

- Logs the warning and surfaces the error in the admin panel (so you can see "wallet needs SOL").
- Does **NOT** stamp `pumpfun_fees_last_claimed_at` — leaves the launch immediately eligible the moment the wallet has funds.
- Releases the row-locks cleanly so the next cycle picks the same launches up.

Add a new dedicated DB function `record_pumpfun_wallet_starved` that only writes the error string + `pumpfun_last_claim_attempt_at`, leaving `pumpfun_fees_last_claimed_at` untouched.

### 3. Surface custodial wallet balance in the admin panel

You already have the `PumpfunFeeHealthPanel` component on the admin Recovery tab. Extend it to:

- Show the current custodial wallet on-chain SOL balance (read live from RPC via a small edge function `get-custodial-balance`).
- Show a red warning banner when it's below the dynamic budget threshold (priority fee + tx reserve + floor for the count of currently-eligible launches).
- Show a "Topup address" copy button so you can fund it in one click.

This way you'd never silently sit in this state again — the panel would say "Wallet underfunded, needs +0.05 SOL" the instant it happens.

## Files to change

- **DB migration**: add `record_pumpfun_wallet_starved(p_launch_id uuid, p_error text)` RPC.
- `distributor/src/db.ts`: add wrapper `recordPumpfunWalletStarved`.
- `distributor/src/claimPumpfunFeesBatch.ts`: in the budget-gate branch, call `recordPumpfunWalletStarved` instead of `recordPumpfunFeeClaimFailure`, and `releaseLaunchLock` for each candidate so they're re-eligible immediately.
- `supabase/functions/get-custodial-balance/index.ts`: new admin-only edge function returning the wallet balance + computed required threshold for currently-eligible launches.
- `src/components/admin/PumpfunFeeHealthPanel.tsx`: poll the new edge function every 30s, render balance, threshold, and a copy-address button.

## What you do after this ships

1. Send ~0.05 SOL to the custodial wallet from your funding wallet.
2. Within 30 seconds the next batch cycle will run, claim creator fees on `ETEST`, fan out to the escrow, and sweep to the platform treasury (`BAGS_PARTNER_WALLET`).
3. From here on, the admin panel will warn you visually if the wallet ever drops below the budget again.
