-- Revoke column-level SELECT on encrypted private key fields from public roles.
-- The frontend uses an explicit column allowlist (LAUNCH_PUBLIC_COLUMNS) that
-- already excludes these fields, so no client code change is required.
-- Edge functions and the executor use the service_role key, which bypasses
-- both RLS and column grants, so their access is unaffected.

REVOKE SELECT (escrow_wallet_encrypted_private_key, pumpfun_mint_keypair_encrypted)
  ON public.launches
  FROM anon, authenticated;

-- Defense in depth: also revoke from PUBLIC in case future roles inherit it.
REVOKE SELECT (escrow_wallet_encrypted_private_key, pumpfun_mint_keypair_encrypted)
  ON public.launches
  FROM PUBLIC;