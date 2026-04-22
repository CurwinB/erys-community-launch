

# Status: NOT READY for testing. Two critical, fund-loss bugs.

If you launch a token right now, **users will not get their tokens** and the launch will get stuck. Both issues must be fixed before any real-money test.

## Critical Issue 1 — Distributor cannot decrypt escrow keys (token distribution will fail 100% of the time)

**Where:** `distributor/src/distribute.ts:161-162` and `distributor/src/claimPumpfunFees.ts:22-23`

**The mismatch:**

- `create-launch/index.ts` and `create-launch-pumpfun/index.ts` encrypt **the hex string** of the secret key:
  ```ts
  encryptKey(uint8ArrayToHex(secretKey), ESCROW_ENCRYPTION_KEY)
  ```
  → ciphertext plaintext is **128 ASCII hex chars** (a string).

- `distributor/src/decrypt.ts` returns the raw decrypted **Buffer** (128 bytes of ASCII hex characters).

- The distributor then does:
  ```ts
  const decrypted = decryptEscrowKey(encrypted);          // 128-byte ASCII hex buffer
  Keypair.fromSecretKey(new Uint8Array(decrypted));       // throws — needs 64 bytes
  ```

`Keypair.fromSecretKey` requires exactly 64 bytes. It receives 128. **Every distribution and every Pump.fun fee claim throws immediately and returns without sending tokens.** The launch sits at `status=launched, distribution_completed=false` forever; the contributor never receives tokens.

The Bags edge function works because it parses the decrypted hex string back into bytes (`hexToUint8Array(escrowPrivateKey)`). The Railway distributor never does that conversion.

**Fix:** In `distributor/src/decrypt.ts`, decode the decrypted buffer as a UTF-8 string then hex-decode to bytes — or change `distribute.ts` / `claimPumpfunFees.ts` to do `Buffer.from(decrypted.toString("utf8"), "hex")` before `Keypair.fromSecretKey`.

**Severity: Critical — blocking. This alone means every launch will fail to distribute.**

## Critical Issue 2 — `execute-launch` is timing out with status 546 (CPU Time exceeded)

**Where:** Production logs show every recent invocation:

```
POST | 546 | execute-launch | execution_time_ms: 4101–5736
event_message: "CPU Time exceeded"
```

Edge functions hit Supabase's CPU budget and crash before the launch transaction completes. Combined with Issue 1, the launch never gets to `launched` status either — it gets stuck in `executing`. The stale-recovery cron we added will flip it to `execution_failed` after 10 min, but it'll just timeout again on retry.

Likely cause: the Bags branch makes 4+ sequential API calls (fee-share/config, multiple send-transaction calls for >15 contributors, create-launch-transaction, send-transaction) plus per-row contribution updates inside the same handler. The CPU budget is ~2–4 seconds; we're using 4–6 seconds of wall time and presumably more CPU.

**Fix direction:** Move the Bags execution flow into a background task (`EdgeRuntime.waitUntil` / async pattern) or split into two functions (config + send), and batch the per-contribution DB updates into a single bulk update.

**Severity: Critical — blocking. Even with Issue 1 fixed, launches won't complete.**

## What works

- Contribution flow (on-chain verification + DB insert) — verified clean.
- Admin dashboard read-only views.
- Encryption on the create-launch side — keys are written correctly.
- Distributor's share-calculation, retry-stability logic, concurrency guard, stale-recovery, and confirmation-strategy are all sound. They just never get to run because of Issue 1.

## Recommendation

Do not run a real-money launch yet. Fix order:

1. **Fix Issue 1** in `decrypt.ts` (one-line change). Without this, no tokens move, ever.
2. **Fix Issue 2** by refactoring `execute-launch` to use background tasks for the post-config steps and bulk-update contributions in one query.
3. Then run a small testnet / mainnet dry run with a single 0.05 SOL contribution from one wallet, confirm tokens land, before opening to real users.

Want me to write the fix prompt for Issue 1 first (smallest, unblocks testing of the Bags edge function path), then the larger refactor for Issue 2?

