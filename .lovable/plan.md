## Add timing delays for Bags fee-share config indexing

### Problem
The `create-launch-transaction` step at Bags fails repeatedly because the fee-share config account isn't yet indexed by Bags' backend when we call it. The current 500ms gap between fee-share transactions is too tight, and there is zero delay between the last fee-share tx and `create-launch-transaction`.

### Changes (one file: `executor/src/executeBags.ts`)

**1. Increase per-fee-share-tx delay from 500ms → 2000ms** (line 194)

Find:
```ts
await new Promise((r) => setTimeout(r, 500));
```
Replace with:
```ts
await new Promise((r) => setTimeout(r, 2_000));
```

**2. Add a 10-second settle wait after fee-share completes**, before the `// Step 2: create-launch-transaction` block (around line 200, after `configKey = returnedConfigKey;` and the closing of the `else` branch).

Insert immediately before `// Step 2: create-launch-transaction`:
```ts
  // Wait for Bags to index the fee-share config on-chain before proceeding
  console.log("Waiting 10 seconds for fee-share config to settle on-chain...");
  await new Promise((r) => setTimeout(r, 10_000));
```

Note: The wait runs on every execution (including the retry path that reuses `launch.fee_share_config_key`). This is intentional and safe — if the config has already been indexed from a previous attempt, the extra 10s is harmless; if a retry happens immediately after a fresh fee-share submission that didn't quite complete, the buffer protects us.

### Out of scope
- No DB schema changes
- No env var changes
- No other files touched
- No changes to `executePumpfun.ts`