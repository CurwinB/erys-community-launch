## What went wrong with launch `682524ef` (Rupper)

Order of operations in `executor/src/launchWithLocalSigning.ts` was:

1. Decrypt keypairs
2. **Charge 0.06 SOL processing fee** → escrow now down to 0.24 SOL
3. Call PumpPortal `/trade-local`
4. PumpPortal returned `400 — Cannot read properties of undefined (reading 'toBuffer')` (a known transient PumpPortal-side bug)
5. `setFailed` → auto-refund kicks in
6. Refund tries to return 0.30 SOL to contributors but escrow only has 0.24 SOL → `partial=1` (one contributor short-changed by ~0.06 SOL)

Two bugs combined:

- The Lightning path (`executePumpfun.ts`) has a **pre-flight PumpPortal health probe** that catches the `toBuffer` 5xx/garbage responses before any funds are committed. The local-signing path (`launchWithLocalSigning.ts`) never got that probe.
- Even if the probe were there, the processing fee is charged **before** the PumpPortal call, so any later failure leaves contributors unable to be made whole.

## Fix

### 1. Port the pre-flight PumpPortal health probe into `launchWithLocalSigning.ts`

Insert the same probe used in `executePumpfun.ts` (POST `/trade-local` with `{action: "create"}`, abort on `>=500` or `toBuffer|undefined` in statusText). Run it **before** any state-changing step (before the processing fee, before BPS persistence). On probe failure call `setFailed` with the diagnostic and return — no funds touched, launch can be retried.

### 2. Reorder: charge the processing fee LAST, only after `/trade-local` + local signing succeed

In `launchWithLocalSigning.ts`, move the `chargeProcessingFee` block from its current position (right after the minimum-pool check) to **immediately before** `connection.sendRawTransaction(signedBytes, …)`. New order:

1. Decrypt keypairs
2. Min-pool check (cancel + refund if < 0.3 SOL)
3. **PumpPortal health probe** (new)
4. Reserve math + `initialBuyLamports` sanity check
5. Persist basis points
6. Call `/trade-local`
7. Deserialize + locally sign
8. **Charge processing fee** (moved here) — also recompute `initialBuyLamports` is NOT needed because the fee is taken out of the post-buy residual; we simply need to ensure escrow has fee + tx fee headroom. Re-check `escrow.getBalance()` ≥ fee + buffer; if not, abort cleanly with full refund still possible
9. `sendRawTransaction`
10. `setLaunched`

This guarantees: if anything from steps 3-7 fails, the processing fee was never taken, and `refundFailedLaunch` can return 100% of contributor SOL.

### 3. Belt-and-suspenders: backstop refund in `refundFailedLaunch.ts` for fee-induced shortfalls

When `refundFailedLaunch` detects `escrowAvailable < sum(contributions)` AND `launch.processing_fee_tx_signature is not null`, log a clear `WARN` line: `"Shortfall caused by already-charged processing fee X lamports — manual treasury reimbursement required for launch <id>"`. Persist a new column `processing_fee_refund_owed_lamports` (bigint, nullable) on the failed launch row so admin tooling can surface it. No on-chain action — treasury wallet refund is a manual op for now (sole admin signer), but the data is recorded.

Migration:
```sql
ALTER TABLE public.launches
  ADD COLUMN processing_fee_refund_owed_lamports bigint;
```

### 4. Surface owed-refund in admin UI

In `src/components/admin/RefundsTab.tsx` (or `AccountingTab.tsx`, whichever lists failed launches), add a column "Fee Refund Owed" showing `processing_fee_refund_owed_lamports / 1e9` SOL when non-null, with a copy-to-clipboard button for the contributor wallet that was short-changed.

## Files

- `executor/src/launchWithLocalSigning.ts` — add probe, reorder fee charge
- `executor/src/refundFailedLaunch.ts` — detect + persist owed-refund
- `supabase/migrations/<ts>_add_processing_fee_refund_owed.sql` — new column
- `src/integrations/supabase/types.ts` — auto-regen
- `src/components/admin/RefundsTab.tsx` (or AccountingTab) — display owed-refund

## Out of scope

- Automatic on-chain treasury → contributor refund of stranded processing fees (deferred; needs treasury private key in executor — separate security review)
- Manual reimbursement for the Rupper launch's short-changed contributor (you said no refund needed now; the new column will be backfilled by the next failure, not retroactively)
- Changing the processing-fee thresholds (already done in prior turn)
