

# What happened

Your SOL was taken — the transaction succeeded on-chain. But the app failed to record it because of a UX bug in the retry flow.

## The actual sequence of events

1. You signed and sent the 0.1 SOL transfer to escrow `3mdZYeCn5y…Zuu7`.
2. The frontend waited for confirmation but Solana was slow that block. The frontend's `confirmTransaction` call timed out with **"block height exceeded"** — meaning *"I didn't see it confirm in time"*, NOT *"it failed"*.
3. Seconds later, Solana finalized the transaction successfully. Verified just now:
   - Tx `3Cqc9K5o…vMBb` → `confirmationStatus: finalized`, `err: null`
   - Escrow `3mdZYeCn…Zuu7` balance → **0.1 SOL** (exactly your contribution)
4. The frontend showed "Contribution failed" and offered "Retry contribution" — but **the retry button builds a brand new transaction** instead of just recording the one that already landed. So clicking it would have you pay another 0.1 SOL on top.

Your SOL is safe in escrow. It just isn't reflected as a contribution row in the database, so the launch shows 0 raised and you have no fee-share entitlement on the launch page.

## What to fix

### 1. Immediate recovery for your stuck contribution

Insert a contribution row directly for launch `637f3b75-8ada-4d3f-accd-1490e0ebeb41`:
- `wallet_address`: `BvpGuDSLDafZXSDeokapirQqiPshocaMFHG5N46c9rxV`
- `amount_lamports`: `100000000`
- `tx_signature`: `3Cqc9K5orLe9mvnxfY3GAXfYBgPwe7UTqMSJBMqZHywwVruoZEwnTx4evu5dcqUqZYvtEDgmvASHkbkkna88vMBb`

Done as a one-off SQL insert (the `contribute` edge function's on-chain verification would also accept this — both paths work).

### 2. Fix the SchedulePage retry logic — the real bug

`performContribution` always builds & sends a NEW transaction. After a confirmation timeout, the retry should first check whether the original tx already landed before asking the user to pay again.

Changes to `src/pages/SchedulePage.tsx`:

- **Save the signature** as soon as `signAndSendTransaction` returns. Store it in `pendingLaunch` alongside `launch_id` and `escrow_wallet` (e.g. `last_tx_signature`).
- **Split confirmation from sending.** When `confirmTransaction` rejects (timeout / block height exceeded), do NOT discard the signature. Poll `getSignatureStatuses` for ~30s — if it lands, jump straight to the `recording` step.
- **Smart retry.** "Retry contribution" should:
  1. If we have a saved signature, first call `getSignatureStatuses` (with `searchTransactionHistory: true`). If it's finalized with `err: null`, skip straight to calling the `contribute` edge function — never send a new tx.
  2. Only if there's no signature OR the saved one is genuinely missing/failed, build & send a fresh transaction.
- **Better error copy.** "block height exceeded" should not be shown as "Contribution failed". Show: *"Couldn't confirm in time — checking on-chain status…"* and run the status check automatically before offering manual retry.

### 3. Resilience improvement

Use `connection.confirmTransaction` with a longer timeout, or replace it with a polling loop on `getSignatureStatuses` (more reliable on busy RPCs). Standard pattern: poll every 2s for up to 60s, succeed on `confirmationStatus === "confirmed" | "finalized"` with `err === null`.

## Files changed

- One-off SQL: insert the missing contribution row for launch `637f3b75…`
- `src/pages/SchedulePage.tsx` — save signature before confirming, status-check before re-sending on retry, friendlier timeout copy, polling-based confirmation

No edge function changes needed — `contribute` already does proper on-chain verification, so it will accept the recovery insert via the API too if you'd rather we go through that path than raw SQL.

