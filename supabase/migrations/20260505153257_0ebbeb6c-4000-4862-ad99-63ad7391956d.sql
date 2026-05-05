ALTER TABLE public.launches
  ADD COLUMN IF NOT EXISTS lightning_wallet_public_key text,
  ADD COLUMN IF NOT EXISTS lightning_wallet_encrypted_private_key text,
  ADD COLUMN IF NOT EXISTS lightning_wallet_encrypted_api_key text;