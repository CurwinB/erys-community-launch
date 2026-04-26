CREATE OR REPLACE FUNCTION public.mark_pumpfun_fee_claim_attempt(p_launch_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.launches
  SET pumpfun_fees_last_claimed_at = now()
  WHERE id = p_launch_id;
$$;