## What happened

Sponsored launch `ac19ded6-343b-4c17-b768-1d0ee55e5a3d` was cancelled because contributions (0.099995 SOL) didn't meet the 0.3 SOL minimum pool. On-chain trail of escrow `A7totkC3tRv8ub6tVXDdcHQoz9C856CDw6iJz4f5nEyi`:

```
+ 0.099995 SOL  from platform (sponsor seed AMfWsZZGV...)   ← should return to platform
+ 0.099995 SOL  from contributor F46Ai...                   ← should return to contributor
- 0.099099 SOL  refunded to contributor F46Ai...            ← contributor got BOTH
   0.000890 SOL rent dust left in escrow
```

The contributor walked away with ~0.198 SOL (their own contribution + the entire 0.1 SOL platform sponsorship). Then `sweepCancelledSponsorEscrows` ran, saw the escrow at rent reserve, and marked recovery complete with `amount=0` — so the platform thinks everything is fine.

## Root cause

`executor/src/cancelAndRefund.ts` computes `escrowAvailable = balance - RENT_EXEMPT_RESERVE` and pays each contributor `min(requested, escrowAvailable - TX_FEE)`. The comment claims "Sponsored seed is left in the escrow for sweepCancelledSponsorEscrows.ts to recover... after contributor refunds drain the rest" — but the math doesn't reserve it. If the escrow holds (sponsor seed + contributions) and a contributor's `requested` exceeds their own deposit, the refund pulls from the sponsor seed too. Then the sweep worker finds an empty escrow and records nothing.

In this case the contributor's `requested` (0.099995 - 0.000005 fee = 0.09999 SOL) was less than `escrowAvailable` (~0.19909 SOL), so the refund paid the full requested amount — which is correct per-contributor — but `escrowAvailable` was double-counted because the sponsor seed was never carved out.

## Fix

### 1. `executor/src/cancelAndRefund.ts` — carve out sponsor seed before refunds

When `launch.is_sponsored && launch.sponsored_amount_lamports > 0`, subtract it from `escrowAvailable` up front so refunds can only draw from contributor SOL:

```ts
let escrowAvailable = BigInt(balance) - RENT_EXEMPT_RESERVE;
const sponsorSeed = launch.is_sponsored
  ? BigInt(launch.sponsored_amount_lamports || 0)
  : 0n;
// Reserve sponsor seed for sweepCancelledSponsorEscrows recovery.
escrowAvailable = escrowAvailable > sponsorSeed
  ? escrowAvailable - sponsorSeed
  : 0n;
```

This guarantees the sweep worker has the full sponsor seed (minus fees consumed during refund txs, which is already the existing tradeoff) to recover to the treasury. Contributors with un-refundable shortfalls get tracked in `refund_shortfall_lamports` exactly like today.

### 2. Manual recovery for launch `ac19ded6…`

The 0.1 SOL is gone to the contributor wallet `F46AiunPJYzAZp1WysKNcPy7RphztugX6Zu9Lev69BEK`. Options to surface in chat after the code fix lands:

- (a) Accept the loss as a one-off and document it.
- (b) Reach out to that wallet's owner (the influencer/contributor) for a manual return.

No on-chain clawback is possible. I'll ask which path you want when we apply the fix.

### 3. Optional hardening (call out, don't necessarily implement now)

- `sweepCancelledSponsorEscrows.ts` could log a warning when the cancelled-sponsor escrow balance is below `sponsored_amount_lamports - small_buffer` so future leaks are detected immediately rather than silently marked complete.

## Files to edit

- `executor/src/cancelAndRefund.ts` — add sponsor-seed reservation.
- (optional) `executor/src/sweepCancelledSponsorEscrows.ts` — add leak warning.

No DB migration, no edge-function changes.
