
-- =========================================================================
-- AFFILIATE PROGRAM
-- =========================================================================

-- 1) affiliates --------------------------------------------------------------
CREATE TABLE public.affiliates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL UNIQUE,
  referral_code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_by_admin_wallet text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_affiliates_code ON public.affiliates (referral_code);

GRANT ALL ON public.affiliates TO service_role;
ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;
-- No public policies: all reads/writes go through SECURITY DEFINER RPCs below.

-- 2) affiliate_referrals -----------------------------------------------------
CREATE TABLE public.affiliate_referrals (
  wallet_address text PRIMARY KEY,
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE RESTRICT,
  referral_code text NOT NULL,
  attributed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_affiliate_referrals_affiliate ON public.affiliate_referrals (affiliate_id);

GRANT ALL ON public.affiliate_referrals TO service_role;
ALTER TABLE public.affiliate_referrals ENABLE ROW LEVEL SECURITY;

-- 3) affiliate_earnings ------------------------------------------------------
CREATE TABLE public.affiliate_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE RESTRICT,
  launch_id uuid NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  wallet_address text NOT NULL, -- snapshot of affiliate payout wallet
  amount_lamports bigint NOT NULL CHECK (amount_lamports >= 0),
  tx_signature text,
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','pending','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (launch_id, tx_signature)
);
CREATE INDEX idx_affiliate_earnings_affiliate ON public.affiliate_earnings (affiliate_id);
CREATE INDEX idx_affiliate_earnings_launch ON public.affiliate_earnings (launch_id);

GRANT ALL ON public.affiliate_earnings TO service_role;
ALTER TABLE public.affiliate_earnings ENABLE ROW LEVEL SECURITY;

-- 4) launches.referred_by_affiliate_id ---------------------------------------
ALTER TABLE public.launches
  ADD COLUMN referred_by_affiliate_id uuid
    REFERENCES public.affiliates(id) ON DELETE SET NULL;
CREATE INDEX idx_launches_referred_by_affiliate ON public.launches (referred_by_affiliate_id);

-- =========================================================================
-- HELPERS
-- =========================================================================

-- Generate a fresh 8-char base32 (Crockford-ish, no easily confused chars).
CREATE OR REPLACE FUNCTION public._gen_affiliate_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  attempt int := 0;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..8 LOOP
      code := code || substr(alphabet, 1 + floor(random()*length(alphabet))::int, 1);
    END LOOP;
    PERFORM 1 FROM public.affiliates WHERE referral_code = code;
    IF NOT FOUND THEN
      RETURN code;
    END IF;
    attempt := attempt + 1;
    IF attempt > 20 THEN
      RAISE EXCEPTION 'could not generate unique affiliate code';
    END IF;
  END LOOP;
END;
$$;

-- =========================================================================
-- PUBLIC RPCs
-- =========================================================================

-- Public: resolve a referral code (used by the /r/:code landing page).
CREATE OR REPLACE FUNCTION public.resolve_referral_code(p_code text)
RETURNS TABLE(affiliate_id uuid, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.status
  FROM public.affiliates a
  WHERE a.referral_code = upper(p_code)
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_referral_code(text) TO anon, authenticated, service_role;

-- Attribute a wallet to a referral code. Idempotent, never overwrites,
-- blocks self-referral. Called by the attribute-referral edge function
-- on first wallet connect.
CREATE OR REPLACE FUNCTION public.attribute_wallet_to_affiliate(
  p_wallet text,
  p_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet text := lower(p_wallet);
  v_code text := upper(p_code);
  v_affiliate public.affiliates%ROWTYPE;
BEGIN
  IF v_wallet IS NULL OR v_wallet = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_wallet');
  END IF;

  -- Already attributed → no-op, first wins.
  IF EXISTS (SELECT 1 FROM public.affiliate_referrals WHERE wallet_address = v_wallet) THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_attributed');
  END IF;

  SELECT * INTO v_affiliate
  FROM public.affiliates
  WHERE referral_code = v_code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_code');
  END IF;
  IF v_affiliate.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive_code');
  END IF;
  IF lower(v_affiliate.wallet_address) = v_wallet THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'self_referral');
  END IF;

  INSERT INTO public.affiliate_referrals (wallet_address, affiliate_id, referral_code)
  VALUES (v_wallet, v_affiliate.id, v_affiliate.referral_code)
  ON CONFLICT (wallet_address) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'reason', 'attributed', 'affiliate_id', v_affiliate.id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.attribute_wallet_to_affiliate(text, text) TO anon, authenticated, service_role;

-- Read a wallet's attribution (used by create-launch edge functions to
-- snapshot the affiliate id onto the new launch row).
CREATE OR REPLACE FUNCTION public.get_wallet_affiliate(p_wallet text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT affiliate_id
  FROM public.affiliate_referrals
  WHERE wallet_address = lower(p_wallet)
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_wallet_affiliate(text) TO anon, authenticated, service_role;

-- Per-launch fee split. Single source of truth for the external fee-claimer
-- service. Returns 7000/3000/0 if no affiliate, 7000/1500/1500 otherwise.
CREATE OR REPLACE FUNCTION public.get_launch_fee_split(p_launch_id uuid)
RETURNS TABLE(
  launch_id uuid,
  creator_wallet text,
  creator_bps int,
  treasury_bps int,
  affiliate_id uuid,
  affiliate_wallet text,
  affiliate_bps int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.created_by_wallet,
    7000::int AS creator_bps,
    CASE WHEN l.referred_by_affiliate_id IS NULL THEN 3000 ELSE 1500 END::int AS treasury_bps,
    l.referred_by_affiliate_id,
    a.wallet_address,
    CASE WHEN l.referred_by_affiliate_id IS NULL THEN 0 ELSE 1500 END::int AS affiliate_bps
  FROM public.launches l
  LEFT JOIN public.affiliates a ON a.id = l.referred_by_affiliate_id
  WHERE l.id = p_launch_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_launch_fee_split(uuid) TO anon, authenticated, service_role;

-- Append an earnings row from the external fee-claimer after a successful
-- sweep tx. Idempotent on (launch_id, tx_signature).
CREATE OR REPLACE FUNCTION public.record_affiliate_earning(
  p_launch_id uuid,
  p_amount_lamports bigint,
  p_tx_signature text,
  p_status text DEFAULT 'paid'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affiliate_id uuid;
  v_wallet text;
  v_existing uuid;
  v_new_id uuid;
BEGIN
  SELECT l.referred_by_affiliate_id, a.wallet_address
    INTO v_affiliate_id, v_wallet
  FROM public.launches l
  LEFT JOIN public.affiliates a ON a.id = l.referred_by_affiliate_id
  WHERE l.id = p_launch_id;

  IF v_affiliate_id IS NULL THEN
    RAISE EXCEPTION 'launch % has no affiliate attribution', p_launch_id;
  END IF;

  -- Idempotency
  SELECT id INTO v_existing
  FROM public.affiliate_earnings
  WHERE launch_id = p_launch_id AND tx_signature = p_tx_signature
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  INSERT INTO public.affiliate_earnings (
    affiliate_id, launch_id, wallet_address,
    amount_lamports, tx_signature, status
  )
  VALUES (
    v_affiliate_id, p_launch_id, v_wallet,
    p_amount_lamports, p_tx_signature, COALESCE(p_status, 'paid')
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;
-- Only service_role (fee-claimer Railway worker) should write earnings.
GRANT EXECUTE ON FUNCTION public.record_affiliate_earning(uuid, bigint, text, text) TO service_role;

-- =========================================================================
-- AFFILIATE-FACING RPCs (wallet-scoped reads)
-- =========================================================================

-- Resolve the connected wallet's affiliate row (if any), so the UI knows
-- whether to show the affiliate dashboard link.
CREATE OR REPLACE FUNCTION public.get_my_affiliate(p_wallet text)
RETURNS TABLE(
  id uuid,
  wallet_address text,
  referral_code text,
  status text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.wallet_address, a.referral_code, a.status, a.created_at
  FROM public.affiliates a
  WHERE a.wallet_address = lower(p_wallet)
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_affiliate(text) TO anon, authenticated, service_role;

-- Per-wallet dashboard summary: totals + referred wallets + per-launch earnings.
CREATE OR REPLACE FUNCTION public.affiliate_dashboard(p_wallet text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affiliate public.affiliates%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO v_affiliate
  FROM public.affiliates
  WHERE wallet_address = lower(p_wallet);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_affiliate');
  END IF;

  SELECT jsonb_build_object(
    'ok', true,
    'affiliate', jsonb_build_object(
      'id', v_affiliate.id,
      'wallet_address', v_affiliate.wallet_address,
      'referral_code', v_affiliate.referral_code,
      'status', v_affiliate.status,
      'created_at', v_affiliate.created_at
    ),
    'totals', (
      SELECT jsonb_build_object(
        'referred_wallets', (SELECT count(*) FROM public.affiliate_referrals WHERE affiliate_id = v_affiliate.id),
        'attributed_launches', (SELECT count(*) FROM public.launches WHERE referred_by_affiliate_id = v_affiliate.id),
        'lifetime_lamports', COALESCE((SELECT sum(amount_lamports) FROM public.affiliate_earnings WHERE affiliate_id = v_affiliate.id), 0)
      )
    ),
    'referred_wallets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'wallet_address', r.wallet_address,
        'attributed_at', r.attributed_at,
        'launch_count', (SELECT count(*) FROM public.launches l WHERE l.created_by_wallet = r.wallet_address),
        'earned_lamports', COALESCE((
          SELECT sum(e.amount_lamports) FROM public.affiliate_earnings e
          JOIN public.launches l ON l.id = e.launch_id
          WHERE e.affiliate_id = v_affiliate.id AND lower(l.created_by_wallet) = r.wallet_address
        ), 0)
      ) ORDER BY r.attributed_at DESC)
      FROM public.affiliate_referrals r
      WHERE r.affiliate_id = v_affiliate.id
    ), '[]'::jsonb),
    'earnings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id,
        'launch_id', e.launch_id,
        'token_name', l.token_name,
        'token_symbol', l.token_symbol,
        'amount_lamports', e.amount_lamports,
        'tx_signature', e.tx_signature,
        'status', e.status,
        'created_at', e.created_at
      ) ORDER BY e.created_at DESC)
      FROM public.affiliate_earnings e
      JOIN public.launches l ON l.id = e.launch_id
      WHERE e.affiliate_id = v_affiliate.id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.affiliate_dashboard(text) TO anon, authenticated, service_role;

-- =========================================================================
-- ADMIN RPCs
-- =========================================================================

CREATE OR REPLACE FUNCTION public.admin_create_affiliate(
  p_admin_wallet text,
  p_wallet text
)
RETURNS public.affiliates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.affiliates%ROWTYPE;
  v_code text;
BEGIN
  IF NOT public.is_admin_wallet(p_admin_wallet) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_wallet IS NULL OR length(p_wallet) < 32 THEN
    RAISE EXCEPTION 'invalid wallet';
  END IF;

  -- If the wallet already exists, return it idempotently.
  SELECT * INTO v_row FROM public.affiliates WHERE wallet_address = lower(p_wallet);
  IF FOUND THEN
    RETURN v_row;
  END IF;

  v_code := public._gen_affiliate_code();

  INSERT INTO public.affiliates (wallet_address, referral_code, created_by_admin_wallet)
  VALUES (lower(p_wallet), v_code, lower(p_admin_wallet))
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_create_affiliate(text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_affiliate_status(
  p_admin_wallet text,
  p_affiliate_id uuid,
  p_status text
)
RETURNS public.affiliates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.affiliates%ROWTYPE;
BEGIN
  IF NOT public.is_admin_wallet(p_admin_wallet) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_status NOT IN ('active','revoked') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;

  UPDATE public.affiliates
  SET status = p_status, updated_at = now()
  WHERE id = p_affiliate_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'affiliate not found';
  END IF;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_affiliate_status(text, uuid, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_affiliates(p_admin_wallet text)
RETURNS TABLE(
  id uuid,
  wallet_address text,
  referral_code text,
  status text,
  created_at timestamptz,
  referred_wallets bigint,
  attributed_launches bigint,
  paid_out_lamports bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_wallet(p_admin_wallet) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN QUERY
  SELECT
    a.id, a.wallet_address, a.referral_code, a.status, a.created_at,
    COALESCE((SELECT count(*) FROM public.affiliate_referrals r WHERE r.affiliate_id = a.id), 0)::bigint,
    COALESCE((SELECT count(*) FROM public.launches l WHERE l.referred_by_affiliate_id = a.id), 0)::bigint,
    COALESCE((SELECT sum(e.amount_lamports) FROM public.affiliate_earnings e WHERE e.affiliate_id = a.id), 0)::bigint
  FROM public.affiliates a
  ORDER BY a.created_at DESC
  LIMIT 1000;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_affiliates(text) TO anon, authenticated, service_role;

-- updated_at trigger for affiliates
CREATE OR REPLACE FUNCTION public._affiliates_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_affiliates_updated_at
BEFORE UPDATE ON public.affiliates
FOR EACH ROW EXECUTE FUNCTION public._affiliates_set_updated_at();
