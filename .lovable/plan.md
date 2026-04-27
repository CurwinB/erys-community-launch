## What happened

Yes — the launch ran on Railway (the executor service polling `executing` launches). It did not fail in the Supabase edge function.

**Latest launch** `e9d37218…` ("Erys test" / ETEST, 22:23 UTC) failed with:
```
createBagsFeeShareConfig failed: Config already exists
```

**The previous one** (`9c4049bd…`) failed with `Reset from stale executing state by distributor` — the distributor's janitor flipped it back to `execution_failed` before the new fee-share retry loop could finish. So we have two related bugs to fix.

## Root causes

### Bug 1 — "Config already exists" (the one you just hit)
- Step 0 of `executeBags.ts` *always* mints a fresh token AND clears `fee_share_config_key` to `null`.
- On the previous attempt the fee-share Jito bundle did land on-chain, but either Step 3/4 failed afterwards or the worker lock was released before we persisted the key. The config PDA is now live for that mint, but our DB has `null`.
- On retry, Step 0 mints a *new* mint, then Step 2 calls `createBagsFeeShareConfig` — and Bags' API refuses because for the claimer set + partner combo a config already exists (Bags dedupes by claimer hash, not by mint).
- Code currently treats this as fatal → `setFailed`.

### Bug 2 — Distributor resets in-flight launches
- The distributor service has a janitor that flips long-`executing` launches back to `execution_failed` ("Reset from stale executing state").
- The new fee-share retry loop with rebuilds can take >Xs across 3 attempts. The janitor's stale threshold killed the previous launch mid-retry.

### Why no Railway log lines appear above
The edge-function log dump only shows `execute-launch` enqueueing — actual execution logs live in the Railway executor logs (not in Supabase). The error string in `launches.execution_error` is the authoritative trail.

## Proposed fix

### A. Handle "Config already exists" gracefully (`executor/src/executeBags.ts`)
1. In the Step 2 catch block, detect the substring `Config already exists` (case-insensitive).
2. When detected: call `sdk.config.createBagsFeeShareConfig` again with the same args to get the deterministic `meteoraConfigKey` from the SDK response (it returns the key even when txs aren't needed), OR derive the PDA client-side from `(baseMint, partner, partnerConfig, claimerHash)`. Prefer asking the SDK first.
3. If we get the key, persist via `storeFeeShareConfig` and continue to Step 3 — no resubmit needed.
4. If we still can't recover the key, fall through to `setFailed` with a clear message.

### B. Stop clobbering `fee_share_config_key` in Step 0
- Only `update({ fee_share_config_key: null })` if the freshly-minted `tokenMint` differs from the previously stored `token_mint_address`. If we ended up with the same mint (idempotent path), keep the existing key.
- Even simpler: never null it out; rely on Bug-A recovery to repopulate when the mint changes.

### C. Raise the distributor's stale-`executing` threshold
- Find the janitor in `distributor/src/` that emits "Reset from stale executing state" and bump the timeout to comfortably exceed worst-case fee-share retries (≥10 minutes), plus require that `worker_locked_at` is null OR older than the threshold (so an actively-locked worker is never stomped).

### D. Manual recovery for `e9d37218…`
- The on-chain fee-share config exists for mint `ATd5uFp7qQLJRPr2Ngk7VYCsbpv6cWTjaXRXkN2VBAGS`. After the code fix, retrying the launch via the existing `retry-failed-launch` edge function will:
  - Step 0 mints a *new* mint (fresh PDA → no collision), OR
  - If we hit the same combo again, the new "already exists" handler recovers the key.
- No SOL was debited (`processing_fee_lamports = 0`, no signature stored), so retry is safe.

## Files to change
- `executor/src/executeBags.ts` — Step 0 conditional clear + Step 2 "already exists" recovery branch.
- `distributor/src/...` (whichever file owns the stale-executing janitor) — bump threshold + respect active worker lock.

## After approval
1. Implement A + B + C above.
2. Trigger `retry-failed-launch` for `e9d37218-29a1-4372-abee-3b613b6eea38`.
3. Watch Railway executor logs for the next tick; confirm Step 2 now either skips or recovers cleanly.