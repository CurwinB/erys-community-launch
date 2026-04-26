---
name: Pump.fun sweep recovery (Token-2022 + post-mint failures)
description: New launch_status sweep_recovery handles minted-but-not-distributed Pump.fun launches; refunds blocked once mint exists on-chain
type: feature
---

## Status enum

`launch_status` includes `sweep_recovery`. Set when a Pump.fun mint exists on-chain (`pumpfun_launch_signature` is persisted) but the custodial → escrow token sweep failed. The next executor poll claims it via `claim_sweep_recovery_launch_for_worker` and re-runs `recoverPumpfunSweep` (executor/src/recoverPumpfunSweep.ts), which performs only the token sweep + residual SOL sweep, then flips the launch back to `launched` so the distributor picks it up.

Use `markForSweepRecovery(id, reason, signature)` from executor/src/db.ts in any post-mint failure branch — never `setFailed` (would auto-refund) and never `setFailedNoRefund` (would strand the launch in `execution_failed`).

## Token-2022 end-to-end

Both executor (`pumpportalCustodial.sweepTokensToWallet`) and distributor (`distribute.ts`) detect the mint owner program via `getAccountInfo(mint).owner` and route ATA derivation, ATA creation, `getAccount`, balance lookups, and transfer instructions through the matching token program (`TOKEN_PROGRAM_ID` or `TOKEN_2022_PROGRAM_ID`). Hardcoding `TOKEN_PROGRAM_ID` anywhere in the Pump.fun path is a regression.

## Refund guardrails

`supabase/functions/refund-contributor`, `supabase/functions/refund-launch`, and `executor/src/refundFailedLaunch.ts` all refuse to refund when the launch is Pump.fun AND any of: `status = 'launched'`, `status = 'sweep_recovery'`, or `pumpfun_launch_signature IS NOT NULL`. Rationale: SOL is already in the bonding curve, so refunds would short-pay contributors while leaving tokens stranded.

## Distributor confirmation

`sendTokensToContributor` uses HTTP polling (`getSignatureStatuses` + 5s rebroadcast, 90s window) instead of `confirmTransaction`. Helius/Alchemy basic tiers don't support `signatureSubscribe`.
