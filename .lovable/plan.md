# Fix Plan: Pump.fun fee claims silently stuck

## What I confirmed on-chain + in DB just now

- Custodial wallet `8fjQrCqe…2bqGed` balance: **2,045,924 lamports** (only ~46k above the 2M floor).
- Last `collectCreatorFee` tx from the custodial wallet: **slot 415853123, ~25 minutes ago** (block time 1777234082).
- ETEST launch row right now: `pumpfun_fees_last_claimed_at = NULL`, `worker_locked_at` refreshed **0.3 seconds ago** by `distributor-1`. So the distributor IS picking it up every cycle, but **no on-chain claim has fired in 25 min**.

Conclusion: the PumpPortal `collectCreatorFee` call is failing **before** the on-chain submit (HTTP error, rate limit, API key issue, or thrown exception). The current code returns `null` on any failure → never stamps `pumpfun_fees_last_claimed_at` → row gets re-claimed every poll → the new no-op throttle migration we just shipped doesn't help because that code path requires the call to succeed first.

We have **zero visibility** into what PumpPortal is actually returning because errors only go to Railway stdout, not the DB.

## Plan — three small, focused changes

### 1. Persist the last claim error to the DB (visibility)

Migration: add two columns to `launches`:

```sql
ALTER TABLE public.launches
  ADD COLUMN pumpfun_last_claim_attempt_at timestamptz,
  ADD COLUMN pumpfun_last_claim_error text;
```

New RPC `record_pumpfun_fee_claim_failure(p_launch_id uuid, p_error text)` that sets:
- `pumpfun_last_claim_attempt_at = now()`
- `pumpfun_last_claim_error = p_error` (truncated to 500 chars)
- **Also stamps `pumpfun_fees_last_claimed_at = now()`** so the 10-min throttle in `claim_pumpfun_launch_for_worker` kicks in for failures too.

Why stamp the throttle on hard failures: today a PumpPortal 5xx makes us re-fire the call every 30s (next distributor poll picks it up because the worker lock is released after the fn returns). Throttling failures the same as no-ops caps the blast radius at one attempt per 10 min until we actually fix the underlying issue. We sacrifice some retry agility for not draining the wallet.

Update `RECORD on-success path` in `increment_pumpfun_fees_claimed` to also clear `pumpfun_last_claim_error`.

### 2. Wire the failure-recording into `claimPumpfunFees.ts`

In `distributor/src/claimPumpfunFees.ts`, replace every silent `return null` in `runFeeClaimCriticalSection` and the outer wrapper with a call to a new `markFeeClaimFailure(launchId, errorMessage)` helper that calls the new RPC.

Specifically capture and persist:
- `Lightning collectCreatorFee failed [HTTP ${status}]: ${summary}`
- `Lightning collectCreatorFee threw: ${err.message}`
- `Failed to get custodial balance: ${err.message}`
- `Custodial balance below sweep threshold (${balance} <= floor+fee)`
- `Failed to sweep custodial → escrow: ${err.message}`
- `Could not acquire custodial lock`

This means the next time we look at the ETEST row we will immediately see *why* it's stuck instead of having to grep Railway logs.

### 3. Surface the error in the Admin UI (RecoveryTab)

Add a "Pump.fun fee-claim health" section to `src/components/admin/RecoveryTab.tsx` that lists every `launched` Pump.fun launch with:
- Token symbol + mint
- `pumpfun_fees_claimed_total`
- `pumpfun_fees_last_claimed_at` (time-ago)
- `pumpfun_last_claim_error` in red if set
- Custodial wallet balance (read once via Solana RPC on mount)
- A "Force retry now" button that calls a small new edge function `force-pumpfun-fee-claim` which clears `pumpfun_fees_last_claimed_at` and `worker_locked_at` so the next distributor cycle picks it up immediately.

This gives you a one-glance dashboard to diagnose any future stuckness.

## What I'm intentionally NOT doing in this round

- **Not changing the PumpPortal call signature** (pool, priorityFee, etc.). We don't yet know what's failing — first we need the error logged. Once we see the actual response, the fix is probably one line (e.g. switch to `pool: "pump-amm"` post-graduation, or rotate the API key). Doing this blindly risks breaking the path that DID work earlier today.
- **Not touching Bug 2** (multi-launch fee attribution). Still needs its own design pass.
- **Not topping up the custodial wallet automatically.** That's an ops decision; I'll just surface the balance in the admin panel.

## Files this will touch

- `supabase/migrations/<new>_pumpfun_fee_claim_visibility.sql` — new columns + new RPC `record_pumpfun_fee_claim_failure`.
- `distributor/src/db.ts` — add `recordPumpfunFeeClaimFailure(launchId, error)`.
- `distributor/src/claimPumpfunFees.ts` — replace every `return null` with a failure-record call.
- `supabase/functions/force-pumpfun-fee-claim/index.ts` — new edge function, admin-gated, clears throttle for one launch.
- `src/components/admin/RecoveryTab.tsx` — new "Pump.fun fee-claim health" section.

## Expected outcome after deploy

1. Within ~30s of Railway picking up the new build, the ETEST row will have `pumpfun_last_claim_error` populated with the actual PumpPortal failure reason.
2. We then make the targeted fix (likely one line, depending on what the error says).
3. Going forward, no more silent retry storms — every failure is one attempt per 10 min and visible in the admin UI.
