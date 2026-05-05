## Problem

The Eureka launch (`2f44f4b7…`) was auto-cancelled with "Insufficient pool" even though:
- Contributor A sent 0.099995 SOL
- Contributor B sent 0.200000 SOL
- Platform sponsor seed: 0.100000 SOL
- **True effective pool: 0.399995 SOL** — well above 0.3 SOL

The minimum-pool check in `executor/src/executePumpfunLightning.ts` only sums contributor `amount_lamports` and ignores `sponsored_amount_lamports`. So a sponsored launch where contributors total 0.299995 SOL gets cancelled, even though 0.4 SOL of buyable SOL is sitting in escrow.

Note: contributor A's 0.099995 SOL is also 5,000 lamports under the 0.1 SOL per-contribution floor — likely a legacy contribution or pre-floor data. Not in scope here; we only fix the pool-minimum check.

## Fix

In `executor/src/executePumpfunLightning.ts`, include the sponsor seed in the `MINIMUM_POOL_LAMPORTS` comparison, while keeping `totalLamports` (used for basis-points math) based on contributor SOL only.

```ts
const totalLamports = contributions.reduce(
  (sum, c) => sum + BigInt(c.amount_lamports),
  0n,
);

// Sponsor seed is real, buyable SOL sitting in escrow — count it toward
// the minimum-pool gate. Do NOT fold it into totalLamports because that
// drives token-distribution basis points, which must reflect contributor
// deposits only.
const sponsorSeedLamports = launch.is_sponsored
  ? BigInt(launch.sponsored_amount_lamports || 0)
  : 0n;
const effectivePoolLamports = totalLamports + sponsorSeedLamports;

const MINIMUM_POOL_LAMPORTS = 300_000_000n; // 0.3 SOL
if (effectivePoolLamports < MINIMUM_POOL_LAMPORTS) {
  console.log(
    `Launch ${launch.id} below minimum pool ` +
    `(contrib: ${totalLamports}, sponsor: ${sponsorSeedLamports}, ` +
    `effective: ${effectivePoolLamports} < ${MINIMUM_POOL_LAMPORTS}). Cancelling.`,
  );
  await cancelAndRefund(launch, contributions);
  return;
}
```

No DB changes, no edge-function changes, no impact on token distribution math (still uses `totalLamports`).

## Files

- `executor/src/executePumpfunLightning.ts` — update minimum-pool check only

## Out of scope (call out, don't fix here)

- Eureka `2f44f4b7…` is already cancelled; not retroactively re-launchable. Contributor B was refunded; sponsor seed swept back to platform; contributor A still has a 0.099995 SOL shortfall pending. That's a separate manual recovery.
- Refund-ordering fairness in `cancelAndRefund` (smallest-first / pro-rata) — discussed earlier, still worth doing but separate task.
