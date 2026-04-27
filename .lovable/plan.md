## Confirmed answer: there are zero creator fees to sweep yet

I queried the DB. The state of the world is:

- **One** Pump.fun launch in `launched` status: `ETEST` (id `9caf31b8-…`), launch sig `3T5aZSxFsTG1…ZroZfHC`, launched ~16h ago.
- The other 7 ETEST attempts on Pump.fun and 10 on Bags are all `execution_failed`. None of those will ever produce fees.
- `platform_fee_claims` is **empty (0 rows, 0 lamports)**.
- `ETEST.pumpfun_fees_last_claimed_at = 2026-04-27 10:02:18Z` (~7 minutes ago) with **no error**, **no throttle**, **no worker lock**, and `pumpfun_fees_claimed_total = 0`.

That last bullet is the whole story: the distributor **is** picking up ETEST every 10 minutes, calling `collectCreatorFee`, and recording the claim attempt successfully — but every claim returns **zero lamports**, so `recordPumpfunEmptyClaim` fires, `pumpfun_fees_last_claimed_at` is stamped, and there's nothing to fan out or sweep. Hence no rows in `platform_fee_claims`.

## Why every claim is empty

Because **nobody has traded the ETEST token**. Pump.fun creator fees only accrue when there's buy/sell volume after launch. ETEST is a test token with the platform's own contributions and presumably no organic trading on the bonding curve, so the creator vault is permanently empty and `collectCreatorFee` returns a 200 with `errors: []` and no balance delta. After 3 consecutive empty cycles the launch will be throttled to once-an-hour by `record_pumpfun_empty_claim` (it isn't yet — `pumpfun_low_volume_throttle_until` is null — meaning the consecutive-empty counter is also being reset cleanly, probably because the distributor was redeployed recently with the truthy-array fix).

## Why the panel said "No launched Pump.fun tokens"

Look at the screenshot: it actually lists ETEST in the table — the empty-state text is for the second table beneath ("Launches needing recovery"). The panel is healthy. The custodial wallet at 0.0519 SOL is fine; it just hasn't spent anything because no claim has had a non-zero delta.

## What this means for the previous "truthy errors" diagnosis

The bug fix (`errorList.length > 0` instead of `json?.errors`) was real and worth shipping — without it, every successful 200 OK was being treated as a failure and stamping `pumpfun_last_claim_error`. The currently-clean error column on ETEST confirms the fix is now in production. But it was never the reason no sweeps happened in real life: the underlying reason is that **no creator fees have ever accrued because there's been no trading on any of our launched tokens**.

## What to do

No code change. To prove the pipeline end-to-end, do one of:

1. **Generate trading volume on ETEST** — buy and sell some of it on pump.fun. Within 10 minutes the next claim cycle picks up real lamports, fans out to the escrow, and sweeps escrow → `BAGS_PARTNER_WALLET`, populating `platform_fee_claims`.
2. **Wait for a real launch with organic volume.** Same outcome.

If after step 1 you still see `pumpfun_fees_claimed_total = 0` and an empty `platform_fee_claims`, then there's a real bug to chase. Until then, the system is working — there's just nothing to sweep.
