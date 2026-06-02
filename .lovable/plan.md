## Change

Replace the existing two-tier processing fee in `executor/src/processingFee.ts` with a single universal **7% of total raised**.

### Before
- `< 0.3 SOL` → 0
- `0.3–1.0 SOL` → 0.06 SOL flat
- `≥ 1.0 SOL` → 7%

### After
- All executing launches → **7% of total raised**

The 0.3 SOL minimum-raise threshold lives elsewhere (refund/cancel path); launches that don't meet it never reach this code, so no extra floor is needed here.

## File edits

**`executor/src/processingFee.ts`**

1. Remove the tier constants `PROCESSING_FEE_THRESHOLD_LOW`, `PROCESSING_FEE_THRESHOLD_HIGH`, `PROCESSING_FEE_LOW`. Keep a single exported `PROCESSING_FEE_PERCENT = 7n`.
2. Update the file-header comment to describe the flat-7% behavior.
3. Simplify `getProcessingFeeLamports(totalLamports)` to `totalLamports * 7n / 100n`, returning `0n` if the result wouldn't cover the 5 000-lamport transfer cost (safety floor for dust launches).
4. Update `shouldChargeProcessingFee` to delegate to `getProcessingFeeLamports(...) > 0n`.

No other files change. `chargeProcessingFee()`, idempotency via `processing_fee_tx_signature`, retry logic, and DB columns all stay as-is.

## Notes

- Existing launches with `processing_fee_lamports = 60_000_000` keep their historical value (column is just a record of what was charged).
- New launches in the 0.3–1.0 SOL range will now be charged ~0.021–0.07 SOL instead of the previous 0.06 SOL flat — slightly cheaper at the low end of that band, slightly more at the top.
- New launches under 0.3 SOL still pay nothing in practice, since the raise-minimum gate cancels them before execute.
