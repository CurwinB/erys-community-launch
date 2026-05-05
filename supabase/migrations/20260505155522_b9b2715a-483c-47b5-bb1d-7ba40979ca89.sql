
REVOKE EXECUTE ON FUNCTION public.claim_launch_for_harvest(text, integer, integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.release_harvest_lock(uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.record_harvest_empty(uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.record_harvest_failure(uuid, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.record_harvest_cycle(uuid, bigint, bigint, bigint, text, text, bigint, bigint, bigint, jsonb, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.claim_allocation_for_user(uuid, text, text, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.complete_allocation_claim(uuid, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.fail_allocation_claim(uuid, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.force_fee_harvest_retry(uuid) FROM anon, authenticated, public;
