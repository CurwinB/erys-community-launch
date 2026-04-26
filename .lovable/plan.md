## Root cause of the latest failure

Launch `7545f9fe` (ETEST, 16:48 UTC) failed with:

> `Failed to fund custodial wallet: Signature 4gN6hkmU... has expired: block height exceeded`

Two compounding issues from the Railway logs:

1. **Your RPC endpoint does not support `signatureSubscribe`** — the logs are flooded with `Method 'signatureSubscribe' not found` (JSON-RPC -32601). `web3.js`'s `confirmTransaction` opens a WebSocket subscription first; when that fails it falls back to slow HTTP polling and often misses the ~60–90 second blockhash window.
2. **`fundCustodialWallet` in `executor/src/pumpportalCustodial.ts`** sends once and waits via `confirmTransaction` with a single blockhash. If the network is slow or the WS path is broken (as it is here), the tx expires before confirmation, even though it may still land. No retry.

The good news: the env vars are now set, the new Lightning code path is reaching Step 1, and your earlier `PUMPPORTAL_API_KEY` issue is resolved.

## Plan

### 1. Add a robust send-and-confirm helper in `executor/src/pumpportalCustodial.ts`

Replace the three `connection.confirmTransaction(...)` call sites (`fundCustodialWallet`, `sweepTokensToWallet`, `sweepSolToWallet`) with a shared `sendAndConfirmWithRetry` helper that:

- Uses HTTP polling via `connection.getSignatureStatuses([sig])` every 2s instead of WebSocket subscriptions (works on any RPC, including Helius/Alchemy without WS tier).
- Re-broadcasts the same signed tx every ~5 seconds while waiting (cheap, idempotent — Solana dedupes).
- On blockhash expiry, fetches a fresh blockhash, **rebuilds and re-signs** the tx, and resubmits up to 3 times.
- Total timeout: 90 seconds per attempt × 3 attempts.
- Returns the confirmed signature, or throws with a clear message including the last attempted signature.

### 2. Apply the helper to all three custodial wallet ops

- `fundCustodialWallet` — most critical, this is what failed.
- `sweepTokensToWallet` — same risk (current retry loop in `executePumpfunLightning.ts` only catches the missing-ATA case, not blockhash expiry).
- `sweepSolToWallet` — already best-effort, but should still retry properly.

### 3. Add a one-shot status check before declaring failure

In `fundCustodialWallet`, before throwing on expiry, do a final `getSignatureStatuses` check — the tx may have actually landed despite the timeout. If confirmed, return the signature instead of throwing.

### 4. Update logging

Replace the noisy `web3.js`-internal WebSocket error spam by setting `Connection`'s `wsEndpoint` explicitly to a no-op or constructing the `Connection` with `disableRetryOnRateLimit: false` and a custom `commitment` config that prefers HTTP. Alternatively, document that `signatureSubscribe` errors are harmless once the polling path is in place.

### 5. Document the RPC requirement

Add a note in `executor/.env.example` explaining the executor now uses HTTP polling for confirmations and works on any RPC tier — no WebSocket required.

## Files modified

- `executor/src/pumpportalCustodial.ts` — add helper, refactor three send/confirm sites
- `executor/.env.example` — note about HTTP polling

## Out of scope (not changing)

- The PumpPortal Lightning create call itself — it's a single HTTP POST, not affected by this issue.
- The retry-on-failure of the entire launch — the worker lock + `execution_attempts` already handles that on the next poll cycle.
- Refunding the stranded funding tx — the SOL is in escrow; the next retry will reuse it.

## What this does NOT solve

- If your RPC is genuinely overloaded and txs aren't landing at all, retries won't help. But the symptom in your logs (`signatureSubscribe not found`) is purely a confirmation-path problem, not a tx-landing problem.
- Long-term, you may want to swap to an RPC tier that supports WebSocket subs for cleaner logs, but it's not required for correctness after this fix.
