## What failed

Your last Bags launch (`Erys Test` / `ETEST`, launched 2026-04-27 21:30 UTC, id `9c4049bd…`) failed at **Step 2: fee-share config submission**.

The exact executor error stored on the row:

```
Fee-share submission failed: Signature 3SQwJv8yCbuxQTRGUTxYMStkt4MBqUY2rLyFwjrPZCF7EdwUunUUdx87Gh85f3rziaZmsffqjhxFCFusBte2ZM6Y has expired: block height exceeded.
```

Translation: the executor signed a Jito bundle returned by `sdk.config.createBagsFeeShareConfig(...)` and tried to send it via `sendBundleAndConfirm`, but by the time Jito landed/confirmed it the recent blockhash baked into the transaction was already past its `lastValidBlockHeight`. So the network rejected it.

Because Step 2 failed, the executor never reached Step 3 (`createLaunchTransaction`) — that's why the row has:
- `fee_share_config_key = NULL`
- `claimer_count = NULL`
- `processing_fee_tx_signature = NULL`
- a `token_mint_address` (Step 0 succeeded, mint was reserved on Bags)
- `status = execution_failed`, `execution_attempts = 1`

No SOL was debited from escrow (no processing fee charged, no launch buy sent). Funds are safe in escrow.

### Why this happens
Bags' SDK builds the bundle txs with a blockhash fetched at build time. Between build → our sign → Jito submit → Jito leader inclusion, ~60–90s can elapse, especially on a busy slot or slow Jito region. Solana blockhashes only live ~60–90s (~150 blocks). Our code does **not** refresh blockhashes or retry expired bundles — one shot, then `setFailed`.

This is the same family of issue we've hit before but on the launch tx; we never hardened the **fee-share bundle** path.

## Fix plan

Two parts: (1) recover this specific launch, (2) prevent the next one.

### 1. Recover launch `9c4049bd…`

The launch is in `execution_failed` with no `pumpfun_launch_signature` and no fee-share config key, so the existing admin retry endpoint (`retry-failed-launch`) is safe to use. On retry, `executeBags.ts` Step 0 already re-reserves a fresh mint and clears stale fee-share config, so a second attempt is clean.

Action: trigger retry from the admin panel (or via the `retry-failed-launch` edge function) for `9c4049bd-56b3-43e5-9d48-db09774209ae`.

### 2. Harden fee-share bundle submission in `executor/src/executeBags.ts`

In the Step 2 loop where we send Jito bundles, wrap each `sendBundleAndConfirm` in a small retry that:

1. Catches `block height exceeded` / `blockhash not found` / generic timeout errors.
2. On expiry, **rebuilds** the fee-share config by calling `sdk.config.createBagsFeeShareConfig(...)` again to get fresh-blockhash transactions (the Bags SDK is the only thing that can re-emit signed-shape txs with a new blockhash for that config layout).
3. Re-signs the new bundles with `escrowKeypair` and resubmits.
4. Caps at ~3 attempts; on final failure call `setFailed` with the original error.

Also apply the same wrapper to the non-bundled `signAndSendTransaction` calls in Step 2 for consistency (LUT extends already use `signAndSendTransaction` which has internal retry, so leave those alone).

Note: we cannot simply patch the blockhash on the existing `VersionedTransaction` — versioned tx message is immutable once signed. Re-fetching from the SDK is the correct path.

### Technical details

- File to change: `executor/src/executeBags.ts`, the block currently labeled `// Send bundles atomically via Jito` (around the `for (let bIdx = 0; bIdx < cfgResult.bundles.length; bIdx++)` loop).
- Add a helper `submitFeeShareWithRetry(sdk, escrowKeypair, args, maxAttempts = 3)` that owns the build → sign → send → detect-expiry → rebuild loop and returns the final `meteoraConfigKey`.
- `configKeyStr` should be set from the **last successful** rebuild's `meteoraConfigKey` (it can change between rebuilds since each call creates a new config account).
- Keep the existing `storeFeeShareConfig(launch.id, configKeyStr, feeClaimers.length)` call after success.
- Leave Step 1 (LUT) and Step 3 (launch tx) as-is — Step 3 already runs through `signAndSendTransaction` which handles blockhash refresh internally per Bags SDK.

### Out of scope

- The 4 older `create-launch-transaction failed: Internal server error` rows from 2026-04-24 are Bags API-side 500s, unrelated to this failure mode and not a code bug on our side.

## Summary

- **Cause:** Jito fee-share bundle's blockhash expired before confirmation; executor has no retry for that specific path.
- **Funds:** Safe in escrow, nothing was spent.
- **Recovery:** Retry the failed launch from admin (it's idempotent thanks to Step 0 fresh-mint + cleared config).
- **Prevention:** Add a rebuild-and-resubmit retry around `sendBundleAndConfirm` in `executeBags.ts` Step 2.
