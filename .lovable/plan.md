

# Build distribute-tokens Edge Function

## Overview
Create a standalone `distribute-tokens` edge function that handles SPL token transfers from the escrow wallet to contributors. Replace the inline distribution code in `execute-launch` with an async invocation of this new function. Add a pg_cron retry job.

## Changes

### 1. New file: `supabase/functions/distribute-tokens/index.ts`
- Imports `@solana/spl-token@0.3.8` and `@solana/web3.js@1.91.1` from esm.sh
- Accepts `{ launch_id }` or empty body (auto-finds oldest incomplete distribution)
- Full sequence:
  1. Load launch (verify status = launched), query contributions with `tokens_distributed = false` and `token_amount IS NOT NULL`
  2. Decrypt escrow key (AES-256-GCM), reconstruct `Keypair.fromSecretKey()`
  3. Read token balance via `getTokenAccountsByOwner` RPC (retry 5x, 3s gaps)
  4. Verify stored `token_amount` sum matches actual balance; redistribute proportionally if mismatch
  5. Derive escrow's own ATA once before the loop
  6. For each contributor: derive their ATA, create if needed via `createAssociatedTokenAccountInstruction`, transfer via `createTransferInstruction`, sign with escrow keypair, send via RPC `sendTransaction`
  7. Update each contribution record (`tokens_distributed`, `distribution_tx_signature` or `distribution_error`)
  8. Mark `distribution_completed = true` on the launch only if all contributors succeeded (or failed due to zero token amount)
- Error handling: never stop the loop for a single failure, log insufficient SOL for ATA as `distribution_error`, continue to next contributor
- Secrets: `SOLANA_RPC_URL`, `ESCROW_ENCRYPTION_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Includes the same `decryptEscrowKey` and `hexToUint8Array` utility functions already in execute-launch

### 2. Edit: `supabase/functions/execute-launch/index.ts`
- Remove the entire `distributeTokens` function (lines 363-579)
- Replace lines 321-341 (Step 4 block) with:
```typescript
supabase.functions.invoke("distribute-tokens", {
  body: { launch_id: launch.id }
}).catch(err => console.error("distribute-tokens invoke error:", err))
```
- No await — fire-and-forget to avoid timeout risk

### 3. pg_cron retry job (via Supabase insert tool)
- Enable `pg_cron` and `pg_net` extensions if not already enabled
- Schedule a job every 10 minutes that calls `distribute-tokens` with empty body
- The function auto-queries for the oldest launch where `distribution_completed = false`, `status = launched`, and `created_at` within last 24 hours

```sql
select cron.schedule(
  'retry-distribute-tokens',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://cifdozolzbztuohtdavx.supabase.co/functions/v1/distribute-tokens',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
```

### 4. Database migration
- Enable `pg_cron` and `pg_net` extensions:
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
```

## Implementation order
1. Create `distribute-tokens/index.ts`
2. Edit `execute-launch/index.ts` to remove inline distribution, add async invoke
3. Deploy both edge functions
4. Run migration to enable extensions
5. Insert cron job via insert tool (contains secrets, not a migration)

