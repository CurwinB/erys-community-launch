CREATE OR REPLACE FUNCTION public.list_my_contributions(p_wallet text)
RETURNS TABLE (
  id uuid,
  wallet_address text,
  amount_lamports bigint,
  tx_signature text,
  contributed_at timestamptz,
  basis_points integer,
  token_amount bigint,
  tokens_distributed boolean,
  distribution_tx_signature text,
  distribution_error text,
  refund_tx_signature text,
  token_delivery_wallet text,
  is_fee_claimer boolean,
  launches jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.wallet_address,
    c.amount_lamports,
    c.tx_signature,
    c.contributed_at,
    c.basis_points,
    c.token_amount,
    c.tokens_distributed,
    c.distribution_tx_signature,
    c.distribution_error,
    c.refund_tx_signature,
    c.token_delivery_wallet,
    c.is_fee_claimer,
    to_jsonb(lp.*) AS launches
  FROM public.contributions c
  LEFT JOIN public.launches_public lp ON lp.id = c.launch_id
  WHERE lower(c.wallet_address) = lower(p_wallet)
  ORDER BY c.contributed_at DESC
  LIMIT 1000;
$$;

GRANT EXECUTE ON FUNCTION public.list_my_contributions(text) TO anon, authenticated;