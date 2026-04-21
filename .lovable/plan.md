

# Add Pump.fun Creator Fee Claiming to Railway Distributor

All changes are inside `distributor/` only. No Supabase edge functions touched.

## 1. Update `distributor/src/db.ts`

- Extend `Launch` interface with: `platform: string`, `pumpfun_fees_last_claimed_at: string | null`, `pumpfun_fees_claimed_total: number`.
- Add `getPumpfunLaunchesForFeeClaim()` — selects `status='launched'` + `platform='pumpfun'` where `pumpfun_fees_last_claimed_at` is null OR ≤ 24h ago, limit 10.
- Add `updatePumpfunFeesClaimed(launchId, amountLamports)` — reads current total, sets `pumpfun_fees_last_claimed_at = now()`, increments `pumpfun_fees_claimed_total`.

## 2. Create `distributor/src/claimPumpfunFees.ts`

Per-launch flow (`claimPumpfunFeesForLaunch`):
1. Decrypt escrow private key → reconstruct `Keypair`.
2. Read escrow SOL balance via Alchemy RPC.
3. If balance < 0.01 SOL threshold, mark `last_claimed_at` and skip.
4. POST to `https://pumpportal.fun/api/trade-local` with `action: "collectCreatorFee"`, `pool: "pump"`, `priorityFee: 0.000001`.
5. Deserialize returned `VersionedTransaction`, sign with escrow keypair, submit via `sendRawTransaction`, confirm.
6. Compute `claimedLamports = newBalance − oldBalance`. If ≤ 0, mark and skip.
7. Split 50/50:
   - Platform share → `BAGS_PARTNER_WALLET` (reused as Erys platform wallet) via SystemProgram.transfer.
   - Creator share → `launch.created_by_wallet` via SystemProgram.transfer.
8. Call `updatePumpfunFeesClaimed(launch.id, claimedLamports)`.

Batch wrapper (`claimAllPumpfunFees`): fetches eligible launches, iterates with 1s delay between each, catches per-launch errors so one failure doesn't stop the loop.

## 3. Update `distributor/src/index.ts`

- Import `claimAllPumpfunFees`.
- Add `BAGS_PARTNER_WALLET` to `validateEnv` required array.
- After the existing `setInterval(pollAndDistribute, POLL_INTERVAL_MS)`, add a second loop:
  - Run `claimAllPumpfunFees()` immediately on startup.
  - `setInterval(claimAllPumpfunFees, 6 * 60 * 60 * 1000)` — every 6h. Per-launch 24h gate is enforced in the DB query.
- Log: "Pump.fun fee claiming enabled. Checking every 6 hours."

## 4. Update `distributor/.env.example`

Add line:
```
BAGS_PARTNER_WALLET=your-erys-platform-wallet-public-key
```

## Notes

- Reuses existing `decryptEscrowKey` and `@solana/web3.js` already imported by `distribute.ts`.
- No new npm dependencies needed.
- No Supabase edge functions, migrations, or frontend files modified.
- After deploy, ensure `BAGS_PARTNER_WALLET` is set in Railway env vars.

## Files

- Edit: `distributor/src/db.ts`
- Create: `distributor/src/claimPumpfunFees.ts`
- Edit: `distributor/src/index.ts`
- Edit: `distributor/.env.example`

