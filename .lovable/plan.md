# Migrate Lightning wallet pool to encrypted Supabase table

## Confirmed current state

- Pool source: `executor/src/pumpportalWalletPool.ts` + identical `distributor/src/pumpportalWalletPool.ts`. Loads wallets from numbered Railway env vars (`PUMPPORTAL_CUSTODIAL_WALLET[_N]`, `PUMPPORTAL_CUSTODIAL_PRIVATE_KEY[_N]`, `PUMPPORTAL_API_KEY[_N]`).
- Consumers: `executePumpfunLightning.ts`, `recoverPumpfunSweep.ts`, `claimPumpfunFeesBatch.ts`, both `index.ts` boot logs. All go through `getWalletForLaunch / getWalletByPubkey / getAllWallets / requireWallets` → `PumpPortalWallet`.
- `launches.pumpportal_wallet_pubkey` already records the wallet binding per launch.
- Encryption pattern: AES-256-GCM with `ESCROW_ENCRYPTION_KEY` (hex), stored as `iv:authTag:ciphertext` (hex). Used by `executor/src/decrypt.ts`.
- Legacy direct-env path: `distributor/src/claimPumpfunFees.ts` (will be migrated).

## What gets built

### 1. Migration: `lightning_wallets` table

```text
id                   uuid pk default gen_random_uuid()
slot                 int unique not null
pubkey               text unique not null
encrypted_secret_key text not null     -- iv:authTag:ciphertext (AES-256-GCM)
encrypted_api_key    text not null     -- same scheme
status               text not null default 'active'  -- 'active' | 'disabled'
notes                text
launch_count         int not null default 0          -- maintained via trigger on launches insert/update of pumpportal_wallet_pubkey
created_at           timestamptz not null default now()
updated_at           timestamptz not null default now()
last_used_at         timestamptz
```

- RLS: deny anon/auth all access, service_role full access.
- SECURITY DEFINER RPC `admin_list_lightning_wallets(p_admin_wallet)` returns rows WITHOUT `encrypted_*` columns, augmented with `launch_count` computed from `launches.pumpportal_wallet_pubkey`.
- Trigger to keep `launch_count` and `last_used_at` updated whenever a launch is bound to a wallet. (Implemented as a simple AFTER trigger on `launches`.)

### 2. Edge function `register-lightning-wallet` (admin-gated)

POST `{ adminWallet, pubkey, secretKeyBase58, apiKey, notes? }`. Checks `is_admin_wallet`, validates secret length = 64 bytes and derived pubkey matches input, encrypts secret + apiKey with `ESCROW_ENCRYPTION_KEY`, picks `slot = max(slot)+1`, inserts.

### 3. Edge function `seed-lightning-wallet-from-env` (idempotent, auto-run)

Reads `PUMPPORTAL_CUSTODIAL_WALLET / _PRIVATE_KEY / API_KEY` from runtime secrets, encrypts, inserts at `slot=1` if and only if no row currently has that pubkey. Safe to call repeatedly — second call is a no-op.

**Auto-trigger on deploy**: A small client-side bootstrap effect inside the existing `AdminPage.tsx` mount calls this function once per session. Belt-and-braces server-side: the executor's boot routine (`executor/src/index.ts`) also POSTs to it once at startup (using its service-role key). That guarantees the seed runs the first time the new code reaches Railway, with no manual step.

### 4. Hybrid loader (executor + distributor `pumpportalWalletPool.ts`)

- Keeps the existing env-var loader.
- Adds an async DB loader that pulls all `status='active'` rows, decrypts via the same AES-GCM scheme.
- Merges DB ∪ env, deduped by pubkey (env wins on collision so the live wallet's behavior is unchanged during cutover).
- 60-second TTL cache so newly added wallets surface within 60 s without restart.
- **Fallback rule**: if the DB query fails OR returns zero rows, the loader silently falls back to env-only and logs a warning. Launches never block on the DB.
- Public API (`getWalletForLaunch`, `getWalletByPubkey`, `requireWallets`, `getAllWallets`) stays sync from the consumer's perspective by warming the cache eagerly at boot and on a background refresh timer; consumers don't change.

### 5. Migrate legacy single-wallet path

`distributor/src/claimPumpfunFees.ts` accepts a `PumpPortalWallet` argument (or resolves by pubkey via the pool) instead of reading `PUMPPORTAL_*` env vars directly.

### 6. Admin UI: new "Lightning Wallets" tab

`src/components/admin/LightningWalletsTab.tsx`, wired into `AdminPage.tsx`. Shows a table with columns: **slot, public key (truncated + copy button), status, launch count, last used, notes**. Below the table, an "Add wallet" form (pubkey, secretKeyBase58, apiKey, notes) calling `register-lightning-wallet`. Disable / re-enable toggle is deferred to v2 per your call.

## Cutover order (zero downtime)

1. Migration creates the table + RPC + trigger.
2. Edge functions deploy (`register-lightning-wallet`, `seed-lightning-wallet-from-env`).
3. Executor + distributor redeploy with hybrid loader. On boot, executor calls `seed-lightning-wallet-from-env` → slot 1 (live Railway wallet) lands in DB. Hybrid loader uses env entry for slot 1 (env wins on dedup) so behavior is byte-identical.
4. You add the 19 new wallets via the admin UI; they're picked up within ~60 s.
5. Later, Railway `PUMPPORTAL_*` vars can be removed; loader continues from DB alone.

## After build: PumpPortal wallet generation steps

I'll give you the exact sequence at the end of the build message. Summary now: each wallet is generated by a single GET to `https://pumpportal.fun/api/create-wallet`, which returns `apiKey`, `walletPublicKey`, `privateKey`. **Save all three for every wallet immediately — PumpPortal does not let you retrieve any of them again.** Fund each `walletPublicKey` with at least 0.01 SOL (the rent-exempt floor + first-funding-tx headroom), then paste each triplet into the new admin tab.

## Files

Created:
- `supabase/migrations/<ts>_lightning_wallets.sql`
- `supabase/functions/register-lightning-wallet/index.ts`
- `supabase/functions/seed-lightning-wallet-from-env/index.ts`
- `src/components/admin/LightningWalletsTab.tsx`

Edited:
- `executor/src/pumpportalWalletPool.ts` (hybrid loader, env fallback, TTL cache, boot warmup)
- `distributor/src/pumpportalWalletPool.ts` (same)
- `executor/src/index.ts` (auto-call seed function once at startup)
- `distributor/src/claimPumpfunFees.ts` (drop direct env reads)
- `src/pages/AdminPage.tsx` (new tab + bootstrap call to seed function)
