

# Fix refund to respect rent floor + escrow shortfall

## Problem

`refund-contributor` and `refund-launch` both compute the payout as `contribution.amount_lamports - 5_000` and assume the escrow can cover it. They never read the escrow's live balance and never reserve the **rent-exempt minimum** (~890,880 lamports). When the escrow is short — e.g. launch `ccf4b49d…` where ~0.1 SOL was burned by the failed Bags execution before refunds started — the Solana runtime aborts simulation with `insufficient funds for rent` (the error in the screenshot).

There's also no DB visibility into shortfalls: today the only signals are `refund_tx_signature` set / null. An admin can't tell "fully refunded" from "partially refunded due to shortfall" from "not refunded yet."

## Fix

### 1. `supabase/functions/refund-contributor/index.ts`

- Before building the tx, fetch `connection.getBalance(escrowKeypair.publicKey)`.
- Define `RENT_EXEMPT_RESERVE = 890_880n` and `TX_FEE = 5_000n` constants.
- Compute:
  ```
  requested  = contribution.amount_lamports - TX_FEE
  available  = escrowBalance - RENT_EXEMPT_RESERVE - TX_FEE
  payout     = min(requested, available)
  ```
- If `payout <= 0`: return a structured `{ error: "Escrow is depleted; nothing recoverable", escrowBalance, requested }` with HTTP 200 and do NOT mark the contribution refunded.
- If `payout < requested`: send the partial refund, then on success persist:
  - `refund_tx_signature` = signature
  - `refund_shortfall_lamports` = `requested - payout` (new column, see migration below)
  - Return `{ success: true, partial: true, txSignature, refundedLamports, shortfallLamports }` so the UI can show "partial refund" instead of a generic success.
- If `payout === requested`: existing happy path, but also write `refund_shortfall_lamports = 0` for consistency.

### 2. `supabase/functions/refund-launch/index.ts`

- Same balance check and `RENT_EXEMPT_RESERVE` constant.
- Loop over contributions in **deposit order** (`order by contributed_at asc`) — earliest contributors get whole refunds first; later ones absorb the shortfall. This is more defensible than pro-rata for a small platform and matches typical waterfall semantics.
- Track `escrowAvailable` locally; decrement by `payout + TX_FEE` after each successful send so we don't re-query the chain per contribution.
- When `escrowAvailable` drops below the next contribution's request, do the partial-refund path (mark `refund_shortfall_lamports`); when it can't cover even rent, mark remaining contributions with `refund_shortfall_lamports = requested` and skip sending.
- Return summary including `partial`, `unrecoverable`, and per-wallet shortfall list so the admin sees exactly what happened.

### 3. DB migration

Add one nullable column to `contributions`:

```
alter table public.contributions
  add column refund_shortfall_lamports bigint default 0;
```

No backfill needed (default `0` is correct for already-refunded rows in normal-balance escrows; the one already-refunded contribution on `ccf4b49d…` was full so `0` is accurate).

### 4. Admin UI surfacing (`src/components/admin/RefundsTab.tsx`)

- Show a "Shortfall" column when `refund_shortfall_lamports > 0` (formatted in SOL).
- Add a per-launch banner when `escrowBalance < sum(unrefunded contributions)`: "Escrow is short by X SOL — refunds will be partial." Computed client-side from the balance returned by a new lightweight `get-escrow-balance` view? No — keep it simple: surface the shortfall **after** a refund attempt via the response payload, no new endpoint needed.
- Toast copy on partial: "Refunded X SOL — Y SOL unrecoverable due to escrow shortfall."

### 5. Out of scope (flagged, not done)

- **Top-up model**: making the platform wallet (`ERYS_PLATFORM_PRIVATE_KEY`) cover execution costs so contributor SOL is never burned by failed launches. This is the right long-term fix but is a bigger architectural change (executor needs to fund the escrow before chain ops, or use the platform wallet as fee-payer for mint/metadata). Calling it out so we don't lose it.
- **Recovering the 0.1 SOL** already lost on `ccf4b49d…` for contributor `62aKW…baV` — there is no on-chain path to recover it; the only options are (a) accept the loss and refund what's available (this fix enables that), or (b) manually top up the escrow from the platform wallet before running the refund. I recommend (b) for this one user since it's a $-small test — say the word and I'll add a one-shot script.

## Files edited

- `supabase/functions/refund-contributor/index.ts`
- `supabase/functions/refund-launch/index.ts`
- `src/components/admin/RefundsTab.tsx`
- new migration: add `refund_shortfall_lamports` to `contributions`

