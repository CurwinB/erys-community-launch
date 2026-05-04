CREATE OR REPLACE FUNCTION public.claim_local_signing_pumpfun_launches_batch_for_worker(
  p_worker_id text,
  p_limit integer DEFAULT 25,
  p_lock_expiry_seconds integer DEFAULT 300
)
RETURNS SETOF launches
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.launches
  SET worker_locked_at = now(),
      worker_id        = p_worker_id
  WHERE id IN (
    SELECT id FROM public.launches
    WHERE status = 'launched'
      AND platform = 'pumpfun'
      AND pumpportal_wallet_pubkey IS NULL
      AND (
        pumpfun_fees_last_claimed_at IS NULL
        OR pumpfun_fees_last_claimed_at <= now() - interval '10 minutes'
      )
      AND (
        pumpfun_low_volume_throttle_until IS NULL
        OR pumpfun_low_volume_throttle_until <= now()
      )
      AND (
        worker_locked_at IS NULL
        OR worker_locked_at < now() - make_interval(secs => p_lock_expiry_seconds)
      )
    ORDER BY created_at ASC
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$function$;