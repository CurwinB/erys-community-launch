-- 1. Add sweep_recovery to launch_status enum (idempotent)
ALTER TYPE public.launch_status ADD VALUE IF NOT EXISTS 'sweep_recovery';

-- Commit the enum addition so subsequent statements can reference it.
COMMIT;
BEGIN;

-- 2. Atomic worker claim function for sweep_recovery launches.
-- Uses status::text comparison to avoid enum-literal resolution edge cases.
CREATE OR REPLACE FUNCTION public.claim_sweep_recovery_launch_for_worker(
  p_worker_id text,
  p_lock_expiry_seconds integer DEFAULT 300
)
RETURNS SETOF public.launches
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.launches
  SET
    worker_locked_at = now(),
    worker_id = p_worker_id
  WHERE id = (
    SELECT id FROM public.launches
    WHERE status::text = 'sweep_recovery'
      AND (
        worker_locked_at IS NULL
        OR worker_locked_at < now() - make_interval(secs => p_lock_expiry_seconds)
      )
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$function$;

-- 3. Reconcile stuck ETEST launch
UPDATE public.launches
SET status = 'sweep_recovery'::public.launch_status,
    pumpfun_launch_signature = '3T5aZSxFsTG1zEsM2rudWxbz99pbGqKquXEwaZtRxvjdgu7Bsou5999oKSf852VribibJAEJ7DhNDFeAvZroZfHC',
    execution_error = 'Reconciled: mint succeeded on-chain, sweep recovery in progress',
    worker_locked_at = NULL,
    worker_id = NULL
WHERE id = '9caf31b8-af12-4feb-8f72-32539e903461';

-- Clear stale partial refund metadata so contributors receive tokens
-- (the on-chain refund tx for wallet A remains as historical record but
-- isn't blocking distribution math anymore).
UPDATE public.contributions
SET refund_tx_signature = NULL,
    refund_shortfall_lamports = 0
WHERE launch_id = '9caf31b8-af12-4feb-8f72-32539e903461';