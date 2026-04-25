
# Verify Pump.fun Creator Fee Behavior for Our Launches

## Why this plan exists
I confidently claimed every token we launch via Pump.fun earns creator fees automatically. The user correctly pushed back: the legacy Pump.fun model paid creators **nothing during bonding** (0%–99.9% progress) — only post-graduation LP fees. Pump.fun has since added "creator revenue sharing" but I don't have verified confirmation that:
1. Our launch flow opts into / qualifies for it
2. PumpPortal Lightning's `pool: "pump"` default enables it
3. `collectCreatorFee` actually returns SOL for our launched tokens during bonding

Before assuming `claimPumpfunFees.ts` will ever produce non-zero claims for pre-graduation tokens, we need to verify against current docs and on-chain reality.

## Investigation steps

### 1. Read current PumpPortal Lightning `create` documentation
Fetch https://pumpportal.fun/creation/?api=lightning and the trading docs to confirm:
- Whether the `create` action has any creator-fee related parameters
- Whether `pool: "pump"` defaults enable creator fees
- Whether there's a separate config (e.g., `creatorFeeBps`) we should be passing

### 2. Read current PumpPortal `collectCreatorFee` documentation
Fetch the relevant page to confirm:
- What conditions must be met for a mint to have collectible fees (graduated only? bonding too?)
- What the response looks like when fees = 0
- Whether the API errors or silently succeeds with 0 lamports moved

### 3. Read Pump.fun's own creator-rewards docs / changelog
Web-search "pump.fun creator rewards bonding curve" and "pump.fun creator revenue sharing 2025" to confirm the current program rules — specifically whether bonding-phase fees go to creators by default for tokens launched in 2025.

### 4. Query our DB for ground truth
Run a read-only query against `launches` joined with whatever table tracks claimed fees:
- How many `pumpfun` launches are in `launched` status?
- Of those, how many have `pumpfun_fees_claimed_total > 0`?
- What's the distribution — is it always 0, or do some have non-zero claims?

This tells us empirically whether our current pipeline ever sees fees, regardless of what the docs say.

### 5. Inspect our `create` call vs. PumpPortal docs
Diff the body we send in `executePumpfunLightning.ts` against the documented Lightning `create` schema. Identify any missing fields that would enable / configure creator fees.

## Possible outcomes & follow-up plans

After investigation, one of these is true:

**A. Creator fees ARE enabled by default for `pool: "pump"` and our setup is correct.**
- Action: Update memory with the verified facts. No code changes. Document expected fee accrual timing (bonding vs. post-graduation).

**B. Creator fees require an explicit field we're not passing.**
- Action: Plan a code change to `executePumpfunLightning.ts` to pass the correct field. Also plan a backfill discussion for existing live tokens (likely no remediation possible — they were created without it).

**C. Creator fees only apply post-graduation.**
- Action: Update memory. Modify `claim-pumpfun-fees` cron / `claimPumpfunFees.ts` to skip pre-graduation tokens (or accept that they'll be no-ops for weeks/months). Update user-facing dashboard messaging if it implies fees flow during bonding.

**D. Mixed model (e.g., small % during bonding, larger post-graduation).**
- Action: Document the split. Tune dashboard expectations.

## Files likely touched (depending on outcome)
- `.lovable/memory/features/` — new or updated memory file with verified facts
- `executor/src/executePumpfunLightning.ts` — only if outcome B
- `distributor/src/claimPumpfunFees.ts` — only if outcome C requires gating
- Dashboard copy in `src/pages/DashboardPage.tsx` or related — only if user-facing claims need correction

## What I will NOT do in this investigation
- Make code changes blindly based on assumed Pump.fun behavior
- Assert anything about creator fees without a doc/DB citation
- Touch the locking work we just shipped — that work is correct regardless of the fee-eligibility question

## Deliverable
A clear, cited answer to: "When a token launches through Erys via PumpPortal Lightning today, does the custodial wallet earn SOL fees during bonding, only after graduation, or never — and is our `collectCreatorFee` cron meaningful for our current launch population?"
