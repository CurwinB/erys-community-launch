
-- ===================================================================
-- Erys Co-Dev Fee Sharing
-- ===================================================================

-- 1. launches columns -----------------------------------------------
ALTER TABLE public.launches
  ADD COLUMN IF NOT EXISTS codev_sharing_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS codev_mode text NOT NULL DEFAULT 'proportional',
  ADD COLUMN IF NOT EXISTS codev_roster_locked_at timestamptz;

ALTER TABLE public.launches
  DROP CONSTRAINT IF EXISTS launches_codev_mode_chk;
ALTER TABLE public.launches
  ADD CONSTRAINT launches_codev_mode_chk
  CHECK (codev_mode IN ('proportional','fcfs'));

-- 2. launch_codevs table --------------------------------------------
CREATE TABLE IF NOT EXISTS public.launch_codevs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  wallet_address text NOT NULL,
  contribution_lamports bigint NOT NULL DEFAULT 0,
  pending_lamports bigint NOT NULL DEFAULT 0,
  paid_lamports bigint NOT NULL DEFAULT 0,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (launch_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS launch_codevs_launch_idx ON public.launch_codevs(launch_id);
CREATE INDEX IF NOT EXISTS launch_codevs_wallet_idx ON public.launch_codevs(wallet_address);

GRANT SELECT ON public.launch_codevs TO anon, authenticated;
GRANT ALL ON public.launch_codevs TO service_role;

ALTER TABLE public.launch_codevs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "launch_codevs_public_select" ON public.launch_codevs;
CREATE POLICY "launch_codevs_public_select" ON public.launch_codevs
  FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public._launch_codevs_enforce_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM public.launch_codevs WHERE launch_id = NEW.launch_id;
  IF v_count >= 100 THEN RAISE EXCEPTION 'codev roster full (100) for launch %', NEW.launch_id; END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS launch_codevs_cap_trg ON public.launch_codevs;
CREATE TRIGGER launch_codevs_cap_trg BEFORE INSERT ON public.launch_codevs
FOR EACH ROW EXECUTE FUNCTION public._launch_codevs_enforce_cap();

CREATE OR REPLACE FUNCTION public._launch_codevs_autolock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM public.launch_codevs WHERE launch_id = NEW.launch_id;
  IF v_count >= 100 THEN
    UPDATE public.launches SET codev_roster_locked_at = COALESCE(codev_roster_locked_at, now()) WHERE id = NEW.launch_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS launch_codevs_autolock_trg ON public.launch_codevs;
CREATE TRIGGER launch_codevs_autolock_trg AFTER INSERT ON public.launch_codevs
FOR EACH ROW EXECUTE FUNCTION public._launch_codevs_autolock();

-- 3. codev_payouts ledger -------------------------------------------
CREATE TABLE IF NOT EXISTS public.codev_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  wallet_address text NOT NULL,
  cycle_id uuid,
  amount_lamports bigint NOT NULL,
  tx_signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (launch_id, wallet_address, tx_signature)
);

CREATE INDEX IF NOT EXISTS codev_payouts_wallet_idx ON public.codev_payouts(wallet_address);
CREATE INDEX IF NOT EXISTS codev_payouts_launch_idx ON public.codev_payouts(launch_id);

GRANT SELECT ON public.codev_payouts TO authenticated;
GRANT ALL ON public.codev_payouts TO service_role;

ALTER TABLE public.codev_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "codev_payouts_public_select" ON public.codev_payouts;
CREATE POLICY "codev_payouts_public_select" ON public.codev_payouts
  FOR SELECT TO authenticated USING (true);

-- 4. Extended fee-split RPC -----------------------------------------
DROP FUNCTION IF EXISTS public.get_launch_fee_split(uuid);
CREATE OR REPLACE FUNCTION public.get_launch_fee_split(p_launch_id uuid)
RETURNS TABLE(
  launch_id uuid,
  creator_wallet text,
  creator_bps int,
  treasury_bps int,
  affiliate_id uuid,
  affiliate_wallet text,
  affiliate_bps int,
  codev_bps int,
  codev_allocations jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    l.id,
    l.created_by_wallet,
    CASE WHEN l.codev_sharing_enabled THEN 5000 ELSE 7000 END::int,
    CASE
      WHEN l.codev_sharing_enabled AND l.referred_by_affiliate_id IS NOT NULL THEN 1500
      WHEN l.codev_sharing_enabled AND l.referred_by_affiliate_id IS NULL     THEN 3000
      WHEN l.referred_by_affiliate_id IS NULL THEN 3000
      ELSE 1500
    END::int,
    l.referred_by_affiliate_id,
    a.wallet_address,
    CASE WHEN l.referred_by_affiliate_id IS NULL THEN 0 ELSE 1500 END::int,
    CASE WHEN l.codev_sharing_enabled THEN 2000 ELSE 0 END::int,
    CASE
      WHEN l.codev_sharing_enabled THEN COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
                  'wallet_address', lc.wallet_address,
                  'weight', lc.contribution_lamports,
                  'pending_lamports', lc.pending_lamports
                ))
           FROM public.launch_codevs lc
          WHERE lc.launch_id = l.id
            AND lc.contribution_lamports > 0),
        '[]'::jsonb)
      ELSE '[]'::jsonb
    END
  FROM public.launches l
  LEFT JOIN public.affiliates a ON a.id = l.referred_by_affiliate_id
  WHERE l.id = p_launch_id;
$$;

-- 5. RPCs -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enable_codev_sharing(p_launch_id uuid, p_wallet text, p_mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_launch public.launches%ROWTYPE;
BEGIN
  IF p_mode NOT IN ('proportional','fcfs') THEN RAISE EXCEPTION 'invalid mode: %', p_mode; END IF;
  SELECT * INTO v_launch FROM public.launches WHERE id = p_launch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'launch not found'; END IF;
  IF v_launch.created_by_wallet <> p_wallet THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF COALESCE(v_launch.fee_harvest_total_lamports, 0) > 0 THEN
    RAISE EXCEPTION 'cannot change codev sharing after fees have been harvested';
  END IF;
  UPDATE public.launches SET codev_sharing_enabled = true, codev_mode = p_mode WHERE id = p_launch_id;
END; $$;

CREATE OR REPLACE FUNCTION public.upsert_launch_codev(
  p_launch_id uuid, p_wallet_address text, p_contribution_lamports bigint
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_launch public.launches%ROWTYPE;
  v_existing public.launch_codevs%ROWTYPE;
  v_seat_count int;
BEGIN
  IF p_contribution_lamports <= 0 THEN RETURN; END IF;
  SELECT * INTO v_launch FROM public.launches WHERE id = p_launch_id;
  IF NOT FOUND OR NOT v_launch.codev_sharing_enabled THEN RETURN; END IF;
  IF v_launch.codev_roster_locked_at IS NOT NULL THEN RETURN; END IF;

  SELECT * INTO v_existing FROM public.launch_codevs
    WHERE launch_id = p_launch_id AND wallet_address = p_wallet_address;
  IF FOUND THEN
    UPDATE public.launch_codevs
      SET contribution_lamports = contribution_lamports + p_contribution_lamports
      WHERE id = v_existing.id;
    RETURN;
  END IF;

  SELECT count(*) INTO v_seat_count FROM public.launch_codevs WHERE launch_id = p_launch_id;
  IF v_seat_count >= 100 THEN RETURN; END IF;
  INSERT INTO public.launch_codevs (launch_id, wallet_address, contribution_lamports)
    VALUES (p_launch_id, p_wallet_address, p_contribution_lamports);
END; $$;

CREATE OR REPLACE FUNCTION public.lock_codev_roster(p_launch_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.launches
    SET codev_roster_locked_at = COALESCE(codev_roster_locked_at, now())
    WHERE id = p_launch_id;
$$;

CREATE OR REPLACE FUNCTION public.record_codev_batch(
  p_launch_id uuid, p_cycle_id uuid, p_tx_signature text, p_payouts jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF p_payouts IS NULL OR jsonb_array_length(p_payouts) = 0 THEN RETURN; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_payouts) LOOP
    INSERT INTO public.codev_payouts (launch_id, wallet_address, cycle_id, amount_lamports, tx_signature)
    VALUES (p_launch_id, r->>'wallet_address', p_cycle_id, (r->>'amount_lamports')::bigint, p_tx_signature)
    ON CONFLICT (launch_id, wallet_address, tx_signature) DO NOTHING;

    UPDATE public.launch_codevs
      SET pending_lamports = GREATEST(0, pending_lamports - (r->>'amount_lamports')::bigint),
          paid_lamports = paid_lamports + (r->>'amount_lamports')::bigint
      WHERE launch_id = p_launch_id AND wallet_address = r->>'wallet_address';
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.accrue_codev_pending(p_launch_id uuid, p_deltas jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF p_deltas IS NULL OR jsonb_array_length(p_deltas) = 0 THEN RETURN; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_deltas) LOOP
    UPDATE public.launch_codevs
      SET pending_lamports = pending_lamports + (r->>'amount_lamports')::bigint
      WHERE launch_id = p_launch_id AND wallet_address = r->>'wallet_address';
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.codev_dashboard(p_wallet text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'ok', true,
    'wallet', p_wallet,
    'seats', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'launch_id', lc.launch_id,
        'token_name', l.token_name,
        'token_symbol', l.token_symbol,
        'token_mint_address', l.token_mint_address,
        'contribution_lamports', lc.contribution_lamports,
        'pending_lamports', lc.pending_lamports,
        'paid_lamports', lc.paid_lamports,
        'joined_at', lc.joined_at,
        'codev_mode', l.codev_mode,
        'roster_locked_at', l.codev_roster_locked_at
      ) ORDER BY lc.joined_at DESC)
      FROM public.launch_codevs lc
      JOIN public.launches l ON l.id = lc.launch_id
      WHERE lc.wallet_address = p_wallet
    ), '[]'::jsonb),
    'recent_payouts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'launch_id', p.launch_id,
        'token_symbol', l.token_symbol,
        'amount_lamports', p.amount_lamports,
        'tx_signature', p.tx_signature,
        'created_at', p.created_at
      ) ORDER BY p.created_at DESC)
      FROM (SELECT * FROM public.codev_payouts WHERE wallet_address = p_wallet ORDER BY created_at DESC LIMIT 50) p
      JOIN public.launches l ON l.id = p.launch_id
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_list_launch_codevs(p_admin_wallet text, p_launch_id uuid)
RETURNS TABLE(wallet_address text, contribution_lamports bigint, pending_lamports bigint, paid_lamports bigint, joined_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin_wallet(p_admin_wallet) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY SELECT lc.wallet_address, lc.contribution_lamports, lc.pending_lamports, lc.paid_lamports, lc.joined_at
    FROM public.launch_codevs lc WHERE lc.launch_id = p_launch_id
    ORDER BY lc.contribution_lamports DESC;
END; $$;

-- Public: fetch codev metadata for a single launch (frontend uses this
-- alongside launches_public which does not expose these columns).
CREATE OR REPLACE FUNCTION public.get_launch_codev_info(p_launch_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'enabled', l.codev_sharing_enabled,
    'mode', l.codev_mode,
    'roster_locked_at', l.codev_roster_locked_at,
    'seat_count', COALESCE((SELECT count(*) FROM public.launch_codevs WHERE launch_id = l.id), 0),
    'seat_cap', 100,
    'top_seats', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'wallet_address', lc.wallet_address,
        'contribution_lamports', lc.contribution_lamports,
        'pending_lamports', lc.pending_lamports,
        'paid_lamports', lc.paid_lamports
      ) ORDER BY (lc.contribution_lamports) DESC)
      FROM (
        SELECT * FROM public.launch_codevs
        WHERE launch_id = l.id
        ORDER BY contribution_lamports DESC
        LIMIT 20
      ) lc
    ), '[]'::jsonb)
  )
  FROM public.launches l
  WHERE l.id = p_launch_id;
$$;
