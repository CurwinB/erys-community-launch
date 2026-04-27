-- 1. Per-launch wallet tracking. Null = legacy launches that used the
--    single unsuffixed PUMPPORTAL_CUSTODIAL_* secrets (slot 1 of the pool).
ALTER TABLE public.launches
  ADD COLUMN IF NOT EXISTS pumpportal_wallet_pubkey text;

CREATE INDEX IF NOT EXISTS idx_launches_pumpportal_wallet
  ON public.launches(pumpportal_wallet_pubkey)
  WHERE platform = 'pumpfun';

-- 2. Generic app-settings table. Tiny key/value store used today only for
--    publishing the wallet pool size from the workers to the edge functions,
--    but reusable for other cross-service runtime config later.
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages app_settings" ON public.app_settings;
CREATE POLICY "Service role manages app_settings"
  ON public.app_settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "App settings are readable by everyone" ON public.app_settings;
CREATE POLICY "App settings are readable by everyone"
  ON public.app_settings
  FOR SELECT
  TO public
  USING (true);

-- 3. Updated batched fee-claim RPC: optional wallet filter so each pass
--    targets a single custodial wallet. NULL keeps prior behavior so the
--    existing distributor code continues to work during the rollout.
CREATE OR REPLACE FUNCTION public.claim_pumpfun_launches_batch_for_worker(
  p_worker_id text,
  p_limit integer DEFAULT 25,
  p_lock_expiry_seconds integer DEFAULT 300,
  p_wallet_pubkey text DEFAULT NULL
)
RETURNS SETOF public.launches
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.launches
  SET worker_locked_at = now(),
      worker_id        = p_worker_id
  WHERE id IN (
    SELECT id FROM public.launches
    WHERE status = 'launched'
      AND platform = 'pumpfun'
      AND (
        p_wallet_pubkey IS NULL
        OR pumpportal_wallet_pubkey IS NOT DISTINCT FROM p_wallet_pubkey
      )
      AND (
        pumpfun_fees_last_claimed_at IS NULL
        OR pumpfun_fees_last_claimed_at <= now() - interval '10 minutes'
      )
      AND (
        pumpfun_low_volume_throttle_until IS NULL
        OR pumpfun_low_volume_throttle_until <= now()
      )
      AND (
        worker_locked_at IS NULL
        OR worker_locked_at < now() - make_interval(secs => p_lock_expiry_seconds)
      )
    ORDER BY created_at ASC
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$function$;

-- 4. Helper to upsert app settings from the workers without granting them
--    direct table write access via the rest API. SECURITY DEFINER so the
--    service-role workers can call it succinctly.
CREATE OR REPLACE FUNCTION public.set_app_setting(p_key text, p_value text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  INSERT INTO public.app_settings (key, value, updated_at)
  VALUES (p_key, p_value, now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();
$function$;