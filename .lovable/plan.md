I checked the uploaded Railway log, Supabase launch rows, and the on-chain transaction. This latest failure is different from the earlier Bags 500s.

## What went wrong this time

The failed Bags launch is:

```text
launch_id: d77ac7e5-d731-45c0-aaba-071e95ae5467
token: Erys test / ETEST
mint: 4eY3ywM1vZss1FFPY3J598hhkEmP3mwX5JHc1rseBAGS
escrow: E7XRAxqquSZQENUhmhjvZYMgvHcLAD33FNZGmd7429LZ
status: execution_failed
```

Supabase says it failed at fee-share submission:

```text
Fee-share submission failed (escrow may hold partial state, manual review):
Signature 4xnT8TeqzFmzaPbMcjJgBFrsq5Xcw3mWPvY8jXtgexN6b1dMvNkwibpjJBeqTESsoH3Hmm7SifFDBcYHwy6BPJiq has expired: block height exceeded.
```

The uploaded Railway log repeatedly shows:

```text
Received JSON-RPC error calling `signatureSubscribe`
signature: 4xnT8TeqzFmzaPbMcjJgBFrsq5Xcw3mWPvY8jXtgexN6b1dMvNkwibpjJBeqTESsoH3Hmm7SifFDBcYHwy6BPJiq
commitment: processed
```

But Solscan shows that exact transaction actually succeeded and finalized:

```text
signature: 4xnT8TeqzFmzaPbMcjJgBFrsq5Xcw3mWPvY8jXtgexN6b1dMvNkwibpjJBeqTESsoH3Hmm7SifFDBcYHwy6BPJiq
result: Success, finalized
program: Bagsfm Fee Shares
instruction: create_fee_config
created config PDA: 9FmdWfQNvx7y9rPqRHnvqbxwiDKAApjdJc1uhoMdEpmJ
block time: 20:00:22 UTC
```

So the core issue is:

```text
The Bags fee-share config transaction landed successfully on-chain,
but the executor trusted the SDK helper's confirmTransaction error,
marked the launch failed, and never continued to createLaunchTransaction.
```

This is not a Bags API 500 this time. It is a transaction confirmation false negative caused by the official SDK helper using `connection.confirmTransaction`, which relies on `signatureSubscribe`. Our Railway/RPC environment is throwing repeated `signatureSubscribe` errors, and then the helper reports blockhash expiry even though the transaction landed.

## Current risk

Bags launches are currently enabled in `app_settings`:

```text
launches_bags_enabled = true
```

That means users can still schedule Bags launches even though the executor can false-fail after a successful on-chain fee-share config transaction. I recommend disabling Bags again until this fix is applied and verified.

## Important state of the failed launch

For `d77ac7e5-d731-45c0-aaba-071e95ae5467`:

- The launch token itself did not launch.
- The fee-share config did get created on-chain.
- Supabase did not store `fee_share_config_key`, because the executor returned early after the false error.
- The correct derived config key is `9FmdWfQNvx7y9rPqRHnvqbxwiDKAApjdJc1uhoMdEpmJ`.
- Contributions have not been refunded yet, which is conservative because partial on-chain state exists.

## Fix plan

### 1. Immediately protect users

Disable Bags launches again via `app_settings` until the confirmation fix is deployed and tested. Pump.fun can remain unchanged.

### 2. Keep the official Bags payload/order, replace only fragile confirmation handling

Continue using Bags SDK for the documented flow and payloads:

```text
createTokenInfoAndMetadata
createBagsFeeShareConfig
createLaunchTransaction
```

But stop using the SDK's `signAndSendTransaction` as the only source of truth for whether a transaction landed. The SDK helper does this internally:

```text
sendTransaction(skipPreflight: true, maxRetries: 0)
confirmTransaction(...)
```

That exact confirmation path is what failed here. I will replace executor-side transaction sending for Bags with a robust helper that:

```text
signs the VersionedTransaction
sends it via sendRawTransaction
polls getSignatureStatuses over HTTP
rebroadcasts while valid
if blockhash expires, checks transaction history before declaring failure
returns success if the tx landed confirmed/finalized
```

This preserves Bags’ documented API call order and payloads, but fixes the confirmation transport problem that caused the false failure.

### 3. Recover successful-on-chain fee-share configs before failing

When fee-share submission throws, the executor should not immediately mark failed. It should:

1. Derive the deterministic fee-share config PDA from `baseMint`.
2. Check RPC for that account.
3. If it exists, store it in Supabase as `fee_share_config_key`.
4. Continue to the 25s Bags indexer wait and `createLaunchTransaction`.

For the latest failed launch, this would have found:

```text
9FmdWfQNvx7y9rPqRHnvqbxwiDKAApjdJc1uhoMdEpmJ
```

and continued instead of failing.

### 4. Persist partial progress earlier

As soon as Bags returns `meteoraConfigKey` from `createBagsFeeShareConfig`, store it in Supabase before submitting fee-share transactions. That way, if confirmation fails after the transaction lands, the admin retry path has the exact config key and does not lose the recovery handle.

### 5. Add a safe admin retry path for this exact launch

After the code fix, `d77ac7e5-d731-45c0-aaba-071e95ae5467` should be recoverable without recreating the fee-share config:

```text
set fee_share_config_key = 9FmdWfQNvx7y9rPqRHnvqbxwiDKAApjdJc1uhoMdEpmJ
set status = executing
clear worker lock
```

Then the executor should skip config creation, wait for Bags indexing, call `createLaunchTransaction`, and launch.

### 6. Improve failure classification

If a Bags transaction confirmation throws but later polling proves the tx landed, treat it as success.

If the tx truly never landed, classify it based on stage:

- Before any on-chain state: safe auto-refund.
- After fee-share config might exist: no auto-refund until recovery check completes.
- After launch tx broadcast: no auto-refund unless we prove the launch tx failed preflight/on-chain.

### 7. Verification

After implementation:

- Re-check the code against the Bags launch guide step-by-step.
- Confirm the executor no longer relies on `signatureSubscribe` for final success/failure decisions.
- Verify the latest failed config PDA is detected on-chain.
- Keep Bags paused until we run one controlled small launch test.