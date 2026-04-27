# Fix sponsored launch failure + public view 401s

## Diagnosis

Two independent bugs surfaced together:

### Bug 1 — "Failed to send a request to the Edge Function" on Claim

Logs for `claim-sponsored-slot`:
```
booted (time: 49ms)
ERROR CPU Time exceeded
LOG shutdown
```

The function crashes on **boot CPU budget**. Cause: the heavy esm.sh imports it doesn't really need:
```ts
import { Keypair, PublicKey, SystemProgram, Transaction } from "https://esm.sh/@solana/web3.js@1.91.1";
import bs58 from "https://esm.sh/bs58@5.0.0";
```
`@solana/web3.js` pulls in BN.js, buffer-layout, tweetnacl, rpc-websockets… and exceeds Deno edge-runtime's startup quota.

### Bug 2 — Homepage 401 `permission denied for table launches`

`launches_public` and `contributions_public` were created `WITH (security_invoker = on)`. Postgres re-applies RLS on the underlying tables using the caller's role — and we just locked those tables down with deny-all policies + revoked grants. So the views themselves return 401.

## Approach

**Move all on-chain work for sponsored claims to the Railway executor.** The edge function shrinks to "validate input + write a DB row." The executor — which already has a battle-tested Solana stack, the platform private key, and connection pooling — picks up the row, funds the escrow, and flips status to `scheduled`. This matches the rest of your architecture (executor handles every other on-chain step).

UX impact: the claim button returns instantly with "Funding in progress…" and the page polls until status flips to `scheduled` (typically a few seconds), then shows the success card. If funding fails, status flips to `cancelled` with an error message.

## Plan

### 1. Database migration

- Add new enum value: `ALTER TYPE launch_status ADD VALUE 'sponsor_pending_funding'`.
- New columns on `launches`:
  - `sponsor_funding_attempts int default 0`
  - `sponsor_funding_error text`
- Recreate the public views **without** `security_invoker` so they bypass the locked-down base tables while still hiding sensitive columns:

```sql
DROP VIEW IF EXISTS public.launches_public CASCADE;
CREATE VIEW public.launches_public AS
SELECT id, token_name, token_symbol, description, image_url,
       twitter_url, telegram_url, website_url,
       token_mint_address, ipfs_metadata_url, escrow_wallet_public_key,
       launch_datetime, min_contribution_lamports, max_contribution_lamports,
       status, created_by_wallet, created_at, platform,
       pumpfun_launch_signature, distribution_completed,
       distribution_completed_at, total_tokens_distributed,
       is_sponsored, sponsored_amount_lamports, claimer_count
FROM public.launches;
GRANT SELECT ON public.launches_public TO anon, authenticated;
```
Same shape for `contributions_public`. Recreate `get_launch_public(uuid)` (CASCADE drops it).

Sensitive columns stay hidden because they're never in the SELECT list, and the base table still denies any direct query.

- Add a new claim RPC for the executor:

```sql
CREATE FUNCTION claim_sponsor_funding_for_worker(p_worker_id text, p_lock_expiry_seconds int default 120)
  RETURNS SETOF launches
  LANGUAGE sql SECURITY DEFINER
AS $$
  UPDATE launches SET worker_locked_at = now(), worker_id = p_worker_id
  WHERE id = (
    SELECT id FROM launches
    WHERE status = 'sponsor_pending_funding'
      AND (worker_locked_at IS NULL OR worker_locked_at < now() - make_interval(secs => p_lock_expiry_seconds))
    ORDER BY created_at ASC
    LIMIT 1 FOR UPDATE SKIP LOCKED
  ) RETURNING *;
$$;
REVOKE EXECUTE ON FUNCTION claim_sponsor_funding_for_worker(text, int) FROM public, anon, authenticated;
```

### 2. Slim down `supabase/functions/claim-sponsored-slot/index.ts`

Remove the `@solana/web3.js` and `bs58` imports entirely. The function now:

1. Validates input + 1–72h window.
2. Looks up the `sponsor_pending` row by token, checks expiry.
3. Generates escrow + mint keypairs (existing inline `crypto.subtle` code — no esm.sh deps).
4. Encrypts both keys with AES-GCM (existing inline code).
5. Uploads metadata JSON to storage (unchanged).
6. Allocates Pump.fun slot under `withScheduleLock` (unchanged).
7. Updates the row with all token fields + `status = 'sponsor_pending_funding'`. **No Solana RPC, no transaction signing.**
8. Returns `{success, launch_id, launch_url, mint_address, adjusted_launch_datetime, was_adjusted, offset_minutes, status: 'sponsor_pending_funding'}`.

### 3. New executor handler `executor/src/fundSponsoredEscrow.ts`

In each poll tick (called from `index.ts` alongside `executeAllPendingLaunches`):

1. `claim_sponsor_funding_for_worker(WORKER_ID)` to lock one row.
2. Decrypt nothing — we just need the `escrow_wallet_public_key` (already plaintext).
3. Build + sign a 0.1 SOL transfer from `ERYS_PLATFORM_PRIVATE_KEY` to the escrow using `@solana/web3.js` (already a dependency on Railway).
4. Send + confirm.
5. On success: update row with `sponsored_tx_signature` and `status = 'scheduled'`.
6. On failure: increment `sponsor_funding_attempts`, write `sponsor_funding_error`. After 3 attempts, set `status = 'cancelled'` so the link can be regenerated.

Reuses existing `executor/src/db.ts` + Solana connection.

### 4. Frontend `src/pages/SponsoredPage.tsx`

After `supabase.functions.invoke("claim-sponsored-slot", …)` returns success:
- Show "Funding your launch…" state with a spinner.
- Poll `get_launch_public(launch_id)` every 2s (max 60s).
  - When `status = 'scheduled'` → show success card (existing UX).
  - When `status = 'cancelled'` → show error: "Funding failed. Please contact support."
  - On timeout → show "Still funding — your launch will appear at /launch/{id} shortly" with a link.

### 5. Mark security finding fixed

After deploy, the homepage and launch page reads work again, no sensitive column is exposed, and the claim flow works end-to-end.

## Files to change

- `supabase/migrations/<new>_sponsor_funding_async_and_views.sql` — enum, columns, recreated views, claim RPC, recreated `get_launch_public`
- `supabase/functions/claim-sponsored-slot/index.ts` — strip web3.js/bs58, remove transaction code, set `sponsor_pending_funding`
- `executor/src/fundSponsoredEscrow.ts` (new) — Solana transfer worker
- `executor/src/index.ts` — call the new handler in the poll loop
- `src/pages/SponsoredPage.tsx` — async funding poll UX
- `src/integrations/supabase/types.ts` — auto-regenerated

## Verification after deploy

1. Homepage `launches_public` queries return 200 with rows.
2. Live contribution feed loads on launch pages.
3. Sponsored claim form: button click → instant "Funding…" state → success card within ~5–10s.
4. Edge function logs show fast boot, no CPU timeout.
5. Executor logs show "Funded sponsored escrow: {signature}".
6. Security scanner stays green — sensitive columns still absent from views; base tables still deny direct anon SELECT.
