## Goal

Stop Pump.fun launches from failing with PumpPortal `400 — Cannot read properties of undefined (reading 'toBuffer')`. The fee-reorder fix already worked for Loopy (no processing fee charged, contributors refunded), but the launch itself still failed. Root cause analysis points to **our own pre-flight probe being the trigger**: it POSTs `{action: "create"}` with no `mint`/`publicKey`/`tokenMetadata`, which is exactly the malformed shape that crashes their `toBuffer` path — and we make that call ~1 second before the real one from the same IP.

## Changes

### 1. Replace the broken probe with a passive health check

In `executor/src/executePumpfunLightning.ts` and `executor/src/launchWithLocalSigning.ts`:

- Remove the `POST /trade-local` probe entirely.
- Replace with a lightweight `GET https://pumpportal.fun/api/trade-local` (or HEAD) with a 5s timeout. We only treat a 5xx or network error as "down". Any 4xx (including 405 Method Not Allowed) means the service is reachable — proceed.
- Rationale: we're no longer feeding their server the exact malformed payload that bricks the next request from our IP.

### 2. Add a single automatic retry on the real `/trade-local` call

In both `executePumpfunLightning.ts` and `launchWithLocalSigning.ts`:

- If the first `/trade-local` call returns a 5xx, a `400` whose body matches `/toBuffer|undefined/i`, or a network error: wait 2.5s, retry once.
- If the second attempt also fails, then call `setFailed` and trigger the existing auto-refund flow.
- Log both attempts clearly (`[attempt 1/2]`, `[attempt 2/2]`).
- Safety: in `launchWithLocalSigning.ts` the processing fee is already charged AFTER `/trade-local` succeeds, so retrying `/trade-local` cannot strand contributor funds.

### 3. Manual reimbursement for Loopy short-changed contributor

Wallet `62aKWrHctoH4TUCfmmqoKCbaXXJWYWoLGL5Zc9izubaV` was refunded but is short **890,880 lamports** (~0.0009 SOL) due to on-chain tx fees from create+refund attempts. This is below the dust threshold and not caused by the new fee-reorder logic (the processing fee was correctly NOT charged). I'll surface it in the existing admin RefundsTab "shortfall" column (already wired) — no code change needed, just verify it's visible. Optional: send a manual treasury transfer; flag this for you with a copy-pastable address + amount but do not auto-execute.

### 4. Update plan.md

Replace the now-stale `.lovable/plan.md` notes about the probe with the new probe-removal rationale so future debugging doesn't re-introduce it.

## Files

- `executor/src/executePumpfunLightning.ts` — replace probe, add retry
- `executor/src/launchWithLocalSigning.ts` — replace probe, add retry
- `executor/src/executePumpfun.ts` — replace probe (same pattern)
- `.lovable/plan.md` — update notes

## Out of scope

- Switching off PumpPortal entirely (would need direct on-chain Pump.fun program calls; large change).
- Auto-reimbursing dust shortfalls from treasury (deferred — separate security review).
- Backfilling `processing_fee_refund_owed_lamports` for Loopy (it's null because no fee was charged — correct behavior).

## Verification

After deploy, the next scheduled Pump.fun launch will exercise:
1. New passive probe (should log `OK` with a 405 or 200, not crash PumpPortal's cache).
2. Real `/trade-local` call. If it 400s on `toBuffer`, the retry will fire 2.5s later.
3. If both fail, contributors get full refund (no fee charged), launch marked `execution_failed`, no funds stranded.
