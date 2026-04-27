-- =====================================================================
-- Lock down public.launches and contributions; expose safe public surface
-- =====================================================================
-- Problem: `launches` had a permissive "viewable by everyone" SELECT policy.
-- Even with column-level GRANTs, the policy + table-level grants kept
-- letting anon/authenticated read sensitive operational columns
-- (escrow_wallet_encrypted_private_key, pumpfun_mint_keypair_encrypted,
-- sponsor_link_token, worker_id, etc.). Fix:
-- 1) Drop the permissive policy; replace with deny-all SELECT.
-- 2) Revoke all browser grants on the base table.
-- 3) Expose a sanitized SECURITY INVOKER view `launches_public` for
--    public/anonymous reads with only safe fields.
-- 4) Provide SECURITY DEFINER RPCs that return the full launches/
--    contributions/fee-claims rows ONLY when caller passes a verified
--    admin wallet (checked via is_admin_wallet).

-- 1) launches: drop public policy + add deny-all
DROP POLICY IF EXISTS "Launches are viewable by everyone" ON public.launches;

CREATE POLICY "No direct browser access to launches"
  ON public.launches
  FOR SELECT
  USING (false);

-- 2) Revoke all browser grants on the base table.
REVOKE ALL ON public.launches FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.launches TO service_role;

-- 3) Sanitized public view (security_invoker so RLS context applies).
DROP VIEW IF EXISTS public.launches_public CASCADE;
CREATE VIEW public.launches_public
WITH (security_invoker = on) AS
  SELECT
    id,
    token_name,
    token_symbol,
    description,
    image_url,
    twitter_url,
    telegram_url,
    website_url,
    token_mint_address,
    ipfs_metadata_url,
    escrow_wallet_public_key,
    launch_datetime,
    min_contribution_lamports,
    max_contribution_lamports,
    status,
    created_by_wallet,
    created_at,
    fee_share_config_key,
    claimer_count,
    excluded_contributors,
    total_tokens_distributed,
    distribution_completed,
    distribution_completed_at,
    platform,
    pumpfun_launch_signature,
    pumpfun_fees_last_claimed_at,
    pumpfun_fees_claimed_total,
    pumpfun_creator_fees_distributed,
    is_sponsored,
    sponsored_by,
    sponsored_amount_lamports,
    sponsored_tx_signature
  FROM public.launches
  WHERE status <> 'sponsor_pending';

GRANT SELECT ON public.launches_public TO anon, authenticated;

-- 4) Admin RPCs (SECURITY DEFINER, gated by is_admin_wallet).
CREATE OR REPLACE FUNCTION public.admin_list_launches(p_admin_wallet text)
RETURNS SETOF public.launches
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_wallet(p_admin_wallet) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN QUERY
    SELECT * FROM public.launches
    ORDER BY launch_datetime DESC NULLS LAST
    LIMIT 1000;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_launches(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_launches(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_pumpfun_fee_health(p_admin_wallet text)
RETURNS SETOF public.launches
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_wallet(p_admin_wallet) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN QUERY
    SELECT * FROM public.launches
    WHERE platform = 'pumpfun' AND status = 'launched'
    ORDER BY created_at DESC
    LIMIT 1000;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_pumpfun_fee_health(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_pumpfun_fee_health(text) TO anon, authenticated;

-- The launch detail page currently reads a single launch by id. Provide a
-- gated detail RPC for the few admin-only fields not exposed by the view.
CREATE OR REPLACE FUNCTION public.get_launch_public(p_id uuid)
RETURNS public.launches_public
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM public.launches_public WHERE id = p_id LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_launch_public(uuid) TO anon, authenticated;