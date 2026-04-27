# Sponsored launches: pump wallet input + SOL recovery

Two gaps in the sponsored flow today:

1. **Influencers can't specify a pump wallet** — regular `SchedulePage` lets the creator enter "Receive your tokens at a different wallet?" so they can trade immediately on Pump.fun. The sponsored claim form has no equivalent. Worse: today no contribution row is written for the platform's 0.1 SOL, so the influencer doesn't actually receive tokens for it at distribution time at all.
2. **No SOL recovery on sponsored failures** — when a sponsored launch ends up `cancelled` (funding-flow exception, IPFS failure, expired link after pre-funding, etc.), the 0.1 SOL sitting in the freshly-generated escrow wallet is orphaned. The Bags wallet is depleted with nothing to show for it.

## What we'll build

### 1. Pump wallet input on the sponsored claim form

- Add a new optional **"Pump.fun wallet"** input on `SponsoredPage.tsx`, modeled exactly on `SchedulePage`'s `creatorDeliveryWallet` — same validation copy, same hint ("Enter your Pump.fun wallet to trade immediately after launch").
- Pass it to `claim-sponsored-slot` as `creator_delivery_wallet`.

### 2. Track the 0.1 SOL as the influencer's contribution

So distribution actually delivers tokens for that seed SOL:

- `executor/src/fundSponsoredEscrow.ts` — after the SOL transfer is confirmed (or detected as already-funded), insert a `contributions` row:
  - `launch_id` = launch
  - `wallet_address` = the influencer's pump wallet if provided; otherwise fall back to the launch's existing `created_by_wallet` (placeholder set at claim time)
  - `token_delivery_wallet` = same pump wallet (NULL if none given)
  - `amount_lamports` = the `sponsored_amount_lamports` (0.1 SOL)
  - `tx_signature` = the funding tx (or recovered signature)
  - `is_fee_claimer` = true (so the influencer is in the fee-share split, matching how a creator is treated on a regular launch)
- Idempotent: skip insert if a contribution with that `tx_signature` already exists.

Migration: store `creator_delivery_wallet` somewhere usable by the executor. Cleanest path is a new nullable column `launches.creator_delivery_wallet text` populated by `claim-sponsored-slot` and read by the funding worker. (Reusing `created_by_wallet` would conflict with refund logic that treats it as the SOL-payer.)

### 3. Auto-sweep cancelled sponsor escrows back to the Bags wallet

New worker tick in the executor: `sweepCancelledSponsorEscrows.ts`.

- Claims one launch at a time via a new RPC `claim_sponsor_recovery_for_worker` matching launches where:
  - `is_sponsored = true`
  - `status = 'cancelled'`
  - `sponsor_recovery_completed_at IS NULL`
  - lock TTL respected
- Loads the escrow keypair, queries on-chain balance, and if `> rent_exempt + tx_fee`, transfers everything (minus fee) back to the Bags wallet (`ERYS_PLATFORM_PRIVATE_KEY` pubkey).
- Records `sponsor_recovery_completed_at`, `sponsor_recovery_tx_signature`, `sponsor_recovery_amount_lamports` on the launch.
- Confirmation hardening identical to `fundSponsoredEscrow.ts`: if `confirmTransaction` times out, re-check status + re-check escrow balance before logging a failure. Records `sponsor_recovery_error` on hard failure with retry on next tick.
- Wired into `executor/src/index.ts` main loop alongside the funding worker.

### 4. Admin visibility

Surface the new fields in `SponsoredTab.tsx`:
- Show "Recovered: 0.0995 SOL · `<sig>`" badge when `sponsor_recovery_tx_signature` is set.
- Show recovery error (if any) in red.

## Technical details

### DB migration

```sql
-- new columns
alter table public.launches
  add column if not exists creator_delivery_wallet text,
  add column if not exists sponsor_recovery_completed_at timestamptz,
  add column if not exists sponsor_recovery_tx_signature text,
  add column if not exists sponsor_recovery_amount_lamports bigint,
  add column if not exists sponsor_recovery_attempts integer not null default 0,
  add column if not exists sponsor_recovery_error text;

-- worker claim RPC
create or replace function public.claim_sponsor_recovery_for_worker(
  p_worker_id text,
  p_lock_expiry_seconds int default 120
) returns setof public.launches
language sql security definer set search_path = public as $$
  update public.launches
  set worker_locked_at = now(), worker_id = p_worker_id
  where id = (
    select id from public.launches
    where is_sponsored = true
      and status = 'cancelled'
      and sponsor_recovery_completed_at is null
      and (
        worker_locked_at is null
        or worker_locked_at < now() - make_interval(secs => p_lock_expiry_seconds)
      )
    order by created_at asc
    limit 1
    for update skip locked
  )
  returning *;
$$;
```

### Files

**Edit**
- `src/pages/SponsoredPage.tsx` — add pump-wallet input + send `creator_delivery_wallet` in the invoke body
- `supabase/functions/claim-sponsored-slot/index.ts` — accept + validate (base58, 32–44 chars) + persist `creator_delivery_wallet`
- `executor/src/fundSponsoredEscrow.ts` — after success/recovery, insert contribution row idempotently
- `executor/src/index.ts` — register the new sweep worker tick
- `src/components/admin/SponsoredTab.tsx` — render recovery status + delivery wallet
- `src/integrations/supabase/types.ts` — regenerated automatically after migration

**Create**
- `executor/src/sweepCancelledSponsorEscrows.ts`
- `supabase/migrations/<ts>_sponsor_recovery.sql` (the SQL above)

### Edge cases handled
- Influencer leaves pump-wallet blank → contribution row uses `created_by_wallet`, no `token_delivery_wallet`, distribution still works (tokens go to the placeholder address).
- Funding succeeded but contribution insert fails → next tick re-detects funded escrow, skips transfer (existing idempotency), retries contribution insert (uniqueness on `tx_signature`).
- Sponsor link expires after pre-funding → status flips to `cancelled` via existing logic, sweep worker reclaims SOL.
- Recovered launch is later un-cancelled by an admin → recovery row already wrote `completed_at`; we'll guard the sweep with both `status='cancelled'` AND `completed_at IS NULL`.
- Bags wallet runs out: documented manual top-up requirement remains; nothing in this plan changes that.
