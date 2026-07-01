# Erys Co-Dev Fee Sharing (Revised)

Opt-in per launch. When enabled, harvested Pump.fun creator fees split **50% creator / 20% co-dev pool / 15% affiliate (if any) / 15% treasury** (treasury absorbs the affiliate slot when no affiliate). When disabled, the existing 70/30 or 70/15/15 behavior is unchanged.

Gas is subtracted from gross **before** any bps math so every party's payout equals their bps of net. Co-dev payouts go out in batched transfers (15 per tx). Under-floor shares accrue on the co-dev row instead of being dropped.

---

## 1. Database

New migration adds:

**`public.launches` columns**
- `codev_sharing_enabled boolean not null default false`
- `codev_mode text not null default 'proportional'` — `'proportional' | 'fcfs'` (see §3 for what these mean now)
- `codev_roster_locked_at timestamptz` — set when 100th codev joins OR when the launch executes, whichever first

**`public.launch_codevs` table**
```
id uuid pk
launch_id uuid fk launches(id) on delete cascade
wallet_address text not null          -- base58, NO lower()/case-folding, ever
contribution_lamports bigint not null default 0
pending_lamports bigint not null default 0        -- accrual balance
paid_lamports bigint not null default 0           -- lifetime paid
joined_at timestamptz not null default now()
unique (launch_id, wallet_address)
```
No `bps_override` column — both modes use the same proportional math (see §3). Grants: `SELECT, INSERT, UPDATE, DELETE` to `authenticated`; `ALL` to `service_role`. RLS: public `SELECT` (needed by the launch page), writes only via SECURITY DEFINER RPCs. Trigger-enforced 100-row hard cap per `launch_id`.

**`public.codev_payouts` ledger**
```
id uuid pk, launch_id uuid, wallet_address text, cycle_id uuid null,
amount_lamports bigint not null, tx_signature text not null, created_at timestamptz default now()
unique (launch_id, wallet_address, tx_signature)
```
Grants + RLS: read-only for `authenticated` filtered by their own wallet via RPC; `service_role` full access.

**Extended RPC: `public.get_launch_fee_split(p_launch_id)`**
Returns existing columns plus:
- `codev_bps int` — `2000` when enabled else `0`
- `creator_bps` becomes `5000` when enabled, `7000` otherwise
- `codev_allocations jsonb` — `[{wallet_address, weight}]` where `weight` is always `contribution_lamports`. Empty array when disabled or when roster is empty at lock time.

New RPCs:
- `enable_codev_sharing(p_launch_id, p_wallet, p_mode)` — only the launch's `created_by_wallet` (case-sensitive compare) may call; blocked once the launch has been harvested at least once.
- `upsert_launch_codev(p_launch_id, p_wallet_address, p_contribution_lamports)` — SECURITY DEFINER. Adds `p_contribution_lamports` to the row's `contribution_lamports` (upsert). Rejects when `codev_roster_locked_at is not null`. Rejects new wallets when `codev_mode = 'fcfs'` and the roster already has 100 entries; existing wallets can still top up until the roster locks. Rejects any insert past 100 regardless of mode (hard ceiling).
- `lock_codev_roster(p_launch_id)` — sets `codev_roster_locked_at = now()` idempotently. Called by the executor on successful launch and by the upsert trigger the moment count hits 100.
- `record_codev_batch(p_launch_id, p_cycle_id, p_tx_signature, p_payouts jsonb)` — atomically inserts N `codev_payouts` rows, decrements matching `launch_codevs.pending_lamports`, bumps `paid_lamports`. Idempotent on `(launch_id, wallet, tx_signature)`.
- `accrue_codev_pending(p_launch_id, p_deltas jsonb)` — bulk increment of `pending_lamports` for wallets whose share this cycle did not clear the floor or whose batch tx failed.
- `codev_dashboard(p_wallet)` — lists a co-dev's launches, pending, paid, recent payouts.

---

## 2. Harvester (`fee-claimer/src/harvestPerLaunchFees.ts`)

Between the existing creator-transfer block and the treasury-transfer block, insert a co-dev batch-payout stage. Full flow per launch when `codev_bps > 0`:

1. **Read allocations** via `get_launch_fee_split`. If `codev_bps=0`, skip the whole stage — behaves exactly like today.
2. **Single gas constant, one derived**:
   ```
   PER_TX_GAS_LAMPORTS              = 50_000     // env-tunable base unit
   PER_RECIPIENT_BATCH_GAS_LAMPORTS = PER_TX_GAS_LAMPORTS / 15  // derived, never separately configured
   ```
   No second env var. If the base is tuned later, the per-wallet floor moves with it.
3. **Dynamic gas budget**:
   ```
   batchCount    = ceil(activeCodevs / 15)
   totalTxs      = 1 claim + 1 creator + (hasAffiliate?1:0) + batchCount + 1 treasury
   gasEstimate   = totalTxs * PER_TX_GAS_LAMPORTS
   MIN_HARVEST   = gasEstimate * PER_LAUNCH_MIN_HARVEST_MULTIPLIER  (default 20)
   ```
4. **Gross-minus-gas split**: subtract `gasEstimate` from `gross` first, then apply bps. Existing rounding-remainder-to-treasury rule preserved.
5. **Compute per-co-dev shares** with BigInt math over `codev_allocations`. Both modes use the same formula (calculateSharesFromBalance pattern):
   ```
   share_i = codevPool * contribution_lamports_i / sum(contribution_lamports)
   remainder → largest contributor
   ```
   This guarantees the full 20% pool is always distributed regardless of roster size. Add each wallet's current `pending_lamports` to `share_i`.
6. **Per-wallet floor**: `PER_CODEV_FLOOR_LAMPORTS = 20 * PER_RECIPIENT_BATCH_GAS_LAMPORTS`. Wallets below floor → not batched, their `share_i` is written via `accrue_codev_pending`. Wallets at/above floor → batch.
7. **Batching**: chunk cleared wallets into groups of 15, one tx per chunk with N `SystemProgram.transfer` ixs + compute-budget + priority-fee ixs. Sign+send via the existing lightning-wallet path.
8. **Failure isolation**: each batch tx is independent. Batch failure → those wallets get their `share_i` re-accrued to `pending_lamports`. Other batches proceed. Errors logged per-batch into `fee_harvest_last_error` (semicolon-joined).
9. **Treasury transfer** runs last on whatever remains.
10. **Cycle recording**: `record_harvest_cycle` continues to run; co-dev totals are stamped via `record_codev_batch` per successful batch and via `accrue_codev_pending` for under-floor/failed wallets.

`db.ts` gains typed helpers: `getCodevAllocations`, `recordCodevBatch`, `accrueCodevPending`. Affiliate transfer logic unchanged.

---

## 3. Assigning Co-Devs at Launch Time

Both modes use identical split math. **Mode only controls eligibility for a roster seat, never how the pool is split.**

- **`proportional` (open)**: every contributing wallet is upserted into `launch_codevs` until the hard 100-wallet ceiling or roster lock.
- **`fcfs` (capped proportional)**: only the first 100 unique wallets to contribute get a seat. Contributor #101+ still gets their normal token allocation — they just don't join `launch_codevs`. Existing seated wallets can keep topping up their `contribution_lamports` until the roster locks.

**Roster lock cutoff** — locked the moment either happens first:
- 100 unique wallets have joined `launch_codevs` (enforced by upsert trigger calling `lock_codev_roster`), OR
- the token launches on Pump.fun. The existing executor success path calls `lock_codev_roster(launch_id)`; no new event needed.

Once `codev_roster_locked_at` is set, `upsert_launch_codev` rejects all writes for that launch.

**Field-name mapping (source vs destination)**: the `contribute` edge function writes each contribution's `amount_lamports` into `contributions.amount_lamports` (existing table, unchanged). When the same edge function then calls `upsert_launch_codev`, it passes that same value as `p_contribution_lamports`, which is added to `launch_codevs.contribution_lamports`. These are two distinct columns on two distinct tables — `contributions.amount_lamports` (source) and `launch_codevs.contribution_lamports` (destination) — not the same field reused. The upsert only fires when `launches.codev_sharing_enabled = true` and `codev_roster_locked_at is null`.

The `create-launch` and `create-launch-pumpfun` edge functions accept an optional `codev` block: `{ enabled, mode }`. `max` is no longer a parameter — the 100 hard ceiling is fixed. Validated: `mode in ('proportional','fcfs')`.

---

## 4. Frontend

- **Launch creation form**: a "Share fees with co-devs" toggle plus a mode picker — Open Proportional vs. Capped Proportional (first 100). Copy explains the 50/20/15/15 vs 70/30 tradeoff and that both modes split the pool proportionally by contribution size; mode only controls whether seats are capped at 100.
- **Launch page** (`src/pages/LaunchPage.tsx` / `HowItWorks.tsx`): when `codev_sharing_enabled`, show a co-dev panel — mode, seat count / cap, roster lock status/time, live pool percentage, top co-devs by paid+pending (truncated wallets).
- **Dashboard** (`src/pages/DashboardPage.tsx`): new "Co-dev earnings" section pulling from `codev_dashboard(wallet)` — one row per launch: pending, lifetime paid, last payout tx.
- **Admin** (`src/pages/AdminPage.tsx` + new `CodevTab.tsx`): per-launch view of the co-dev roster with pending/paid, plus a force-payout retry button.
- **HowItWorks page**: short section describing the 50/20/15/15 opt-in split and the two modes.

No shared UI component or color needs to change; use the existing accent + card tokens.

---

## 5. Edge cases & guardrails

- Case sensitivity: every query touching `wallet_address` uses exact-match. No `lower()`, no `citext`.
- Idempotency: `record_codev_batch` upserts by `(launch_id, wallet_address, tx_signature)`.
- Enable-window lock: `enable_codev_sharing` refuses if `fee_harvest_total_lamports > 0`.
- 100-wallet ceiling: DB trigger + RPC-side guard.
- Roster lock: enforced by RPC on every insert; auto-set by the executor on launch and by the trigger at the 100th seat.
- Sub-floor forever: out of scope, but `pending_lamports` remains queryable.
- Full pool always distributed: proportional-with-remainder ensures no dead bps regardless of seat count.
- No changes to affiliate math, treasury math when disabled, or the existing 70/30 default.

---

## Out of scope

Vesting/cliffs, per-launch harvest cadence, dust-cleanup policy for dead launches, creator-tunable per-seat weights.
