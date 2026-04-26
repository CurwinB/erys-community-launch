# Diagnosis: Pump.fun creator fee claims for ETEST

## What I found on-chain

The claims **are running**. Looking at the on-chain history of our custodial wallet `8fjQrCqeJfNgc5QQRarykX1eBwL7Xt5dvFi5hA2bqGed` (which IS the registered Pump.fun `creator` for ETEST mint `JAQch38...`):

- **39 `collectCreatorFee` transactions** in the last ~3 hours, signed by the custodial wallet.
- Most recent one (`5Z4FCEvHTgz...`, ~30 seconds ago):
  - `Program log: Instruction: CollectCreatorFee`
  - **`Program log: No creator fee to collect`**
  - Pre-balance: 2,155,924 → Post: 2,100,924 (lost 55,000 lamports = priority + base fee)
- Creator vault PDA `7RmCbww3Z8pYNK8LxQubqmbD2ky4hurTpvp2TMBXXVHU` balance: 890,880 lamports = exactly rent-exempt minimum = **empty**.

So the volume that did happen on the bonding curve never actually accrued meaningful fees into the vault, OR the very first claim drained whatever did accrue and every claim since has been a no-op.

Pump.fun bonding-curve state confirms it: `real_sol_reserves: 6` lamports, `market_cap: $27.95`, `ath_market_cap: $2,523`. The token spiked momentarily then was sold back. Net fee accrual at 0.300% of swap notional is essentially zero by now.

## What's broken in our code

There are **two real bugs** worth fixing:

### Bug 1: No-op claims are not throttled (custodial SOL drain)

In `distributor/src/claimPumpfunFees.ts`:

```ts
if (claimedLamports <= 0) {
  console.log(`No fees were actually claimed for launch ${launch.id}`);
  return null;  // ← does NOT stamp pumpfun_fees_last_claimed_at
}
```

And the SQL RPC `claim_pumpfun_launch_for_worker` re-selects any launch where `pumpfun_fees_last_claimed_at IS NULL OR <= now() - 10 min`.

Because no-op claims never set `pumpfun_fees_last_claimed_at`, ETEST is re-claimed on every distributor poll. The only thing throttling it to ~5 min cadence is the `worker_locked_at` 300-second TTL — i.e. we're paying ~55,000 lamports of priority fee every 5 minutes on a launch that has nothing to claim.

Over a day that's **~16,000 lamports/min × 60 × 24 ≈ 23M lamports = 0.023 SOL per launch per day**. Not catastrophic per launch, but multiplies linearly with the number of `launched` Pump.fun rows we accumulate, and silently bleeds the custodial wallet (which only has the 0.002 SOL floor reserved). It will eventually push the custodial below the sweep threshold and break real fee claims.

The "Why we did this" comment in the code is correct: we don't want to lock a launch out for 24h after a transient RPC failure. But "no fees in vault" is NOT a transient failure — it's the steady state for low-volume tokens.

### Bug 2: We lose attribution if multiple launches accumulate fees

`collectCreatorFee` with `pool: "pump"` claims **all accumulated creator fees across every Pump.fun coin the custodial wallet created** in a single tx (per Pump.fun docs and our own memory `mem://features/pumpfun-creator-fees`). Right now our balance-delta logic attributes 100% of the claimed amount to whichever launch row we happened to be processing at the time — which is wrong if launch A and launch B both have fees pending.

This isn't actively hurting us today (only ETEST is in `launched` state) but it will start mis-attributing as soon as we have a 2nd successful Pump.fun launch. Worth flagging now and fixing when we build the proper accounting.

## Fix plan

**Scope this to Bug 1 only** (Bug 2 needs a small design discussion before we touch attribution).

### 1. Stamp `pumpfun_fees_last_claimed_at` on no-op claims too

In `distributor/src/claimPumpfunFees.ts`, when `collectCreatorFee` succeeds on-chain (response OK, no `errors` array, signature confirmed) but `claimedLamports <= 0`, we still mark the attempt:

- Call a new RPC (or reuse a lightweight UPDATE) that sets `pumpfun_fees_last_claimed_at = now()` **without** incrementing `pumpfun_fees_claimed_total`.
- Distinguish this case from a true RPC failure (network error, PumpPortal 5xx, signature never confirmed) — those should still NOT stamp the timestamp, because the next poll genuinely needs to retry.

This caps the per-launch claim cadence at the intended 10 minutes regardless of whether there's anything to claim, eliminating the SOL drain.

### 2. Add a no-op cooldown shortcut

Add a small in-memory or DB-backed counter: if the last 3 consecutive claims for a launch returned 0, back off to 1 hour instead of 10 min. Optional, but useful once we have many `launched` rows that may sit idle for days between fee accruals.

### 3. ETEST itself: nothing to recover

The ATH-then-dump pattern means there's no meaningful creator fee to claim right now. The fee accounting on the launch row (`pumpfun_fees_claimed_total = 0`) is therefore correct — there is genuinely nothing to distribute to creator/platform yet. If trading picks up later, the fix above ensures we still claim it on the next 10-min cycle.

## Files to change

- `distributor/src/claimPumpfunFees.ts` — distinguish "RPC succeeded, vault empty" from "RPC failed", and stamp the timestamp in the first case.
- New migration adding a small RPC like `mark_pumpfun_fee_claim_attempt(p_launch_id uuid)` that updates only `pumpfun_fees_last_claimed_at` (no total increment).
- `distributor/src/db.ts` — wrapper for the new RPC.

## What I will NOT touch in this round

- `claim_pumpfun_launch_for_worker` SQL — its 10-min throttle window is correct, the bug is that we never stamp the timestamp on no-op claims.
- The escrow → platform split logic — works fine when there's actually SOL to split.
- The fee attribution issue (Bug 2) — separate plan once we have ≥2 active Pump.fun launches.

## After deploy

1. Watch the custodial wallet `8fjQrCqeJfNgc5QQRarykX1eBwL7Xt5dvFi5hA2bqGed` — signature rate should drop from ~0.2/min to ~0.0017/min (1 every 10 min) for ETEST.
2. Check Railway distributor logs for the new "claim succeeded but vault empty, stamping timestamp" log line.
3. ETEST `pumpfun_fees_last_claimed_at` in DB should start updating every 10 min instead of staying NULL.
