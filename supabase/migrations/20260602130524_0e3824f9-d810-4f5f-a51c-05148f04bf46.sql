-- 1. Add Launch Profile metadata columns (all nullable, additive only)
ALTER TABLE public.launches
  ADD COLUMN IF NOT EXISTS hook text,
  ADD COLUMN IF NOT EXISTS profile_description text,
  ADD COLUMN IF NOT EXISTS twitter_handle text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS meme_images text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS launch_checklist jsonb,
  ADD COLUMN IF NOT EXISTS launch_window text;

-- 2. Length / enum guards (NULL-friendly)
ALTER TABLE public.launches
  DROP CONSTRAINT IF EXISTS launches_hook_length,
  DROP CONSTRAINT IF EXISTS launches_profile_description_length,
  DROP CONSTRAINT IF EXISTS launches_category_check,
  DROP CONSTRAINT IF EXISTS launches_meme_images_count;

ALTER TABLE public.launches
  ADD CONSTRAINT launches_hook_length
    CHECK (hook IS NULL OR char_length(hook) <= 100),
  ADD CONSTRAINT launches_profile_description_length
    CHECK (profile_description IS NULL OR char_length(profile_description) <= 500),
  ADD CONSTRAINT launches_category_check
    CHECK (category IS NULL OR category IN ('meme','community','tech','other')),
  ADD CONSTRAINT launches_meme_images_count
    CHECK (array_length(meme_images, 1) IS NULL OR array_length(meme_images, 1) <= 3);

-- 3. Rebuild launches_public to expose the new profile columns.
--    Keep the same sensitive-column exclusions as before.
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
  fee_share_config_key,
  hook,
  profile_description,
  twitter_handle,
  category,
  meme_images,
  launch_checklist,
  launch_window
FROM public.launches;

GRANT SELECT ON public.launches_public TO anon, authenticated;

-- 4. Recreate get_launch_public (CASCADE dropped it with the view).
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