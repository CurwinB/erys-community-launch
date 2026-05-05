
CREATE TABLE public.lightning_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot integer UNIQUE NOT NULL,
  pubkey text UNIQUE NOT NULL,
  encrypted_secret_key text NOT NULL,
  encrypted_api_key text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  notes text,
  launch_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lightning_wallets_status_chk CHECK (status IN ('active','disabled'))
);

ALTER TABLE public.lightning_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny public reads of lightning_wallets"
  ON public.lightning_wallets FOR SELECT
  TO public
  USING (false);

CREATE POLICY "Service role manages lightning_wallets"
  ON public.lightning_wallets FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.admin_list_lightning_wallets(p_admin_wallet text)
RETURNS TABLE (
  id uuid,
  slot integer,
  pubkey text,
  status text,
  notes text,
  launch_count integer,
  last_used_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_wallet(p_admin_wallet) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN QUERY
    SELECT lw.id, lw.slot, lw.pubkey, lw.status, lw.notes,
           lw.launch_count, lw.last_used_at, lw.created_at, lw.updated_at
      FROM public.lightning_wallets lw
     ORDER BY lw.slot ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_lightning_wallet_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.pumpportal_wallet_pubkey IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.pumpportal_wallet_pubkey IS DISTINCT FROM OLD.pumpportal_wallet_pubkey) THEN
    UPDATE public.lightning_wallets
       SET launch_count = launch_count + 1,
           last_used_at = now(),
           updated_at = now()
     WHERE pubkey = NEW.pumpportal_wallet_pubkey;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bump_lightning_wallet_usage_trg
AFTER INSERT OR UPDATE OF pumpportal_wallet_pubkey ON public.launches
FOR EACH ROW
EXECUTE FUNCTION public.bump_lightning_wallet_usage();
