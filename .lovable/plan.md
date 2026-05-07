# Fix fee-claimer: path collision + sponsored creator destination

## Important correction

There is **no `sponsored_slots` table** in this project. Sponsored launch data lives entirely on `launches`. Two relevant columns:

- `created_by_wallet` — set by `create-sponsored-slot` from the admin's `influencer_wallet` input (the wallet entered when the link was created). For most sponsored launches this is a valid base58 pubkey, but at least one legacy row (STARBY) has a URL string here, which is what triggers `Non-base58 character`.
- `creator_delivery_wallet` — set by `claim-sponsored-slot` when the influencer claims the link and enters where they want their share delivered.

For sponsored launches, `creator_delivery_wallet` is the wallet the influencer actually controls and expects funds in. We will treat it as the authoritative destination, with `created_by_wallet` as fallback.

## Bug 1 — Path collision

In `fee-claimer/src/index.ts`, inside `pollAndClaimFees`:

- Remove the two `while` loops that call `claimPumpfunFeesBatch()` and `claimLocalSigningFeesBatch()`.
- Keep only the single call to `harvestPerLaunchFees()`.
- Leave the imports/files intact (no deletions) so we can re-enable later if needed; just stop invoking them.
- Add a one-line comment explaining why the legacy batch sweeps are disabled (they pre-drain the creator vault before the 70/30 split can run).

## Bug 2 — Wrong creator destination for sponsored launches

In `fee-claimer/src/harvestPerLaunchFees.ts`, replace the current `creatorPubkey` resolution block in `runHarvestCriticalSection` with:

1. A small helper `tryParsePubkey(s: string | null | undefined): PublicKey | null` that returns `null` on any failure (no throw).
2. Resolution logic:
   - If `launch.is_sponsored === true`:
     - First try `creator_delivery_wallet` → label path `"sponsored:creator_delivery_wallet"`.
     - Fall back to `created_by_wallet` → label path `"sponsored:created_by_wallet"`.
   - Else (non-sponsored):
     - Use `created_by_wallet` → label path `"non_sponsored:created_by_wallet"`.
3. If no path yields a valid base58 pubkey:
   - Log `[HARVEST][CREATOR_RESOLVE] launch=<id> sponsored=<bool> result=unresolved created_by_wallet=<raw> creator_delivery_wallet=<raw>`.
   - Call `recordFailure(launch.id, "Could not resolve creator destination wallet for 70% share")` and `return`. Skip the creator transfer for that launch only — do not affect other launches in the loop.
4. On success, before any signing, log:
   `[HARVEST][CREATOR_RESOLVE] launch=<id> sponsored=<bool> path=<label> creator=<pubkey>`

The rest of the harvest flow (vault peek, claim, 70/30 split, transfers, recordCycle) is unchanged. The `notes` field on `recordCycle` should additionally include the resolution path, e.g. `path=sponsored:creator_delivery_wallet creator=...`.

## Files touched

- `fee-claimer/src/index.ts` — remove two while loops, keep single `harvestPerLaunchFees()` call, add comment.
- `fee-claimer/src/harvestPerLaunchFees.ts` — add `tryParsePubkey`, replace creator resolution block, add `[HARVEST][CREATOR_RESOLVE]` log lines, extend `notes`.

No DB schema changes. No edge function changes. No changes to `claimPumpfunFeesBatch.ts` or `claimLocalSigningFees.ts` (kept on disk, just unused).

## Note on legacy data

STARBY (`78b34564-...`) has `created_by_wallet = "erys.live/sponsored/e65452281cf14da88a710414d3747d05"` — a URL, not a pubkey. With this fix, STARBY's 70% share will route to its `creator_delivery_wallet` (`F46AiunPJYzAZp1WysKNcPy7RphztugX6Zu9Lev69BEK`) via the sponsored path. No data backfill required.
