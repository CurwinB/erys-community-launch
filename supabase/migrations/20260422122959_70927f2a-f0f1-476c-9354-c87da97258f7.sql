ALTER TABLE public.launches
  ADD COLUMN IF NOT EXISTS is_sponsored boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS sponsored_by text,
  ADD COLUMN IF NOT EXISTS sponsored_amount_lamports bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sponsored_tx_signature text,
  ADD COLUMN IF NOT EXISTS sponsor_link_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS sponsor_link_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS sponsor_link_claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_launches_sponsor_pending
  ON public.launches (sponsor_link_expires_at)
  WHERE status = 'sponsor_pending';

CREATE OR REPLACE FUNCTION public.get_sponsor_slot_by_token(p_token text)
RETURNS TABLE (
  id uuid,
  launch_datetime timestamptz,
  sponsor_link_expires_at timestamptz,
  sponsored_amount_lamports bigint,
  status text,
  token_name text,
  token_symbol text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.launch_datetime,
    l.sponsor_link_expires_at,
    l.sponsored_amount_lamports,
    l.status::text,
    l.token_name,
    l.token_symbol
  FROM public.launches l
  WHERE l.sponsor_link_token = p_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_sponsor_slot_by_token(text) TO anon, authenticated;