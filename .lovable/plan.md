## Two changes, applied as one batch

Two corrections to your prompts before I write code — both would have broken things.

### Correction A: escrow key decoding bug in proposed cancelAndRefund.ts

Your snippet does `decryptEscrowKey(...).toString("utf8")` then re-decodes hex. That's wrong. `decryptEscrowKey` already returns the raw 64-byte secret key as a Buffer (see `executor/src/decrypt.ts` line 23). Existing files do `Keypair.fromSecretKey(new Uint8Array(escrowSecret))` directly. I'll mirror that pattern — no utf8/hex round-trip.

### Correction B: contribute/index.ts already reads `min_contribution_lamports` from the launch row

There's no per-request min coming from the client. I'll just hardcode the constant in the check and skip the launch-row lookup of that field. The DB column stays (existing rows have it set) but new launches all write `100_000_000`.

---

### Change 1 — Platform-enforced 0.1 SOL min, remove creator-set min/max

Files:
- `src/pages/SchedulePage.tsx` — remove min-contribution input, max-contribution toggle + input, `minContribution` and `enableMaxContribution`/`maxContribution` from form state. Hardcode `100_000_000` in the create-launch payload (or omit and let edge function default it).
- `supabase/functions/create-launch/index.ts` — drop `min_contribution_lamports` / `max_contribution_lamports` from body destructuring; insert `min_contribution_lamports: 100_000_000` and `max_contribution_lamports: null` always.
- `supabase/functions/create-launch-pumpfun/index.ts` — same treatment.
- `supabase/functions/contribute/index.ts` — replace the launch-row min/max check with:
  ```ts
  const PLATFORM_MIN_CONTRIBUTION = 100_000_000;
  if (amount < PLATFORM_MIN_CONTRIBUTION) return errorResponse(...);
  ```
  Drop the max check entirely.
- `src/pages/LaunchPage.tsx` — replace `formatSol(Number(launch.min_contribution_lamports))` with literal `0.1`. Remove `maxContrib` derivation and any UI using it.

### Change 2 — Auto-cancel + waterfall refund below 0.3 SOL pool

New file `executor/src/cancelAndRefund.ts`:
- Connection + decrypt escrow key the *correct* way (`new Uint8Array(decryptEscrowKey(...))`).
- Mark launch `status='cancelled'`, set `execution_error`, clear worker lock.
- Track `escrowAvailable` locally minus `RENT_EXEMPT_RESERVE` (890_880n) — same pattern as `refundFailedLaunch.ts` — so we don't drain rent.
- Use `sendRefundWithRetry` helper (copy the proven one from `refundFailedLaunch.ts` — handles blockhash expiry, signature recovery on confirm timeout). Do **not** use the naive single-shot `sendRawTransaction` from your snippet; it produced silent failures we already fixed in the existing refund path.
- Waterfall:
  1. Regular contributors first (exclude `created_by_wallet`, exclude rows where `wallet_address === BAGS_PARTNER_WALLET` for sponsored seed). Pro-rata down if `escrowAvailable` runs short, recording `refund_shortfall_lamports`.
  2. Creator's contribution row (if they apéd in) refunded next.
  3. Sponsored seed: send remainder up to `sponsored_amount_lamports - TX_FEE` to `BAGS_PARTNER_WALLET`. Sweep mechanic in `sweepCancelledSponsorEscrows.ts` already handles dust + sets `sponsor_recovery_*` columns, so we can either (a) let it pick up the cancelled row afterward, or (b) call the same logic inline. **I'll go with (a)** — write `status='cancelled'` and let the existing sweeper recover the seed. Less duplicated code, already battle-tested.
- Token-delivery-wallet preference: refund to `token_delivery_wallet ?? wallet_address`. Matches token distribution behavior.

Modified `executor/src/executeBags.ts` and `executor/src/executePumpfun.ts`:
- After contributions are loaded and `totalLamports` summed, before any on-chain work, fee charging, or Bags API calls:
  ```ts
  const MINIMUM_POOL_LAMPORTS = 300_000_000n;
  if (totalLamports < MINIMUM_POOL_LAMPORTS) {
    await cancelAndRefund(launch, contributions);
    return;
  }
  ```
- Place this **before** `chargeProcessingFee` (don't charge fee on a cancelled raise) and **before** any Bags `create-token-info` / Pump.fun mint (don't burn an IPFS upload on a doomed launch).

Modified `executor/src/db.ts`:
- Add to `Launch` interface: `is_sponsored: boolean | null;` and `sponsored_amount_lamports: number | null;` and `created_by_wallet` (already there). Add to `Contribution` interface: `wallet_address` (already there) and confirm `token_delivery_wallet` (already there).

### Out of scope / explicitly not touching

- `executor/src/executePumpfunLightning.ts` — same flag as last round; user said "two execute files" so leaving lightning alone. **Note for follow-up**: lightning path will also skip the cancel check until added.
- `refund-launch` edge function — handles creator-initiated cancel of `scheduled` launches, separate flow. Already has its own waterfall logic.
- DB schema — no migration. `min_contribution_lamports` column kept for backward-compat with existing rows.
- Admin UI surfaces showing min/max — I'll search and remove any read sites that break (LaunchCard, admin tables).

### Risks acknowledged

- **Refund gas:** 100 contributors × ~0.000005 SOL tx fee = 0.0005 SOL. On a 0.299 SOL pool, refund cost is negligible vs. pool but contributors take a 5_000 lamport haircut each (already standard in `refundFailedLaunch`).
- **Status enum:** `cancelled` already exists in the launch_status enum (memory confirms).
- **Idempotency:** if executor re-claims the row after partial refund, the `refund_tx_signature IS NOT NULL` check skips already-refunded contribs (same as existing path).
- **0.1 SOL floor + 0.3 raise = 3 wallets minimum** to clear threshold. You confirmed this is intentional.

Approve and I'll ship both prompts in one edit pass.