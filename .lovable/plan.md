# Option 1: Serialize Custodial Wallet Operations with Postgres Advisory Lock

## Problem (recap)
The PumpPortal Lightning custodial wallet is shared across all Pump.fun launches and fee claims. Today's code reads `getBalance(custodial)` and sweeps "everything above the floor" — if two operations interleave, sweep A can drain SOL that belongs to launch B (and same for creator-fee claims). Nonce/blockhash contention also silently kills parallel sweeps.

## Fix Strategy
Wrap every custodial-wallet code path in a **Postgres advisory lock** keyed by the custodial wallet's public key. This forces all PumpPortal launches and fee claims (across any number of executor and distributor replicas) to take turns touching the wallet. SPL token sweeps are isolated by mint and don't strictly need the lock, but it's simpler and safer to hold the lock for the full launch lifecycle so the SOL accounting stays consistent.

Token sweeps for *different* mints are technically safe in parallel, but holding the lock through them costs nothing because the executor is already throughput-bounded by Lightning create latency (~5–15 s per launch).

## Scope of Changes

### 1. New SQL helper functions (migration)
Add two SECURITY DEFINER functions exposing `pg_try_advisory_lock` / `pg_advisory_unlock` over a stable bigint derived from a text key. Service role only.

```sql
create or replace function public.try_acquire_custodial_lock(p_key text)
returns boolean language sql security definer set search_path = public as $$
  select pg_try_advisory_lock(hashtextextended(p_key, 0));
$$;

create or replace function public.release_custodial_lock(p_key text)
returns boolean language sql security definer set search_path = public as $$
  select pg_advisory_unlock(hashtextextended(p_key, 0));
$$;
```

Notes:
- `hashtextextended` returns a deterministic bigint, suitable for advisory-lock keys.
- Advisory locks are session-scoped. Because supabase-js uses PgBouncer (transaction pooling), we MUST acquire + release in the same call chain and never rely on connection identity. We achieve this by wrapping each lock attempt in a tight retry loop and always calling release at the end of the critical section, with a TTL fallback (see #3).

### 2. New executor helper: `executor/src/custodialLock.ts`
Small utility around the SQL functions:
- `acquireCustodialLock(timeoutMs, pollMs)` — polls `try_acquire_custodial_lock` until it returns true or `timeoutMs` elapses. Throws on timeout.
- `releaseCustodialLock()` — best-effort release; logs but never throws.
- `withCustodialLock(fn, opts)` — acquires, runs `fn`, always releases in `finally`.
- Lock key is the custodial wallet pubkey string so future per-wallet pools (Option 3) get free isolation by reusing the same primitive with a different key.

Same helper duplicated into `distributor/src/custodialLock.ts` (separate codebase, can't share).

### 3. TTL safety net
Because PgBouncer can route the release to a different backend than the acquire, advisory locks could theoretically leak. Mitigations:
- Default acquire timeout: 90 s (longer than the worst-case Lightning create + sweeps).
- Add a `custodial_wallet_locks` table as a belt-and-braces TTL fallback used in addition to the advisory lock:
  ```sql
  create table public.custodial_wallet_locks (
    lock_key text primary key,
    locked_by text not null,
    locked_at timestamptz not null default now()
  );
  ```
  Acquire = `INSERT … ON CONFLICT DO NOTHING` only when existing row is older than 120 s. Release = `DELETE WHERE locked_by = $worker_id`. Combined with the advisory lock, this guarantees self-healing if an executor crashes mid-launch.

### 4. Wire the lock into the Lightning executor
File: `executor/src/executePumpfunLightning.ts`
Wrap the entire critical section — funding → Lightning create → token sweep retries → SOL sweep — in `withCustodialLock`. The lock is held from the moment we transfer SOL into the custodial wallet until we've swept residual SOL back out. This eliminates SOL collision and serializes all PumpPortal API calls per worker fleet.

The pre-flight checks (decrypting keys, computing splits, persisting basis points) happen BEFORE acquiring the lock so we don't block other launches while doing CPU work that doesn't touch the custodial wallet.

### 5. Wire the lock into the fee claimer
File: `distributor/src/claimPumpfunFees.ts`
Wrap the entire `claimPumpfunFeesForLaunch` body from "read pre-claim balance" through "sweep custodial → escrow" in `withCustodialLock`. The 50/50 escrow→platform/creator split runs OUTSIDE the lock since by then funds are in the per-launch escrow and are no longer shared.

### 6. Fail-fast on lock timeout
- Executor: if `acquireCustodialLock` times out, **release the worker lock on `launches`** so another worker (or the same worker on the next poll) can retry. Do NOT mark the launch failed — it never started.
- Fee claimer: if it times out, just log and skip; the next 10-min cycle will pick the launch up again automatically.

## Files Touched
- `supabase/migrations/<timestamp>_custodial_advisory_lock.sql` — new SQL functions + TTL table
- `executor/src/custodialLock.ts` — new helper
- `executor/src/executePumpfunLightning.ts` — wrap critical section
- `executor/src/db.ts` — minor: factor a no-op release path on timeout
- `distributor/src/custodialLock.ts` — new helper (duplicate of executor's)
- `distributor/src/claimPumpfunFees.ts` — wrap critical section

No frontend changes. No new secrets. No env-var changes. Bags launches (`executeBags.ts`) untouched — they don't share custodial state.

## Throughput After This Change
- ~1 Pump.fun launch in flight at a time globally (~15–25 s each end-to-end). Realistic ceiling: **~2–4 Pump.fun launches per minute**. Plenty for current load; if it ever becomes a bottleneck, Option 3 (wallet pool) drops in cleanly using the same `withCustodialLock(key=walletPubkey, ...)` primitive.
- Bags launches: **unchanged, fully parallel**.
- Fee claims: **serialized for Pump.fun launches only**, sequential per launch (already the case in `claimAllPumpfunFees` which iterates with a 1 s delay).

## What This Does NOT Fix
- PumpPortal API outages (still a single dependency)
- Per-API-key rate limits (single key)
- Custodial wallet running out of SOL float (operator concern)
Each of those is addressed by Option 3 or 4 in the earlier discussion.

## Rollout
1. Run migration (creates SQL functions + TTL table).
2. Redeploy executor and distributor to Railway with the new code.
3. Verify in logs: first Pump.fun launch should log `Acquired custodial lock`; a concurrent second one (if any) should log `Waiting for custodial lock`.

No data backfill required. Safe to roll back by removing the `withCustodialLock` wrappers.
