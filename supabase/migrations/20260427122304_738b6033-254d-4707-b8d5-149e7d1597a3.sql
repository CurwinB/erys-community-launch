-- 1. Lock down contributions table for browser reads
DROP POLICY IF EXISTS "Contributions are viewable by everyone" ON public.contributions;

CREATE POLICY "No direct browser access to contributions"
  ON public.contributions
  FOR SELECT
  TO public
  USING (false);

REVOKE SELECT ON public.contributions FROM anon, authenticated;

-- 2. Sanitized public view for live feeds (no tx_signature, refund details, delivery wallet, etc.)
CREATE OR REPLACE VIEW public.contributions_public
WITH (security_invoker = on) AS
SELECT
  id,
  launch_id,
  wallet_address,
  amount_lamports,
  contributed_at
FROM public.contributions
WHERE refund_tx_signature IS NULL;

GRANT SELECT ON public.contributions_public TO anon, authenticated;

-- 3. Admin RPC: full contribution rows for admin dashboard
CREATE OR REPLACE FUNCTION public.admin_list_contributions(p_admin_wallet text)
RETURNS SETOF public.contributions
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
    SELECT * FROM public.contributions
    ORDER BY contributed_at DESC
    LIMIT 5000;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_contributions(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_contributions(text) TO anon, authenticated, service_role;

-- 4. Wallet-scoped RPC for dashboard / wallet dropdown
-- Returns enriched rows for the supplied wallet only, including safe launch info.
CREATE OR REPLACE FUNCTION public.list_my_contributions(p_wallet text)
RETURNS TABLE (
  id uuid,
  launch_id uuid,
  wallet_address text,
  amount_lamports bigint,
  contributed_at timestamptz,
  basis_points integer,
  token_amount bigint,
  tokens_distributed boolean,
  is_fee_claimer boolean,
  refund_tx_signature text,
  refund_shortfall_lamports bigint,
  distribution_tx_signature text,
  token_delivery_wallet text,
  launches public.launches_public
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.launch_id,
    c.wallet_address,
    c.amount_lamports,
    c.contributed_at,
    c.basis_points,
    c.token_amount,
    c.tokens_distributed,
    c.is_fee_claimer,
    c.refund_tx_signature,
    c.refund_shortfall_lamports,
    c.distribution_tx_signature,
    c.token_delivery_wallet,
    lp
  FROM public.contributions c
  LEFT JOIN public.launches_public lp ON lp.id = c.launch_id
  WHERE lower(c.wallet_address) = lower(p_wallet)
  ORDER BY c.contributed_at DESC
  LIMIT 1000;
$$;

REVOKE ALL ON FUNCTION public.list_my_contributions(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_contributions(text) TO anon, authenticated, service_role;

-- 5. Storage policies: lock down UPDATE/DELETE on token-images to service_role only
DROP POLICY IF EXISTS "Service role manages token-images updates" ON storage.objects;
DROP POLICY IF EXISTS "Service role manages token-images deletes" ON storage.objects;

CREATE POLICY "Service role manages token-images updates"
  ON storage.objects
  FOR UPDATE
  TO service_role
  USING (bucket_id = 'token-images')
  WITH CHECK (bucket_id = 'token-images');

CREATE POLICY "Service role manages token-images deletes"
  ON storage.objects
  FOR DELETE
  TO service_role
  USING (bucket_id = 'token-images');

-- Same hardening for token-metadata while we are here
DROP POLICY IF EXISTS "Service role manages token-metadata updates" ON storage.objects;
DROP POLICY IF EXISTS "Service role manages token-metadata deletes" ON storage.objects;

CREATE POLICY "Service role manages token-metadata updates"
  ON storage.objects
  FOR UPDATE
  TO service_role
  USING (bucket_id = 'token-metadata')
  WITH CHECK (bucket_id = 'token-metadata');

CREATE POLICY "Service role manages token-metadata deletes"
  ON storage.objects
  FOR DELETE
  TO service_role
  USING (bucket_id = 'token-metadata');

-- 6. Revoke EXECUTE on internal SECURITY DEFINER worker / maintenance functions
-- These are only meant to be called by the service role (workers / cron / edge functions).
REVOKE EXECUTE ON FUNCTION public.claim_launch_for_worker(text, text, integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.claim_pumpfun_launch_for_worker(text, integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.claim_executing_launch_for_worker(text, integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.claim_pumpfun_launches_batch_for_worker(text, integer, integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.claim_pumpfun_launches_batch_for_worker(text, integer, integer, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.claim_sweep_recovery_launch_for_worker(text, integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.record_pumpfun_wallet_starved(uuid, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.record_pumpfun_fee_treasury_sweep(uuid, text, text, bigint, text, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.record_pumpfun_creator_vault_balance(uuid[], bigint) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.try_acquire_custodial_lock(text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.release_custodial_lock(text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.try_acquire_custodial_row_lock(text, text, integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.release_custodial_row_lock(text, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.mark_pumpfun_fee_claim_attempt(uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.record_pumpfun_fee_claim_failure(uuid, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.force_pumpfun_fee_claim_retry(uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.record_pumpfun_empty_claim(uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_app_setting(text, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.reset_all_pumpfun_fee_throttles() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.increment_pumpfun_fees_claimed(uuid, bigint) FROM anon, authenticated, public;
