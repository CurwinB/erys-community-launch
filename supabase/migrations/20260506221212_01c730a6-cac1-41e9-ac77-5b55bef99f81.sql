DELETE FROM public.pump_keypair_pool
WHERE claimed_at IS NULL
  AND public_key NOT LIKE '%pump';