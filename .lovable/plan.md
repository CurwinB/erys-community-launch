## Files touched

1. `fee-claimer/src/index.ts` — remove dead imports.
2. `executor/src/refundFailedLaunch.ts` — convert refund loop from FIFO to proportional.
3. `executor/src/cancelAndRefund.ts` — same conversion.

No other files, no DB schema changes, no changes to retry/confirm helpers, decrypt, or the Pump.fun on-chain skip guard.

---

## 1. `fee-claimer/src/index.ts`

Delete lines 4 and 5:

```ts
import { claimPumpfunFeesBatch } from "./claimPumpfunFeesBatch";
import { claimLocalSigningFeesBatch } from "./claimLocalSigningFees";
```

Leave the explanatory comment inside `pollAndClaimFees` intact (it documents *why* the batch path is disabled, still useful). No other edits.

---

## 2 & 3. Proportional refund algorithm (applied identically to both files)

### Current behavior (FIFO)

Loop iterates contributions in `contributed_at` order. Each one tries to take its full `amount_lamports - TX_FEE` from `escrowAvailable`; once escrow runs dry, remaining contributors get a `refund_shortfall_lamports` row and zero SOL.

### New behavior (proportional)

Replace the single existing loop with a **two-pass** structure:

**Pass 1 — compute the proration ratio (no on-chain calls):**

- Build `eligible: { contrib, requested: bigint }[]` from contributions where:
  - `refund_tx_signature` is null (already-refunded rows skipped, same as today), AND
  - `requested = BigInt(amount_lamports) - TX_FEE > 0n` (sub-fee dust skipped, same as today, counted as `failed`).
- `totalRequested = sum(eligible.requested)`.
- `payoutPool = escrowAvailable - TX_FEE * BigInt(eligible.length)` — reserve one tx fee per refund tx up front so we don't over-promise.
- If `payoutPool <= 0n` or `totalRequested === 0n`: write `refund_shortfall_lamports = Number(requested)` for every eligible contrib, increment `unrecoverable` (refundFailedLaunch) / `failed` (cancelAndRefund), return after logging.
- Otherwise: clamp `effectivePool = min(payoutPool, totalRequested)` so nobody gets more than they put in (handles the rare case where escrow somehow exceeds owed, e.g. stray top-ups).

**Pass 2 — pay each eligible contrib their share:**

For each `{ contrib, requested }` in `eligible`:

```ts
// integer math, floor division — leaves at most ~N lamports of dust in escrow
const payout = (requested * effectivePool) / totalRequested;
const shortfall = requested - payout;
```

- If `payout <= 0n`: persist `refund_shortfall_lamports = Number(requested)`, count as unrecoverable/failed, continue.
- Else: send refund tx via existing `sendRefundWithRetry(...)` (unchanged) for `Number(payout)` lamports, then update row with `refund_tx_signature` + `refund_shortfall_lamports = Number(shortfall)`. Increment `refunded`; if `shortfall > 0n` increment `partial`.
- On thrown error from send/confirm: increment `failed`, do not mutate `effectivePool` (the reserved TX_FEE is simply unused — safe).
- Do **not** subtract from a running balance between iterations — the proration was decided up-front, so a later send failure doesn't redistribute leftover SOL to earlier contributors. This keeps refunds idempotent and re-runnable: re-invoking the function will recompute proration over the still-unrefunded set against current escrow balance.

### Recipient address

- `refundFailedLaunch.ts`: keeps `new PublicKey(contrib.wallet_address)` (unchanged).
- `cancelAndRefund.ts`: keeps `new PublicKey(contrib.token_delivery_wallet || contrib.wallet_address)` (unchanged).

### Counters & logging

Same final summary log lines as today (`refunded / partial / unrecoverable / failed / total` for refundFailedLaunch; `refunded / partial / failed / total` for cancelAndRefund). The post-loop processing-fee shortfall warning block in `refundFailedLaunch.ts` is untouched.

### Things explicitly not changing

- `RENT_EXEMPT_RESERVE` and `TX_FEE` constants.
- Pump.fun on-chain mint guard at the top of `refundFailedLaunch.ts`.
- The `cancelled` status update + worker-lock clear at the top of `cancelAndRefund.ts`.
- `sendRefundWithRetry` and `sleep` helpers.
- DB schema, RLS, migrations.
- Sponsored escrow sweep worker (still runs separately for any leftover dust).

### Risks / notes

- Floor-division dust (≤ N lamports across N contributors, well under 1 cent) stays in escrow and is later swept by `sweepCancelledSponsorEscrows` for sponsored cancels, or remains as residual dust for organic-fail launches (same fate as today's leftover rent).
- Proration is computed against `escrowAvailable` *at function entry*. If the function is re-run later (e.g. after a transient RPC failure), only still-unrefunded rows participate, and the new proration is computed against the then-current balance — correct behavior.
- A contributor whose individual `payout` rounds to `0n` (only possible if `requested * effectivePool < totalRequested`, i.e. extreme dilution) will be marked fully unrecoverable rather than getting a 1-lamport tx. Acceptable.
