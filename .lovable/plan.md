## What's actually wrong

The launch `017ef269...` (ETEST, 14:28 UTC) failed at Step 2 with `Transaction did not pass signature verification`. Both contributions are still in escrow on-chain (0.21 + 0.06 SOL), unrefunded.

The refund UI **is still there** — under the **Recovery** tab, every contributor row has a "Refund" button and there's a "Refund All Pending Contributors" button. The launch is in `execution_failed`, which is included in the recovery list, so it should appear.

What changed and why it feels like refunds disappeared:

1. **Auto-refund was removed for ALL Bags failure paths.** In the previous fix, every Bags failure now calls `setFailedNoRefund` (executeBags.ts lines 854, 863, 892, 914). Before, Step 1/Step 2 pre-flight failures (where nothing landed on-chain) triggered automatic contributor refunds. Now nothing happens automatically — admin must go to Recovery tab and click Refund.
2. **The "obvious" Refund action on the main Launches tab does not exist** — that tab only has a "Retry" button. So when a launch fails, the eye-catching action looks like Retry, and refund is hidden one tab over.
3. The Step 2 no-refund decision is **wrong for this specific failure mode**: signature-verification rejection is a pre-flight error, the tx never hit the chain, no fee-share PDA was created. It is safe (and was previously the default) to auto-refund here.

## The plan

### 1. Auto-refund Step 2 pre-flight failures (executor)

In `executor/src/executeBags.ts`, distinguish between:
- **Pre-flight / never-landed errors** (signature verification, simulation rejected, blockhash never used, "Config already exists" returned by Bags before submit) → `setFailedAndRefund`
- **Possibly-landed errors** (timeout/expiry after send, unknown send error after some signatures broadcast) → keep `setFailedNoRefund`

Add a small `isPreflightOnlyError(msg)` helper that matches:
- `Transaction did not pass signature verification`
- `Simulation failed`
- `Config already exists` (returned synchronously from `createBagsFeeShareConfig` before any tx is built)
- `createLaunchTransaction failed: Request failed with status 4xx` (Bags API rejected before any tx landed)

Use it at the four `setFailedNoRefund` call sites to choose refund vs. no-refund.

### 2. Add a "Refund Contributors" action on the Launches tab

Edit `src/components/admin/LaunchesTab.tsx` so any row with `status === 'execution_failed'` (and at least one un-refunded contribution) gets a **Refund Contributors** button next to Retry. Clicking it opens a confirmation dialog and then bulk-calls the existing `refund-contributor` edge function for each pending contribution (same logic the Recovery tab already uses). This makes the action discoverable from the screen admins land on first.

### 3. One-time recovery for `017ef269...`

Once the UI button ships, click "Refund Contributors" on that row to return 0.21 SOL to `BvpGuD…9rxV` and 0.06 SOL to `62aKWr…ubaV` from the escrow `escrow_wallet_public_key`. No code change needed beyond #2; the existing `refund-contributor` function handles it.

### 4. Clarify the failure message

The current `execution_error` text is a wall of SDK boilerplate. In the executor, when we catch a `SendTransactionError`, log `err.logs` separately and store a short, human first sentence in `execution_error` (e.g. `"Bags fee-share tx rejected pre-flight: signature verification failed (no on-chain state). Safe to refund."`). Full details still go to Railway logs.

## Files to edit

- `executor/src/executeBags.ts` — add `isPreflightOnlyError`, route Step 2/3/4 failures to refund vs. no-refund, shorten error message.
- `src/components/admin/LaunchesTab.tsx` — add "Refund Contributors" button + confirmation dialog for `execution_failed` rows.

## Out of scope

- Root-causing the underlying signature verification error itself (that's the prior open thread on Bags pre-built tx signing). This plan is specifically about restoring the refund path so stuck SOL can always be returned regardless of what failed.