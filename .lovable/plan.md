

# Fix Pump.fun Fee Claim Stamping + Distribution Priority Fee

Three medium-severity fixes across two distributor files. No edge functions, frontend, DB, or env changes.

## Fix 1 & 2 — Only stamp timestamp when both transfers succeed (`distributor/src/claimPumpfunFees.ts`)

**Problem:** Currently `updatePumpfunFeesClaimed` is called unconditionally after the platform/creator transfer blocks. If either `SystemProgram.transfer` throws, the catch logs the error but execution falls through to stamp `pumpfun_fees_last_claimed_at = now()`, locking the launch out of the next 24h of poll cycles with funds stranded in escrow.

**Change:** Track per-transfer success and gate the DB stamp on both succeeding.

- Introduce `let platformSent = false; let creatorSent = false;` before the two transfer blocks.
- In each transfer's `try`, set the corresponding flag to `true` after `confirmTransaction` resolves. Catches stay as logs only — no early returns.
- Replace the existing unconditional `await updatePumpfunFeesClaimed(launch.id, claimedLamports)` + "Fee claim complete" log at the bottom with:
  ```ts
  if (platformSent && creatorSent) {
    await updatePumpfunFeesClaimed(launch.id, claimedLamports);
    console.log(`Fee claim complete for launch ${launch.id}`);
  } else {
    console.error(
      `Fee claim incomplete for launch ${launch.id}. Platform sent: ${platformSent}, Creator sent: ${creatorSent}. Will retry next cycle.`
    );
  }
  ```
- The earlier no-op early-returns (zero claimed delta, distributable ≤ 0) are unaffected — they already correctly skip the stamp.

**Effect:** A failed transfer leaves the timestamp untouched, so the next 6h fee-claim cycle picks the launch back up. Note that on retry the next `collectCreatorFee` call will likely return ~0 new fees (the original claim already moved them into escrow), but the delta-based recompute will correctly use the residual escrow balance from the prior failed split via the next claim's pre/post delta — the operator can intervene if a launch repeatedly logs "Fee claim incomplete".

## Fix 3 — Add priority fee to token distribution transfers (`distributor/src/distribute.ts`)

**Problem:** `sendTokensToContributor` builds transactions with no compute-unit price. During mainnet congestion these can sit unconfirmed past the blockhash expiry (~90s) and fail. Affects both Bags and Pump.fun token distribution.

**Change:**
- Add `ComputeBudgetProgram` to the existing `@solana/web3.js` import.
- In `sendTokensToContributor`, immediately after `const tx = new Transaction();` and before the ATA-creation conditional, push:
  ```ts
  tx.add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 })
  );
  ```
- Remaining instruction order (optional `createAssociatedTokenAccountInstruction`, then `createTransferInstruction`) is unchanged.

**Effect:** Each distribution tx pays ~0.00005 SOL priority, matching the launch-execution priority budget. Escrow already holds enough SOL from the launch reserve to cover this for every contributor.

## Out of scope

- Low/informational items from the audit (P1, P2, P5, D1, D2, D5, F3, F7, decryption typing, SIGTERM handling).
- No changes to `db.ts`, `index.ts`, edge functions, frontend, schema, or env vars.

## Files

- Edit: `distributor/src/claimPumpfunFees.ts`
- Edit: `distributor/src/distribute.ts`

