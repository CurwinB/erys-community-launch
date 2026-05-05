
-- ============================================================
-- Per-launch fee harvest + claimable distribution
-- ============================================================

ALTER TABLE public.launches
  ADD COLUMN IF NOT EXISTS fee_harvest_state text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS fee_harvest_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS fee_harvest_worker_id text,
  ADD COLUMN IF NOT EXISTS fee_harvest_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS fee_harvest_last_error text,
  ADD COLUMN IF NOT EXISTS fee_harvest_last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS fee_harvest_total_lamports bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_treasury_total_lamports bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_contributor_total_lamports bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_harvest_consecutive_empty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_harvest_throttle_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_launches_fee_harvest_eligible
  ON public.launches (fee_harvest_state, fee_harvest_last_success_at)
  WHERE lightning_wallet_public_key IS NOT NULL AND status = 'launched';

-- Cycles
CREATE TABLE IF NOT EXISTS public.fee_harvest_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL,
  gross_lamports bigint NOT NULL,
  treasury_lamports bigint NOT NULL,
  contributor_lamports bigint NOT NULL,
  claim_tx_signature text,
  treasury_tx_signature text,
  vault_balance_before bigint,
  escrow_balance_before bigint,
  escrow_balance_after bigint,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fee_harvest_cycles_launch ON public.fee_harvest_cycles(launch_id, created_at DESC);

ALTER TABLE public.fee_harvest_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages fee_harvest_cycles"
  ON public.fee_harvest_cycles FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Anon/auth can read fee_harvest_cycles"
  ON public.fee_harvest_cycles FOR SELECT TO anon, authenticated USING (true);

-- Allocations
CREATE TABLE IF NOT EXISTS public.fee_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL,
  cycle_id uuid NOT NULL REFERENCES public.fee_harvest_cycles(id) ON DELETE CASCADE,
  contribution_id uuid NOT NULL,
  wallet_address text NOT NULL,
  basis_points integer NOT NULL,
  lamports bigint NOT NULL,
  claim_state text NOT NULL DEFAULT 'unclaimed',
  claim_tx_signature text,
  claim_error text,
  claimed_at timestamptz,
  claim_locked_at timestamptz,
  claim_worker_id text,
  delivery_wallet text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, contribution_id)
);

CREATE INDEX IF NOT EXISTS idx_fee_allocations_wallet
  ON public.fee_allocations (lower(wallet_address), claim_state);
CREATE INDEX IF NOT EXISTS idx_fee_allocations_launch
  ON public.fee_allocations (launch_id, claim_state);

ALTER TABLE public.fee_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages fee_allocations"
  ON public.fee_allocations FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Anon/auth can read fee_allocations"
  ON public.fee_allocations FOR SELECT TO anon, authenticated USING (true);

-- ============================================================
-- Functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_launch_for_harvest(
  p_worker_id text,
  p_lock_ttl_seconds integer DEFAULT 300,
  p_min_interval_seconds integer DEFAULT 600
)
RETURNS SETOF public.launches
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.launches
  SET fee_harvest_state = 'harvesting',
      fee_harvest_locked_at = now(),
      fee_harvest_worker_id = p_worker_id
  WHERE id = (
    SELECT id FROM public.launches
    WHERE status = 'launched'
      AND lightning_wallet_public_key IS NOT NULL
      AND lightning_wallet_encrypted_private_key IS NOT NULL
      AND (
        fee_harvest_state = 'idle'
        OR (fee_harvest_state = 'harvest_failed')
        OR (fee_harvest_state = 'harvesting'
            AND fee_harvest_locked_at < now() - make_interval(secs => p_lock_ttl_seconds))
      )
      AND (
        fee_harvest_last_success_at IS NULL
        OR fee_harvest_last_success_at <= now() - make_interval(secs => p_min_interval_seconds)
      )
      AND (
        fee_harvest_throttle_until IS NULL
        OR fee_harvest_throttle_until <= now()
      )
    ORDER BY COALESCE(fee_harvest_last_success_at, to_timestamp(0)) ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION public.release_harvest_lock(p_launch_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.launches
  SET fee_harvest_state = CASE WHEN fee_harvest_state = 'harvesting' THEN 'idle' ELSE fee_harvest_state END,
      fee_harvest_locked_at = NULL,
      fee_harvest_worker_id = NULL
  WHERE id = p_launch_id;
$$;

CREATE OR REPLACE FUNCTION public.record_harvest_empty(p_launch_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.launches
  SET fee_harvest_state = 'idle',
      fee_harvest_locked_at = NULL,
      fee_harvest_worker_id = NULL,
      fee_harvest_last_attempt_at = now(),
      fee_harvest_last_error = NULL,
      fee_harvest_consecutive_empty = COALESCE(fee_harvest_consecutive_empty, 0) + 1,
      fee_harvest_last_success_at = now()
  WHERE id = p_launch_id
  RETURNING fee_harvest_consecutive_empty INTO v_count;

  IF v_count >= 3 THEN
    UPDATE public.launches
    SET fee_harvest_throttle_until = now() + interval '1 hour'
    WHERE id = p_launch_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_harvest_failure(p_launch_id uuid, p_error text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.launches
  SET fee_harvest_state = 'harvest_failed',
      fee_harvest_locked_at = NULL,
      fee_harvest_worker_id = NULL,
      fee_harvest_last_attempt_at = now(),
      fee_harvest_last_error = LEFT(COALESCE(p_error, 'unknown'), 500)
  WHERE id = p_launch_id;
$$;

-- Records a successful harvest cycle: inserts cycle + allocations, bumps totals,
-- resets state to idle. allocations is a jsonb array of
-- { contribution_id, wallet_address, basis_points, lamports }.
CREATE OR REPLACE FUNCTION public.record_harvest_cycle(
  p_launch_id uuid,
  p_gross_lamports bigint,
  p_treasury_lamports bigint,
  p_contributor_lamports bigint,
  p_claim_tx_signature text,
  p_treasury_tx_signature text,
  p_vault_balance_before bigint,
  p_escrow_balance_before bigint,
  p_escrow_balance_after bigint,
  p_allocations jsonb,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cycle_id uuid;
BEGIN
  INSERT INTO public.fee_harvest_cycles (
    launch_id, gross_lamports, treasury_lamports, contributor_lamports,
    claim_tx_signature, treasury_tx_signature,
    vault_balance_before, escrow_balance_before, escrow_balance_after, notes
  )
  VALUES (
    p_launch_id, p_gross_lamports, p_treasury_lamports, p_contributor_lamports,
    p_claim_tx_signature, p_treasury_tx_signature,
    p_vault_balance_before, p_escrow_balance_before, p_escrow_balance_after, p_notes
  )
  RETURNING id INTO v_cycle_id;

  IF p_allocations IS NOT NULL AND jsonb_array_length(p_allocations) > 0 THEN
    INSERT INTO public.fee_allocations (
      launch_id, cycle_id, contribution_id, wallet_address, basis_points, lamports
    )
    SELECT
      p_launch_id,
      v_cycle_id,
      (a->>'contribution_id')::uuid,
      a->>'wallet_address',
      COALESCE((a->>'basis_points')::int, 0),
      (a->>'lamports')::bigint
    FROM jsonb_array_elements(p_allocations) a
    WHERE (a->>'lamports')::bigint > 0;
  END IF;

  UPDATE public.launches
  SET fee_harvest_state = 'idle',
      fee_harvest_locked_at = NULL,
      fee_harvest_worker_id = NULL,
      fee_harvest_last_attempt_at = now(),
      fee_harvest_last_success_at = now(),
      fee_harvest_last_error = NULL,
      fee_harvest_consecutive_empty = 0,
      fee_harvest_throttle_until = NULL,
      fee_harvest_total_lamports = COALESCE(fee_harvest_total_lamports,0) + p_gross_lamports,
      fee_treasury_total_lamports = COALESCE(fee_treasury_total_lamports,0) + p_treasury_lamports,
      fee_contributor_total_lamports = COALESCE(fee_contributor_total_lamports,0) + p_contributor_lamports
  WHERE id = p_launch_id;

  RETURN v_cycle_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.force_fee_harvest_retry(p_launch_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.launches
  SET fee_harvest_state = 'idle',
      fee_harvest_last_success_at = NULL,
      fee_harvest_throttle_until = NULL,
      fee_harvest_consecutive_empty = 0,
      fee_harvest_last_error = NULL,
      fee_harvest_locked_at = NULL,
      fee_harvest_worker_id = NULL
  WHERE id = p_launch_id;
$$;

-- ============================================================
-- User claim helpers
-- ============================================================

-- Atomically flips an allocation unclaimed -> claiming if requester wallet matches.
-- Returns the row (with launch lightning credentials) so the edge function can sign.
CREATE OR REPLACE FUNCTION public.claim_allocation_for_user(
  p_allocation_id uuid,
  p_wallet text,
  p_worker_id text,
  p_delivery_wallet text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  launch_id uuid,
  wallet_address text,
  lamports bigint,
  delivery_wallet text,
  lightning_wallet_public_key text,
  lightning_wallet_encrypted_private_key text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH upd AS (
    UPDATE public.fee_allocations fa
    SET claim_state = 'claiming',
        claim_locked_at = now(),
        claim_worker_id = p_worker_id,
        delivery_wallet = COALESCE(p_delivery_wallet, fa.delivery_wallet, fa.wallet_address)
    WHERE fa.id = p_allocation_id
      AND lower(fa.wallet_address) = lower(p_wallet)
      AND fa.claim_state = 'unclaimed'
    RETURNING fa.*
  )
  SELECT u.id, u.launch_id, u.wallet_address, u.lamports, u.delivery_wallet,
         l.lightning_wallet_public_key, l.lightning_wallet_encrypted_private_key
  FROM upd u
  JOIN public.launches l ON l.id = u.launch_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_allocation_claim(
  p_allocation_id uuid,
  p_tx_signature text
)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.fee_allocations
  SET claim_state = 'claimed',
      claim_tx_signature = p_tx_signature,
      claimed_at = now(),
      claim_locked_at = NULL,
      claim_worker_id = NULL,
      claim_error = NULL
  WHERE id = p_allocation_id;
$$;

CREATE OR REPLACE FUNCTION public.fail_allocation_claim(
  p_allocation_id uuid,
  p_error text
)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.fee_allocations
  SET claim_state = 'unclaimed',
      claim_locked_at = NULL,
      claim_worker_id = NULL,
      claim_error = LEFT(COALESCE(p_error, 'unknown'), 500)
  WHERE id = p_allocation_id;
$$;

-- Wallet-scoped claimable summary
CREATE OR REPLACE FUNCTION public.list_claimable_fees(p_wallet text)
RETURNS TABLE (
  id uuid,
  launch_id uuid,
  cycle_id uuid,
  wallet_address text,
  basis_points integer,
  lamports bigint,
  claim_state text,
  claim_tx_signature text,
  claimed_at timestamptz,
  created_at timestamptz,
  token_name text,
  token_symbol text,
  token_mint_address text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT fa.id, fa.launch_id, fa.cycle_id, fa.wallet_address,
         fa.basis_points, fa.lamports, fa.claim_state,
         fa.claim_tx_signature, fa.claimed_at, fa.created_at,
         l.token_name, l.token_symbol, l.token_mint_address
  FROM public.fee_allocations fa
  JOIN public.launches l ON l.id = fa.launch_id
  WHERE lower(fa.wallet_address) = lower(p_wallet)
  ORDER BY fa.created_at DESC
  LIMIT 1000;
$$;

-- Admin listing
CREATE OR REPLACE FUNCTION public.admin_list_fee_harvest(p_admin_wallet text)
RETURNS TABLE (
  launch_id uuid,
  token_name text,
  token_symbol text,
  lightning_wallet_public_key text,
  fee_harvest_state text,
  fee_harvest_last_attempt_at timestamptz,
  fee_harvest_last_success_at timestamptz,
  fee_harvest_last_error text,
  fee_harvest_total_lamports bigint,
  fee_treasury_total_lamports bigint,
  fee_contributor_total_lamports bigint,
  fee_harvest_throttle_until timestamptz,
  unclaimed_lamports bigint,
  cycle_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_wallet(p_admin_wallet) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN QUERY
  SELECT
    l.id, l.token_name, l.token_symbol, l.lightning_wallet_public_key,
    l.fee_harvest_state, l.fee_harvest_last_attempt_at, l.fee_harvest_last_success_at,
    l.fee_harvest_last_error,
    l.fee_harvest_total_lamports, l.fee_treasury_total_lamports, l.fee_contributor_total_lamports,
    l.fee_harvest_throttle_until,
    COALESCE((SELECT SUM(fa.lamports) FROM public.fee_allocations fa
              WHERE fa.launch_id = l.id AND fa.claim_state = 'unclaimed'), 0)::bigint AS unclaimed_lamports,
    (SELECT COUNT(*) FROM public.fee_harvest_cycles fc WHERE fc.launch_id = l.id) AS cycle_count
  FROM public.launches l
  WHERE l.lightning_wallet_public_key IS NOT NULL
  ORDER BY l.created_at DESC
  LIMIT 1000;
END;
$$;
