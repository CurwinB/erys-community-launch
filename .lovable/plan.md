# Add Priority Fee Buffer to ATA Reserve Calculation

## Problem
The current ATA reserve calculation in both executor files does not account for the ComputeBudgetProgram.setComputeUnitPrice instruction added to each distribution transaction, which costs additional lamports per transfer.

## Solution
Add a priority fee buffer constant (10,000 lamports per contributor) to the ATA reserve calculation in both executor files.

## Changes Required

### Fix 1: executor/src/executeBags.ts

**Location:** Lines 73-78 (reserve calculation section)

**Current code:**
```typescript
  // Calculate reserves
  const ATA_COST = 2_039_280n;
  const TX_FEE = 5_000n;
  const BASE_TX_FEES = 20_000n;
  const LOOKUP_TABLE_RENT = 2_550_000n;
  const contributorCount = BigInt(contributions.length);
  const ataReserve = contributorCount * (ATA_COST + TX_FEE);
```

**Replace with:**
```typescript
  // Calculate reserves
  const ATA_COST = 2_039_280n;
  const TX_FEE = 5_000n;
  const PRIORITY_FEE_PER_CONTRIBUTOR = 10_000n; // buffer for ComputeBudgetProgram priority fee per distribution tx
  const BASE_TX_FEES = 20_000n;
  const LOOKUP_TABLE_RENT = 2_550_000n;
  const contributorCount = BigInt(contributions.length);
  const ataReserve = contributorCount * (ATA_COST + TX_FEE + PRIORITY_FEE_PER_CONTRIBUTOR);
```

### Fix 2: executor/src/executePumpfun.ts

**Location:** Lines 48-53 (reserve calculation section)

**Current code:**
```typescript
  // Calculate reserves
  const ATA_COST = 2_039_280n;
  const TX_FEE = 5_000n;
  const PRIORITY_FEE = 50_000n;
  const contributorCount = BigInt(contributions.length);
  const ataReserve = contributorCount * (ATA_COST + TX_FEE);
```

**Replace with:**
```typescript
  // Calculate reserves
  const ATA_COST = 2_039_280n;
  const TX_FEE = 5_000n;
  const PRIORITY_FEE = 10_000n; // buffer for ComputeBudgetProgram priority fee per distribution tx
  const PRIORITY_FEE = 50_000n;
  const contributorCount = BigInt(contributions.length);
  const ataReserve = contributorCount * (ATA_COST + TX_FEE + PRIORITY_FEE);
```

**Note:** The first PRIORITY_FEE (10_000n) is for per-contributor distribution transactions. The second PRIORITY_FEE (50_000n) is the existing priority fee for the main launch transaction. Consider renaming one for clarity.

## Files Edited
- executor/src/executeBags.ts
- executor/src/executePumpfun.ts

## Impact
- Ensures sufficient lamports are reserved for priority fees on each contributor's distribution transaction
- Prevents "Insufficient SOL" errors during launch execution when priority fees are applied
- No schema changes or environment variable changes required