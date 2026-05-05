
-- 1. Make the view run with caller's permissions (fixes Security Definer View linter error)
ALTER VIEW public.launches_public SET (security_invoker = true);

-- 2. Replace deny-all SELECT with permissive SELECT, relying on column-level grants below
DROP POLICY IF EXISTS "No direct browser access to launches" ON public.launches;

CREATE POLICY "Anon/auth can read launches (column-restricted)"
  ON public.launches
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- 3. Revoke broad column access, then grant only the safe public columns
REVOKE SELECT ON public.launches FROM anon, authenticated;

GRANT SELECT (
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
) ON public.launches TO anon, authenticated;
