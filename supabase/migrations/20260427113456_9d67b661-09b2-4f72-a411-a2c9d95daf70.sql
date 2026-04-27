ALTER TABLE public.launches ALTER COLUMN launch_datetime DROP NOT NULL;

DROP FUNCTION IF EXISTS public.get_sponsor_slot_by_token(text);

CREATE OR REPLACE FUNCTION public.get_sponsor_slot_by_token(p_token text)
 RETURNS TABLE(id uuid, launch_datetime timestamp with time zone, sponsor_link_expires_at timestamp with time zone, sponsored_amount_lamports bigint, status text, token_name text, token_symbol text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    l.id,
    l.launch_datetime,
    l.sponsor_link_expires_at,
    l.sponsored_amount_lamports,
    l.status::text,
    l.token_name,
    l.token_symbol
  FROM public.launches l
  WHERE l.sponsor_link_token = p_token
  LIMIT 1;
$function$;