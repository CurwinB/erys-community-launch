# Tiered processing fee

Add a second, higher processing-fee tier so launches that raise ≥ 2 SOL pay a 0.13 SOL platform fee instead of the existing 0.06 SOL fee. Launches < 0.3 SOL still pay nothing. The fee remains hidden, debited from escrow → treasury just before the launch tx, and contributor BPS math is unchanged.

| Total raised | Fee (this PR) |
|---|---|
| < 0.3 SOL | 0 |
| ≥ 0.3 and < 2 SOL | 0.06 SOL |
| ≥ 2 SOL | 0.13 SOL |

## Files changed

### 1. `executor/src/processingFee.ts` (primary)

- Replace the single `PROCESSING_FEE_LAMPORTS` / `PROCESSING_FEE_THRESHOLD` constants with the four-constant tiered set:
  - `PROCESSING_FEE_THRESHOLD_LOW = 300_000_000n`
  - `PROCESSING_FEE_THRESHOLD_HIGH = 2_000_000_000n`
  - `PROCESSING_FEE_LOW = 60_000_000n`
  - `PROCESSING_FEE_HIGH = 130_000_000n`
  - keep `PROCESSING_FEE_TX_FEE = 5_000n` (renamed in the user prompt to `PROCESSING_FEE_TX_COST`; we keep current name to avoid touching nothing-else, OR rename — pick one; plan: keep `PROCESSING_FEE_TX_FEE`).
- Add `getProcessingFeeLamports(totalLamports: bigint): bigint` returning `PROCESSING_FEE_HIGH`, `PROCESSING_FEE_LOW`, or `0n`.
- `shouldChargeProcessingFee` now compares against `PROCESSING_FEE_THRESHOLD_LOW`.
- Update `chargeProcessingFee` signature to add `totalLamports: bigint` as a **new required parameter**, while keeping the existing `existingSignature?: string | null` idempotency param. Final signature:
  ```ts
  chargeProcessingFee(
    connection, escrowKeypair, treasuryWallet, launchId,
    totalLamports, existingSignature?
  )
  ```
- Inside `chargeProcessingFee`:
  - Compute `feeLamports = getProcessingFeeLamports(totalLamports)`. If `0n`, return `{ charged: false }`.
  - Replace every hardcoded `PROCESSING_FEE_LAMPORTS` reference (idempotency return, transferAmount, log line, all three success returns) with the dynamic `feeLamports`.
  - `transferAmount = feeLamports - PROCESSING_FEE_TX_FEE`.
- Update the file-level comment block to describe the two tiers.

### 2. `executor/src/executeBags.ts`

Update the single `chargeProcessingFee(...)` call (around line 419) to pass `totalLamports` before the existing-signature arg:
```ts
const feeResult = await chargeProcessingFee(
  connection,
  escrowKeypair,
  BAGS_PARTNER_WALLET,
  launch.id,
  totalLamports,
  (launch as any).processing_fee_tx_signature ?? null,
);
```

### 3. `executor/src/executePumpfunLightning.ts`

Same change at the call site around line 136 (TREASURY_WALLET). Note: the user's prompt referenced `executePumpfun.ts`, but the active Pump.fun caller is `executePumpfunLightning.ts`. The legacy `executePumpfun.ts` does **not** call `chargeProcessingFee`, so it needs no change.

## Notes

- Idempotency preserved: the `findAlreadyPaidProcessingFee` early-return still uses `feeLamports` (the new tier value) for `feeLamports` in the result. If a previous attempt at a lower tier already landed on-chain, the function returns it as-is — we will not double-charge to "top up" to the new tier. This is the correct behavior (we already debited the user; we don't second-debit on retry).
- No DB schema changes. `processing_fee_lamports` already stores whatever amount was charged.
- No env vars, no frontend changes.
- Existing `PROCESSING_FEE_LAMPORTS` export is removed; ripgrep confirms it has no external importers.
