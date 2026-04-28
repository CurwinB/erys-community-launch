## What failed this time

Latest Bags launch:

```text
af4dc71d-2b37-4f8c-a52e-c09d093ae87f
Token: Erys test / ETEST
Status: execution_failed
Mint reserved: 8xGh78mVhi9hXyioGNjtLyTF98XGPYG825XgTwsuBAGS
Error: createBagsFeeShareConfig says "Config already exists" but did not return the existing config key
```

Yes, this still went through Railway. The Supabase `execute-launch` edge function only queued it:

```text
Queued launch af4dc71d... for execution on Railway
```

The actual failure happened in the Railway executor during Bags fee-share config creation.

## Simple explanation

This is not a normal launch transaction failure. It is failing before the actual token launch buy.

Bags has a fee-share config step before launch. Our code asks Bags:

```text
For this mint + contributor wallets + fee splits + partner wallet, create the fee-share config.
```

Bags replied:

```text
That config already exists.
```

The previous fix correctly detected that message, but it depended on the Bags SDK returning the existing config key inside the error. I inspected the SDK behavior: the SDK actually throws away the successful response when `needsCreation=false` and only throws a plain `Error('Config already exists')`. So our recovery branch had nothing to recover.

That is why the same failure happened again.

## Important extra issue found

Because `setFailed()` automatically runs refunds, this failed launch has already refunded contributors:

```text
Contribution total: 270,000,000 lamports
Refunded contributors: 2/2
Total refund shortfall: 7,433,124 lamports
```

So this specific launch should not simply be retried as-is unless we intentionally re-fund/handle the escrow. The current auto-refund behavior is too aggressive for Bags failures after on-chain setup has started, because Bags config creation can spend escrow SOL even though the token launch did not finish.

## Plan to fix properly

### 1. Bypass the SDK bug for fee-share config creation

Update `executor/src/executeBags.ts` so Step 2 calls Bags' REST endpoint directly for fee-share config creation, instead of using `sdk.config.createBagsFeeShareConfig()` for this specific step.

The Bags API response includes:

```text
needsCreation: true/false
meteoraConfigKey: <key>
transactions: [...]
bundles: [...]
```

New behavior:

- If `needsCreation=true`: decode/sign/send the returned transactions/bundles like today.
- If `needsCreation=false`: store `meteoraConfigKey` immediately and continue to launch.
- If Bags returns an API error: fail with the full Bags error payload.

This directly fixes the current repeated `Config already exists` failure.

### 2. Derive/store the config key as a final fallback

Add a deterministic fallback for the known on-chain Bags fee-share PDA:

```text
seed: "fee_share_config"
baseMint: token mint
quoteMint: WSOL
program: BAGS_FEE_SHARE_V2_PROGRAM_ID
```

If Bags ever says the config exists but the response is malformed, derive the config PDA, check it exists on-chain, store it in `launches.fee_share_config_key`, and continue.

### 3. Stop auto-refunding Bags launches too early

Change `setFailed()` usage for Bags execution after Step 0/Step 2 begins.

For failures where an on-chain Bags setup may already exist, mark the launch `execution_failed` but do not auto-refund immediately. This prevents the platform from draining escrow before we can retry/recover the existing fee-share config.

Use a safer pattern:

```text
Before Bags on-chain setup: setFailed() with auto-refund is OK
After Bags on-chain setup starts: setFailedNoRefund() or a Bags-specific no-refund failure path
```

The existing `setFailedNoRefund()` function is currently described around Pump.fun, but it is generic enough to reuse or rename for clarity.

### 4. Add better executor logs

Add logs for:

- Bags `needsCreation` value
- `meteoraConfigKey`
- number of returned transactions/bundles
- whether config was created, reused, or PDA-derived
- whether failure is refund-safe or no-refund

This will make Railway logs decisive next time.

### 5. Recovery for the failed launch

After the code fix:

- Do not blindly retry `af4dc71d...` because contributors have already been refunded and there is a partial refund shortfall.
- Either create a fresh test launch with fresh funding, or manually reconcile/re-fund the escrow before retrying this exact launch.
- For any existing failed launch that still has funds and hit `Config already exists`, the new code can reuse the existing Bags config and proceed.

## Files to change

- `executor/src/executeBags.ts`
  - Replace Step 2 SDK fee-share config call with direct REST handling.
  - Handle `needsCreation=false` as success.
  - Add PDA fallback and better logs.
  - Use no-refund failure after on-chain setup starts.

- `executor/src/db.ts`
  - Add or clarify a no-refund failure helper for Bags partial/on-chain setup failures.

No database schema change is required.