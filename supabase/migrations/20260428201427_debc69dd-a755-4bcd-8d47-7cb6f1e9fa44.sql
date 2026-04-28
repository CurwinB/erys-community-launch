UPDATE public.app_settings SET value = 'false', updated_at = now() WHERE key = 'launches_bags_enabled';
INSERT INTO public.app_settings (key, value, updated_at)
SELECT 'launches_bags_enabled', 'false', now()
WHERE NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'launches_bags_enabled');