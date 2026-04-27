CREATE OR REPLACE FUNCTION public.force_pumpfun_fee_claim_retry(p_launch_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.launches
  SET pumpfun_fees_last_claimed_at = NULL,
      pumpfun_last_claim_error     = NULL,
      worker_locked_at             = NULL,
      worker_id                    = NULL
  WHERE id = p_launch_id
    AND platform = 'pumpfun'
    AND status   = 'launched';
$function$;