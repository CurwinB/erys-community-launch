## Plan: Make high-tier processing fee percentage-based

Single-file change to `executor/src/processingFee.ts`. Verified via `rg`: `PROCESSING_FEE_HIGH` is only referenced inside this file, so removal is safe.

### Changes

**1. Update header comment** — replace the high-tier line:

```
//   total >= 5.0 SOL  -> 5% of total
```

**2. Remove the constant**

```ts
export const PROCESSING_FEE_HIGH = 200_000_000n; // 0.20 SOL  ← delete
```

**3. Update `getProcessingFeeLamports`**

```ts
export function getProcessingFeeLamports(totalLamports: bigint): bigint {
  if (totalLamports >= PROCESSING_FEE_THRESHOLD_HIGH) {
    // 5% of total contributions for launches >= 5 SOL
    return (totalLamports * 5n) / 100n;
  }
  if (totalLamports >= PROCESSING_FEE_THRESHOLD_MID) return PROCESSING_FEE_MID;
  if (totalLamports >= PROCESSING_FEE_THRESHOLD_LOW) return PROCESSING_FEE_LOW;
  return 0n;
}
```

### Out of scope

No changes to `chargeProcessingFee`, `shouldChargeProcessingFee`, callers in `executeBags.ts` / `executePumpfun.ts`, DB, edge functions, or UI. The fee is still computed dynamically each time, so percentage-based output flows through the existing `feeLamports - PROCESSING_FEE_TX_FEE` transfer logic unchanged.

### Tier table after change

| Total raised | Fee |
|---|---|
| ≥ 5 SOL | 5% of total |
| ≥ 2 SOL | 0.13 SOL (flat) |
| ≥ 0.3 SOL | 0.06 SOL (flat) |
| < 0.3 SOL | 0 |

Approve and I'll apply the edit.