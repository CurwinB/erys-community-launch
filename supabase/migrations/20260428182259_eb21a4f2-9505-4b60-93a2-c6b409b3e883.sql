
-- Seed default platform-status settings (idempotent).
INSERT INTO public.app_settings (key, value, updated_at)
VALUES
  ('launches_bags_enabled', 'true', now()),
  ('launches_pumpfun_enabled', 'true', now())
ON CONFLICT (key) DO NOTHING;

-- Public read: returns the current enabled state for both platforms plus
-- when each was last updated. No secrets exposed.
CREATE OR REPLACE FUNCTION public.get_launch_platform_status()
RETURNS TABLE(
  bags_enabled boolean,
  pumpfun_enabled boolean,
  bags_updated_at timestamptz,
  pumpfun_updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE((SELECT value FROM public.app_settings WHERE key = 'launches_bags_enabled'), 'true') = 'true'
      AS bags_enabled,
    COALESCE((SELECT value FROM public.app_settings WHERE key = 'launches_pumpfun_enabled'), 'true') = 'true'
      AS pumpfun_enabled,
    (SELECT updated_at FROM public.app_settings WHERE key = 'launches_bags_enabled')
      AS bags_updated_at,
    (SELECT updated_at FROM public.app_settings WHERE key = 'launches_pumpfun_enabled')
      AS pumpfun_updated_at;
$$;

GRANT EXECUTE ON FUNCTION public.get_launch_platform_status() TO anon, authenticated;

-- Admin write: flips the enabled flag for a single platform. Caller must be
-- a registered admin wallet.
CREATE OR REPLACE FUNCTION public.set_launch_platform_status(
  p_admin_wallet text,
  p_platform text,
  p_enabled boolean
)
RETURNS TABLE(
  bags_enabled boolean,
  pumpfun_enabled boolean,
  bags_updated_at timestamptz,
  pumpfun_updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  IF NOT public.is_admin_wallet(p_admin_wallet) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_platform = 'bags' THEN
    v_key := 'launches_bags_enabled';
  ELSIF p_platform = 'pumpfun' THEN
    v_key := 'launches_pumpfun_enabled';
  ELSE
    RAISE EXCEPTION 'invalid platform: %', p_platform;
  END IF;

  INSERT INTO public.app_settings (key, value, updated_at)
  VALUES (v_key, CASE WHEN p_enabled THEN 'true' ELSE 'false' END, now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();

  RETURN QUERY SELECT * FROM public.get_launch_platform_status();
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_launch_platform_status(text, text, boolean) TO anon, authenticated;
