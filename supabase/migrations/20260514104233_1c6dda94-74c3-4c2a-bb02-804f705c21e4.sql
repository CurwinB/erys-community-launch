CREATE OR REPLACE FUNCTION public.admin_set_app_setting(p_admin_wallet text, p_key text, p_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_wallet(p_admin_wallet) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  INSERT INTO public.app_settings (key, value, updated_at)
  VALUES (p_key, p_value, now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();
END;
$$;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('footer_contract_address', '4T1GVUfBjwhPv2GQiWP8GiUiq5GGhdybtVRJY733BAGS', now())
ON CONFLICT (key) DO NOTHING;