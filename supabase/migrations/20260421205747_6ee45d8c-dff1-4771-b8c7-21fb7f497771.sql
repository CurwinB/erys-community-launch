CREATE OR REPLACE FUNCTION public.increment_pumpfun_fees_claimed(launch_id uuid, amount bigint)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.launches
  SET pumpfun_fees_last_claimed_at = now(),
      pumpfun_fees_claimed_total   = COALESCE(pumpfun_fees_claimed_total, 0) + amount
  WHERE id = launch_id;
$$;