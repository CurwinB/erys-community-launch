

# Four Distributor Fixes: Precision, Concurrency, Stale Recovery, Confirmation API

All changes confined to the Railway distributor (`distributor/src/`). No edge functions, no frontend, no env vars. **One deviation from the prompt is required** (Fix 3) because the `launches` table has no `updated_at` column.

## Fix 1 — Pass `bigint` to `createTransferInstruction`

**File:** `distributor/src/distribute.ts` (`sendTokensToContributor`)

Drop the `Number(tokenAmount)` cast and pass `tokenAmount` directly. `@solana/spl-token`'s `createTransferInstruction` accepts `bigint`, so the cast was a precision-loss hazard for token amounts above `Number.MAX_SAFE_INTEGER` (~9.007e15). With 6-decimal tokens this is ~9 billion whole tokens, which is below typical 1B-supply launches but unsafe for higher-supply tokens.

## Fix 2 — Concurrency guard on `claimAllPumpfunFees`

**File:** `distributor/src/index.ts`

Add a module-level `claimRunning` boolean and a `runClaimIfIdle()` wrapper. Replace both call sites (startup `await` and `setInterval`) with the wrapper. Prevents overlapping 6-hour cycles if a previous cycle hangs (e.g. RPC stalls during many sequential transfers).

```ts
let claimRunning = false;

async function runClaimIfIdle(): Promise<void> {
  if (claimRunning) {
    console.log("Fee claim cycle already running, skipping this interval");
    return;
  }
  claimRunning = true;
  try {
    await claimAllPumpfunFees();
  } finally {
    claimRunning = false;
  }
}
```

Same pattern as the existing `processing` Set guard for distributions.

## Fix 3 — Recover stale `executing` launches (DEVIATION FROM PROMPT)

**Files:** `distributor/src/db.ts`, `distributor/src/index.ts`

**Deviation:** The prompt's `.lt("updated_at", staleCutoff)` will fail because **the `launches` table has no `updated_at` column** (verified against `supabase/migrations/` and `src/integrations/supabase/types.ts`). The available timestamp columns are `created_at`, `launch_datetime`, `distribution_completed_at`, and `pumpfun_fees_last_claimed_at`.

**Replacement signal:** Use `launch_datetime` — the scheduled launch time. A launch in `executing` status whose scheduled time is more than 10 minutes in the past is definitively stuck. This is actually a better signal than a generic `updated_at` because it's tied to the launch lifecycle rather than any DB update.

```ts
// distributor/src/db.ts
export async function resetStaleExecutingLaunches(): Promise<void> {
  const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("launches")
    .update({
      status: "execution_failed",
      execution_error: "Reset from stale executing state by distributor",
    })
    .eq("status", "executing")
    .lt("launch_datetime", staleCutoff);

  if (error) {
    console.error("Error resetting stale executing launches:", error.message);
  }
}
```

In `index.ts`, import and call at the top of `pollAndDistribute()` so it runs every 30 seconds. Stuck launches flip to `execution_failed`, which the existing pg_cron retry job picks up and re-executes.

**Note:** No log on success path to avoid log spam every 30s. Errors still log.

## Fix 4 — Replace deprecated `confirmTransaction(signature, commitment)` with strategy form

**Files:** `distributor/src/distribute.ts`, `distributor/src/claimPumpfunFees.ts`

The single-string form is deprecated and lacks blockhash expiry tracking — confirmations can hang indefinitely if the blockhash expires. The strategy object form `{ signature, blockhash, lastValidBlockHeight }` properly bounds the wait.

### `distribute.ts` — `sendTokensToContributor`

Destructure `lastValidBlockHeight` alongside `blockhash` from `getLatestBlockhash("confirmed")`, and pass the strategy object to `confirmTransaction`:

```ts
const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
tx.recentBlockhash = blockhash;
// ... sign, send ...
await connection.confirmTransaction(
  { signature, blockhash, lastValidBlockHeight },
  "confirmed"
);
```

### `claimPumpfunFees.ts` — three call sites

**Platform transfer + creator transfer** (lines ~133, ~157): straightforward — destructure `lastValidBlockHeight` from the existing `getLatestBlockhash()` call already used to set `recentBlockhash`. Pass strategy object to `confirmTransaction`.

**Claim tx** (line ~82): special case. The `VersionedTransaction` is returned **pre-built by PumpPortal** with its blockhash already baked into the message — we don't fetch a blockhash before signing. To use the strategy form we extract the blockhash from the deserialized message and fetch the current block height as a conservative `lastValidBlockHeight`:

```ts
const tx = VersionedTransaction.deserialize(claimTxBytes);
tx.sign([escrowKeypair]);

const claimBlockhash = tx.message.recentBlockhash;
const currentBlockHeight = await connection.getBlockHeight("confirmed");
// PumpPortal blockhashes have ~150 block validity (~60s). Use a conservative
// 150-block window from the current height as the expiry cutoff.
const claimLastValidBlockHeight = currentBlockHeight + 150;

const serialized = tx.serialize();
const signature = await connection.sendRawTransaction(serialized, {
  preflightCommitment: "confirmed",
});
await connection.confirmTransaction(
  { signature, blockhash: claimBlockhash, lastValidBlockHeight: claimLastValidBlockHeight },
  "confirmed"
);
```

This bounds the wait at ~60 seconds rather than potentially hanging forever on the deprecated form. If PumpPortal's blockhash was already older than fresh, the confirmation simply expires faster — which is the correct failure mode (we'll retry next 6h cycle).

## Summary of files

- `distributor/src/distribute.ts` — Fix 1 + Fix 4 (one call site)
- `distributor/src/claimPumpfunFees.ts` — Fix 4 (three call sites)
- `distributor/src/index.ts` — Fix 2 + Fix 3 wiring
- `distributor/src/db.ts` — Fix 3 (new function, uses `launch_datetime` not `updated_at`)

No schema migration. No new env vars. No edge function changes.

