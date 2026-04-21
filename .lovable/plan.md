

# Two Fixes: Semantic Column Use + Remove Distribution Cutoff

Both fixes are surgical, isolated, and low-risk. No frontend, no schema, no env changes.

## Fix 1 — Use `basis_points` instead of `token_amount` for pre-launch allocations

**File:** `supabase/functions/execute-launch/index.ts` (`executePumpfunLaunch`)

**Problem:** The pre-launch loop writes proportional basis points (a value out of 10,000) into `token_amount`. That column is semantically the actual token quantity distributed post-launch, and `distribute.ts` later overwrites it with the real token amount. Storing BPS there temporarily pollutes the field, makes the DB confusing to inspect mid-launch, and risks any reader between execute and distribute reading a 4-digit "token amount" that's actually a percentage.

**Change:** In the pre-launch contribution update loop, write to the `basis_points` column instead of `token_amount`:

```ts
for (const c of contributions) {
  const proportionalBps = Math.floor(
    (Number(BigInt(c.amount_lamports)) / Number(totalLamports)) * 10000
  );
  await supabase
    .from("contributions")
    .update({ basis_points: proportionalBps })
    .eq("id", c.id);
}
```

`basis_points` already exists on the `contributions` schema (integer, nullable) and is the semantically correct column. `token_amount` stays null until `distribute.ts` writes the real on-chain token quantity after launch confirmation.

**Safety check:** `distribute.ts` reads `token_amount` only for already-distributed contributions (`tokens_distributed = true`) when computing `previouslyDistributed` for the retry-stable share calc. On a fresh launch nothing is yet distributed, so the field being null is correct and expected.

## Fix 2 — Remove 48-hour cutoff from `getPendingDistributions`

**File:** `distributor/src/db.ts` (`getPendingDistributions`)

**Problem:** The query filters `created_at >= now() - 48h`. Any launch that goes `launched` but fails to fully distribute within 48 hours of creation drops off the polling list permanently, even though tokens may still be sitting in escrow. Combined with the partial-failure retry logic just added, this is a silent fund-loss path: retries work for 48h then the launch is invisible to the distributor forever.

**Change:** Drop the cutoff filter and the unused constant:

```ts
export async function getPendingDistributions(): Promise<Launch[]> {
  const { data, error } = await supabase
    .from("launches")
    .select("*")
    .eq("status", "launched")
    .eq("distribution_completed", false)
    .order("created_at", { ascending: true })
    .limit(5);

  if (error) {
    console.error("Error fetching pending distributions:", error.message);
    return [];
  }
  return (data as Launch[]) || [];
}
```

The `status = launched` + `distribution_completed = false` + `limit 5` ascending-by-creation guarantees the query stays small and prioritizes the oldest stuck launches first. No risk of unbounded growth — completed launches flip `distribution_completed = true` and exit the result set.

## Out of scope

- Audit-flagged low items (precision cast in `sendTokensToContributor`, claim-fee net accounting, claim concurrency guard).
- No edits to `claimPumpfunFees.ts`, `decrypt.ts`, edge functions other than `execute-launch`, frontend, schema, or env vars.

## Files

- Edit: `supabase/functions/execute-launch/index.ts`
- Edit: `distributor/src/db.ts`

