# Why no sweeps have happened — and the one-line fix

## The actual reason

The Pump.fun launch `ETEST` has this in its `pumpfun_last_claim_error`:

```
PumpPortal collectCreatorFee HTTP 200: {"signature":"5e8VaFu682r6Ee7bxpqvXmaw9z6Yfkcw31NJZrUn1Vw6pPPZPjwUeGZqcaUdsd7Rp5dPtzKxGtBorQFdK5XpN7dK","errors":[]}
```

That is PumpPortal returning **success**: HTTP 200, a real signature, and `errors: []`. We are turning that into a failure.

The bug is in `distributor/src/claimPumpfunFeesBatch.ts` line 375:

```ts
if (!response.ok || json?.errors) {
```

`json.errors` is an **empty array `[]`**, which is **truthy** in JavaScript. So every successful claim trips the failure branch:

1. `recordPumpfunFeeClaimFailure` stamps `pumpfun_fees_last_claimed_at = now()` (the 10-min throttle), so the launch is then locked out for 10 minutes.
2. We `return` from the lock callback before ever computing the post-claim balance delta or the per-launch share.
3. Because `claimedLamports` stays `0` for every candidate, `sweepEscrowToPlatform` is never called → **no escrow → treasury sweep, ever**.

So the previous "starved wallet" diagnosis was a red herring — the wallet may now be funded, but we'd still never sweep because we mis-classify every PumpPortal 200 OK as an error and skip the entire fan-out + sweep block. `platform_fee_claims` is empty, `pumpfun_fees_claimed_total = 0`, and `pumpfun_creator_fees_distributed = 0` for the same reason.

The on-chain claim itself probably worked (PumpPortal returned a signature). The custodial wallet may already hold creator fees we never attributed or swept.

## The fix

### 1. Correct the success check in `collectAllCreatorFees`

In `distributor/src/claimPumpfunFeesBatch.ts`, change the check to recognise PumpPortal's success shape:

```ts
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
```

Same bug pattern exists in `distributor/src/claimPumpfunFees.ts` (the legacy single-launch path) — fix it there too for safety.

### 2. Clear the bad error & throttle on the affected launch

The `ETEST` launch is currently throttled because we wrote `pumpfun_fees_last_claimed_at = now()` on the false failure. Clear that so the next 30s poll picks it up again. We already have `force_pumpfun_fee_claim_retry(p_launch_id)` for exactly this — call it once after the code fix lands. We can also wipe the stale error text by adding `pumpfun_last_claim_error = NULL` to that RPC's UPDATE, which is a tiny improvement worth doing.

### 3. Reconcile the custodial wallet on-chain (one-off check, no code)

After the fix runs once, verify on Solscan:
- The custodial wallet (`8fjQrCqeJfNgc5QQRarykX1eBwL7Xt5dvFi5hA2bqGed`) shows the inbound creator-fee transfer from signature `5e8VaFu682r6Ee7bxpqvXmaw9z6Yfkcw31NJZrUn1Vw6pPPZPjwUeGZqcaUdsd7Rp5dPtzKxGtBorQFdK5XpN7dK`.
- The next batch cycle then does fan-out → escrow → treasury and `platform_fee_claims` starts populating.

If creator fees did accrue to the vaults *between* the false-failure tx and now, the next `collectCreatorFee` will sweep them too — no data loss, just delayed accounting.

## Files

**Modified**
- `distributor/src/claimPumpfunFeesBatch.ts` — fix truthy `errors` check
- `distributor/src/claimPumpfunFees.ts` — same fix in legacy path
- `supabase/migrations/<ts>_clear_pumpfun_error_on_force_retry.sql` — extend `force_pumpfun_fee_claim_retry` to also null out `pumpfun_last_claim_error`

**Run once after deploy** (no code, just an RPC call from the Pump.fun Fee-Claim Health admin panel "Force retry" button):
- Click Force retry on `ETEST` — distributor picks it up within 30s and starts sweeping.

## Behavior after fix

| Step | Before fix | After fix |
|---|---|---|
| PumpPortal returns 200 + `errors: []` | Treated as failure, throttled 10 min | Treated as success, balance delta computed |
| `claimedLamports` per launch | `0` | actual lamports / N |
| Escrow → treasury sweep | **Never runs** | Runs in parallel after fan-out |
| `platform_fee_claims` table | Empty | Populated each successful cycle |
