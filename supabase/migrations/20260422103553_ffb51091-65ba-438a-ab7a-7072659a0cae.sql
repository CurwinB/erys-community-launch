-- Add worker locking columns
ALTER TABLE public.launches
  ADD COLUMN IF NOT EXISTS worker_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS worker_id text;

CREATE INDEX IF NOT EXISTS idx_launches_worker_locked_at
  ON public.launches(worker_locked_at);

-- Atomic claim function for distribution work
CREATE OR REPLACE FUNCTION public.claim_launch_for_worker(
  p_worker_id text,
  p_status text,
  p_lock_expiry_seconds integer DEFAULT 300
)
RETURNS SETOF public.launches
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.launches
  SET
    worker_locked_at = now(),
    worker_id = p_worker_id
  WHERE id = (
    SELECT id FROM public.launches
    WHERE status::text = p_status
      AND distribution_completed = false
      AND (
        worker_locked_at IS NULL
        OR worker_locked_at < now() - make_interval(secs => p_lock_expiry_seconds)
      )
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

-- Atomic claim function for Pump.fun fee claiming
CREATE OR REPLACE FUNCTION public.claim_pumpfun_launch_for_worker(
  p_worker_id text,
  p_lock_expiry_seconds integer DEFAULT 300
)
RETURNS SETOF public.launches
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.launches
  SET
    worker_locked_at = now(),
    worker_id = p_worker_id
  WHERE id = (
    SELECT id FROM public.launches
    WHERE status = 'launched'
      AND platform = 'pumpfun'
      AND (
        pumpfun_fees_last_claimed_at IS NULL
        OR pumpfun_fees_last_claimed_at <= now() - interval '10 minutes'
      )
      AND (
        worker_locked_at IS NULL
        OR worker_locked_at < now() - make_interval(secs => p_lock_expiry_seconds)
      )
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

-- Atomic claim function for launch execution
CREATE OR REPLACE FUNCTION public.claim_executing_launch_for_worker(
  p_worker_id text,
  p_lock_expiry_seconds integer DEFAULT 120
)
RETURNS SETOF public.launches
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.launches
  SET
    worker_locked_at = now(),
    worker_id = p_worker_id
  WHERE id = (
    SELECT id FROM public.launches
    WHERE status = 'executing'
      AND (
        worker_locked_at IS NULL
        OR worker_locked_at < now() - make_interval(secs => p_lock_expiry_seconds)
      )
    ORDER BY launch_datetime ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;