## Problem

The homepage cards show 0 contributors / 0 SOL, and the launch page's "Recent Apes" feed is empty. Both screens query the `contributions_public` view, which returns nothing.

Root cause is in the security migration shipped earlier today (`20260505112409_...sql`):

- `contributions_public` was switched to `security_invoker = on`, so Postgres now checks the **caller's** privileges on the underlying `public.contributions` table.
- `public.contributions` has RLS policy `"No direct browser access to contributions"` with `USING (false)` for `public`, AND `anon`/`authenticated` have no column-level `SELECT` grants.
- Net effect: anon users can read the view's definition but get zero rows.

This was never the intent — the view exists precisely to expose the safe public columns (`id, launch_id, wallet_address, amount_lamports, contributed_at`). The sensitive columns (tx signatures, encrypted keys, distribution errors, basis points, refund details, delivery wallets, etc.) are excluded by the view and stay protected.

Wallet address is a public Solana pubkey already visible on-chain for every contribution tx — exposing it is consistent with how every Solana explorer works and is required for the "Recent Apes" UX.

## Fix

Mirror the same pattern that was just applied to `launches`:

1. Replace the deny-all SELECT policy on `contributions` with a permissive policy for `anon` + `authenticated`, gated by column-level grants.
2. Revoke blanket `SELECT` on `public.contributions` from `anon` and `authenticated`.
3. Grant `SELECT` only on the five safe columns the view exposes:
   - `id, launch_id, wallet_address, amount_lamports, contributed_at`
   - Plus `refund_tx_signature` because the view's `WHERE refund_tx_signature IS NULL` filter must be evaluable by the caller under `security_invoker`.
4. Keep `contributions_public` as `security_invoker = on` (no linter regression).
5. Service role policies for INSERT/UPDATE stay untouched; no DELETE remains possible.

## Files

- New migration: `supabase/migrations/<timestamp>_restore_contributions_public_read.sql`
- No frontend changes needed — `Index.tsx`, `LaunchPage.tsx`, and `ContributionFeed.tsx` already query `contributions_public` correctly.

## Out of scope / not changed

- Sensitive columns on `contributions` (signatures, basis points, token amounts, distribution/refund metadata, delivery wallets, fee-claimer flag) remain inaccessible to anon — only the view's 5 safe columns become readable.
- Admin queries continue to use service role and are unaffected.
- Security memory will be updated to record that wallet_address + amount on `contributions_public` is intentionally public, so future scans don't re-flag it.
