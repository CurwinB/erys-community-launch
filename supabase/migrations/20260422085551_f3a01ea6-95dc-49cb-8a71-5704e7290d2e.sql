CREATE TABLE public.admin_wallets (
  wallet_address text PRIMARY KEY,
  email text,
  added_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin wallets are viewable by everyone"
ON public.admin_wallets
FOR SELECT
USING (true);

CREATE POLICY "Service role can manage admin wallets"
ON public.admin_wallets
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);