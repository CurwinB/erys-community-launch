-- Add a dedicated launch status for "mint succeeded on-chain but the
-- custodial -> escrow token sweep failed". Distinguishing this from
-- execution_failed lets the recovery flow pick it up safely without the
-- refund logic ever firing (SOL is already in the bonding curve).
ALTER TYPE public.launch_status ADD VALUE IF NOT EXISTS 'sweep_recovery';
