ALTER TABLE public.contributions
ADD COLUMN IF NOT EXISTS token_delivery_wallet text;