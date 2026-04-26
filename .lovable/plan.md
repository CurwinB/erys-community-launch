
## Goal

Make the executor reliably know — and record — whether a Pump.fun token was actually minted on-chain, on **every** code path. Today the launch signature is only saved on the happy path and on the post-create sweep-failure path. Several other branches drop it, and the on-chain status check is a single non-retried call that can mis-classify a "still propagating" tx as "didn't land."

## Why this matters

Once Pump.fun's create+buy CPI lands on-chain:
- The token mint exists forever (Token-2022 mint is created)
- The dev-buy tokens are in the PumpPortal custodial wallet
- The SOL has been spent into the bonding curve and **cannot** be refunded

So mis-classifying a successful mint as a failure (and triggering auto-refunds) produces partial/short refunds and strands tokens — exactly what happened with the ETEST launch.

## The two questions the executor must answer correctly

1. **Did the token get minted?** → check `getSignatureStatuses` with retries
2. **If yes, did we save the signature?** → must be persisted in *every* terminal DB write that happens after we hold a signature

## Changes

### 1. Robust on-chain status detection — `executor/src/executePumpfunLightning.ts`

Replace the single `confirmTransaction` + single `getSignatureStatuses` block with a polling helper that returns a clear three-state result:

```ts
type LandedStatus = "succeeded" | "reverted" | "not_landed";

async function pollLandedStatus(
  connection: Connection,
  signature: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<{ status: LandedStatus; err: any | null }> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  let lastStatus: any = null;
  while (Date.now() < deadline) {
    const res = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    lastStatus = res?.value?.[0];
    if (lastStatus) {
      if (lastStatus.err) return { status: "reverted", err: lastStatus.err };
      const conf = lastStatus.confirmationStatus;
      if (conf === "confirmed" || conf === "finalized") {
        return { status: "succeeded", err: null };
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { status: "not_landed", err: null };
}
```

Use HTTP polling, not WebSocket — keeps Alchemy `signatureSubscribe` log spam out.

### 2. Per-state handling after we have a signature

Once `lightningJson.signature` exists, **the signature must be persisted on every terminal path**, even on failures. Change the flow to:

```
launchSignature obtained
  ↓
result = pollLandedStatus(launchSignature)
  ↓
switch (result.status) {
  case "succeeded": // token IS minted
    → token sweep (with retries) — Token-2022 aware
       ├─ success → setLaunched(launchSignature)
       └─ fail    → setFailedNoRefund(reason, launchSignature)  // already correct
    → SOL residual sweep (best-effort)

  case "reverted": // tx exists on-chain but failed; no token, no SOL spent
    → trySweepSolBack (refund custodial SOL to escrow)
    → setFailedWithSignature(reason, launchSignature)  // NEW helper, refunds OK
       (refunds are correct here — SOL was never consumed)

  case "not_landed": // tx never landed within timeout
    → trySweepSolBack
    → setFailedWithSignature(reason, launchSignature)
       (signature still saved for audit / manual lookup; refunds OK because
        SOL hasn't been spent into a bonding curve that doesn't exist)
}
```

### 3. New DB helper — `executor/src/db.ts`

Add `setFailedWithSignature(launchId, reason, signature)`:
- Updates `status = 'execution_failed'`, `execution_error = reason`, **`pumpfun_launch_signature = signature`**
- Then calls `refundFailedLaunch(launchId)` (same auto-refund as `setFailed`)

This is the "we have a signature but it didn't succeed and SOL hasn't been spent into a bonding curve" path. Distinct from `setFailedNoRefund` which is "SOL is gone, do not refund."

Decision matrix is then:

| Outcome | Helper | Saves sig? | Refunds? |
|---|---|---|---|
| Mint succeeded, sweep succeeded | `setLaunched` | ✅ | n/a |
| Mint succeeded, sweep failed | `setFailedNoRefund` | ✅ | ❌ |
| Tx reverted on-chain (no mint) | `setFailedWithSignature` | ✅ | ✅ |
| Tx never landed (no mint) | `setFailedWithSignature` | ✅ | ✅ |
| Pre-signature failure (funding, PumpPortal call, no signature returned) | `setFailed` | n/a | ✅ |

### 4. Diagnostic logging

When status resolves, log clearly:
```
On-chain status for <sig>: succeeded | reverted (<err>) | not_landed after 60s
Token mint <mint> created: yes | no
```
Makes Railway logs unambiguous.

### 5. Memory update — `.lovable/memory/features/custodial-wallet-locking.md`

Document the invariant: *whenever we hold a Pump.fun launch signature, we must persist it on the launch row, regardless of overall success/failure. The signature is the source of truth for whether the mint exists on-chain.*

Also document the failure-state decision matrix above so future changes don't re-introduce the gap.

## Files to modify

- `executor/src/executePumpfunLightning.ts` — replace confirmation block with `pollLandedStatus`, route to the right DB helper per state, persist signature everywhere
- `executor/src/db.ts` — add `setFailedWithSignature`
- `.lovable/memory/features/custodial-wallet-locking.md` — record the invariant + decision matrix

## Out of scope (intentionally)

- Manual recovery of the existing stranded ETEST tokens — separate plan, you asked about that earlier
- Changing the `not_landed` timeout policy beyond 60s — current default is fine; can tune later if Alchemy is slow
- Migrating away from Lightning to Local API — different effort
