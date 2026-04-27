-- Track on-chain creator vault balance so we can display it in admin
ALTER TABLE public.launches
  ADD COLUMN IF NOT EXISTS pumpfun_creator_vault_balance_lamports bigint,
  ADD COLUMN IF NOT EXISTS pumpfun_creator_vault_checked_at timestamptz;

GRANT SELECT (pumpfun_creator_vault_balance_lamports, pumpfun_creator_vault_checked_at)
  ON public.launches TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_pumpfun_creator_vault_balance(
  p_launch_ids uuid[],
  p_balance_lamports bigint
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.launches
     SET pumpfun_creator_vault_balance_lamports = p_balance_lamports,
         pumpfun_creator_vault_checked_at       = now()
   WHERE id = ANY(p_launch_ids);
$$;