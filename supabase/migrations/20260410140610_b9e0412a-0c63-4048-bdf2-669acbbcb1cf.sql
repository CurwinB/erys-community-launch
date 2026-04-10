
-- Add columns to launches table
ALTER TABLE public.launches
  ADD COLUMN fee_share_config_key text,
  ADD COLUMN claimer_count integer,
  ADD COLUMN excluded_contributors integer DEFAULT 0;

-- Add columns to contributions table
ALTER TABLE public.contributions
  ADD COLUMN is_fee_claimer boolean DEFAULT true,
  ADD COLUMN basis_points integer;

-- Create platform_fee_claims table
CREATE TABLE public.platform_fee_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_lamports bigint NOT NULL,
  tx_signature text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on platform_fee_claims (no public access - internal accounting only)
ALTER TABLE public.platform_fee_claims ENABLE ROW LEVEL SECURITY;

-- Allow service_role to update launches (for edge functions to set status, config key, etc.)
CREATE POLICY "Service role can update launches"
  ON public.launches
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow service_role to update contributions (for edge functions to set basis_points, is_fee_claimer)
CREATE POLICY "Service role can update contributions"
  ON public.contributions
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow service_role full access to platform_fee_claims
CREATE POLICY "Service role can manage platform fee claims"
  ON public.platform_fee_claims
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
