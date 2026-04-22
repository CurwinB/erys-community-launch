

# Add 30s timeouts to executor outbound API calls

Wrap each external HTTP call in the executor with an `AbortController` + 30-second timer so a hung PumpPortal or Bags response can no longer freeze a launch in `executing` indefinitely. On timeout the launch is flipped to `execution_failed` with a clear reason and the executor moves on.

## Files

**`executor/src/executePumpfun.ts`** — wrap the PumpPortal `trade-local` fetch:
- Create `AbortController` + `setTimeout(..., 30_000)` before the call
- Pass `signal: controller.signal` into the fetch options
- `try/catch/finally`: on `AbortError` → `setFailed(launch.id, "PumpPortal request timed out after 30 seconds")` and return; on any other error → `setFailed(launch.id, "PumpPortal request failed: <msg>")` and return; `finally` clears the timer
- The Alchemy `sendTransaction` RPC call stays as-is (per instructions, only the PumpPortal call is wrapped)

**`executor/src/executeBags.ts`** — same pattern applied to:
1. `POST ${BAGS_API_BASE}/fee-share/config` — on timeout: `setFailed(launch.id, "Bags fee-share/config request timed out after 30 seconds")`
2. `POST ${BAGS_API_BASE}/token-launch/create-launch-transaction` — on timeout: `setFailed(launch.id, "Bags create-launch-transaction request timed out after 30 seconds")`

The `signAndSendToBags` helper (used for fee-share txs and the final launch tx submission) is **not** wrapped — those are signing/submission calls, not API config calls, and the instructions scope the change to `fee-share/config` and `create-launch-transaction`.

## Behavior after change

- Hung PumpPortal call: aborts at 30s → launch marked `execution_failed` with timeout reason → executor poll loop continues → admin can see the error in the dashboard and refund.
- Hung Bags config/launch call: same path, with a Bags-specific timeout message identifying which step hung.
- Successful calls (typical < 5s): unchanged — timer is cleared in `finally`.

## Out of scope

- No changes to the distributor, edge functions, frontend, schema, or env vars.
- No changes to the Alchemy RPC `sendTransaction` call or the Bags `send-transaction` helper.
- No retry logic — single attempt with timeout, fail loud, let admin decide.

## Note on rollout

Code change lives in `executor/`. After merging, you'll need to redeploy the executor service on Railway (push triggers it automatically if Railway is wired to the repo) for the timeout to take effect. The running instance will not pick up the change until restart.

