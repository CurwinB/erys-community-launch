
# Fix refund expiry errors for admin refunds

## Problem

The new error is different from the earlier key issues: the refund transaction is now being signed, but it expires before confirmation.

`Signature ... has expired: block height exceeded` means the function used a blockhash that became stale before the RPC confirmed the transfer. This usually happens under RPC latency / congestion and is consistent with the current implementation using `sendAndConfirmTransaction(...)` directly with no refresh-or-retry strategy.

## What to build

Make admin refunds resilient to Solana blockhash expiry by replacing the one-shot send flow with an explicit retryable transaction sender that:

1. fetches a fresh latest blockhash
2. builds a new transfer transaction
3. signs it with the escrow key
4. sends it with explicit options
5. confirms it against the exact `blockhash + lastValidBlockHeight`
6. if confirmation fails due to expiry, rebuilds with a fresh blockhash and retries automatically

This should apply to both:
- single contributor refunds
- bulk launch refunds

## Files to change

### 1) `supabase/functions/refund-contributor/index.ts`
Replace the direct `sendAndConfirmTransaction(...)` path with a helper like `sendRefundWithRetry(...)`.

Planned behavior:
- retry on blockhash-expiry / `TransactionExpiredBlockheightExceededError`
- fetch a brand new blockhash on each retry
- rebuild and re-sign the transaction each time
- use `sendRawTransaction(..., { preflightCommitment: "confirmed", maxRetries: ... })`
- use `confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed")`
- return the successful signature once confirmed
- preserve the current 200 + `{ error }` response envelope so admin still sees the real reason when it fails

### 2) `supabase/functions/refund-launch/index.ts`
Apply the same retryable send logic inside the loop that refunds all pending contributors for a cancelled launch.

This keeps:
- single refund and bulk refund behavior consistent
- the admin “Refund All Pending Contributors” flow from failing for the same reason

### 3) Optional shared helper
If the code reads cleaner, extract the retryable sender into a small shared helper used by both refund functions instead of duplicating the logic.

## Retry strategy

Use a conservative retry policy tuned for admin recovery actions:

- 3 attempts per refund
- fresh blockhash every attempt
- short backoff between attempts
- retry only for expiry / transient confirmation errors
- do not retry if the failure is deterministic:
  - invalid recipient
  - insufficient balance
  - bad secret key
  - invalid encrypted data
  - RPC auth / whitelist issues

## Error handling improvements

Surface clearer admin-facing errors:
- `"Refund failed after 3 attempts due to blockhash expiry"`
- `"Escrow wallet has insufficient SOL for refund + fee"`
- `"Contribution already refunded"`
- `"Refund transaction sent but confirmation timed out"` only if signature status remains ambiguous

If feasible, add a defensive post-failure signature status check before declaring final failure, so a refund is not accidentally retried after it actually landed.

## Why this should fix it

The current refund functions sign once and rely on a blockhash that can age out before confirmation. Solana transactions cannot be safely re-confirmed forever with the same blockhash. The correct recovery is to fetch a new blockhash, rebuild, re-sign, and resend. That is the missing piece.

## Validation after implementation

1. Retry the same admin refund from Recovery.
2. Confirm the function either:
   - succeeds and writes `refund_tx_signature`, or
   - returns a specific non-expiry error if escrow funds are actually insufficient.
3. Retry the bulk refund button on the cancelled launch.
4. Confirm refunded rows disappear from pending state and appear in the Refunds tab.

## Technical details

Proposed send flow:

```text
for attempt in 1..3
  getLatestBlockhash("confirmed")
  build Transaction(SystemProgram.transfer(...))
  set recentBlockhash
  set feePayer = escrow public key
  sign with escrow keypair
  sendRawTransaction(serialized, { preflightCommitment: "confirmed", maxRetries: 3 })
  confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed")

  if confirmed -> success
  if block height exceeded -> retry with fresh blockhash
  else -> throw
```

## Scope

- No frontend redesign
- No DB migration
- No secret changes
- No auth changes

## Files expected to be edited

- `supabase/functions/refund-contributor/index.ts`
- `supabase/functions/refund-launch/index.ts`
- possibly a new shared edge helper if extracted
