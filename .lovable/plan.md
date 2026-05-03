## Plan: Two independent fixes to processing-fee logic

Both changes are scoped, single-file, and have no DB/edge-function impact.

---

### Fix 1 — Charge processing fee on Pump.fun launches

**File:** `executor/src/executePumpfun.ts`

Currently `chargeProcessingFee` is never called for Pump.fun, so launches ≥ 0.3 SOL skip the platform fee. Mirror the exact pattern used in `executeBags.ts` (lines 416–452, 463–474).

Steps inside `executePumpfunLaunch`, applied **after** `totalLamports` is computed and **before** the `ATA_COST` reserve math:

1. **Add imports** at the top:
   ```ts
   import { Connection } from "@solana/web3.js";
   import { supabase } from "./db";
   import { shouldChargeProcessingFee, chargeProcessingFee } from "./processingFee";
   ```
   (`supabase` and `Connection` are not currently imported in this file.)

2. **Construct a Connection** (this file currently talks to RPC only via raw `fetch`; `chargeProcessingFee` needs a `Connection` object). Place near the top of the function:
   ```ts
   const connection = new Connection(SOLANA_RPC_URL, "confirmed");
   ```

3. **Charge the fee** after `totalLamports` is summed:
   ```ts
   let processingFeeLamports = 0n;
   if (shouldChargeProcessingFee(totalLamports)) {
     try {
       const feeResult = await chargeProcessingFee(
         connection,
         escrowKeypair,
         process.env.BAGS_PARTNER_WALLET!, // shared treasury, same as Bags
         launch.id,
         totalLamports,
         (launch as any).processing_fee_tx_signature ?? null,
       );
       if (feeResult.charged) {
         processingFeeLamports = feeResult.feeLamports!;
         await supabase
           .from("launches")
           .update({
             processing_fee_lamports: Number(processingFeeLamports),
             processing_fee_tx_signature: feeResult.signature ?? null,
           })
           .eq("id", launch.id);
       }
     } catch (feeErr: any) {
       await setFailed(launch.id, `Processing fee transfer failed: ${feeErr?.message ?? feeErr}`);
       return;
     }
   }
   const availableLamports = totalLamports - processingFeeLamports;
   ```

4. **Use `availableLamports`** in the existing reserve math (replace `totalLamports` only in this one spot):
   ```ts
   const initialBuyLamports = availableLamports - ataReserve - PRIORITY_FEE;
   ```

5. **Leave basis-point storage unchanged** — the `storeBasisPoints` loop must keep using `totalLamports` so contributors are not penalized in their token-distribution share. Already correct in current code.

**Out of scope for this fix:**
- `executePumpfunLightning.ts` — separate file, separate flow. Flag for follow-up but do not touch per user instruction ("one file only").
- DB schema — `processing_fee_lamports` / `processing_fee_tx_signature` columns already exist (used by Bags path).
- Idempotency — `chargeProcessingFee` already handles this via `existingSignature`.

---

### Fix 2 — Smooth fee tiers (remove 5 SOL cliff)

**File:** `executor/src/processingFee.ts`

Replace the three-tier structure with two tiers: flat below 2 SOL, percentage at and above.

1. **Update header comment block** (lines 11–18) to:
   ```
   //   total >= 2.0 SOL  -> 5% of total
   //   total >= 0.3 SOL  -> 0.06 SOL
   //   total <  0.3 SOL  -> 0
   ```

2. **Remove constants:** `PROCESSING_FEE_THRESHOLD_MID`, `PROCESSING_FEE_MID`. Rename `PROCESSING_FEE_THRESHOLD_HIGH` value from `5_000_000_000n` (5 SOL) to `2_000_000_000n` (2 SOL).
   ```ts
   export const PROCESSING_FEE_THRESHOLD_LOW  = 300_000_000n;   // 0.3 SOL
   export const PROCESSING_FEE_THRESHOLD_HIGH = 2_000_000_000n; // 2.0 SOL
   export const PROCESSING_FEE_LOW  = 60_000_000n;              // 0.06 SOL flat
   export const PROCESSING_FEE_HIGH_PERCENT = 5n;               // 5% above 2 SOL
   ```

3. **Simplify `getProcessingFeeLamports`:**
   ```ts
   export function getProcessingFeeLamports(totalLamports: bigint): bigint {
     if (totalLamports >= PROCESSING_FEE_THRESHOLD_HIGH) {
       return (totalLamports * PROCESSING_FEE_HIGH_PERCENT) / 100n;
     }
     if (totalLamports >= PROCESSING_FEE_THRESHOLD_LOW) {
       return PROCESSING_FEE_LOW;
     }
     return 0n;
   }
   ```

**Verification (`rg`):** `PROCESSING_FEE_MID` and `PROCESSING_FEE_THRESHOLD_MID` are referenced only inside `processingFee.ts`, so removal is safe. `PROCESSING_FEE_THRESHOLD_HIGH` is also only referenced in this file.

**Resulting tier table:**

| Total raised | Fee |
|---|---|
| ≥ 2 SOL | 5% of total |
| 0.3 – 1.99 SOL | 0.06 SOL flat |
| < 0.3 SOL | 0 |

Remaining boundary jump: at exactly 2.00 SOL, fee jumps from 0.06 → 0.10 SOL (a 0.04 SOL bump for hitting the 2 SOL mark). Smaller than the prior 0.12 SOL cliff but still present. Acceptable per user spec; can be further smoothed later if needed.

---

### Order of application

Fixes are independent and can be applied in either order. I'll do Fix 1 first (Pump.fun parity) then Fix 2 (tier smoothing) so each commit is reviewable on its own.

### Out of scope (both fixes)

- `executePumpfunLightning.ts`
- `refundProcessingFee.ts` — refund logic reads `processing_fee_lamports` from the DB row, not from `getProcessingFeeLamports`, so tier changes don't break historical refunds.
- UI / admin panels — fee is hidden, no surface displays the tier table.

Approve and I'll apply both edits.