## Diagnosis — what the logs actually show

The log timeline for launch `049c3955…`:

```
16:45:23  Step 0  createTokenInfoAndMetadata    OK   (mint ARrob…BAGS, ipfs.io/ipfs/QmWhpb…)
16:45:23  Step 2  fee-share config              built (key 5tPW…m5QM, needsCreation=true, 2 txs)
16:45:24  fee-share-tx-1   submitted 2VQK…kJov
16:45:26  fee-share-tx-2   submitted 2oQX…Sm7d
16:45:28  Wait 25s for indexer
16:45:58  fee_share_config 5tPW… confirmed on-chain (1048 bytes)   ← PDA verified
16:45:58  Step 3  createLaunchTransaction (netBuy=255871440, claimers=2)
          attempt 1/5 → 500 {"success":false,"response":"Internal server error"}
          attempt 2/5 → 500 (same)
          attempt 3/5 → 500 (same)
          attempt 4/5 → 500 (same)
16:46:29  attempt 5/5 → 500 — give up, setFailedNoRefund
```

**Everything we built last round worked:**

- The retry loop fired all 5 attempts with proper backoff (2s/4s/8s/16s).
- The 25 s indexer wait + on-chain `getAccountInfo` verification confirmed the fee-share PDA exists (1048 bytes — that's the correct config size).
- `describeBagsError` now surfaces the real Bags body: `{"success":false,"response":"Internal server error"}`.

**The failure is on Bags' side, not ours.** Their `POST /token-launch/create-launch-transaction` is returning a hard 500 for *this specific payload* across 30+ seconds of retries. That rules out a transient blip — something in the request itself is making their backend throw. Their error response is opaque ("Internal server error") because their server-side logging swallowed the real cause.

### What's different about this payload that could trip Bags

Comparing our payload to known-good launches:

| Field | Value | Risk |
|---|---|---|
| `metadataUrl` | `https://ipfs.io/ipfs/QmWhpb59D4rQNA8mKM7EyGmx17iRRZhwxHEeuMKG6AWAfr` | **High** — `ipfs.io` is a public gateway that's frequently rate-limited / 504s. If Bags' backend fetches this URL to validate the JSON or pull the image, a gateway timeout there manifests as a 500 to us. |
| `tokenMint` | `ARrob…BAGS` (vanity grind suffix) | Low — Bags supports vanity mints. |
| `launchWallet` | escrow pubkey | Low. |
| `initialBuyLamports` | `255871440` (~0.256 SOL) | Low — well above the 10 M floor we check. |
| `configKey` | `5tPW…m5QM` (just-created PDA) | Low — verified on-chain. |
| `claimers` | 2 | Low. |

Two other launches recently failed at the **same step** (per the prior plan in `.lovable/plan.md` — `a7e8b27f…` also died at `createLaunchTransaction` with a 500). The pattern is "everything before Step 3 succeeds, Step 3 returns 500". This strongly points at the **metadata URL** as the common offender — `createTokenInfoAndMetadata` returns an `ipfs.io` gateway URL, and Bags' indexer/validator on the next call has to fetch it. When `ipfs.io` 504s, Bags 500s.

There's also a smaller risk: **Bags expects the metadata host they themselves wrote it to** (their own pinning service / CDN). Calling their helper to upload then handing the same URL back should be fine — but if their server-side fetcher uses a different gateway (or has a stricter timeout than the public `ipfs.io`), we'll see exactly this symptom.

---

## Fix plan

### 1. Stop using the `ipfs.io` URL — use the Bags-canonical URL

Inspect `tokenInfo` returned by `sdk.tokenLaunch.createTokenInfoAndMetadata`. The SDK returns multiple fields (`tokenMetadata`, sometimes `metadataUri`, sometimes a CID). We're currently picking `tokenMetadata` (which the logs show as `https://ipfs.io/...`). We should:

- Log the **full** `tokenInfo` object once so we can see every URL Bags hands back (CID, gateway, alternate host).
- Prefer a Bags-hosted URL (e.g. `https://storage.bags.fm/...` or whatever they pin to) over the public `ipfs.io` gateway.
- If only `ipfs.io` is returned, rewrite to a more reliable gateway like `https://cf-ipfs.com/ipfs/<cid>` or `https://<cid>.ipfs.dweb.link` *and* warm it ourselves (`HEAD`) before calling Step 3 so any cold-cache 504 happens to us, not to Bags.

### 2. Pre-validate the metadata URL before Step 3

Before calling `createLaunchTransaction`, do a `fetch(ipfsMetadataUrl, { method: "GET" })` from the executor itself with a 10 s timeout. If it fails or returns non-2xx, swap to an alternate gateway (or re-pin) and retry. This makes the failure mode visible and recoverable instead of hidden inside Bags' 500.

### 3. Make the retry loop smarter — call out *why* we're retrying

Right now all 5 attempts hit Bags within 30 s with the same payload and the same metadata URL — so they all fail the same way. Two cheap improvements:

- On attempt ≥2, **re-resolve the metadata** (call `createTokenInfoAndMetadata` again to get a fresh URL, or rotate gateway). The mint stays the same, but the URL we send to Bags differs. This costs nothing on-chain.
- Stretch backoff to `5s, 15s, 30s, 60s` so we span at least 2 minutes — long enough for a real Bags-side incident to clear, short enough to stay within the worker lock window (120 s; bump to 240 s if needed).

### 4. Auto-refund instead of "no refund" when Step 3 exhausts retries

Today we call `setFailedNoRefund` so the operator must click Retry/Refund. But Step 3 is build-only — no SOL was spent into a curve. The fee-share config PDA on-chain is harmless. Change the exhausted-retry branch to `setFailed` (which auto-refunds contributors) when:

- The error is purely 5xx/network across all 5 attempts (Bags genuinely down).
- AND no on-chain launch tx was ever broadcast (always true at this point in the code).

Operator can still investigate later; contributors get their SOL back automatically.

### 5. Recover the stuck launch `049c3955…`

After the patch:
- **Option A (preferred):** click **Retry** in admin. The new code will reuse `configKey=5tPW…m5QM` (already on-chain), re-fetch metadata via the new gateway, and try again. Cost: nothing extra.
- **Option B:** click **Refund (N)** to send the contributor SOL back. The fee-share PDA stays on-chain idle — harmless.

No DB changes needed; both buttons already exist.

### 6. Operational visibility

Add a single structured log line just before Step 3 dumping `{ metadataUrl, tokenMint, configKey, netBuyLamports, claimerCount, payloadBytes }` so future Bags 500s let us correlate against their support ticket without grepping multiple lines.

---

## Files to change

- `executor/src/executeBags.ts`
  - Step 0: log full `tokenInfo`, prefer non-`ipfs.io` URL, store chosen URL.
  - New helper `pickBestMetadataUrl(tokenInfo)` + `verifyMetadataReachable(url)`.
  - Step 3 retry loop: re-resolve metadata URL between attempts, longer backoff (5/15/30/60), and switch the exhausted-retry branch from `setFailedNoRefund` → `setFailed` for pure-5xx cases.
- `executor/src/executeLaunch.ts` — bump worker lock expiry to ~240 s if Step 3 backoff total exceeds 120 s.

No DB schema changes. No edge function changes. No UI changes.

---

## Why this fixes the loop for real

Past iterations chased the *transport* (retries, backoff, indexer race, error capture). All of that is now correct and the logs prove it. What's left is the *payload*: Bags' backend appears to choke when fetching/validating our `ipfs.io` metadata URL. Switching to a faster/canonical gateway, pre-warming it ourselves, and rotating it on retry directly attacks the only remaining variable. Auto-refund on exhausted retries closes the contributor-experience gap so a Bags outage no longer requires manual operator action.
