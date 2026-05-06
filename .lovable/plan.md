## Goal

Remove the artificial Pump.fun per-minute scheduling cap of 1 caused by `pumpportal_wallet_pool_size = 1`. Per-launch Lightning wallets are now created on demand at launch creation time, so the shared PumpPortal wallet pool no longer represents Pump.fun launch capacity — only the executor's polling/concurrency does.

## Changes

### 1. `supabase/functions/_shared/scheduleCapacity.ts`

- Bump `BASE_CAPS.pumpfun` from `1` to `20` (per-minute cap matching executor capacity at 5s polling + fire-and-forget on one replica).
- Remove the `pumpportal_wallet_pool_size` lookup entirely:
  - Delete `cachedPoolSize`, `POOL_SIZE_TTL_MS`, and the `getPumpfunPoolSize()` function.
  - Simplify `getPlatformCap()` to just return `BASE_CAPS[platform]` for both platforms (still async-signature-preserving so existing callers don't break).
- Result: Pump.fun cap = 20/min, Bags = 5/min, no DB read needed for cap resolution.

### 2. `executor/src/index.ts`

- Remove the `app_settings` publish block (lines ~67–76) that writes `pumpportal_wallet_pool_size`. It no longer drives anything — the scheduling cap is now a constant.
- Keep `warmWalletPool()` call. The shared wallet pool is still used by fee-claim/sweep paths and `getAllWallets()` is referenced by `claimPumpfunFeesBatch.ts`.

### 3. `distributor/src/index.ts`

- Same removal: drop the `app_settings.pumpportal_wallet_pool_size` publish block (lines ~110–122).
- Keep `warmWalletPool()` and `getAllWallets()` import — still used in fee claiming.

### 4. Stale DB row (optional cleanup)

The existing `app_settings` row with key `pumpportal_wallet_pool_size = 1` becomes unused after this change. Leave it in place (harmless) — no migration needed unless you'd like one to delete it.

## Out of scope

- No change to `pumpportalWalletPool.ts`, fee-claim, or per-launch Lightning wallet creation logic.
- No change to Bags.fm cap (stays at 5/min).
- No change to scheduling lock (`withScheduleLock`) or slot-walk lookahead window.

## Verification

- `check-launch-slot` and `create-launch-pumpfun` will now see a 20/min Pump.fun cap on the next deploy of the edge functions.
- 30s edge-function module cache means the new cap takes effect immediately on cold start of each function instance.
