

# Fix Pump.fun Fee Claim Bugs (F1, F3, F4, F7, D1)

Five fixes across the Railway distributor and a new Postgres function. No edge functions, no frontend, no new secrets.

## Fix 1 — Remove escrow-balance threshold gate (F1, High)

In `distributor/src/claimPumpfunFees.ts`:
- Delete `MIN_CLAIM_THRESHOLD` constant.
- Delete the pre-claim threshold check block that early-returns when escrow SOL < 0.01 (and its `updatePumpfunFeesClaimed(launch.id, 0)` skip-stamp).
- Keep one pre-claim balance read (`escrowBalanceBefore`) used solely for delta math.
- Always proceed to PumpPortal `collectCreatorFee`. After confirmation, compute `claimedLamports = newBalance - escrowBalanceBefore`. If `<= 0`, log "no fees claimed" and return without stamping (covered by Fix 3).

## Fix 2 — Reserve transfer fees before 50/50 split (F3, High)

After `claimedLamports` is computed and confirmed positive:
```ts
const TX_FEE_RESERVE = 10_000; // ~5000 lamports × 2 transfers
const distributableLamports = claimedLamports - TX_FEE_RESERVE;
if (distributableLamports <= 0) {
  console.log(`Claimed amount too small to distribute after tx fees for launch ${launch.id}`);
  await updatePumpfunFeesClaimed(launch.id, claimedLamports);
  return;
}
const platformShareLamports = Math.floor(distributableLamports * PLATFORM_SHARE);
const creatorShareLamports  = distributableLamports - platformShareLamports;
```
Existing `SystemProgram.transfer` blocks for platform and creator stay the same — they just consume `platformShareLamports` / `creatorShareLamports`.

## Fix 3 — Don't stamp timestamp on no-op claims (F7, Medium)

Remove every `updatePumpfunFeesClaimed(launch.id, 0)` call on early-return paths (skip and zero-delta). Only call `updatePumpfunFeesClaimed` once a real, non-zero claim has been settled (after the transfers). This lets the next 6-hour cycle retry instead of being locked out for 24h.

## Fix 4 — Raise claim priority fee (F4, Medium)

In the PumpPortal request body:
```ts
priorityFee: 0.00005   // was 0.000001
```
Matches the launch-execution priority fee.

## Fix 5 — Atomic increment via Postgres RPC (D1, Medium)

**Migration** — create the function:
```sql
CREATE OR REPLACE FUNCTION public.increment_pumpfun_fees_claimed(launch_id uuid, amount bigint)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.launches
  SET pumpfun_fees_last_claimed_at = now(),
      pumpfun_fees_claimed_total   = COALESCE(pumpfun_fees_claimed_total, 0) + amount
  WHERE id = launch_id;
$$;
```

**`distributor/src/db.ts`** — replace `updatePumpfunFeesClaimed`:
```ts
export async function updatePumpfunFeesClaimed(
  launchId: string,
  amountLamports: number
): Promise<void> {
  const { error } = await supabase.rpc("increment_pumpfun_fees_claimed", {
    launch_id: launchId,
    amount: amountLamports,
  });
  if (error) {
    console.error(`Error updating Pump.fun fee claim for launch ${launchId}:`, error.message);
  }
}
```
Single atomic UPDATE — no read-then-write race.

## Out of scope

- P5 already verified: Railway recalculates from on-chain balance, stored `token_amount` BP is unused noise.
- P1, P2, P4, P6, F5, F6, I1, I2 (low/cosmetic) — not addressed in this pass.
- No changes to edge functions, frontend, schema columns, or env vars.

## Files

- Edit: `distributor/src/claimPumpfunFees.ts`
- Edit: `distributor/src/db.ts`
- New migration: create `public.increment_pumpfun_fees_claimed(uuid, bigint)`

