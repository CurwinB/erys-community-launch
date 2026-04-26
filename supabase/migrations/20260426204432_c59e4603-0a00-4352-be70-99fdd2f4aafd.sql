-- Add visibility columns for Pump.fun fee claim attempts
ALTER TABLE public.launches
  ADD COLUMN IF NOT EXISTS pumpfun_last_claim_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS pumpfun_last_claim_error text;

-- RPC: record a fee-claim FAILURE.
-- Stamps both the attempt timestamp AND pumpfun_fees_last_claimed_at so the
-- 10-minute throttle in claim_pumpfun_launch_for_worker also applies to
-- failures. This caps a broken PumpPortal integration to one retry per 10
-- minutes per launch instead of every poll cycle.
CREATE OR REPLACE FUNCTION public.record_pumpfun_fee_claim_failure(
  p_launch_id uuid,
  p_error text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.launches
  SET pumpfun_last_claim_attempt_at = now(),
      pumpfun_last_claim_error      = LEFT(COALESCE(p_error, 'unknown error'), 500),
      pumpfun_fees_last_claimed_at  = now()
  WHERE id = p_launch_id;
$function$;

-- On successful claim, also clear any stale error message and stamp the
-- attempt timestamp so the admin UI shows a recent healthy heartbeat.
CREATE OR REPLACE FUNCTION public.increment_pumpfun_fees_claimed(
  launch_id uuid,
  amount bigint
)
RETURNS void
LANGUAGE sql
SET search_path TO 'public'
AS $function$
  UPDATE public.launches
  SET pumpfun_fees_last_claimed_at = now(),
      pumpfun_last_claim_attempt_at = now(),
      pumpfun_last_claim_error      = NULL,
      pumpfun_fees_claimed_total    = COALESCE(pumpfun_fees_claimed_total, 0) + amount
  WHERE id = launch_id;
$function$;

-- No-op claim (vault empty) is a healthy outcome too — clear any prior error
-- and stamp the heartbeat.
CREATE OR REPLACE FUNCTION public.mark_pumpfun_fee_claim_attempt(p_launch_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.launches
  SET pumpfun_fees_last_claimed_at = now(),
      pumpfun_last_claim_attempt_at = now(),
      pumpfun_last_claim_error      = NULL
  WHERE id = p_launch_id;
$function$;

-- Force a Pump.fun launch to be picked up by the next distributor poll.
-- Clears the throttle and any worker lock. Used by the admin "Force retry"
-- button.
CREATE OR REPLACE FUNCTION public.force_pumpfun_fee_claim_retry(p_launch_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.launches
  SET pumpfun_fees_last_claimed_at = NULL,
      worker_locked_at             = NULL,
      worker_id                    = NULL
  WHERE id = p_launch_id
    AND platform = 'pumpfun'
    AND status   = 'launched';
$function$;