-- Add Pump.fun support columns to launches
ALTER TABLE public.launches
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'bags',
  ADD COLUMN IF NOT EXISTS pumpfun_mint_keypair_encrypted text,
  ADD COLUMN IF NOT EXISTS pumpfun_fees_last_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS pumpfun_fees_claimed_total bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pumpfun_creator_fees_distributed bigint DEFAULT 0;

-- Add CHECK constraint for platform values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'launches_platform_check'
  ) THEN
    ALTER TABLE public.launches
      ADD CONSTRAINT launches_platform_check CHECK (platform IN ('bags', 'pumpfun'));
  END IF;
END $$;

-- Create token-metadata storage bucket (public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('token-metadata', 'token-metadata', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for token-metadata bucket
DROP POLICY IF EXISTS "Token metadata is publicly accessible" ON storage.objects;
CREATE POLICY "Token metadata is publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'token-metadata');

DROP POLICY IF EXISTS "Anyone can upload token metadata" ON storage.objects;
CREATE POLICY "Anyone can upload token metadata"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'token-metadata');