## What's broken

The previous security migration revoked the table-level `SELECT` GRANT on `public.launches` from `anon`/`authenticated` AND switched `launches_public` to `security_invoker=true`. The view now runs as the caller, so PostgREST checks the caller's grants on the underlying table — and since there are no grants, every query to `launches_public` returns `401 permission denied for table launches`. That's why the homepage shows "No launched tokens yet."

## Fix

Restore column-level `SELECT` grants on **only the safe columns** of `public.launches` to `anon` and `authenticated`. This is exactly the column allowlist the `launches_public` view exposes. Sensitive columns (encrypted escrow private key, processing fee signature, worker lock fields, sponsor link token, encrypted pumpfun mint keypair, etc.) remain ungranted and unreadable.

This keeps the security improvements from the last migration (no full-table SELECT, view runs as invoker) while restoring the public read path the website depends on.

## Migration

```sql
GRANT SELECT (
  id, token_name, token_symbol, description, image_url,
  twitter_url, telegram_url, website_url, token_mint_address,
  ipfs_metadata_url, escrow_wallet_public_key, launch_datetime,
  min_contribution_lamports, max_contribution_lamports, status,
  created_by_wallet, created_at, platform, pumpfun_launch_signature,
  distribution_completed, distribution_completed_at,
  total_tokens_distributed, is_sponsored, sponsored_amount_lamports,
  claimer_count, fee_share_config_key
) ON public.launches TO anon, authenticated;
```

No code changes needed — the frontend already queries `launches_public`.