-- Atomic worker claim for sweep_recovery launches. Same pattern as
-- claim_executing_launch_for_worker but scoped to launches whose mint
-- already exists on-chain and only need a custodial->escrow token sweep
-- redo. Safe to call from multiple replicas — SKIP LOCKED guarantees no
-- two workers ever pick up the same launch.
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
    WHERE status = 'sweep_recovery'
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
