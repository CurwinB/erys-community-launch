-- 1. Explicit deny SELECT policy on admin_wallets for public/anon/authenticated
CREATE POLICY "Deny public reads of admin_wallets"
ON public.admin_wallets
FOR SELECT
TO public
USING (false);

-- 2. Restrict token-images bucket to image MIME types and enforce size limit
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif','image/svg+xml'],
    file_size_limit = 5242880
WHERE id = 'token-images';

-- 3. Switch launches_public view to security_invoker without dropping (preserves
-- dependent function get_launch_public). The view's column allowlist remains the
-- protective boundary; we keep the existing GRANTs and add an RLS policy on
-- launches that allows SELECT only via the view (anon/authenticated have no
-- direct SELECT grant on the launches table itself).
ALTER VIEW public.launches_public SET (security_invoker = true);

GRANT SELECT ON public.launches_public TO anon, authenticated;

DROP POLICY IF EXISTS "Public can read launches via view" ON public.launches;
CREATE POLICY "Public can read launches via view"
ON public.launches
FOR SELECT
TO anon, authenticated
USING (true);

-- Ensure no direct table SELECT grant leaks sensitive columns
REVOKE SELECT ON public.launches FROM anon, authenticated, PUBLIC;

-- 4. Revoke EXECUTE from anon/authenticated on internal worker/service-only
-- SECURITY DEFINER functions. Service role bypasses these grants.
REVOKE EXECUTE ON FUNCTION public.increment_pumpfun_fees_claimed(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_sponsor_funding_for_worker(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_pumpfun_wallet_starved(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_sponsor_recovery_for_worker(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_pumpfun_fee_treasury_sweep(uuid, text, text, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_launch_for_worker(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_pumpfun_launch_for_worker(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_executing_launch_for_worker(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_all_pumpfun_fee_throttles() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_pumpfun_creator_vault_balance(uuid[], bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_custodial_row_lock(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.try_acquire_custodial_lock(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_custodial_lock(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.try_acquire_custodial_row_lock(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_pumpfun_launches_batch_for_worker(text, integer, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_pumpfun_launches_batch_for_worker(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_pumpfun_fee_claim_attempt(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_sweep_recovery_launch_for_worker(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_pumpfun_fee_claim_failure(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_app_setting(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_pumpfun_empty_claim(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.force_pumpfun_fee_claim_retry(uuid) FROM PUBLIC, anon, authenticated;