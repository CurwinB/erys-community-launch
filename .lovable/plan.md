## Root cause

The previous batch wrote three migration **files** into `supabase/migrations/` but they were never executed against the live database. Verified directly:

- `launch_status` enum currently contains: `scheduled, executing, launched, execution_failed, cancelled, sponsor_pending` — **no `sweep_recovery`**.
- `public.claim_sweep_recovery_launch_for_worker` does **not** exist (hence the Railway errors).
- ETEST launch `9caf31b8-af12-4feb-8f72-32539e903461` is still `status=execution_failed` with `pumpfun_launch_signature=NULL` — reconcile never ran.

The redeployed executor is calling an RPC and looking for an enum value that don't exist, against un-reconciled data. Distribution will never trigger.

## Fix — re-run the 3 migrations as one consolidated migration

Create a single new migration that performs all three steps idempotently (so it's safe even if parts somehow partially landed). Concretely:

### 1. Add `sweep_recovery` to the enum
```sql
ALTER TYPE public.launch_status ADD VALUE IF NOT EXISTS 'sweep_recovery';
```
Run this in its own statement / migration block (Postgres requires enum additions to be committed before they can be referenced by name in the same transaction).

### 2. Create `claim_sweep_recovery_launch_for_worker`
Re-create the function exactly as defined in `supabase/migrations/20260426193200_claim_sweep_recovery_launch.sql`:
- `SECURITY DEFINER`, `search_path = public`
- `UPDATE … WHERE id = (SELECT … WHERE status = 'sweep_recovery' AND lock expired/null FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`
- Sets `worker_locked_at = now()`, `worker_id = p_worker_id`

### 3. Reconcile the ETEST launch `9caf31b8-af12-4feb-8f72-32539e903461`
Confirmed live state of its 2 contributions:

| wallet | amount | refund_tx_signature | refund_shortfall_lamports | token_delivery_wallet |
|---|---|---|---|---|
| `62aKW…ubaV` | 0.1 SOL | `4sCGYe9D…ySS` (partial refund) | 96,782,620 | `F46Ai…69BEK` |
| `BvpGu…c9rxV` | 0.1 SOL | NULL | 99,995,000 | NULL |

Apply:
```sql
UPDATE public.launches
SET status = 'sweep_recovery',
    pumpfun_launch_signature = '3T5aZSx…' ,    -- the real on-chain mint sig
    execution_error = 'Reconciled: mint succeeded, sweep failed',
    worker_locked_at = NULL,
    worker_id = NULL
WHERE id = '9caf31b8-af12-4feb-8f72-32539e903461';

UPDATE public.contributions
SET refund_tx_signature = NULL,
    refund_shortfall_lamports = 0
WHERE launch_id = '9caf31b8-af12-4feb-8f72-32539e903461';
```

**Open item:** I need the exact `pumpfun_launch_signature` for ETEST. The previous reconcile migration referenced `3T5aZSx…` — I'll re-read `supabase/migrations/20260426193100_reconcile_etest_launch.sql` to grab the full signature it used and reuse it verbatim. If that file has a placeholder rather than the real sig, I'll flag and ask before running.

## Files

- **New**: `supabase/migrations/<timestamp>_apply_sweep_recovery.sql` — consolidated, idempotent version of the three previous migrations.
- **Delete**: the three previously-created-but-never-applied migrations under `supabase/migrations/20260426193000_…`, `…193100_…`, `…193200_…` so the migration history isn't ambiguous (their content is fully subsumed by the new one).

No code changes — the executor and edge functions already reference `sweep_recovery` and `claim_sweep_recovery_launch_for_worker`; they just need the DB to catch up.

## Verification after migration applies

1. `SELECT unnest(enum_range(NULL::public.launch_status))` includes `sweep_recovery`.
2. `SELECT proname FROM pg_proc WHERE proname='claim_sweep_recovery_launch_for_worker'` returns 1 row.
3. ETEST launch shows `status=sweep_recovery`, signature populated, both contributions cleared of refund metadata.
4. Railway executor logs: the "Could not find the function" errors stop and a "Worker … claimed launch 9caf31b8… for sweep recovery" line appears within ~1 poll cycle.
5. After sweep + status flip back to `launched`, distributor delivers tokens (50/50 split, Wallet A's `F46Ai…` override honored).

No executor/distributor redeploy needed — they're already running the right code.
