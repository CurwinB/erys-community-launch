# Fix: stop refunding the sponsor seed to the influencer on execution failures

## Problem (confirmed)

`executor/src/refundFailedLaunch.ts` iterates every `contributions` row and refunds to `contrib.wallet_address`. For sponsored launches, `fundSponsoredEscrow.ts` previously inserted a row representing the platform's 0.1 SOL seed with `wallet_address = influencer pump wallet` and `tx_signature = launch.sponsored_tx_signature`. So when a sponsored launch hits any `setFailed` path, the platform's seed is sent to the influencer and `sweepCancelledSponsorEscrows` later finds an empty escrow (real example: launch `ac19ded6…`).

`cancelAndRefund.ts` already handles this correctly via a sponsor-seed carve-out. We mirror that here.

## Change — `executor/src/refundFailedLaunch.ts` only

1. **Expand the launch select** to include the fields needed to identify a sponsored seed:
   - `is_sponsored`, `sponsored_amount_lamports`, `sponsored_tx_signature`

2. **Identify the seed contribution** after loading contributions. Match by `tx_signature === launch.sponsored_tx_signature` (this is the exact dedupe key `fundSponsoredEscrow` uses when inserting the row — more precise than `is_fee_claimer`, which is `true` for normal contributors too). Skip the row entirely in the refund loop (`continue` before the payout block) so no SOL is sent to the influencer for the seed.

3. **Reserve the seed lamports from `escrowAvailable`** before the loop, identical to `cancelAndRefund.ts` lines 88–100:
   ```ts
   const sponsorSeed = launch.is_sponsored
     ? BigInt(launch.sponsored_amount_lamports || 0) : 0n;
   if (sponsorSeed > 0n) {
     escrowAvailable = escrowAvailable > sponsorSeed
       ? escrowAvailable - sponsorSeed : 0n;
     console.log(`refundFailedLaunch ${launchId}: reserving ${Number(sponsorSeed) / LAMPORTS_PER_SOL} SOL sponsor seed for treasury sweep.`);
   }
   ```
   This guards real contributors from being silently overpaid out of the seed if any individual refund payout is capped by remaining escrow.

4. **Log when the seed row is skipped**, e.g.
   `refundFailedLaunch ${launchId}: skipping sponsor seed contribution row ${contrib.id} (${amount} lamports) — reserved for treasury recovery.`

5. Add the `LAMPORTS_PER_SOL` import from `@solana/web3.js` for the log line.

## Out of scope

No changes to `cancelAndRefund.ts`, executor entry, distributor, fee-claimer, or any other file. The existing `sweepCancelledSponsorEscrows` worker already recovers the reserved seed on its next cycle once the launch is `cancelled`.

## Why this is safe

- Existing non-sponsored launches: `is_sponsored` is false → carve-out is a no-op, behavior unchanged.
- Sponsored launches that already succeeded: function early-returns on `launched`/`sweep_recovery` (lines 43–51), unaffected.
- Already-refunded sponsored seeds (historic rows like `ac19ded6…`): `refund_tx_signature` is set, the loop already `continue`s — no double-spend risk.
