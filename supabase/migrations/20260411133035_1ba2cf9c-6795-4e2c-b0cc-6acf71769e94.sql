
-- Add token distribution tracking columns to contributions
ALTER TABLE public.contributions
  ADD COLUMN IF NOT EXISTS token_amount bigint,
  ADD COLUMN IF NOT EXISTS tokens_distributed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS distribution_tx_signature text,
  ADD COLUMN IF NOT EXISTS distribution_error text,
  ADD COLUMN IF NOT EXISTS refund_tx_signature text;

-- Add distribution tracking columns to launches
ALTER TABLE public.launches
  ADD COLUMN IF NOT EXISTS total_tokens_distributed bigint,
  ADD COLUMN IF NOT EXISTS distribution_completed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS distribution_completed_at timestamptz;
