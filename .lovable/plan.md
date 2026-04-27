## What actually happened (full forensics)

Launch `643a4fe0` ("Etest"). I pulled every escrow tx from chain — here's the real sequence:

| Time | Tx | What | Result |
|---|---|---|---|
| 13:31:17 | `34Zb44…` | Sponsor seed in (0.0999 SOL from Bags wallet) | ✅ on-chain |
| 13:32:44 | `2Z1dgS…` | Contributor `BvpGuDSL…` deposits 0.23 SOL | ✅ on-chain |
| ~13:33 | `5wcFrb8…` | **Processing fee 0.06 SOL → treasury** | ✅ **finalized on-chain** |
| ~13:33 | – | `confirmTransaction` throws `block height exceeded` | ❌ executor gives up |
| 13:33:11 | `3uN7wc…` | Refund 0.0999 SOL → influencer `F46AiunP…` | ✅ |
| 13:34:12 | `3p78gn…` | Refund 0.169 SOL → contributor `BvpGuDSL…` | ✅ |

Final escrow balance: 890,880 lamports (~0.0009 SOL of dust).

### So what was actually deducted vs lost

- **Processing fee 0.06 SOL**: deducted from the escrow, **landed in the platform treasury wallet** (`BAGS_PARTNER_WALLET`). Not "lost" — it's in our own wallet. Nobody else got it.
- **Sponsor seed 0.0999 SOL**: refunded back to the influencer. Net for them: ~0.
- **Contributor 0.23 SOL**: refunded 0.169 SOL — they're **short ~0.061 SOL**. That's the processing fee + 2 tx fees, which the refund worker pro-rated against escrow balance.

The bug isn't "money disappeared" — it's that **the contributor effectively paid the processing fee for a launch that never happened.**

### Why it happened

`executor/src/processingFee.ts` does `sendRawTransaction` then `confirmTransaction`. When the RPC throws `block height exceeded` (network blip, slow inclusion), the function throws → the launch is marked `execution_failed` → the auto-refund worker runs → contributors are made roughly whole minus the already-debited fee. **The actual fee tx finalized 30s later**, but by then we'd already aborted.

`fundSponsoredEscrow.ts` has the exact pattern needed — it polls `getSignatureStatuses` after a confirm timeout and re-checks balance before declaring failure. `processingFee.ts` never got that treatment, so it's the one fragile link in the chain.

## Fix

### 1. Harden `executor/src/processingFee.ts`

- Wrap `confirmTransaction` in try/catch.
- On timeout: poll `getSignatureStatuses([sig], {searchTransactionHistory:true})` for ~30s. If `confirmed`/`finalized` → return success with that sig.
- If not landed and blockhash truly expired: build a fresh tx with new blockhash and retry up to 2x.
- Only throw after all paths fail.

### 2. Idempotency

- Before charging, if `launches.processing_fee_tx_signature` is already set, query its on-chain status. If finalized → skip the charge and treat as already paid.
- This makes execution-retry safe.

### 3. Make execution retryable for this failure class

- In `LaunchesTab` (admin), expose a "Retry execution" action for `execution_failed` rows. It clears `execution_error`, clears `worker_locked_at/worker_id`, and flips `status` back to `executing`. The hardened + idempotent code from #1 and #2 makes the retry safe — it won't double-charge or double-buy.

### 4. Manual recovery for this specific launch (`643a4fe0`)

We can't relaunch this one — both contributors have already been refunded, and the influencer's pump wallet was never registered with Pump.fun. Options to make the contributor (`BvpGuDSL…`) whole:
- Ship them ~0.061 SOL out of the treasury (the 0.06 we collected + ~0.001 in network fees they ate). This is the cleanest fix and a tiny amount.
- A new admin "Refund processing fee" action could automate this for any future occurrence: pulls the missing amount from treasury back to the affected contributor.

I'll add the manual top-up call as a one-shot script (`/tmp/refund_processing_fee.ts`) we run after the code lands.

## Files

**Edit**
- `executor/src/processingFee.ts` — confirm-timeout polling + fresh-blockhash retries + idempotency check
- `executor/src/executePumpfunLightning.ts` — pass existing `processing_fee_tx_signature` into `chargeProcessingFee` for skip-if-paid
- `executor/src/executeBags.ts` — same idempotency hookup
- `src/components/admin/LaunchesTab.tsx` — "Retry execution" button for `execution_failed` (only if not already there)
- `supabase/functions/` — small edge function `retry-failed-launch` that does the status flip with admin auth

**One-off**
- `/tmp/refund_processing_fee.ts` — script to send ~0.061 SOL from treasury to `BvpGuDSL…` to close out this incident. Not committed.

**No DB migration** — `processing_fee_tx_signature` already exists on `launches`.

## Why this won't regress

- The funding worker already runs the same recover-on-timeout pattern in production fine; we're literally porting it.
- Idempotency check is one cheap RPC call; trivially skipped when the sig column is null.
- Fee economics, threshold, distributor math: all unchanged.
- Auto-refund behavior on truly-failed launches: unchanged.
