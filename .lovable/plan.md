## Problem

The launch `31b4b633…` reverted on-chain with `InstructionError [5, Custom: 1]` from the Pump.fun program. The Custom:1 inside the buy CPI = "insufficient SOL on the payer". The Lightning wallet didn't have enough headroom to cover the create+buy transaction's incidental costs.

### Why this regressed for per-launch wallets

In `executor/src/executePumpfunLightning.ts` (lines 196-206), the per-launch path explicitly zeroes out the funding buffer:

```ts
const fundingTxFee = isPerLaunchWallet ? 0n : 5_000n;
const fundingBuffer = isPerLaunchWallet ? 0n : CUSTODIAL_FUNDING_BUFFER_LAMPORTS;
const initialBuyLamports = availableLamports - ataReserve - fundingTxFee - fundingBuffer;
```

Then we tell PumpPortal to buy `initialBuyLamports` SOL. With the legacy pooled wallet we *added* a 0.025 SOL buffer on top when funding the custodial wallet (line 273). With the per-launch wallet we don't fund anything — the wallet's full balance is `availableLamports`, and we ask it to spend almost all of that on the buy, leaving only the contributor-distribution ATA reserve untouched.

The create+buy tx the Lightning API submits has to pay, *out of the same wallet*, all of:
- mint metadata account rent (~0.00204 SOL)
- custodial token-account ATA rent (~0.00204 SOL)
- Pump.fun 1% protocol fee on the buy (~0.0025 on a 0.25 SOL buy)
- Pump.fun 0.30% creator fee
- compute + priority fees (~0.001 SOL)
- network signature fee

That's roughly 0.01–0.015 SOL of headroom needed *in addition to* the buy amount. With buffer = 0 the wallet runs short mid-CPI and Pump.fun reverts.

The reverted run also produced a misleading log line: `refundFailedLaunch: skipping … Pump.fun mint exists on-chain`. The mint does NOT exist (the create instruction reverted), but `setFailedWithSignature` persists `pumpfun_launch_signature`, and `refundFailedLaunch.ts` (lines 39-49) treats *any* non-null signature as proof the mint exists and refuses to refund. So contributors are stuck and not auto-refunded.

## Fix

### 1. Reserve a launch-tx buffer for per-launch wallets

In `executor/src/executePumpfunLightning.ts`, stop zeroing the buffer for the per-launch path. The buffer doesn't need to cover an escrow→custodial transfer (there is none), but it MUST stay *retained* in the Lightning wallet so the create+buy tx can pay rents + protocol fees.

Change lines 203-206 to subtract the same `CUSTODIAL_FUNDING_BUFFER_LAMPORTS` from `initialBuyLamports` in both paths. The per-launch path doesn't need `fundingTxFee` (no separate funding tx), but it does need the buffer.

Also rename the constant to something accurate (e.g. `LAUNCH_TX_RESERVE_LAMPORTS`) since "funding buffer" no longer matches its meaning in the per-launch model. 0.025 SOL is fine; it stays in the Lightning wallet and any leftover becomes part of the long-term fee-harvest balance.

Update the `< 10_000_000n` minimum-buy guard error message to reference both the processing fee and the launch-tx reserve.

### 2. Fix the auto-refund false-positive on reverted launches

In `executor/src/refundFailedLaunch.ts` (lines 39-49), the gate currently bails on any non-null `pumpfun_launch_signature`. That's wrong — we explicitly persist the signature on `reverted` and `not_landed` failures (executePumpfunLightning.ts lines 426-443) precisely so they remain traceable, not because tokens exist.

Tighten the gate to only skip when we have positive evidence the mint exists:
- `status === 'launched'` or `status === 'sweep_recovery'` → skip (current behavior, correct)
- otherwise (e.g. `status === 'execution_failed'`) → do an on-chain `getSignatureStatus` for `pumpfun_launch_signature`. If `value.err` is set OR the signature isn't found, the mint does NOT exist → proceed with refunds. Only skip if the tx confirmed without error.

This way reverted launches auto-refund and successful-but-mid-sweep launches still don't.

### 3. Manually recover the stuck launch

After deploying:
- Trigger refunds for `31b4b633-ba6a-4af8-8b0b-01ab8ed38a15` via the existing `refund-launch` edge function / admin Refunds tab. (The fix in #2 won't retroactively unstick this one since it's already in `execution_failed` with no auto-retry path; admin action is the intended recovery surface.)

## Files to edit

- `executor/src/executePumpfunLightning.ts` — apply buffer to per-launch path; rename constant; tighten min-buy error message
- `executor/src/refundFailedLaunch.ts` — replace signature-presence check with on-chain status check

No DB migration, no new env vars, no edge-function changes.

## Out of scope

- Changing the buffer size (0.025 SOL is well-tested; the issue is that we're applying 0)
- Pre-flight balance simulation (would catch this earlier but is a larger change)
- Reworking how `pumpfun_launch_signature` is stored on failure (kept as-is for traceability)
