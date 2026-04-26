## Good news: the 5% creator floor already exists

In `distributor/src/distribute.ts` (line 73) `calculateSharesFromBalance` already enforces:

```ts
const CREATOR_MIN = (actualBalance * 500n) / 10000n;  // 5% of token supply we bought
const creatorEntry = rawShares.find((s) => s.wallet === creatorWallet);
if (creatorEntry && creatorEntry.share < CREATOR_MIN) { ... }
```

So in the **happy path** the creator already gets at least 5% of the tokens we buy.

## But there are 3 edge cases that can silently break the guarantee

I want to fix these so "minimum 5%" is a hard invariant, not a best-effort.

### Edge case 1 — Creator not in the contributor list
If the creator never contributed (or used `token_delivery_wallet` to redirect their own share), `rawShares.find((s) => s.wallet === creatorWallet)` returns `undefined` and the floor is silently skipped. They get **0%**.

Today this can happen because:
- The schedule flow doesn't strictly require the creator to be a contributor row in every code path.
- A contributor's `token_delivery_wallet` overrides `wallet_address` for delivery, but the **floor check uses `wallet_address`**, so it still works for that case — *but the creator must already exist as a contributor.*

**Fix:** if no creator entry is found, log a loud warning AND if any contribution was made by `created_by_wallet` under a different identity (e.g. via the sponsor flow) we still want them protected. Concretely: if creator is missing from the contributor list, we leave shares as-is (no floor possible — there's nobody to credit) but emit a `console.error` so it's visible in Railway logs and never silently swallowed.

### Edge case 2 — Proportional reduction can push other contributors to 0 or negative
The current redistribution:
```ts
const reduction = (entry.share * deficit) / othersTotal;
entry.share -= reduction;
```
If `othersTotal < deficit` (e.g. creator put in 1% and we need to bump to 5%, but the other contributors collectively only hold 4% of tokens — impossible mathematically since shares are proportional to lamports, but possible after BigInt flooring on tiny contributions), one or more entries can round to 0 or end up off by a lamport. Today the remainder is dumped onto `rawShares[0]` which **is the creator**, so the creator absorbs rounding — fine. But the per-entry reduction is not floored to ensure `entry.share >= 0n`.

**Fix:** clamp `entry.share = entry.share > reduction ? entry.share - reduction : 0n` and recompute the remainder dump on `rawShares[0]` after the loop. This guarantees no negative BigInts and the creator still ends with `>= CREATOR_MIN`.

### Edge case 3 — Single-contributor launch (creator is the only one)
If only the creator contributed, they already get 100% — `othersTotal === 0n`, the `if (othersTotal > 0n)` guard prevents division-by-zero, creator share is set to `CREATOR_MIN`, but **the remaining 95% gets dumped via the remainder line** onto `rawShares[0]` (which is the creator). Net result: creator gets 100%. ✅ Already correct, but I want to add a unit-test-style comment + an explicit early-return for clarity.

### Edge case 4 (bonus) — Ensure the 5% floor invariant is asserted before sending
After all share calculation, add a defensive assertion:
```ts
const finalCreatorShare = shares.get(creatorContribId) ?? 0n;
if (creatorContribId && finalCreatorShare < CREATOR_MIN) {
  throw new Error(`Creator share invariant violated: got ${finalCreatorShare}, need ${CREATOR_MIN}`);
}
```
This means if any future refactor breaks the math, the distributor crashes loudly **before** sending tokens, so we can fix it instead of silently shorting the creator. The lock is released in the `finally`, so the launch will be retried.

## Files to change

- **`distributor/src/distribute.ts`** — refactor `calculateSharesFromBalance`:
  - Track `creatorContribId` (not just wallet) so the post-calc invariant check is unambiguous.
  - Clamp `entry.share -= reduction` to never go below `0n`.
  - Add early-return for single-contributor case.
  - Add the post-calculation invariant assertion in `distributeTokensForLaunch` before the per-contributor send loop.
  - Add `console.error` (not silent skip) when creator wallet is absent from contributors.

## What does NOT change

- The 5% number itself (`500 bps`). If you want a different floor (e.g. 7.5% to match the Bags fee-share floor), say the word.
- The Bags fee-share floor in `executor/src/executeBags.ts` (separate concern — that's about future trading-fee BPS, not initial token supply). It's already at 7.5% and works correctly.
- DB schema, edge functions, executor logic, frontend. Pure distributor hardening.

## Risk

Low. The code path already targets this guarantee — these are belt-and-suspenders fixes that turn a best-effort behavior into a hard invariant. The invariant assertion will only ever throw if there's a real bug, in which case retrying is the right move.