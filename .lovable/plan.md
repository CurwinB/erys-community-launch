## Goal

Stop second-guessing Bags. Follow their documented example **exactly** for `executor/src/executeBags.ts` Steps 0 → 3, and let any failure surface naturally instead of being masked by retries against a payload Bags never asked us to mutate.

## Why our current code is fighting Bags

The official Bags "Launch a Token" example (from `docs.bags.fm/how-to-guides/launch-token`) does exactly this for Step 3:

```ts
const tokenInfoResponse = await sdk.tokenLaunch.createTokenInfoAndMetadata({ ... });
// ...fee-share config...
const tokenLaunchTransaction = await sdk.tokenLaunch.createLaunchTransaction({
  metadataUrl: tokenInfoResponse.tokenMetadata,   // ← exactly what Bags returned
  tokenMint,
  launchWallet: keypair.publicKey,
  initialBuyLamports: launchParams.initialBuyAmountLamports,
  configKey,
});
```

The Bags `CreateTokenInfoResponse` schema (`/api-reference/create-token-info`) defines exactly two URL-ish fields: `tokenMint` and `tokenMetadata`. There is no `metadataUri`/`metadataUrl`/`uri` on the response — Bags expects you to pass `tokenMetadata` straight back, untouched.

Our code currently:
- Calls `pickBestMetadataUrl(tokenInfo)` which **rewrites the URL to `dweb.link` / `cf-ipfs` / `pinata`**.
- On retries, calls `rotateMetadataGateway()` which **mutates the URL again**.
- Pre-warms the URL via `fetch()` from Railway and retries up to 5 times across ~110s.

Bags' backend likely validates the metadata URL against the host **it pinned to** (the `ipfs.io` URL it returned). When we hand it `dweb.link/ipfs/<cid>`, Bags' validator either rejects it or its own fetcher fails — and we get the opaque 500. Every retry rotates to *another* gateway Bags didn't return, so all 5 attempts fail the same way.

The Bags changelog also confirms: when you let `createTokenInfoAndMetadata` upload, "we use the provided URL as-is" downstream. They want their URL back.

## What changes

### `executor/src/executeBags.ts`

1. **Step 0 — pass `tokenInfo.tokenMetadata` through verbatim.** Delete the URL rewrite. Store the literal Bags-returned URL in `ipfs_metadata_url`.

2. **Step 3 — call `createLaunchTransaction` with the exact same five fields the Bags example uses, in the same order:**
   ```ts
   launchTx = await sdk.tokenLaunch.createLaunchTransaction({
     metadataUrl: tokenInfo.tokenMetadata,
     tokenMint,
     launchWallet: escrowPubkey,
     initialBuyLamports: Number(netBuyLamports),
     configKey: new PublicKey(configKeyStr),
   });
   ```

3. **Delete the gateway machinery** — no longer needed:
   - `IPFS_GATEWAYS`
   - `extractIpfsCid`
   - `pickBestMetadataUrl`
   - `rotateMetadataGateway`
   - `verifyMetadataReachable`
   - the `node-fetch` import (verify nothing else in the file uses it; if so, leave it).

4. **Simplify the Step 3 retry loop.** Bags' docs treat `createLaunchTransaction` as a one-shot call. Keep a small safety net for genuine transport blips, but stop hammering:
   - `MAX_LAUNCH_TX_ATTEMPTS = 3`
   - Backoff: `5s, 15s` (≈20s span). Fits comfortably inside the existing lock.
   - Retry **only** on network-level errors (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`, `fetch failed`, `socket hang up`) and HTTP `429`/`503`.
   - **Treat HTTP `500` as terminal** — Bags returning 500 means the payload is bad (or their service is genuinely broken); retrying won't fix either, and our logs prove 5 attempts produce 5 identical 500s.
   - On exhaustion or terminal error: still call `setFailed` (auto-refund) when no on-chain SOL was committed, which is always true at this point. Drop the `setFailedNoRefund` branch for Step 3 — there is no scenario at Step 3 where keeping contributor SOL in escrow is the right answer.

5. **Keep the diagnostic logging** of `tokenInfo` keys + the Step 3 payload (`metadataUrl`, `tokenMint`, `launchWallet`, `initialBuyLamports`, `configKey`, `claimerCount`). These are cheap and let us correlate any future Bags 500 with their support team.

### `executor/src/db.ts`

6. **Revert `claim_executing_launch_for_worker` lock from 240s → 120s.** With the simplified retry budget (≤25s for Step 3) we no longer need the extended window, and 120s matches what every other path expects.

### Files NOT changed

- `executor/src/executeLaunch.ts` — unchanged.
- DB schema, RPCs, edge functions, UI — unchanged.
- Refund logic — unchanged (already correct).

## Recovery for the stuck launch `049c3955…`

After deploying:
1. Click **Retry** in admin. The new code will:
   - Call `createTokenInfoAndMetadata` for a fresh mint + Bags-canonical URL.
   - Reuse the existing `fee_share_config_key` PDA (already on-chain, harmless).
   - Call `createLaunchTransaction` with the exact URL Bags handed back.
2. If Bags still returns 500, the failure surfaces fast (~25s vs ~2min), `setFailed` runs, and contributors are auto-refunded. The opaque error body is captured in `execution_error` and we open a Bags support ticket with the logged payload.

## Why this is the right move

- We've spent two iterations adding workarounds for a symptom (500s) without evidence the workarounds help — the logs show all 5 rotated-gateway attempts failed identically. That's a strong signal the URL mutation is *causing* the rejection, not curing it.
- The Bags docs, SDK schema, and example code all agree: pass `tokenMetadata` through unchanged.
- Removing ~80 lines of speculative gateway code makes future debugging much easier — when Bags returns 500 again, we'll know it's their payload validator, not our gateway shuffle.

## Files to edit

- `executor/src/executeBags.ts` (delete helpers, simplify Steps 0 and 3, simplify retry)
- `executor/src/db.ts` (lock back to 120s)
