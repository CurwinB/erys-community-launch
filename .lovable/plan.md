

# Fix Bags basis-points to sum to 10000

## Change

In `executor/src/executeBags.ts`, replace the basis-points calculation so `claimersArray` sums to exactly 10000. The Bags `partner` / `partnerConfig` fields handle the platform cut separately and must not be subtracted from the claimer pool.

## Edit: `executor/src/executeBags.ts`

Replace the current block:

```ts
const PLATFORM_BPS = 2500;
const CREATOR_MIN_BPS = 750;
const remaining = 10000 - PLATFORM_BPS;
```

with:

```ts
const CREATOR_MIN_BPS = 750;
const remaining = 10000; // claimers must sum to 10000; partner handled separately by Bags
```

Update the loop bound from `Math.min(contributions.length, 99)` to `Math.min(contributions.length, 100)` to match the documented 100-claimer limit (saved memory: `mem://features/fee-share-config`).

The rest of the function — creator floor logic (`Math.max(CREATOR_MIN_BPS, creatorRaw)`), per-contributor `Math.floor` distribution, and the final `basisPointsArray[0] += remaining - usedBps` adjustment — remains unchanged and will now correctly settle to a sum of 10000.

The `partner: BAGS_PARTNER_WALLET` and `partnerConfig: BAGS_PARTNER_CONFIG` fields in the `fee-share/config` POST body stay exactly as they are.

## Out of scope

- No changes to `claim-fees`, the `claimersArray` shape, partner fields, on-chain flow, or DB schema.
- Not retrying the previously failed launch (`ccf4b49d-…`) — separate operational decision; flag if you want it re-queued.

## Files edited

- `executor/src/executeBags.ts`

