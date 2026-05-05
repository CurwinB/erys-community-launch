
-- Replace deny-all SELECT policy with permissive policy gated by column-level grants
DROP POLICY IF EXISTS "No direct browser access to contributions" ON public.contributions;

CREATE POLICY "Anon/auth can read contributions (column-restricted)"
  ON public.contributions
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Revoke any blanket select, then grant only the safe public columns the view exposes
REVOKE SELECT ON public.contributions FROM anon, authenticated;

GRANT SELECT (
  id,
  launch_id,
  wallet_address,
  amount_lamports,
  contributed_at,
  refund_tx_signature
) ON public.contributions TO anon, authenticated;
