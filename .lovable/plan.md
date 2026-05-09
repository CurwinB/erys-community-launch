## Files I will touch

- `distributor/src/distribute.ts` — only file changed.

No other files need edits. `is_sponsored` is already on the `Launch` type in `distributor/src/db.ts`, so no type or query changes are required.

## Change summary

Branch the creator-floor logic on `launch.is_sponsored`:

- **Sponsored (`is_sponsored === true`)**: keep existing behavior — creator gets `max(proportional, 5%)`, with the same redistribution + invariant guard as today.
- **Non-sponsored (`is_sponsored !== true`)**: pure proportional. No 5% floor, no redistribution from other contributors, no post-calc invariant assertion against the floor.

Add one log line per launch describing which method was applied and the creator's resulting percentage (in bps / %).

## Technical detail

1. `calculateSharesFromBalance(...)` gains an `enforceCreatorFloor: boolean` parameter.
   - When `false`: skip the `creatorEntry.share < CREATOR_MIN` redistribution block entirely. Keep the single-contributor short-circuit and the BigInt remainder dump on `rawShares[0]` (those are correctness fixes, unrelated to the floor).
   - When `true`: behavior is unchanged from today.

2. In `distributeTokensForLaunch(...)`:
   - Compute `enforceCreatorFloor = launch.is_sponsored === true`.
   - Pass it into `calculateSharesFromBalance`.
   - Replace the existing "Creator share OK" / invariant block with:
     - If `enforceCreatorFloor` and `creatorContrib` exists → keep the current `creatorShare >= creatorMin` assertion + existing OK log.
     - Else → skip the assertion entirely (no floor to enforce).
   - After share calc, if `creatorContrib` exists, log one line:
     ```
     Allocation method for launch <id>: <"sponsored-floor" | "proportional-only">; creator received <bps> bps (<pct>%) of <originalTotalBalance>
     ```
     If creator is not a contributor, log that instead (method + "creator not in contributor list").

3. No DB schema, no migrations, no other modules. Constants `CREATOR_MIN_BPS` / `TOTAL_BPS` stay (still used in the sponsored branch).

## Risks

- Non-sponsored launches where the creator contributed less than 5% will now receive strictly their proportional share. This is the intended behavior change.
- Invariant guard is intentionally bypassed for non-sponsored launches; if the math regresses there, it will not be caught by the floor assertion. Acceptable since there is no floor to violate.
