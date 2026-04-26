---
name: Creator token-supply floor (5%)
description: Hard invariant — launch creator always receives ≥5% of the tokens we buy at launch, enforced in distributor/src/distribute.ts with pre-send assertion
type: feature
---

## Rule

The launch creator (identified by `launches.created_by_wallet`) MUST receive at least **5% (500 bps) of the token supply purchased at launch**, regardless of how small their seed contribution was relative to other contributors.

## Implementation

Enforced in `distributor/src/distribute.ts`:

1. `calculateSharesFromBalance` computes proportional shares, then bumps the creator to `CREATOR_MIN = actualBalance * 500n / 10000n` if needed. Deficit is taken proportionally from non-creator contributors. All math in BigInt.
2. Per-contributor reduction is clamped: `entry.share = entry.share > reduction ? entry.share - reduction : 0n` so no contributor ever goes negative due to BigInt flooring.
3. Single-contributor edge case: if creator is the only contributor, they get 100% (early return).
4. Missing-creator edge case: if creator wallet is not in the contributor list, `console.error` logs it loudly and the floor is skipped (nobody to credit).
5. **Invariant assertion** in `distributeTokensForLaunch` AFTER share calc and BEFORE any token transfer: throws if creator share < 5% floor. The throw aborts distribution; the outer `finally` releases the worker lock so the launch retries.

## What this floor does NOT cover

- It applies to **token supply** (Pump.fun + Bags initial buy distribution), not to fee shares.
- Bags fee-share BPS has its own separate **7.5% creator floor** in `executor/src/executeBags.ts` (`CREATOR_MIN_BPS = 750`). Different concern (future trading-fee revenue, not token supply).
- Pump.fun creator fees are 100% platform — no creator share for fees, so no floor needed there.
- `token_delivery_wallet` overrides only change the on-chain recipient pubkey; the floor check uses `wallet_address` (the contributing wallet) as identity, which matches `created_by_wallet`.

## If the assertion ever fires

It means a refactor broke the math. The launch will be stuck in a retry loop with the error in Railway logs. Fix the math, redeploy distributor, and the next poll cycle will pick it up correctly.