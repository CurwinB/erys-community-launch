-- 1. Grant browser roles SELECT on the newly added safe launch columns so the
--    admin dashboard stops getting 401 permission denied on launch reads.
GRANT SELECT (
  processing_fee_lamports,
  processing_fee_tx_signature,
  pumpfun_last_claim_attempt_at,
  pumpfun_last_claim_error
) ON public.launches TO anon, authenticated;

-- 2. Create the Pump.fun treasury-sweep ledger.
CREATE TABLE IF NOT EXISTS public.pumpfun_fee_sweeps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NULL,
  source_wallet text NOT NULL,
  treasury_wallet text NOT NULL,
  amount_lamports bigint NOT NULL CHECK (amount_lamports >= 0),
  tx_signature text NOT NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pumpfun_fee_sweeps_launch_created
  ON public.pumpfun_fee_sweeps (launch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pumpfun_fee_sweeps_created
  ON public.pumpfun_fee_sweeps (created_at DESC);

ALTER TABLE public.pumpfun_fee_sweeps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage pumpfun fee sweeps"
  ON public.pumpfun_fee_sweeps;
CREATE POLICY "Service role can manage pumpfun fee sweeps"
  ON public.pumpfun_fee_sweeps
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Lock down direct browser access; we expose this via service-role workers
-- and admin-side queries that already check is_admin server-side.
REVOKE ALL ON public.pumpfun_fee_sweeps FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pumpfun_fee_sweeps TO service_role;

-- 3. RPC: record a treasury sweep + clear stale claim error on the launch.
CREATE OR REPLACE FUNCTION public.record_pumpfun_fee_treasury_sweep(
  p_launch_id uuid,
  p_source_wallet text,
  p_treasury_wallet text,
  p_amount_lamports bigint,
  p_tx_signature text,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.pumpfun_fee_sweeps (
    launch_id, source_wallet, treasury_wallet,
    amount_lamports, tx_signature, notes
  )
  VALUES (
    p_launch_id, p_source_wallet, p_treasury_wallet,
    p_amount_lamports, p_tx_signature, p_notes
  )
  RETURNING id INTO v_id;

  IF p_launch_id IS NOT NULL THEN
    UPDATE public.launches
       SET pumpfun_last_claim_attempt_at = now(),
           pumpfun_last_claim_error      = NULL,
           pumpfun_fees_last_claimed_at  = now(),
           pumpfun_fees_claimed_total    =
             COALESCE(pumpfun_fees_claimed_total, 0) + p_amount_lamports,
           pumpfun_consecutive_empty_claims  = 0,
           pumpfun_low_volume_throttle_until = NULL
     WHERE id = p_launch_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_pumpfun_fee_treasury_sweep(
  uuid, text, text, bigint, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pumpfun_fee_treasury_sweep(
  uuid, text, text, bigint, text, text
) TO service_role;

-- 4. RPC: force every launched Pump.fun launch back to immediately-retriable.
CREATE OR REPLACE FUNCTION public.reset_all_pumpfun_fee_throttles()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.launches
     SET pumpfun_fees_last_claimed_at = NULL,
         pumpfun_low_volume_throttle_until = NULL,
         pumpfun_consecutive_empty_claims = 0,
         pumpfun_last_claim_error = NULL,
         worker_locked_at = NULL,
         worker_id = NULL
   WHERE platform = 'pumpfun'
     AND status   = 'launched';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_all_pumpfun_fee_throttles()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_all_pumpfun_fee_throttles() TO service_role;

-- 5. Kick the stuck ETEST launch so the next distributor cycle retries it.
UPDATE public.launches
   SET pumpfun_fees_last_claimed_at = NULL,
       pumpfun_low_volume_throttle_until = NULL,
       pumpfun_consecutive_empty_claims = 0,
       pumpfun_last_claim_error = NULL,
       worker_locked_at = NULL,
       worker_id = NULL
 WHERE platform = 'pumpfun'
   AND status   = 'launched';