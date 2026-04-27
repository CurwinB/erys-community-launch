CREATE OR REPLACE FUNCTION public.record_pumpfun_wallet_starved(p_launch_id uuid, p_error text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.launches
  SET pumpfun_last_claim_attempt_at = now(),
      pumpfun_last_claim_error      = LEFT(COALESCE(p_error, 'custodial wallet underfunded'), 500)
  WHERE id = p_launch_id;
$function$;