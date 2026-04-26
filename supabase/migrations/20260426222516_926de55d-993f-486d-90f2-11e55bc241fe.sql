
ALTER TABLE public.launches
  ADD COLUMN IF NOT EXISTS pumpfun_low_volume_throttle_until timestamptz,
  ADD COLUMN IF NOT EXISTS pumpfun_consecutive_empty_claims integer NOT NULL DEFAULT 0;

-- Batch claim function: grab up to p_limit eligible Pump.fun launches in a
-- single locked statement. Respects both the 10-min normal throttle and the
-- long-throttle for repeatedly-empty vaults.
CREATE OR REPLACE FUNCTION public.claim_pumpfun_launches_batch_for_worker(
  p_worker_id text,
  p_limit integer DEFAULT 25,
  p_lock_expiry_seconds integer DEFAULT 300
)
RETURNS SETOF launches
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.launches
  SET worker_locked_at = now(),
      worker_id        = p_worker_id
  WHERE id IN (
    SELECT id FROM public.launches
    WHERE status = 'launched'
      AND platform = 'pumpfun'
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
$$;

-- Record an empty-vault attempt: bump the counter, and once it crosses a
-- threshold (3) push the next attempt out by 1 hour to spare the custodial
-- wallet's priority-fee budget.
CREATE OR REPLACE FUNCTION public.record_pumpfun_empty_claim(p_launch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new_count integer;
BEGIN
  UPDATE public.launches
  SET pumpfun_fees_last_claimed_at  = now(),
      pumpfun_last_claim_attempt_at = now(),
      pumpfun_last_claim_error      = NULL,
      pumpfun_consecutive_empty_claims = COALESCE(pumpfun_consecutive_empty_claims, 0) + 1
  WHERE id = p_launch_id
  RETURNING pumpfun_consecutive_empty_claims INTO v_new_count;

  IF v_new_count >= 3 THEN
    UPDATE public.launches
    SET pumpfun_low_volume_throttle_until = now() + interval '1 hour'
    WHERE id = p_launch_id;
  END IF;
END;
$$;

-- When fees ARE collected, reset the empty-claim counter.
CREATE OR REPLACE FUNCTION public.increment_pumpfun_fees_claimed(launch_id uuid, amount bigint)
RETURNS void
LANGUAGE sql
SET search_path TO 'public'
AS $$
  UPDATE public.launches
  SET pumpfun_fees_last_claimed_at = now(),
      pumpfun_last_claim_attempt_at = now(),
      pumpfun_last_claim_error      = NULL,
      pumpfun_fees_claimed_total    = COALESCE(pumpfun_fees_claimed_total, 0) + amount,
      pumpfun_consecutive_empty_claims = 0,
      pumpfun_low_volume_throttle_until = NULL
  WHERE id = launch_id;
$$;
