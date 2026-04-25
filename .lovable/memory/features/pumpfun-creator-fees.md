---
name: Pump.fun creator fee mechanics
description: Verified rules for when Pump.fun pays creator fees, who the "creator" is in our flow, and how collectCreatorFee works for tokens on the bonding curve vs. PumpSwap canonical pools
type: feature
---

## Are creator fees ON during bonding? YES, since May 12 2025.

Per Pump.fun's official program docs (`pump-fun/pump-public-docs/PUMP_CREATOR_FEE_README.md`, deployed Mainnet May 12 2025) and the live fee schedule at https://pump.fun/docs/fees (last updated Oct 7 2025):

**Bonding curve fees (every swap, from token creation through graduation):**
- Creator fee: **0.300%**
- Protocol fee: 0.95%
- LP fee: 0%
- Total: 1.25%

The legacy "creator earns 0% during bonding" claim is **outdated** (pre-May 2025 model). It does not apply to any token launched today.

**PumpSwap canonical pool (post-graduation) fees** scale with market cap, starting at 0.300% creator fee for 0–420 SOL mcap and ranging up to 0.950% in the 420–1470 SOL band, then tapering down as mcap grows. Full schedule on pump.fun/docs/fees.

## Who receives the creator fee?

The pubkey passed as `creator` to the Pump program's `create` instruction. That pubkey owns the `creator_vault` PDA (`seeds = ["creator-vault", bonding_curve.creator]`) where fees accumulate.

**In our flow (PumpPortal Lightning):** PumpPortal calls `create` using the wallet associated with our `PUMPPORTAL_API_KEY`, i.e. our **PUMPPORTAL_CUSTODIAL_WALLET**. That custodial wallet is therefore the on-chain creator and the only signer that can call `collectCreatorFee` to drain the vault.

## How `collectCreatorFee` works

Per https://pumpportal.fun/creator-fee/:
- POST to `/api/trade?api-key=...` with `{ action: "collectCreatorFee", priorityFee, pool: "pump" }`.
- For `pool: "pump"`, the API claims **all accumulated creator fees across every Pump.fun coin the API-key wallet created** in a single tx — `mint` is NOT required and is ignored.
- For `pool: "meteora-dbc"`, `mint` IS required.
- Returns a tx signature. Fees land in the custodial wallet (the creator pubkey).

**Implication:** our distributor cannot easily attribute claimed SOL to a specific launch via the API — it has to read the custodial wallet's balance delta around the claim. This is already what `claimPumpfunFees.ts` does (pre/post balance diff), so the architecture is correct.

## What this means for Erys today

1. Every Pump.fun coin we launch has creator fees enabled by default — there is no flag we need to pass in the Lightning `create` call. The custodial wallet IS the creator, so it accrues 0.300% of every bonding-curve swap.
2. `collectCreatorFee` will return non-zero fees as soon as **any** of our launched coins sees trading volume — it batches across all our coins in one call.
3. Our `pumpfun_fees_claimed_total = 0` for all rows is NOT a fee-eligibility bug. As of 2026-04-25, every Pump.fun launch in the DB is in `execution_failed` status, so there is no live coin generating fees yet. Fix the launch failures first; fee accrual will start automatically once a token actually mints.
4. After graduation, the same `collectCreatorFee(pool: "pump")` call continues to work for the now-canonical PumpSwap pool. No code change needed at graduation boundary.

## What this does NOT cover

- Coins that ever migrate to Raydium (instead of PumpSwap canonical pool) stop earning creator fees — out of Pump.fun's control. Pump.fun's normal graduation path is to PumpSwap, so this is rare.
- "Non-canonical" PumpSwap pools (created by anyone, not via Pump's `migrate`) pay 0% creator fee. Not relevant to our launch path.