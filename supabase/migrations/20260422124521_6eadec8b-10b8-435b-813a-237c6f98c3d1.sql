-- =========================================================
-- 1) LAUNCHES: revoke SELECT on sensitive columns from anon/authenticated
-- =========================================================
-- The frontend already uses LAUNCH_PUBLIC_COLUMNS (see src/lib/constants.ts),
-- which excludes the columns below. Edge functions use the service role and
-- are unaffected by column-level GRANTs.

REVOKE SELECT (
  escrow_wallet_encrypted_private_key,
  pumpfun_mint_keypair_encrypted,
  sponsor_link_token,
  execution_error,
  worker_id,
  worker_locked_at
) ON public.launches FROM anon, authenticated;

-- =========================================================
-- 2) CONTRIBUTIONS: drop the permissive authenticated INSERT policy.
-- All contribution inserts go through the `contribute` edge function which
-- runs with the service role and verifies the on-chain SOL transfer first.
-- =========================================================
DROP POLICY IF EXISTS "Authenticated users can create contributions" ON public.contributions;

CREATE POLICY "Service role can insert contributions"
ON public.contributions
FOR INSERT
TO service_role
WITH CHECK (true);

-- =========================================================
-- 3) STORAGE: token-images upload policy must enforce a safe path pattern.
-- We require the object name to be a v4 UUID followed by an extension at the
-- bucket root (no slashes / no traversal). Combined with the existing app
-- behavior of using crypto.randomUUID() for filenames, this prevents an
-- attacker from overwriting another launch's image by guessing or reusing
-- a known path.
-- =========================================================
DROP POLICY IF EXISTS "Authenticated users can upload token images" ON storage.objects;

CREATE POLICY "Anyone can upload token images with random UUID filename"
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'token-images'
  AND name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[a-zA-Z0-9]{1,8}$'
);
