## Goal

Make adding a new PumpPortal custodial wallet a **zero-code operation**. Going from 1 wallet to N should require only:

1. Add `PUMPPORTAL_CUSTODIAL_WALLET_2`, `PUMPPORTAL_CUSTODIAL_PRIVATE_KEY_2`, and `PUMPPORTAL_API_KEY_2` as secrets.
2. Restart the workers.

That's it. No code changes. No UI changes. The system auto-discovers the new wallet, includes it in the scheduling capacity calculation, distributes new launches across the pool, and includes it in the fee-claim cycle.

## How It Works

### 1. Wallet pool auto-discovery

A new shared module `pumpportalWalletPool.ts` scans environment variables on boot and builds an array of `{ id, pubkey, secretKey, apiKey }`. The naming convention is:

```text
Slot 1 (existing, unchanged):
  PUMPPORTAL_CUSTODIAL_WALLET
  PUMPPORTAL_CUSTODIAL_PRIVATE_KEY
  PUMPPORTAL_API_KEY

Slot 2:
  PUMPPORTAL_CUSTODIAL_WALLET_2
  PUMPPORTAL_CUSTODIAL_PRIVATE_KEY_2
  PUMPPORTAL_API_KEY_2

Slot N:
  PUMPPORTAL_CUSTODIAL_WALLET_N
  PUMPPORTAL_CUSTODIAL_PRIVATE_KEY_N
  PUMPPORTAL_API_KEY_N
```

The loader stops at the first numbered slot whose secrets are missing. Each slot must have all three; partial slots throw at boot with a clear error. Existing single-wallet deployments keep working with no changes (slot 1 = the legacy unsuffixed names).

The module is duplicated across `executor/src/` and `distributor/src/` (Node) since the two services are deployed separately, but they share the exact same file contents (kept in sync — small file).

### 2. Capacity scales with the pool size

`supabase/functions/_shared/scheduleCapacity.ts` currently hard-codes `pumpfun: 1` per minute. We change it to read the pool size from a database setting and multiply: `pumpfun_cap = pool_size`. So:

- 1 wallet → 1 launch/min on Pump.fun
- 2 wallets → 2 launches/min
- 5 wallets → 5 launches/min

Implementation: a tiny new `app_settings` table with a single row `(key='pumpportal_wallet_pool_size', value=integer)`. The workers update this row on boot whenever they detect a different pool size. The scheduling edge functions read it (cached for 30 s) when computing slot capacity. This keeps the edge functions stateless — they don't need access to the wallet env vars.

### 3. Per-launch wallet assignment

When the executor picks up a `scheduled` Pump.fun launch:

1. It hashes `launch.id` to a number, `mod pool_size`, picking a wallet deterministically.
2. It writes the chosen `pumpportal_wallet_pubkey` to the launch row **before** running the critical section.
3. It uses that wallet's secret key + API key for funding, the Lightning create call, and the post-mint sweep.
4. The custodial lock key becomes the wallet pubkey (already the case today — so concurrent launches on different wallets run in parallel automatically).

Recovery (`recoverPumpfunSweep`) reads the persisted `pumpportal_wallet_pubkey` so it knows which wallet to sweep tokens from.

### 4. Fee-claim cycle iterates the pool

`claimPumpfunFeesBatch` becomes wallet-aware:

- The `claim_pumpfun_launches_batch_for_worker` RPC takes an optional `p_wallet_pubkey` filter so each batch contains launches for exactly one wallet.
- The distributor loops through every wallet in the pool, claiming + sweeping each one in turn (each under its own lock key, so two distributors can sweep two wallets in parallel).
- Each wallet has its own creator-vault PDA, so the existing "balance check before claim" logic runs per wallet.

### 5. Admin visibility (optional but cheap)

The admin AccountingTab already shows fee-sweep history. We add a small "Wallet pool" panel showing each configured wallet, its current SOL balance, its creator-vault balance, and how many launches it owns. Read-only — no controls. This is the only UI change.

## Database Changes

Two small migrations:

```sql
-- 1. Add per-launch wallet tracking
alter table public.launches
  add column pumpportal_wallet_pubkey text;

create index if not exists idx_launches_pumpportal_wallet
  on public.launches(pumpportal_wallet_pubkey)
  where platform = 'pumpfun';

-- 2. App settings for cross-service config
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
create policy "Service role manages app_settings"
  on public.app_settings for all
  to service_role using (true) with check (true);
create policy "App settings are readable by everyone"
  on public.app_settings for select
  to public using (true);

-- 3. Updated batch-claim RPC with optional wallet filter
create or replace function public.claim_pumpfun_launches_batch_for_worker(
  p_worker_id text,
  p_limit integer default 25,
  p_lock_expiry_seconds integer default 300,
  p_wallet_pubkey text default null
) returns setof public.launches ...
  -- adds: and (p_wallet_pubkey is null
  --            or pumpportal_wallet_pubkey = p_wallet_pubkey)
```

`pumpportal_wallet_pubkey` stays `null` for existing launches (they all use the legacy single wallet, which is slot 1 of the pool — backwards-compatible by definition).

## Files Touched

**New files:**
- `executor/src/pumpportalWalletPool.ts` — pool loader + `getWalletForLaunch(launchId)` + `getAllWallets()`.
- `distributor/src/pumpportalWalletPool.ts` — identical contents.
- `supabase/migrations/<ts>_pumpportal_wallet_pool.sql` — schema + RPC update.

**Modified:**
- `executor/src/pumpportalCustodial.ts` — refactor module-level cached keypair into `getKeypairForWallet(pubkey)`. Helper functions take a wallet handle.
- `executor/src/executePumpfunLightning.ts` — pick wallet via `getWalletForLaunch`, pass wallet handle into helpers, persist `pumpportal_wallet_pubkey`.
- `executor/src/recoverPumpfunSweep.ts` — read `pumpportal_wallet_pubkey` from launch, use that wallet.
- `executor/src/index.ts` — on boot, write current pool size to `app_settings`.
- `distributor/src/claimPumpfunFeesBatch.ts` — outer loop over all wallets in pool; each iteration uses that wallet's keypair + API key, with the wallet pubkey as the lock key.
- `distributor/src/claimPumpfunFees.ts` — same single-launch path: read launch's wallet column, use that wallet.
- `distributor/src/index.ts` — write pool size to `app_settings` on boot.
- `supabase/functions/_shared/scheduleCapacity.ts` — read `pumpportal_wallet_pool_size` from `app_settings` (cached) and use it as the per-minute cap.
- `src/components/admin/AccountingTab.tsx` — small "Wallet pool" panel (read-only).

## What Stays The Same

- All existing secrets, RPC URLs, encryption keys: untouched.
- The custodial lock RPC functions: unchanged (already keyed by string).
- The launch flow on the user side: identical.
- The fee-claim economics + thresholds: identical.
- Single-wallet deployments: still work with zero changes.

## Operational Story (the user-facing simplicity)

After this lands, here's the entire process to add wallet #2:

1. Create a new PumpPortal Lightning wallet, copy its API key + private key + public key.
2. In the Lovable secrets panel, add three secrets: `PUMPPORTAL_API_KEY_2`, `PUMPPORTAL_CUSTODIAL_WALLET_2`, `PUMPPORTAL_CUSTODIAL_PRIVATE_KEY_2`.
3. Restart the executor + distributor on Railway.

The system immediately:
- Reports pool size = 2 to the database.
- Doubles the per-minute Pump.fun scheduling capacity in the UI.
- Starts assigning new launches to wallets 1 or 2 (round-robin via launch-id hash).
- Includes wallet 2 in every fee-claim cycle.

To remove a wallet: delete the three secrets and restart. New launches stop using it; old launches still on it get swept whenever someone tops up its SOL.

## Out of Scope

- Auto-rebalancing SOL between wallets (operator's responsibility for now).
- Failover when one wallet errors (each launch sticks to its assigned wallet — failure is per-launch, not per-wallet).
- A UI to add/remove wallets without touching secrets (deliberately not building this — secrets stay the source of truth).
