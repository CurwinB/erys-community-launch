-- 1. Add new launch status for async sponsor funding
ALTER TYPE public.launch_status ADD VALUE IF NOT EXISTS 'sponsor_pending_funding';

-- 2. Tracking columns for sponsor funding retries
ALTER TABLE public.launches
  ADD COLUMN IF NOT EXISTS sponsor_funding_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sponsor_funding_error text;

-- 3. Recreate launches_public WITHOUT security_invoker so anon/authenticated
--    can read the sanitized columns even though the base table has deny-all RLS.
--    Sensitive columns (escrow_wallet_encrypted_private_key, pumpfun_mint_keypair_encrypted,
--    sponsor_link_token, worker_id, sponsor_funding_error, etc.) are intentionally
--    excluded from this view.
DROP VIEW IF EXISTS public.launches_public CASCADE;
CREATE VIEW public.launches_public AS
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
  platform,
  pumpfun_launch_signature,
  distribution_completed,
  distribution_completed_at,
  total_tokens_distributed,
  is_sponsored,
  sponsored_amount_lamports,
  claimer_count,
  fee_share_config_key
FROM public.launches;

GRANT SELECT ON public.launches_public TO anon, authenticated;

-- 4. Recreate contributions_public WITHOUT security_invoker.
DROP VIEW IF EXISTS public.contributions_public CASCADE;
CREATE VIEW public.contributions_public AS
SELECT
  id,
  launch_id,
  wallet_address,
  amount_lamports,
  contributed_at
FROM public.contributions
WHERE refund_tx_signature IS NULL;

GRANT SELECT ON public.contributions_public TO anon, authenticated;

-- 5. Recreate get_launch_public (CASCADE dropped it).
CREATE OR REPLACE FUNCTION public.get_launch_public(p_id uuid)
RETURNS public.launches_public
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT * FROM public.launches_public WHERE id = p_id LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_launch_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_launch_public(uuid) TO anon, authenticated, service_role;

-- 6. Worker claim RPC: Railway executor uses this to lock and fund one
--    pending sponsored escrow at a time.
CREATE OR REPLACE FUNCTION public.claim_sponsor_funding_for_worker(
  p_worker_id text,
  p_lock_expiry_seconds integer DEFAULT 120
)
RETURNS SETOF public.launches
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.launches
  SET worker_locked_at = now(),
      worker_id        = p_worker_id
  WHERE id = (
    SELECT id FROM public.launches
    WHERE status::text = 'sponsor_pending_funding'
      AND (
        worker_locked_at IS NULL
        OR worker_locked_at < now() - make_interval(secs => p_lock_expiry_seconds)
      )
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.claim_sponsor_funding_for_worker(text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_sponsor_funding_for_worker(text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sponsor_funding_for_worker(text, integer) TO service_role;