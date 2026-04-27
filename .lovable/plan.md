## Answers to your questions

### 1. How does the platform know when there are fees to claim?

**It doesn't, really — it just polls.** There is no signal from Pump.fun saying "you have fees." The current flow:

- A DB function (`claim_pumpfun_launches_batch_for_worker`) selects up to 50 launches that are `status = 'launched'`, `platform = 'pumpfun'`, and whose `pumpfun_fees_last_claimed_at` is older than 10 minutes (and not throttled).
- The worker calls PumpPortal `collectCreatorFee` with `pool: "pump"`. **One call drains every creator vault our custodial wallet owns** — `mint` is ignored.
- It measures the custodial wallet's balance delta before/after to know if anything actually came in.
- If three consecutive cycles return zero, the launch is throttled for 1 hour (`pumpfun_low_volume_throttle_until`).

So the "detection" is: "blindly call collectCreatorFee every 10 minutes per launch group, then look at the balance change."

### 2. How much does each claim cost?

Per-cycle cost (paid out of `PUMPPORTAL_CUSTODIAL_WALLET`):

| Item | Lamports | SOL |
|---|---|---|
| `collectCreatorFee` priority fee (`0.00005` SOL passed to PumpPortal) | 50,000 | 0.00005 |
| Base tx fee for the claim | ~5,000 | 0.000005 |
| Treasury sweep tx (`SystemProgram.transfer` custodial → treasury) | ~5,000 | 0.000005 |
| **Total per cycle (when fees > 0)** | **~60,000** | **~0.00006 SOL** |
| **Total per cycle (empty vault — no sweep)** | **~55,000** | **~0.000055 SOL** |

At ~$150/SOL that's roughly **$0.009 per claim attempt** — sub-penny but it adds up.

The wallet-budget gate currently requires `preBalance >= 55,000 + 5,000 + 2,000,000` (the 0.002 SOL rent floor). It only checks the wallet has enough to *attempt* the claim — **it does not check that the expected payout exceeds the cost.**

### 3. Are we capping claims so we only claim when fees > N × gas?

**No.** Today the worker claims unconditionally every 10 minutes for any launched token. The only protection is the 3-empty-claims → 1-hour throttle, which is reactive (we already burned 3 × ~55k lamports = ~165k lamports / launch group before throttling kicks in).

There is no minimum-payout gate. A vault holding 1,000 lamports will be claimed and swept, costing ~60k lamports — a guaranteed loss of ~59k lamports per cycle until volume picks up.

### 4. What should the threshold be?

Recommendation: **claim only when expected payout ≥ 10× total cost**, with a hard floor.

- Total cycle cost: ~60,000 lamports.
- 10× margin → minimum payout to claim: **600,000 lamports (0.0006 SOL)**.
- Hard absolute floor regardless of multiplier: **500,000 lamports**, so we never burn cycles on dust.

Configurable via env var, e.g. `PUMPFUN_MIN_CLAIM_LAMPORTS` (default 600,000) and `PUMPFUN_MIN_CLAIM_GAS_MULTIPLE` (default 10).

**Problem:** we can't know the vault balance before calling `collectCreatorFee` via the PumpPortal Lightning API (it doesn't expose a "peek" endpoint, and `pool: "pump"` claims across all vaults at once). Two options:

- **(A) Read the creator vault PDA balance directly on-chain.** The PDA is `["creator-vault", custodial_wallet_pubkey]` under the Pump program. We can `getBalance` on it before calling claim. If `balance - rent_exempt_floor < threshold`, skip. **This is the right fix** and works for the batched single-call architecture (one PDA holds all our coins' fees).
- **(B) Track empirical payout-per-cycle** and back off based on a moving average. Less precise.

Plan below implements (A).

---

## Plan: enforce a "fees > N × gas" gate before claiming

### Steps

1. **Add a pre-claim vault balance check** in `distributor/src/claimPumpfunFeesBatch.ts`:
   - Derive the creator vault PDA from the custodial wallet pubkey using the Pump program ID and seeds `["creator-vault", custodial_wallet]`.
   - `connection.getBalance(creatorVaultPda)` before calling `collectCreatorFee`.
   - Compute `claimable = vaultBalance - rentExempt` (rent-exempt for an empty data account ≈ 890,880 lamports — verify via `getMinimumBalanceForRentExemption(0)`).
   - Compare against `PUMPFUN_MIN_CLAIM_LAMPORTS` (default 600,000).
   - If below threshold: skip the PumpPortal call entirely, mark all batched launches with `record_pumpfun_empty_claim` (so the existing 10-min / 1-hour throttle kicks in), and release locks.

2. **Add tunable env vars** to `distributor/.env.example`:
   - `PUMPFUN_MIN_CLAIM_LAMPORTS` (default `600000`)
   - `PUMPFUN_MIN_CLAIM_GAS_MULTIPLE` (default `10` — informational; actual threshold = `max(MIN_CLAIM_LAMPORTS, MULTIPLE × estimated_cost)`)
   - `PUMP_PROGRAM_ID` (default `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`)

3. **Surface vault balance in the admin Pump.fun health panel** (`src/components/admin/PumpfunFeeHealthPanel.tsx`):
   - Add a "Creator vault balance" row showing current PDA balance and claimable amount.
   - Show "Next claim eligible at: …" using vault balance + threshold logic, so it's obvious why a claim isn't firing.
   - This requires either an edge function that reads the on-chain PDA balance, or storing the last observed vault balance on the launch row.

4. **Persist last-observed vault balance** on the `launches` table (or a new `pumpfun_custodial_health` row) so the admin UI doesn't need its own RPC call:
   - New columns: `pumpfun_creator_vault_balance_lamports bigint`, `pumpfun_creator_vault_checked_at timestamptz`.
   - The distributor updates these every cycle whether or not it claims.

5. **Update memory**: append the threshold rule to `mem://features/pumpfun-creator-fees.md` so future cycles don't reintroduce unconditional claims.

### Files to change

- `distributor/src/claimPumpfunFeesBatch.ts` — add PDA balance check + skip path
- `distributor/src/claimPumpfunFees.ts` — same gate (legacy single-launch path, or remove it if dead)
- `distributor/.env.example` — new env vars
- `src/components/admin/PumpfunFeeHealthPanel.tsx` — show vault balance + claim eligibility
- `src/lib/constants.ts` — expose new launch columns to frontend selects
- New Supabase migration:
  - Add `pumpfun_creator_vault_balance_lamports` and `pumpfun_creator_vault_checked_at` columns to `launches`
  - Grant SELECT on those to `anon`/`authenticated`
- `.lovable/memory/features/pumpfun-creator-fees.md` — document the threshold rule

### What this fixes

- Stops bleeding ~55k lamports per cycle per launch group when vaults are empty or trivially small.
- Makes the admin UI honest about why claims aren't happening ("vault has 12,000 lamports, threshold 600,000").
- Keeps the existing throttle as a backstop, but the primary gate is now economic.
