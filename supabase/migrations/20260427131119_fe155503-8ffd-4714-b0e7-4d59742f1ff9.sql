-- Add columns to support sponsor recovery + creator delivery wallet on sponsored launches
ALTER TABLE public.launches
  ADD COLUMN IF NOT EXISTS creator_delivery_wallet text,
  ADD COLUMN IF NOT EXISTS sponsor_recovery_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sponsor_recovery_tx_signature text,
  ADD COLUMN IF NOT EXISTS sponsor_recovery_amount_lamports bigint,
  ADD COLUMN IF NOT EXISTS sponsor_recovery_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sponsor_recovery_error text;

-- Worker claim RPC: pulls one cancelled, sponsored launch whose escrow has not
-- been swept yet, with TTL-based lock so retries are safe.
CREATE OR REPLACE FUNCTION public.claim_sponsor_recovery_for_worker(
  p_worker_id text,
  p_lock_expiry_seconds integer DEFAULT 120
)
RETURNS SETOF public.launches
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.launches
  SET worker_locked_at = now(),
      worker_id        = p_worker_id
  WHERE id = (
    SELECT id FROM public.launches
    WHERE is_sponsored = true
      AND status = 'cancelled'
      AND sponsor_recovery_completed_at IS NULL
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