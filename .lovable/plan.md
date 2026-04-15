

# Fix Claimable Positions Field Mapping in DashboardPage

## Problem
The Bags API returns `baseMint` and `claimableDisplayAmount` on position objects, but the code references `mint` and `claimableAmount`. This causes contributors to always see zero fees.

## Changes

### Edit: `src/pages/DashboardPage.tsx`

**1. Update `ClaimablePosition` interface** (lines 15-20):
```typescript
interface ClaimablePosition {
  baseMint: string;
  claimableDisplayAmount: number;
  totalClaimableLamportsUserShare: number;
}
```

**2. Update `totalClaimable` calculation** (lines 72-75):
Change `p.claimableAmount` → `p.claimableDisplayAmount`

**3. Update `getClaimableForMint` function** (lines 77-81):
Change `p.mint` → `p.baseMint` and `pos?.claimableAmount` → `pos?.claimableDisplayAmount`

**4. Update claim mutation mint parameter** (line 88):
The `mint` passed to `claimMutation.mutate()` already comes from `c.launches?.token_mint_address` (line 225), which is the correct on-chain mint address matching `baseMint`. No change needed there — the lookup in `getClaimableForMint` is what needed fixing.

Four small field-name replacements, no structural changes.

