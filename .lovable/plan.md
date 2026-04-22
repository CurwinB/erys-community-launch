

# Distributed worker locking for executor + distributor

Replace the in-memory `processing` Set in both Railway services with Postgres row-level locks (`FOR UPDATE SKIP LOCKED`) so multiple replicas can run safely in parallel without ever double-processing the same launch.

## Database (migration tool)

1. Add columns to `public.launches`:
   - `worker_locked_at timestamptz`
   - `worker_id text`
   - Index on `worker_locked_at`
2. Create three SECURITY DEFINER SQL functions returning `SETOF launches`. Each uses `FOR UPDATE SKIP LOCKED` on an inner SELECT and stamps `worker_locked_at = now()`, `worker_id = p_worker_id`:
   - `claim_launch_for_worker(p_worker_id, p_status, p_lock_expiry_seconds DEFAULT 300)` — for distribution (`status='launched'`, `distribution_completed=false`, ordered by `created_at`)
   - `claim_pumpfun_launch_for_worker(p_worker_id, p_lock_expiry_seconds DEFAULT 300)` — for fee claims (`status='launched'`, `platform='pumpfun'`, last claim null or older than 10 min, ordered by `created_at`)
   - `claim_executing_launch_for_worker(p_worker_id, p_lock_expiry_seconds DEFAULT 120)` — for execution (`status='executing'`, ordered by `launch_datetime`)

   Each function only claims a row whose `worker_locked_at IS NULL` or is older than the expiry window, so crashed workers' locks self-heal.

## `distributor/`

**`src/db.ts`**
- Add `worker_locked_at: string | null` and `worker_id: string | null` to `Launch` interface.
- Add new functions: `claimNextDistribution(workerId)`, `claimNextPumpfunFeeClaim(workerId)`, `releaseLaunchLock(launchId)`. Each RPC returns the claimed row or `null`.
- Keep `getPendingDistributions` / `getPumpfunLaunchesForFeeClaim` for now, marked `@deprecated`.
- `resetStaleExecutingLaunches` stays unchanged.

**`src/distribute.ts`**
- Wrap the body of `distributeTokensForLaunch` in `try { ... } finally { await releaseLaunchLock(launch.id) }` so the lock is always released, even on early returns or throws.

**`src/claimPumpfunFees.ts`**
- No behavior change. `updatePumpfunFeesClaimed` (timestamp + total) stays inside `claimPumpfunFeesForLaunch`. `claimAllPumpfunFees` becomes unused once `index.ts` switches to the new loop, but keep it exported for safety.

**`src/index.ts`**
- `const WORKER_ID = process.env.WORKER_ID || process.env.RAILWAY_REPLICA_ID || "worker-default"` (no validateEnv requirement — automatic fallback).
- Replace `pollAndDistribute` with a loop that repeatedly calls `claimNextDistribution(WORKER_ID)` until it returns `null`, kicking off `distributeTokensForLaunch` in the background (lock released by distribute's finally).
- Replace `runClaimIfIdle`/`claimAllPumpfunFees` invocation with `pollAndClaimFees`: loop calls `claimNextPumpfunFeeClaim(WORKER_ID)`, awaits `claimPumpfunFeesForLaunch(launch)` sequentially, then `releaseLaunchLock(launch.id)` in a finally.
- Drop the in-memory `processing` Set and `claimRunning` boolean — Postgres now owns concurrency.
- Log `Worker ID: ${WORKER_ID}` at startup.

**`.env.example`**
- Add `WORKER_ID=worker-1` (commented as optional; falls back to `RAILWAY_REPLICA_ID`).

## `executor/`

**`src/db.ts`**
- Add `worker_locked_at` / `worker_id` to `Launch`.
- Add `claimNextExecutingLaunch(workerId)` (RPC) and `releaseLaunchLock(launchId)`.
- Keep `getExecutingLaunches` exported but unused.

**`src/executeLaunch.ts`**
- Replace the `getExecutingLaunches` + `processing` Set pattern with a loop: call `claimNextExecutingLaunch(WORKER_ID)` repeatedly; for each claimed launch, run the existing `executeBagsLaunch` / `executePumpfunLaunch` branch in the background with a `finally { releaseLaunchLock(launch.id) }`.
- Export the loop as `executeAllPendingLaunches(workerId)`.

**`src/index.ts`**
- `const WORKER_ID = process.env.WORKER_ID || process.env.RAILWAY_REPLICA_ID || "worker-default"`.
- Pass `WORKER_ID` into `executeAllPendingLaunches`.
- Log `Worker ID` at startup. No validateEnv change.

## Behavior after change

- Each Railway replica only sees launches it has atomically claimed; `SKIP LOCKED` guarantees no two replicas can ever claim the same row.
- Crashed workers' locks expire after 300s (distribution/fees) or 120s (execution) and are reclaimable by any worker.
- Horizontal scaling is now safe: bump replica count in Railway with no per-instance env config required (uses `RAILWAY_REPLICA_ID` automatically).

## Out of scope

- No frontend changes.
- No new secrets.
- No changes to executor business logic (`executeBags.ts`, `executePumpfun.ts`) or distribution math.
- No changes to `pg_cron` retry job.

