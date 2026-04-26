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
- **Pump.fun mints are Token-2022.** New Pump.fun mints are owned by `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` (Token-2022), NOT the legacy SPL Token program. ATA derivation, `getAccount`, `createAssociatedTokenAccountInstruction`, and `createTransferInstruction` MUST be passed the Token-2022 program id, otherwise the sweep looks at the wrong ATA address and reports "no token account" while the tokens are actually sitting in the Token-2022 ATA. `sweepTokensToWallet` in `pumpportalCustodial.ts` detects the mint owner via `getAccountInfo(mint).owner` and routes through the matching token program.
- **Post-create sweep failures must NOT auto-refund.** Once Pump.fun create+buy lands on-chain, contributor SOL has been spent into the bonding curve. If the downstream token sweep fails, use `setFailedNoRefund` (not `setFailed`) so we don't issue partial/short refunds. Tokens in the custodial wallet can be recovered manually by an admin.

## Mint detection invariant (Apr 2026)

Whenever the executor holds a Pump.fun launch signature returned by PumpPortal Lightning, that signature MUST be persisted on `launches.pumpfun_launch_signature` regardless of overall success/failure. The signature is the source of truth for whether a Token-2022 mint exists on-chain — losing it makes manual recovery and audit impossible.

On-chain landing is determined by `pollLandedStatus` in `executePumpfunLightning.ts` — HTTP polling of `getSignatureStatuses` with `searchTransactionHistory: true`, 60 s timeout, 2 s interval. Returns one of three states. Decision matrix for terminal DB writes:

| Outcome | Helper | Saves signature? | Auto-refunds? | Why |
|---|---|---|---|---|
| Mint succeeded, sweep succeeded | `setLaunched(id, sig)` | yes | n/a | happy path |
| Mint succeeded, sweep failed | `setFailedNoRefund(id, reason, sig)` | yes | NO | SOL is in bonding curve; refunding would be partial; tokens recoverable from custodial wallet |
| Tx reverted on-chain (`status.err` set) | `setFailedWithSignature(id, reason, sig)` | yes | yes | tx exists but Buy CPI failed; SOL never spent into curve |
| Tx not landed within polling window | `setFailedWithSignature(id, reason, sig)` | yes | yes | no mint, SOL still in custodial; sweep back then refund |
| Pre-signature failure (funding tx, PumpPortal HTTP error, no signature in response) | `setFailed(id, reason)` | n/a | yes | no on-chain artifact to record |

Do not introduce new post-signature failure branches that call `setFailed` directly — they will drop the signature.