
-- Create launch status enum
CREATE TYPE public.launch_status AS ENUM (
  'scheduled', 'executing', 'launched', 'execution_failed', 'cancelled'
);

-- Create launches table
CREATE TABLE public.launches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_name TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  twitter_url TEXT,
  telegram_url TEXT,
  website_url TEXT,
  token_mint_address TEXT,
  ipfs_metadata_url TEXT,
  escrow_wallet_public_key TEXT NOT NULL,
  escrow_wallet_encrypted_private_key TEXT NOT NULL,
  launch_datetime TIMESTAMPTZ NOT NULL,
  min_contribution_lamports BIGINT NOT NULL,
  max_contribution_lamports BIGINT,
  status public.launch_status NOT NULL DEFAULT 'scheduled',
  execution_error TEXT,
  execution_attempts INTEGER NOT NULL DEFAULT 0,
  created_by_wallet TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on launches
ALTER TABLE public.launches ENABLE ROW LEVEL SECURITY;

-- Anyone can view launches
CREATE POLICY "Launches are viewable by everyone"
  ON public.launches FOR SELECT
  USING (true);

-- Authenticated users can create launches
CREATE POLICY "Authenticated users can create launches"
  ON public.launches FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Create contributions table
CREATE TABLE public.contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id UUID REFERENCES public.launches(id) ON DELETE CASCADE NOT NULL,
  wallet_address TEXT NOT NULL,
  amount_lamports BIGINT NOT NULL,
  tx_signature TEXT NOT NULL,
  contributed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on contributions
ALTER TABLE public.contributions ENABLE ROW LEVEL SECURITY;

-- Anyone can view contributions
CREATE POLICY "Contributions are viewable by everyone"
  ON public.contributions FOR SELECT
  USING (true);

-- Authenticated users can create contributions
CREATE POLICY "Authenticated users can create contributions"
  ON public.contributions FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Create indexes
CREATE INDEX idx_contributions_launch_id ON public.contributions(launch_id);
CREATE INDEX idx_contributions_wallet ON public.contributions(wallet_address);
CREATE INDEX idx_launches_status ON public.launches(status);
CREATE INDEX idx_launches_created_by ON public.launches(created_by_wallet);
CREATE INDEX idx_launches_datetime ON public.launches(launch_datetime);

-- Create storage bucket for token images
INSERT INTO storage.buckets (id, name, public) VALUES ('token-images', 'token-images', true);

-- Storage policies
CREATE POLICY "Token images are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'token-images');

CREATE POLICY "Authenticated users can upload token images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'token-images');
