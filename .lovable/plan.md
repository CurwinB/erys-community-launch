

# Three Medium-Severity Fixes: Mint Validation, Retry Math, Dust Lockout

Three surgical fixes. No frontend, no schema, no env changes.

## Fix 1 — Validate mint keypair matches stored mint address

**File:** `supabase/functions/execute-launch/index.ts` (`executePumpfunLaunch`, around line 605)

**Problem:** After decrypting `pumpfun_mint_keypair_encrypted` and constructing `mintKeypair`, the function signs and submits without verifying the derived public key matches `launch.token_mint_address`. A corrupted or mis-stored mint secret would launch a token at a different mint than the one stored in the DB, causing the Railway distributor (which uses `launch.token_mint_address`) to look at the wrong escrow ATA and skip every distribution.

**Change:** Immediately after `const mintKeypair = Keypair.fromSecretKey(mintSecret);` and before `tx.sign([mintKeypair, escrowKeypair]);`:

```ts
const derivedMintAddress = mintKeypair.publicKey.toBase58();
if (derivedMintAddress !== launch.token_mint_address) {
  await setFailed(
    supabase,
    launch.id,
    `Mint keypair mismatch. Stored: ${launch.token_mint_address}, Derived: ${derivedMintAddress}`
  );
  return errorResponse("Mint keypair does not match stored token mint address");
}
console.log(`Mint keypair verified: ${derivedMintAddress}`);
```

Fail-closed: launch is marked failed and no on-chain submission happens.

## Fix 2 — Prevent over-distribution on partial-failure retry

**File:** `distributor/src/distribute.ts` (`distributeTokensForLaunch`, around lines 165-192)

**Problem:** `calculateSharesFromBalance` divides the *current* escrow balance proportionally across the *currently unpaid* contributors. After a partial-failure retry, the residual balance (≈ what the failed contributors should have received) is divided across only the failed set — but those proportions are computed against the smaller residual total, which inflates each remaining share relative to their original entitlement. Net effect: failed contributors collectively receive too much, breaking the proportional fairness invariant.

**Change:** Before calling `calculateSharesFromBalance`, reconstruct the original total by summing already-distributed `token_amount` values plus the current escrow balance, and pass that total instead:

```ts
// Reconstruct the original distributable total to keep proportional shares
// stable across retry cycles.
const { data: alreadyDistributed } = await supabase
  .from("contributions")
  .select("token_amount")
  .eq("launch_id", launch.id)
  .eq("tokens_distributed", true);

const previouslyDistributed = (alreadyDistributed || []).reduce(
  (sum: bigint, c: any) => sum + BigInt(c.token_amount || "0"),
  0n
);

const originalTotalBalance = tokenBalance + previouslyDistributed;

console.log(`Token balance in escrow: ${tokenBalance}`);
console.log(`Previously distributed: ${previouslyDistributed}`);
console.log(`Original total for share calc: ${originalTotalBalance}`);

const shares = calculateSharesFromBalance(
  contributions,
  originalTotalBalance,
  launch.created_by_wallet
);
```

Note: `calculateSharesFromBalance` is called with the *pending* contributions list, so the per-contribution shares it returns are still correct entitlements out of the original pool. The remainder-assignment line inside `calculateSharesFromBalance` (`rawShares[0].share += remainder`) operates on `actualBalance - sum(rawShares)` and will produce a small positive remainder relative to `originalTotalBalance` — this is harmless on a first run (transferred normally) and on a retry will resolve to dust within the residual escrow balance. No change needed inside `calculateSharesFromBalance`.

The pre-write loop that stores `token_amount` per contribution remains correct: it now stores the contributor's true share of the original pool, which matches what they will eventually receive.

## Fix 3 — Don't stamp 24h lockout on dust claims

**File:** `distributor/src/claimPumpfunFees.ts` (lines 107-113)

**Problem:** When `distributableLamports <= 0` (claim came in below the 10,000-lamport tx-fee reserve), `updatePumpfunFeesClaimed` is still called, which stamps `pumpfun_fees_last_claimed_at = now()`. This locks the launch out of the next 24h of cycles even though no SOL was sent to anyone. A low-volume token whose hourly fees sit just under the dust threshold will *never* accumulate enough to clear the threshold because every claim resets the cooldown.

**Change:** Replace the dust-path early return body so the timestamp stays untouched:

```ts
if (distributableLamports <= 0) {
  console.log(
    `Claimed amount too small to distribute after tx fees for launch ${launch.id}. Fees will accumulate and be claimed next cycle.`
  );
  // Do NOT stamp timestamp — allow fees to accumulate and retry next cycle
  return;
}
```

Effect: dust claims still moved SOL into escrow (correct — that SOL is now sitting in escrow waiting), but the next 6h cycle will retry, the next `collectCreatorFee` will return ~0 new delta but the cumulative escrow balance grows, and once it exceeds the 10k-lamport reserve the split runs and the timestamp finally stamps. This pairs cleanly with the existing pre/post balance-delta logic that already handles "no real claim happened" via the earlier `claimedLamports <= 0` guard.

Minor caveat: `pumpfun_fees_claimed_total` will under-report by the dust amounts that accumulated in escrow but were never split. This is acceptable — those lamports are still recoverable from escrow and will be counted on the cycle that finally distributes them (the post-claim delta will include them).

## Out of scope

- Low/info items from prior audits (deprecated `confirmTransaction` signature, concurrency guard on `claimAllPumpfunFees`, claimedLamports net-of-fee accounting, `db.ts` bigint typing).
- No edits to `index.ts`, `db.ts`, `decrypt.ts`, edge functions other than `execute-launch`, frontend, schema, or env vars.

## Files

- Edit: `supabase/functions/execute-launch/index.ts`
- Edit: `distributor/src/distribute.ts`
- Edit: `distributor/src/claimPumpfunFees.ts`

