
## The actual bottleneck

The custodial wallet is **not** rate-limited by Solana — a Solana keypair can sign as fast as you can feed it transactions. The real chokepoints are:

| Layer | Limit | Why it matters |
|---|---|---|
| `withCustodialLock` (advisory + row lock) | **1 claim at a time, globally** | Adding distributor replicas does NOT help fee claiming. They all queue on the same lock. |
| PumpPortal Lightning API (single API key) | ~few req/sec, undocumented | Same key = same tenant. Parallelism here risks 429s. |
| Custodial wallet SOL balance | Drains ~55k lamports per claim attempt | At 100+ launches every 10 min, the wallet bleeds SOL faster than fees come in for low-volume tokens. |
| 10-min poll cadence | Per-launch, not global | If serial processing takes >10 min, the next cycle starts before the last finishes — backlog grows forever. |

**Today's effective ceiling:** ~30–60 fee claims per 10-min cycle (3–6/min through the lock), shared across all replicas. Beyond that, claims back up indefinitely.

## The fix — three layers

### 1. Batch the wallet-touching work (biggest win, smallest change)

Right now each launch independently:
- acquires the lock
- calls `collectCreatorFee`
- sweeps custodial → escrow
- releases the lock

Then **outside the lock**, the per-launch escrow → treasury transfer happens.

Change the distributor's fee loop to:
1. Acquire the custodial lock **once per cycle**.
2. Inside the lock, iterate over up to N (e.g. 25) eligible launches:
   - Call `collectCreatorFee` for each (sequentially — PumpPortal limit).
   - After all claims are submitted and confirmed, do **one** sweep of `custodial → a fan-out account` (or directly fan out to each launch's escrow with one multi-instruction tx per ~10 launches, since Solana tx size limits us to ~12 transfers per tx).
3. Release the lock.
4. Outside the lock, do the per-launch escrow → treasury transfers in parallel (each escrow is independent).

This collapses lock-hold time from `N × ~3s` to `~N × 0.5s + 1 sweep tx`, raising practical throughput ~5–10x with no new infrastructure.

### 2. Wallet-health budget + circuit breaker

Add a SOL-budget gate before each claim attempt:

- Read custodial balance once per cycle.
- Compute `available = balance - floor - reserved_for_pending_launches`.
- If `available < 50_000 lamports * candidate_count`, **skip claims** for this cycle and surface a "Custodial wallet low — pause" alert in the admin panel.
- Add a `pumpfun_min_expected_fee_lamports` threshold (configurable). Skip launches whose last claim returned <X SOL — they're not worth the priority-fee burn. Stamp them with a longer throttle (e.g. 1 hour instead of 10 min).

This stops the wallet from dying under a long tail of zero-volume launches.

### 3. Wallet pool (future-proof, optional now)

The custodial wallet is single-tenant because Pump.fun's "creator" is set at launch time. To shard:

- Introduce a `custodial_wallets` table: `pubkey`, `encrypted_privkey`, `is_active`, `current_load`.
- At **launch creation time** (`executor/src/executePumpfunLightning.ts`), pick the least-loaded active wallet and use it as the creator.
- Store `custodial_wallet_pubkey` on each launch row.
- Each wallet gets its own `custodialLock` keyed by pubkey → claims for different wallets run truly in parallel.
- PumpPortal supports multiple API keys (one per wallet) — we'd need one `PUMPPORTAL_API_KEY_<n>` secret per pool member.

Adding 3 wallets to the pool ≈ 3x claim throughput and 3x SOL headroom. We can add this incrementally — start with the table + selection logic, populate with one wallet, expand later.

## Concrete changes

### Migrations
- Add `pumpfun_low_volume_throttle_until` (timestamptz) to `launches` so we can back off chronically empty creator vaults to 1h instead of 10m.
- (Pool prep) Add `custodial_wallets` table with RLS (service role only) and a `custodial_wallet_pubkey` column on `launches` (nullable, defaults to the env var wallet for backfill).
- New RPC `claim_pumpfun_launches_batch_for_worker(worker_id, limit, ttl)` that returns up to `limit` launches in a single locked batch (FOR UPDATE SKIP LOCKED), so the distributor can grab a batch atomically.

### Distributor (`distributor/src/claimPumpfunFees.ts`, `index.ts`, `db.ts`)
- New `claimPumpfunFeesBatch(launches[])` that holds the custodial lock once and processes all claims, then does a single fan-out sweep.
- Add `getCustodialBalance()` precheck and skip-cycle if budget insufficient.
- Apply long-throttle when a claim returns 0 lamports twice in a row.
- Replace the per-launch `pollAndClaimFees` while-loop with a single batch call per 10-min tick.

### Admin UI (`src/components/admin/PumpfunFeeHealthPanel.tsx`)
- Show "Effective claim throughput (last hour)" and "Wallet runway (claims at current burn rate)".
- Show count of launches in long-throttle vs active.
- Add a "Top up custodial wallet" reminder when balance < 0.05 SOL.

## What this gets you

| Metric | Today | After batching | After pool (3 wallets) |
|---|---|---|---|
| Claims per 10-min cycle | ~30–60 | ~200–400 | ~600–1200 |
| Custodial SOL bleed under 0-volume launches | Linear in launch count | Capped by long-throttle | Capped + spread |
| Single-point-of-failure wallet | Yes | Yes | No |
| New infra/secrets needed | None | None | 1 secret + 1 keypair per pool member |

## Recommended sequencing

1. **Now:** Migration for long-throttle column + batching RPC. Refactor distributor to batch. Wire the wallet-health gate. *(High impact, no new secrets, no new wallets.)*
2. **Next:** Admin panel updates so you can see throughput and wallet runway.
3. **When you cross ~50 active launches:** Add the `custodial_wallets` table + per-launch wallet assignment. Provision the first additional wallet + PumpPortal key.

Approve this and I'll implement step 1 (batching + budget gate + long-throttle) in the next pass — that alone unlocks roughly 5–10x today's ceiling without touching wallets or secrets.
