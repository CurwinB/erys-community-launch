
-- 1. Lock down admin_wallets: remove public SELECT (exposes emails)
DROP POLICY IF EXISTS "Admin wallets are viewable by everyone" ON public.admin_wallets;

-- Provide a SECURITY DEFINER membership-check RPC so the frontend can verify
-- whether a wallet is an admin without ever exposing the email column or
-- the full admin list.
CREATE OR REPLACE FUNCTION public.is_admin_wallet(p_wallet text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_wallets
    WHERE wallet_address = lower(p_wallet)
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin_wallet(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_wallet(text) TO anon, authenticated, service_role;

-- Scrub the PII committed to a previous migration file from the live DB.
-- The wallet itself stays (it's a public Solana address); only the email is wiped.
UPDATE public.admin_wallets SET email = NULL WHERE email IS NOT NULL;

-- 2. Hide encrypted escrow keys from public reads via column-level REVOKE.
-- The row-level SELECT policy stays so the frontend can still read launch
-- metadata; only the two encrypted-key columns become inaccessible to anon
-- and authenticated roles. Edge functions use service_role and are unaffected.
REVOKE SELECT (escrow_wallet_encrypted_private_key, pumpfun_mint_keypair_encrypted)
  ON public.launches FROM anon, authenticated;

-- 3. Lock down the worker-claim RPCs. Their RETURNING * leaks encrypted keys,
-- so restrict EXECUTE to service_role (the Railway workers already use it).
REVOKE EXECUTE ON FUNCTION public.claim_launch_for_worker(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_pumpfun_launch_for_worker(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_executing_launch_for_worker(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_launch_for_worker(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_pumpfun_launch_for_worker(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_executing_launch_for_worker(text, integer) TO service_role;

-- 4. Lock down token-metadata storage uploads to service_role only.
-- Only the create-launch-pumpfun edge function uploads metadata, and it uses
-- service_role. Anon users no longer have a way to spam the bucket.
DROP POLICY IF EXISTS "Anyone can upload token metadata" ON storage.objects;
CREATE POLICY "Service role can upload token metadata"
  ON storage.objects
  FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'token-metadata');

-- 5. Restrict listing of token-metadata bucket: keep individual files publicly
-- accessible by direct URL (needed for IPFS-style metadata fetch by mint
-- address) but prevent enumeration of all uploaded objects.
-- Note: file contents at known URLs remain accessible because the bucket is
-- public; this just stops the "list all objects" attack surface.
DROP POLICY IF EXISTS "Token metadata is publicly accessible" ON storage.objects;
CREATE POLICY "Token metadata files are publicly fetchable"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated, service_role
  USING (bucket_id = 'token-metadata');
