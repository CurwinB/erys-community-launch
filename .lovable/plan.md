

# Retry failed Bags launch `a0d56180…`

## Change

Run the provided SQL UPDATE in the Supabase SQL editor to flip the failed launch back to `scheduled` status so the execute-launch edge function will re-queue it.

```sql
UPDATE public.launches
SET 
  status = 'scheduled',
  execution_error = null,
  worker_locked_at = null,
  worker_id = null
WHERE id = 'a0d56180-c34a-4588-b4a4-709197996f94';
```

## Notes

- `execution_attempts` stays at 1 (not reset), so the executor will treat this as attempt 2 of 3.
- The launch already has `fee_share_config_key = 'FcRYArQoCxapKM9uegQr8LJaKeYHMVNo9nqYwb5sGeAK'` from the previous run; the executor will likely reuse this or re-call fee-share/config depending on Bags API state.
- The Bags API 500 from the previous attempt may have been transient; retrying is the correct next diagnostic step.

## Files edited

None — database operation only.

