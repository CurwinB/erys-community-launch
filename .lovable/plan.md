

# Update ATA Reserve Calculation in execute-launch

## What changes
Two edits in `supabase/functions/execute-launch/index.ts`:

**1. Line 9** — Replace the single `ATA_COST_LAMPORTS` constant with two constants:
```typescript
const TX_FEE_PER_TRANSFER = 5_000n; // 0.000005 SOL per SPL token transfer
const ATA_COST_PER_CONTRIBUTOR = 2_039_280n; // 0.00203928 SOL per ATA creation
```

**2. Lines 195-210** — Replace the reserve calculation block:
```typescript
// Reserve enough SOL to send tokens to every contributor:
// - 0.00203928 SOL per contributor for ATA creation
// - 0.000005 SOL per contributor for transaction fees
// Everything else goes into the initial buy
const totalReserve = BigInt(filtered.length) * (ATA_COST_PER_CONTRIBUTOR + TX_FEE_PER_TRANSFER);
const allContribTotal = contributions.reduce(
  (sum: bigint, c: any) => sum + BigInt(c.amount_lamports),
  0n
);
const netBuyLamports = allContribTotal - totalReserve;

if (netBuyLamports < 10_000_000n) {
  await setFailed(
    supabase,
    launch.id,
    `Insufficient SOL after token distribution reserve. Total: ${allContribTotal}, Reserve: ${totalReserve}, Net: ${netBuyLamports}`
  );
  return errorResponse("Not enough SOL raised to cover token distribution costs and initial buy");
}
```

No other changes. The rest of the file already uses `netBuyLamports` for `initialBuyLamports`.

