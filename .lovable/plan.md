## Problem recap

`handleContribute` signs and sends SOL to escrow **before** the `contribute` edge function validates anything. Any server-side rejection (under 0.1 SOL, window closed, status not `scheduled`, signer/amount mismatch, RPC slow to confirm, duplicate tx) leaves SOL stranded on-chain with no DB row. The UI's "Total Escrow" reads from the `contributions` table sum, so stranded SOL is invisible.

## Fix — three changes, one PR

### 1. Pre-flight validation edge function (prevents stranding)

New edge function: `supabase/functions/validate-contribution/index.ts`.

Runs every check `contribute` does, except the on-chain tx verification:
- `launch_id` exists
- `status === 'scheduled'`
- `launch_datetime > now() + 5min`
- `amount_lamports >= 100_000_000` (0.1 SOL platform floor)
- `token_delivery_wallet` format if provided
- `wallet_address` format

Returns `{ ok: true }` on 200 or `{ error: "<human message>" }` on 400/404.

**Client change** in `src/pages/LaunchPage.tsx` `handleContribute`:
1. Keep the existing client-side `< 0.1 SOL` early toast (cheap UX win).
2. **Before** building the tx, call `supabase.functions.invoke("validate-contribution", …)`. On error, show the same status-aware toast we already added and return — no wallet popup.
3. Only on `{ ok: true }` proceed to sign/send and then call `contribute`.

This closes ~all stranding paths because the only failures left at the `contribute` step are:
- RPC hasn't confirmed yet (handled with retry — already in `contribute`)
- Signer/amount mismatch (impossible if client built the tx correctly)
- Race: launch flipped to `executing` between validate and confirm (rare; covered by #3)

### 2. Show on-chain escrow balance, not DB sum

In `LaunchPage.tsx`:
- Add a React Query (`["escrowBalance", launch.escrow_wallet_public_key]`, `refetchInterval: 30s`) that calls `connection.getBalance(escrow_wallet_public_key)` via the existing `VITE_SOLANA_RPC_URL`.
- Pass the on-chain lamports to `LaunchStats` as the source of truth for "Total Escrow". Keep the contributor count from the DB (still accurate for "N apes").
- If on-chain > DB sum, show a small muted note: `"X.XX SOL pending confirmation"` (the diff). Disappears once `contribute` catches up.

No backend changes required for this part.

### 3. Auto-recovery for stranded SOL (safety net)

Modify `supabase/functions/contribute/index.ts`: when the on-chain tx **is verified successfully** but a downstream validation rule fails (e.g. status flipped to `executing`, window closed by the time we got here), instead of just returning 400 and leaving SOL stranded:

1. Insert the contribution row anyway with `refund_shortfall_lamports = 0` and a new flag `pending_orphan_refund = true` (new column on `contributions`, default `false`).
2. Return `{ error, queued_for_refund: true }` so the UI can say "Your SOL was returned to a refund queue."

A new lightweight worker pass in the existing executor (`refundFailedLaunch`-style) picks up rows where `pending_orphan_refund = true` and refunds them using the same path as `cancelAndRefund`.

DB migration:
```sql
ALTER TABLE public.contributions
  ADD COLUMN pending_orphan_refund boolean NOT NULL DEFAULT false;
```

The existing `< 0.1 SOL` case never gets here because validate-contribution catches it client-side before signing — so this only fires for true races.

## Files touched

- `supabase/functions/validate-contribution/index.ts` (new)
- `supabase/functions/contribute/index.ts` (orphan-refund branch)
- `supabase/migrations/<ts>_add_pending_orphan_refund.sql` (new column)
- `src/pages/LaunchPage.tsx` (pre-flight call + escrow balance query)
- `src/components/launch/LaunchStats.tsx` (accept `onChainLamports` prop, optional pending diff)
- `executor/src/index.ts` + new `executor/src/refundOrphanContributions.ts` (sweep loop)

## Out of scope (per your call)

- Refunding the specific stuck SOL from your earlier test.
- Rate limiting on validate-contribution.
- Per-launch creator min/max (not currently in schema).
