

# Skip fee-share/config on retry when configKey already stored

## Problem

When `executeBags` retries a launch, it always calls `POST /fee-share/config`. Bags treats that mint as already-configured and returns `{success:true}` with no `meteoraConfigKey`, so our code fails at line 170 with `"fee-share/config returned no configKey"`. The valid key is already in `launches.fee_share_config_key` from the first attempt.

## Fix — `executor/src/executeBags.ts`

Wrap the existing fee-share block (lines 122–188) in a guard:

```ts
let configKey: string;

if (launch.fee_share_config_key) {
  console.log(`Using existing fee_share_config_key: ${launch.fee_share_config_key}`);
  configKey = launch.fee_share_config_key;
} else {
  // existing fee-share/config call, response handling,
  // tx submission loop, and storeFeeShareConfig(...) — unchanged
  configKey = feeShareData.response?.meteoraConfigKey;
  if (!configKey) {
    await setFailed(launch.id, "fee-share/config returned no configKey");
    return;
  }
  // ... existing tx loop ...
  await storeFeeShareConfig(launch.id, configKey, claimersArray.length);
}

// Step 2: create-launch-transaction — unchanged, uses configKey
```

The `configKey` declaration on line 167 changes from `const` to be supplied by whichever branch ran. No other logic touched. Step 2 (`create-launch-transaction`) and Step 3 (sign + send) are unchanged.

## Fix — `executor/src/db.ts`

Already correct — `fee_share_config_key: string | null` exists on the `Launch` interface at line 25. No change needed; flagging so we don't waste an edit.

## Manual follow-up (after deploy)

Run in Supabase SQL editor to re-queue the launch:

```sql
UPDATE public.launches
SET status = 'scheduled',
    execution_error = null,
    worker_locked_at = null,
    worker_id = null
WHERE id = 'a0d56180-c34a-4588-b4a4-709197996f94';
```

`execution_attempts` stays at 2 — this will be the third and final auto-attempt before the executor's `< 3` cap.

## Notes / risks

1. **Claimers can't change on retry.** Because we skip re-registering, the on-chain config is locked to the claimer set from attempt 1. If contributors were added/removed between attempts, the new ones won't be in the fee-share config. For `a0d56180…` this is fine — same 2 contributors, same amounts.
2. **If Bags ever invalidates a stale config key**, this retry will fail at `create-launch-transaction` instead. Acceptable — that's the correct failure mode and surfaces a real Bags-side problem rather than masking it.
3. **No change to `claimer_count`** on retry, since we skip `storeFeeShareConfig`. Already correct from attempt 1.

## Out of scope

- No change to `refund` flow, `db.ts`, `executeLaunch.ts`, or pumpfun path.
- Not touching `execution_attempts` reset logic — keeping the 3-attempt cap as-is.

## Files edited

- `executor/src/executeBags.ts`

