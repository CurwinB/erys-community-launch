

# Speed up Pump.fun fee claiming: 6h → 10min

Reduce the Pump.fun creator fee claim cadence so platform + creator shares land roughly every 10 minutes instead of every 6 hours. Two files, two edits each.

## Files

### `distributor/src/index.ts`
- `PUMPFUN_CLAIM_INTERVAL_MS`: `6 * 60 * 60 * 1000` → `10 * 60 * 1000`
- Update startup log: `"Checking every 6 hours."` → `"Checking every 10 minutes."`

### `distributor/src/db.ts` (inside `getPumpfunLaunchesForFeeClaim`)
- Rename `cutoff24h` → `cutoff10min` and change the window from `24 * 60 * 60 * 1000` to `10 * 60 * 1000`
- Update the `.or(...)` filter to reference `cutoff10min` so a launch becomes eligible 10 minutes after its last successful claim (or immediately if never claimed)

## Behavior after change

- Distributor wakes every 10 min, fetches up to 10 eligible Pump.fun launches, claims fees, and splits 50/50 between the platform wallet and the token creator.
- `runClaimIfIdle`'s existing guard still prevents overlapping cycles if a claim run takes longer than 10 minutes.
- No schema, env var, frontend, or executor changes.

## Operational note

Change lives in `distributor/`. After merge, redeploy the distributor service on Railway for the new cadence to take effect — the running instance keeps the old 6h interval until restart. Expect more frequent (smaller) on-chain claim transactions and a slight uptick in RPC usage; well within Alchemy limits at current launch volume.

