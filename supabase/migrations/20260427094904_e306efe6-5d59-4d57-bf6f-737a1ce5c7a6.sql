ALTER TABLE public.launches
  ADD COLUMN IF NOT EXISTS processing_fee_lamports bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_fee_tx_signature text;