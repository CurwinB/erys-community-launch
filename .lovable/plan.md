# Increase launchWallet SOL reserve for Bags createLaunchTransaction

## What Bags told us

> "Make sure the createLaunchTransaction call gets a launchWallet passed that has enough SOL to cover the TX cost of launching."

In every recent failed launch the escrow (launchWallet) held ~0.256 SOL and we passed the *entire* balance minus a 20,000-lamport (0.00002 SOL) reserve as `initialBuyLamports`. The Bags launch transaction itself (priority fee, compute units, ATA rent for the launch wallet's token account, lookup-table rent paid by the wallet, etc.) costs far more than 20k lamports, so Bags' build step rejects with a 500.

## Root cause

`executor/src/executeBags.ts` lines 477–487:

```text
ATA_COST                       = 2,039,280   (per *contributor* ATA only)
TX_FEE                         = 5,000       (per contributor distribution)
PRIORITY_FEE_PER_CONTRIBUTOR   = 10,000
BASE_TX_FEES                   = 20,000      <-- the only buffer left in escrow for the LAUNCH tx itself
LOOKUP_TABLE_RENT              = 2,550,000   (only if >15 contributors)

netBuyLamports = availableLamports - ataReserve - lookupTableReserve - BASE_TX_FEES
```

Problems:
1. `BASE_TX_FEES = 20_000` lamports is meant to cover *the launch tx fee itself* on the launchWallet, but Bags' launch tx pays priority + compute + creator-ATA rent (~0.005–0.012 SOL real-world). 20k is two orders of magnitude too small.
2. We don't read the actual on-chain escrow balance before calling Bags — we trust `sum(contributions)`. Sponsor seed, dust, or already-debited processing fee can drift this.

## Fix

1. Replace `BASE_TX_FEES = 20_000n` with a `LAUNCH_TX_RESERVE` constant sized to cover Bags' launch tx in the worst case. Use **15,000,000 lamports (0.015 SOL)** — empirically covers compute + priority + creator ATA rent + tx fee with margin, and is still small relative to our 0.3 SOL minimum raise.
2. Before computing `netBuyLamports`, read `connection.getBalance(escrowPubkey)` and use `min(availableLamports, onChainBalance)` so we never promise Bags more SOL than the wallet actually holds.
3. Bump the `netBuyLamports < 10_000_000` guard message to include the on-chain balance so future failures are diagnosable.
4. No changes to fee-claimer math, BPS, processing fee, or distribution logic.

## Files touched

- `executor/src/executeBags.ts` — reserve constant, on-chain balance check, error message.

## Out of scope

- Pump.fun executor (separate code path; Bags-specific guidance).
- Refund logic (unchanged — if `netBuyLamports` falls below threshold the existing `setFailed` path triggers normal refunds).
- Retrying the already-failed launches in DB (admin can use existing retry once deployed; configKeys are reusable per existing logic).
