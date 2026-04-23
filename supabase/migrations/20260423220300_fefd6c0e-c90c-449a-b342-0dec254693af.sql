-- The previous fix revoked column access, but anon/authenticated still had table-level
-- SELECT on public.launches. In Postgres, table-level SELECT still permits reading all
-- columns, so we must remove the table-level grant entirely and then explicitly grant
-- only safe columns back to browser roles.

REVOKE SELECT ON public.launches FROM anon, authenticated, PUBLIC;

GRANT SELECT (
  id,
  sponsor_link_claimed_at,
  sponsored_amount_lamports,
  sponsored_tx_signature,
  sponsor_link_token,
  sponsor_link_expires_at,
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
  execution_error,
  execution_attempts,
  created_by_wallet,
  created_at,
  fee_share_config_key,
  claimer_count,
  excluded_contributors,
  total_tokens_distributed,
  distribution_completed,
  distribution_completed_at,
  platform,
  pumpfun_fees_last_claimed_at,
  pumpfun_fees_claimed_total,
  pumpfun_creator_fees_distributed,
  pumpfun_launch_signature,
  worker_locked_at,
  worker_id,
  is_sponsored,
  sponsored_by
)
ON public.launches TO anon, authenticated;