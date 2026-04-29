## Two distinct problems in the latest Bags launches

### Problem 1 — `signatureSubscribe not found` (ours to fix)

The Bags SDK uses `connection.confirmTransaction` internally for several steps we cannot intercept (e.g. `createTipTransaction` / `sendBundleAndConfirm`, and any future SDK calls). `confirmTransaction` opens a WebSocket and calls `signatureSubscribe`. Our executor builds the Connection with only an HTTP URL:

```text
executor/src/executeBags.ts:309
new Connection(SOLANA_RPC_URL, "confirmed")
```

web3.js then derives a default WS endpoint from the HTTP URL, which on most providers is wrong. Result: repeated `Method 'signatureSubscribe' not found` log spam and SDK-internal confirmation false-failures.

You're correct that Alchemy's standard Solana tier does not serve `signatureSubscribe`, so we must let the operator point WS at a provider that does (Helius, Triton, QuickNode, etc.) without code changes.

### Problem 2 — Bags `createLaunchTransaction` returning HTTP 500 five times

This is a server-side Bags issue. Our payload is correct (fee-share PDA verified at 1048 bytes, BPS=10000, 2 claimers, mint reserved this run, metadata URL present). Retrying the same payload 5x with backoff did not help. We will not change the payload — but we will tighten the retry/refund behavior so a Bags outage doesn't leave launches in a confusing half-state.

## Plan

### 1. Add `wsEndpoint` to the Bags executor Connection

File: `executor/src/executeBags.ts`

```text
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!
const SOLANA_WSS_URL =
  process.env.SOLANA_WSS_URL ||
  SOLANA_RPC_URL.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://")

new Connection(SOLANA_RPC_URL, {
  commitment: "confirmed",
  wsEndpoint: SOLANA_WSS_URL,
})
```

This makes `wsEndpoint` explicit and overridable via env. Operator action (out of repo): set `SOLANA_WSS_URL` in Railway to a WS-capable endpoint (Helius / Triton / QuickNode). Alchemy HTTP can stay as `SOLANA_RPC_URL`.

### 2. Document the env var

File: `executor/.env.example`

Add:

```text
# Optional. WebSocket RPC endpoint used ONLY for SDK-internal
# signatureSubscribe calls (Bags SDK confirmTransaction).
# Defaults to SOLANA_RPC_URL with https->wss. Alchemy's standard
# Solana tier does NOT support signatureSubscribe — point this at
# Helius / Triton / QuickNode if you see "Method 'signatureSubscribe'
# not found" warnings.
SOLANA_WSS_URL=wss://your-ws-capable-rpc
```

Also update the existing comment block in that file that says "WebSocket / signatureSubscribe support is NOT required" to clarify it's only true for our own custodial sends (which use HTTP polling), not for the Bags SDK helpers.

### 3. Defensive logging for env parity

In `executor/src/index.ts`, add a one-line log on startup showing whether `SOLANA_WSS_URL` is set (don't print the URL — just a boolean). Helps confirm Railway picked it up.

### 4. Treat repeated Bags 5xx on `createLaunchTransaction` as a clear, non-refunding failure with operator guidance

File: `executor/src/executeBags.ts` (Step 3 block, lines ~740-820)

Currently 500 is terminal-on-first-attempt (good) but the failure message is generic. Change:

- When the final error is HTTP 5xx, set the failure reason to:
  `"Bags createLaunchTransaction returned 5xx (Bags-side outage). Fee-share configKey=<key> is reusable. Retry from admin once Bags is healthy."`
- Keep auto-refund as today (no on-chain launch tx was broadcast).
- Add the upstream Bags status code into the reason string so admin UI shows "503", "500", etc.

No retry-loop changes — Claude's read is right: hammering the same payload at a 500 doesn't help.

### 5. Out-of-scope (not changed)

- No change to Pump.fun, distributor, or any other executor file.
- No change to `app_settings` — Bags remains paused via the existing admin toggle until the operator sets `SOLANA_WSS_URL` and verifies one small launch.

## Files touched

```text
executor/src/executeBags.ts   (Connection wsEndpoint + Step 3 5xx reason)
executor/src/index.ts         (one-line WSS startup log)
executor/.env.example         (SOLANA_WSS_URL doc + corrected comment)
```

## What you do after I implement

1. Grab a WebSocket Solana RPC URL (Helius free tier works: `wss://mainnet.helius-rpc.com/?api-key=...`).
2. Add `SOLANA_WSS_URL` in Railway → executor service env.
3. Redeploy.
4. Re-enable Bags in the admin Platform Status panel.
5. Run one small test launch.

If `signatureSubscribe` warnings disappear from Railway logs and `createLaunchTransaction` still returns 500, we have proof it's a Bags outage and the next step is contacting Bags support with the request fingerprint we already log.
