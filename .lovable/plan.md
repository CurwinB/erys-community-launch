## Plan: Tune fee-claimer batch/harvest parameters

### 1. Increase batched-fee safety hops and batch size
**File:** `fee-claimer/src/index.ts`
- PumpPortal batched claim loop (`safetyHops`): change exit condition from `< 5` to `< 10` so up to 10 consecutive batches can run per 10-minute tick.
- Local-signing claim loop (`localHops`): change exit condition from `< 5` to `< 10` for the same reason.

**File:** `fee-claimer/src/claimPumpfunFeesBatch.ts`
- Change `PUMPFUN_FEE_BATCH_SIZE` default from `50` to `200`.

### 2. Raise per-launch harvest threshold from 10x to 20x gas
**File:** `fee-claimer/src/harvestPerLaunchFees.ts`
- Change `PER_LAUNCH_MIN_HARVEST_MULTIPLIER` default from `10` to `20`.
- Update the inline comment and log message that reference "10x gas" to say "20x gas" so the code stays honest.

### No other files touched
The distributor, executor, edge functions, and frontend are unchanged. Both `PUMPFUN_FEE_BATCH_SIZE` and `PER_LAUNCH_MIN_HARVEST_MULTIPLIER` remain overridable via env var — only their hard-coded defaults shift.