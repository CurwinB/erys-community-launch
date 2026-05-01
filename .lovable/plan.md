# Add third processing fee tier

Single-file change to `executor/src/processingFee.ts`. No other files touched. No DB, edge-function, or UI changes.

## New tier ladder

| Total raised | Processing fee |
|---|---|
| ≥ 5 SOL | 0.20 SOL |
| ≥ 2 SOL | 0.13 SOL |
| ≥ 0.3 SOL | 0.06 SOL |
| < 0.3 SOL | 0 |

## Changes inside `executor/src/processingFee.ts`

### 1. Update the tier comment block at the top of the file

Replace the existing 3-line tier table in the header comment to document all three tiers (≥5 / ≥2 / ≥0.3 / <0.3).

### 2. Replace the threshold + fee constants

Rename the current `_HIGH` constants to `_MID` (their values stay 2 SOL / 0.13 SOL), and add new `_HIGH` constants for the 5 SOL / 0.20 SOL tier:

```ts
export const PROCESSING_FEE_THRESHOLD_LOW  = 300_000_000n;    // 0.3 SOL
export const PROCESSING_FEE_THRESHOLD_MID  = 2_000_000_000n;  // 2 SOL
export const PROCESSING_FEE_THRESHOLD_HIGH = 5_000_000_000n;  // 5 SOL

export const PROCESSING_FEE_LOW  = 60_000_000n;   // 0.06 SOL
export const PROCESSING_FEE_MID  = 130_000_000n;  // 0.13 SOL
export const PROCESSING_FEE_HIGH = 200_000_000n;  // 0.20 SOL
```

`PROCESSING_FEE_TX_FEE = 5_000n` is kept as-is (already named this way and referenced inside `chargeProcessingFee`; the prompt's `PROCESSING_FEE_TX_COST` appears to be a typo — keeping the existing name avoids breaking the internal `feeLamports - PROCESSING_FEE_TX_FEE` math).

### 3. Update `getProcessingFeeLamports` to a 3-tier ladder

```ts
export function getProcessingFeeLamports(totalLamports: bigint): bigint {
  if (totalLamports >= PROCESSING_FEE_THRESHOLD_HIGH) return PROCESSING_FEE_HIGH;
  if (totalLamports >= PROCESSING_FEE_THRESHOLD_MID)  return PROCESSING_FEE_MID;
  if (totalLamports >= PROCESSING_FEE_THRESHOLD_LOW)  return PROCESSING_FEE_LOW;
  return 0n;
}
```

### 4. Leave everything else untouched

- `shouldChargeProcessingFee` — still keys off `PROCESSING_FEE_THRESHOLD_LOW`, semantics unchanged (any raise ≥ 0.3 SOL gets charged).
- `findAlreadyPaidProcessingFee` — unchanged.
- `chargeProcessingFee` — unchanged (still reads the fee via `getProcessingFeeLamports`, so it automatically picks up the new tier).
- `waitForSignatureLanded` and all retry/recovery logic — unchanged.
- All callers in `executor/src/executeBags.ts` and `executor/src/executePumpfun.ts` — unchanged.

## Behavior impact

- Launches raising **2 – 4.999… SOL**: fee stays at **0.13 SOL** (was previously the top tier at 2+ SOL — now correctly capped at MID).
- Launches raising **≥ 5 SOL**: fee jumps to **0.20 SOL** (new tier).
- Launches < 2 SOL: no behavior change.

## Pre-flight check before editing

Grep the repo for external imports of `PROCESSING_FEE_THRESHOLD_HIGH` / `PROCESSING_FEE_HIGH`. The prompt asserts no caller uses them, but since their numeric meaning shifts (2→5 SOL, 0.13→0.20 SOL), I'll confirm with `rg` first. If any external file imports them by name, I'll surface that rather than silently change their semantics.

## Risks

- None to existing flows: the only public surface that changes value is `getProcessingFeeLamports`, which is the intended behavior change. Idempotency via `findAlreadyPaidProcessingFee` is unaffected.
