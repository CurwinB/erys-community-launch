---
name: PumpPortal custodial wallet locking
description: Shared PumpPortal custodial wallet must be serialized via withCustodialLock to prevent SOL collisions across concurrent launches and fee claims
type: feature
---

The PumpPortal Lightning custodial wallet is shared across all Pump.fun launches and creator-fee claims. Its SOL balance is read-then-swept ("everything above floor"), which is unsafe under concurrency.

**Rule:** every code path that funds, sweeps from, or calls Lightning APIs against the custodial wallet MUST run inside `withCustodialLock(custodialPubkey, workerId, fn)`.

**Implementation:**
- `executor/src/custodialLock.ts` and `distributor/src/custodialLock.ts` (duplicated, can't share across services)
- Combines `pg_advisory_lock` (fast) with row in `custodial_wallet_locks` (TTL safety net, 120 s self-heal)
- SQL helpers: `try_acquire_custodial_lock`, `release_custodial_lock`, `try_acquire_custodial_row_lock`, `release_custodial_row_lock`
- Default acquire timeout: 90 s. On timeout, do NOT mark launch failed — let the next poll retry.
- Lock key = custodial wallet pubkey, so a future per-wallet pool (Option 3) gets free isolation by passing different keys.

**Critical sections:**
- `executePumpfunLightning.ts` → `runCustodialCriticalSection`: funding → Lightning create → token sweep retries → SOL sweep
- `claimPumpfunFees.ts` → `runFeeClaimCriticalSection`: pre-claim balance read → collectCreatorFee → custodial→escrow sweep. The escrow→platform/creator 50/50 split runs OUTSIDE the lock.

**Throughput ceiling:** ~2–4 Pump.fun launches/min globally. Bags launches unaffected (different code path).

**Worker ID:** `process.env.WORKER_ID || process.env.RAILWAY_REPLICA_ID || "<service>-default"`.

## Pump.fun Lightning gotchas (verified on-chain Apr 2026)

- **Funding buffer:** `CUSTODIAL_FUNDING_BUFFER_LAMPORTS = 0.025 SOL` in `executePumpfunLightning.ts`. Must cover 2× ATA rent (~0.00408), Pump.fun 1% protocol fee, 0.30% creator fee, compute/priority, tx fee, plus margin. 0.01 SOL was empirically too small — Buy CPI ran 0.0027 SOL short. Leftovers are swept back to escrow on success.
- **Empty `errors: []` is success.** PumpPortal Lightning returns `{signature, errors: []}` on success. The empty array is truthy in JS — must check `Array.isArray(errors) && errors.length > 0`.
- **Lightning returns 200 + signature even when the tx reverts on-chain.** After `confirmTransaction`, ALWAYS call `getSignatureStatuses([sig], {searchTransactionHistory: true})` and check `status.err`. If non-null, mark failed AND `trySweepSolBack` so custodial SOL isn't stranded.