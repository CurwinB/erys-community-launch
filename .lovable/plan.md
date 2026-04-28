## Diagnosis

The Railway log shows the launch died at Step 3:

```
Step 3: createLaunchTransaction (mint=EPGFBU1G…BAGS configKey=6UCKGxu7… netBuyLamports=255871440 claimers=2)
Launch a7e8b27f… failed (no auto-refund): createLaunchTransaction failed
  (configKey=6UCKGxu7…, retry can reuse config): Request failed with status 500
```

What we know for certain:

- Steps 0, 2 succeeded. The fee-share config PDA is on-chain (`6UCKGxu7ppfJJJ9tsPYfTjVbDm997nqqyf4rnULevsjQ`) and persisted in the DB row, so any retry skips re-creation.
- The 500 came from Bags' `POST /token-launch/create-launch-transaction` — a build-only HTTP call, **nothing was broadcast on-chain**, so escrow SOL is fully recoverable.
- Bags' own docs say: "500 — retry with exponential backoff (max 5 attempts)". We currently fail on the first 500 and stop.
- We waited only **10s** between fee-share-config confirmation and `createLaunchTransaction`. The fee-share PDA was just created two slots earlier on the *same* validator path; Bags' indexer can lag behind chain finalization, and a freshly-created config can return 500 if their backend reads from a stale replica.
- Our error wrapper (`describeBagsError`) extracted only `Request failed with status 500` — it didn't surface Bags' JSON body (`{success:false,error:"…"}`) because the Bags SDK throws a generic `Error` whose `response` property isn't always populated. We're flying blind on the actual reason.

So this is two problems compounding:

1. **No retry on 500** for `createLaunchTransaction`, despite Bags explicitly recommending it and the call being trivially safe to retry (no on-chain side-effect).
2. **No body capture** when the SDK throws — we only see "status 500", which is why we keep going back and forth.

There's also a UX problem: with `setFailedNoRefund`, the launch sits in `execution_failed` requiring the operator to manually click Retry. For a build-only failure where nothing landed, the executor should retry automatically inside the same run.

---

## Fix

### 1. Retry `createLaunchTransaction` with backoff (executor/src/executeBags.ts)

Wrap the `sdk.tokenLaunch.createLaunchTransaction(...)` call in a retry loop:

- Up to **5 attempts** with exponential backoff: 2s, 4s, 8s, 16s, 32s.
- Retry only on **500/502/503/504** and network errors. Do **not** retry 400/401/403/404 (per Bags docs).
- Each retry reuses the existing `configKeyStr` (already persisted), so no extra SOL is spent.
- Log each attempt and the captured Bags response body.

Pseudocode:

```text
for attempt in 1..=5:
  try:
    launchTx = await sdk.tokenLaunch.createLaunchTransaction({...})
    break
  catch err:
    body = await captureBagsErrorBody(err)   // see step 2
    status = body.status
    log("createLaunchTransaction attempt {attempt} failed status={status} body={body}")
    if status in {400,401,403,404}: setFailedNoRefund(...); return
    if attempt == 5: setFailedNoRefund(...); return
    await sleep(2000 * 2^(attempt-1))
```

### 2. Capture the actual Bags error body

The Bags SDK uses axios under the hood and the response body lives on `err.response.data`, but our `describeBagsError` only reads it when present and falls back to `err.message`. Strengthen it:

- Inspect `err.response?.data`, `err.response?.body`, `err.cause`, `err.body`, and `err.toJSON?.()`.
- If the SDK swallowed the body, fall back to a direct `fetch` of `${BAGS_API_BASE_URL}/token-launch/create-launch-transaction` with the same payload so we always get the JSON `{success,error}` text in `execution_error`.

This means future 500s will tell us *why* (e.g. "config not yet indexed", "invalid initialBuyLamports", "metadata fetch failed").

### 3. Wait longer for the fee-share config to index

10s is empirically too short when the fee-share config is brand-new. Two changes:

- Bump the post-config sleep from **10s → 25s** when `needsCreation === true` was true on this run.
- After the sleep, **verify the config PDA actually exists** via `connection.getAccountInfo(configKey, "confirmed")` before calling `createLaunchTransaction`. If absent, sleep another 10s and recheck (max 3 rechecks). This eliminates the race where Bags' API reads from an indexer that hasn't caught up to our confirmed slot.

If config was reused (`needsCreation === false`) we keep the 10s wait — it's already on-chain and indexed.

### 4. Treat exhausted-retry build-only failures as auto-refundable

Today `createLaunchTransaction` failure goes through `setFailedNoRefund` so contributor SOL is held until the admin acts. That made sense when we feared partial state, but this call is purely a build-time HTTP fetch — by definition no tx was broadcast. Change behaviour:

- If retries are exhausted with **only** 500/network errors → use `setFailed` (auto-refund). The fee-share config PDA is harmless to leave on-chain; it just sits idle.
- If we got a 4xx → still `setFailedNoRefund` (signals our request shape is wrong; admin should investigate before refund).

This restores the auto-refund path the user expects when launches fail before any mint exists.

### 5. Operational cleanup for the stuck launch `a7e8b27f-…`

This launch already has the fee-share config on-chain. After the patch lands the operator can simply click **Retry** on the admin Launches tab — the new retry loop will reuse `configKey=6UCKGxu7…`, skip the fee-share step entirely, and call `createLaunchTransaction` up to 5 times. If it still fails (Bags backend genuinely broken), the operator can click the **Refund (2)** button next to it to return the 0.26 SOL to the two contributors.

No code change is needed to recover this specific launch — the existing Retry/Refund admin UI handles it once the executor is patched.

---

## Files to change

- `executor/src/executeBags.ts` — retry loop around `createLaunchTransaction`, longer + verified post-config wait, smarter `setFailed` vs `setFailedNoRefund` decision, beefed-up `describeBagsError` (or a `fetchBagsLaunchTxDirect` fallback that returns the raw JSON body).

No DB schema changes. No edge-function changes. No admin UI changes (the Refund/Retry buttons added in the prior task already cover the manual-recovery path for the currently stuck launch).

---

## Why this finally fixes the loop

Past iterations chased "Config already exists", signature-verification races, and missing meteoraConfigKey — all of which we've already fixed. This is a *different* class of failure: a transient 500 from Bags on the next API call, made worse by an indexer race we never accounted for. Retrying with backoff + waiting for indexer + capturing the real error body covers all three failure modes that have surfaced on this endpoint, and aligns directly with Bags' published retry guidance.