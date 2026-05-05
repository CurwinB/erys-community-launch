
# Per-Launch Fee Harvesting & Claimable Distribution

Adds a scheduled harvester that pulls Pump.fun creator fees from each launch's per-launch Lightning wallet, splits them 40% treasury / 60% contributors (proportional to contribution amount), and exposes a claim flow. No funds are auto-sent to users.

## Scope

This plan covers ONLY launches that use the per-launch Lightning wallet model (`launches.lightning_wallet_public_key IS NOT NULL`). The existing pooled (`claimPumpfunFeesBatch.ts`) and local-signing (`claimLocalSigningFees.ts`) paths are left untouched — they already sweep 100% to treasury and predate the per-launch model.

## State Model

Add a `fee_harvest_state` enum on the launch row plus a small per-launch state machine:

```text
idle  ──harvest tick──▶  harvesting  ──claim+sweep ok──▶  splitting
                                │                              │
                                │                              ▼
                                │                          allocating
                                │                              │
                                ▼                              ▼
                            harvest_failed               idle (with
                            (auto-resets after TTL)      new allocations)
```

- `idle` — eligible for next harvest tick
- `harvesting` — actively claiming + sweeping; locked to one worker
- `splitting` — claim landed, computing 40/60 + writing allocation rows
- `allocating` — writing per-contributor allocation rows (transactional)
- `harvest_failed` — last cycle errored; auto-reset after TTL

User claims operate on a **separate** column (`claim_state` on each allocation row) so they never block harvesting. Treasury transfer is part of the harvest tx — not a separate worker — to guarantee atomicity of the 40/60 split.

## Database changes

New columns on `launches`:
- `fee_harvest_state text default 'idle'` (`idle|harvesting|splitting|harvest_failed`)
- `fee_harvest_locked_at timestamptz`
- `fee_harvest_worker_id text`
- `fee_harvest_last_attempt_at timestamptz`
- `fee_harvest_last_error text`
- `fee_harvest_total_lamports bigint default 0` (lifetime gross harvested)
- `fee_treasury_total_lamports bigint default 0` (lifetime 40% portion)
- `fee_contributor_total_lamports bigint default 0` (lifetime 60% portion)

New table `fee_harvest_cycles` — one row per successful harvest:
- `id, launch_id, gross_lamports, treasury_lamports, contributor_lamports`
- `claim_tx_signature, treasury_tx_signature`
- `vault_balance_before, escrow_balance_before, escrow_balance_after`
- `created_at`

New table `fee_allocations` — per-contributor share per cycle:
- `id, launch_id, cycle_id, contribution_id, wallet_address`
- `basis_points` (snapshot from contribution at allocation time)
- `lamports` (this cycle's share)
- `claim_state text default 'unclaimed'` (`unclaimed|claiming|claimed|failed`)
- `claim_tx_signature, claim_error, claimed_at`
- `claim_locked_at, claim_worker_id` (independent lock from harvest)
- Unique `(cycle_id, contribution_id)`

Materialized rollup view `fee_unclaimed_by_wallet` for the dashboard (sum of `unclaimed` allocations grouped by wallet).

New SQL functions (SECURITY DEFINER):
- `claim_launch_for_harvest(worker_id, lock_ttl_seconds)` — `FOR UPDATE SKIP LOCKED` over launches with `lightning_wallet_public_key IS NOT NULL`, `status='launched'`, `fee_harvest_state IN ('idle','harvest_failed')`, and harvest cooldown elapsed. Sets state→`harvesting`.
- `record_harvest_cycle(launch_id, ..., allocations jsonb)` — inserts cycle row, allocation rows, bumps lifetime totals, sets state→`idle`. All in one transaction.
- `record_harvest_failure(launch_id, error)` — sets state→`harvest_failed`, stamps error.
- `claim_allocation_for_user(allocation_id, wallet)` — flips `unclaimed→claiming` only if requester wallet matches. Returns row.
- `complete_allocation_claim(allocation_id, tx_sig)` / `fail_allocation_claim(allocation_id, error)`.

## Harvester worker (new file `distributor/src/harvestPerLaunchFees.ts`)

Runs in the existing distributor process on its own interval (e.g. every 10 min, same as the pooled fee claimer).

Per tick:

1. **Eligibility & lock** — call `claim_launch_for_harvest`. Skip launches whose vault PDA balance < `10 × estimated gas`. Estimated gas = priority fee + tx base fee + safety margin. Configurable via env `PER_LAUNCH_MIN_HARVEST_MULTIPLIER` (default 10) and `PER_LAUNCH_HARVEST_GAS_ESTIMATE_LAMPORTS` (default ~110k = collect tx + treasury transfer + buffer).
2. **Peek vault** — read creator vault PDA balance. If below threshold, mark cycle as empty (`record_pumpfun_empty_claim`-style), release lock, continue.
3. **Claim** — sign Pump.fun `collect_creator_fee` instruction with the launch's decrypted Lightning wallet keypair (same approach as `claimLocalSigningFees.ts`, but per-launch and using the lightning keypair).
4. **Compute split** — `gross = post_balance - pre_balance` (or `vault_lamports` if we choose to read claim delta from the tx). `treasury = floor(gross * 0.4)`, `contributors = gross - treasury`.
5. **Treasury transfer** — single `SystemProgram.transfer(lightning_wallet → BAGS_PARTNER_WALLET, treasury_lamports)` signed by the Lightning keypair, in the same critical section.
6. **Allocate** — read all `contributions` for the launch. Compute each share as `floor(contributors * contribution_lamports / total_contributed_lamports)`. Round-robin the rounding remainder into the largest contributors. Build `allocations[]` JSON.
7. **Persist** — single RPC `record_harvest_cycle(...)` writes cycle + allocation rows + lifetime totals + sets state→`idle`. The 60% portion stays in the Lightning wallet awaiting claims.
8. **Failure** — any error → `record_harvest_failure`. State auto-resets via TTL on next tick.

The critical section is wrapped in a per-launch advisory lock (key = lightning wallet pubkey) using the existing `withCustodialLock` helper, so harvest never overlaps with itself or with any user-driven action on that wallet.

## Claim flow (new edge function `claim-fee-allocation`)

User-facing endpoint, called from the dashboard:

- Input: `{ allocation_ids: uuid[], delivery_wallet?: string }`
- Validates the caller wallet owns each allocation (via signed message or session-bound wallet — match existing contribution auth pattern).
- For each allocation:
  - `claim_allocation_for_user` → flips to `claiming` (independent lock; harvester ignores `claiming` rows).
  - Queue an on-chain transfer from the launch's Lightning wallet to the user's wallet for `lamports`.
  - On success → `complete_allocation_claim`. On failure → `fail_allocation_claim` (which flips back to `unclaimed`).
- Batches multiple allocations across different launches into separate txs (one signer per launch).

This runs **out-of-band** from the harvester. Even if the user claims while a harvest tick is running, the harvest holds the wallet's advisory lock, so the claim transfer blocks until harvest releases (or the claim queue retries on the next user click). Harvester will not touch allocation rows in `claiming` state.

## Concurrency guarantees

| Process | Locks held | Ignores |
|---|---|---|
| Harvester | `fee_harvest_state='harvesting'` row lock + Lightning-wallet advisory lock | nothing — first-mover wins via `SKIP LOCKED` |
| Treasury transfer | Inside harvester critical section | n/a |
| User claim | `fee_allocations.claim_state='claiming'` row check + same Lightning-wallet advisory lock during the on-chain send | allocations not in `unclaimed` |

Three guarantees:
1. A launch cannot be harvested twice — `claim_launch_for_harvest` uses `FOR UPDATE SKIP LOCKED` and flips state atomically.
2. Treasury transfer cannot run during a harvest cycle — it IS part of the harvest cycle.
3. Claims cannot interfere with harvest/distribution — they grab the wallet advisory lock for the duration of the on-chain send only, after the allocation row has already been flipped to `claiming`.

## Admin & dashboard surface

- **Admin → new "Fee Harvest" tab**: per-launch table (status, last harvest, lifetime gross / treasury / contributor totals, last error, manual "force harvest" button calling a `force_harvest_retry` SQL fn that resets cooldown).
- **Dashboard → "Claimable fees" section**: groups unclaimed allocations by launch, shows total lamports claimable, "Claim" button per launch (or "Claim all").

## Files to create / edit

Create:
- `supabase/migrations/<ts>_fee_harvest.sql` — enum, columns, tables, SQL functions, view.
- `distributor/src/harvestPerLaunchFees.ts` — the new harvester.
- `supabase/functions/claim-fee-allocation/index.ts` — user claim endpoint.
- `src/components/admin/FeeHarvestTab.tsx` — admin UI.
- `src/components/dashboard/ClaimableFeesPanel.tsx` (or extend existing dashboard).

Edit:
- `distributor/src/index.ts` — wire the harvester into the poll loop alongside `pollAndClaimFees`.
- `distributor/src/db.ts` — add `Launch` fields, harvester DB helpers.
- `src/pages/AdminPage.tsx` — register the new tab.
- `src/pages/DashboardPage.tsx` — add the claimable-fees panel.

Untouched:
- `claimPumpfunFeesBatch.ts`, `claimLocalSigningFees.ts` (legacy 100%-treasury paths).
- `executePumpfunLightning.ts` (launch flow).
- All existing migrations / RLS / contribution flow.

## Open questions

1. **Min harvest threshold** — default proposal is `10 × ~110k lamports ≈ 1.1M lamports (0.0011 SOL)`. OK to use this or want a different multiplier?
2. **Claim auth** — reuse the existing contribution-flow wallet-signature pattern, or require a fresh signed message per claim batch?
3. **Allocation snapshot** — compute shares from `contributions` at harvest time (current plan) vs. snapshot once on launch completion. Current plan handles late refunds gracefully but is slightly more compute per cycle.
