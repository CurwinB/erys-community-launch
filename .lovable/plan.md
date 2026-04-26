## Root cause (verified on-chain)

The latest launch (`Erys test`, sig `4m8qBeEv…`) was **submitted successfully** to Pump.fun but **reverted on-chain** during the Buy instruction:

```
Transfer: insufficient lamports 183158380, need 185886440
```

The custodial wallet was short by **~0.0027 SOL** because `CUSTODIAL_FUNDING_BUFFER_LAMPORTS = 0.01 SOL` doesn't cover the real combined cost of: 2× ATA rent (~0.004), Pump.fun 1% protocol fee (~0.002 on a 0.19 SOL buy), creator fee, compute/priority, and tx fee — total ~0.0125 SOL.

A second bug compounded it: the failure branch checks `lightningJson?.errors`, but PumpPortal returns `errors: []` (empty array = truthy in JS), so even successful Lightning responses trip the failure path. That's why the DB error message shows `errors:[]` despite the signature being valid.

## Fixes

### 1. `executor/src/executePumpfunLightning.ts` — bump the funding buffer

Raise `CUSTODIAL_FUNDING_BUFFER_LAMPORTS` from `10_000_000n` (0.01 SOL) to **`25_000_000n` (0.025 SOL)**.

Breakdown that 0.025 must cover, with margin:
- 2× ATA rent at ~0.00204 each = 0.00408 SOL
- Pump.fun 1% protocol fee on initial buy = up to ~0.005 SOL on a 0.5 SOL buy
- Pump.fun creator fee (0.05%) = negligible
- Compute + priority fees = ~0.001 SOL
- PumpPortal transaction fee = ~0.001 SOL
- Safety margin = ~0.013 SOL

Leftovers are already swept back to escrow by `sweepSolToWallet` after a successful launch, so over-padding is harmless.

### 2. `executor/src/executePumpfunLightning.ts` — fix the empty-array error check

Change line 246 from:

```ts
if (!lightningRes.ok || lightningJson?.errors) {
```

to:

```ts
if (!lightningRes.ok || (Array.isArray(lightningJson?.errors) && lightningJson.errors.length > 0)) {
```

This way an empty `errors: []` from a successful Lightning response no longer trips the failure branch.

### 3. `executor/src/executePumpfunLightning.ts` — verify on-chain status before declaring failure

After `connection.confirmTransaction` (line 283), explicitly check the on-chain status of `launchSignature` via `getSignatureStatuses` (with `searchTransactionHistory: true`). If `status.err` is non-null:

- Mark the launch failed with the actual on-chain error (e.g. `InstructionError: insufficient lamports during Buy`).
- Run `trySweepSolBack` so the residual custodial SOL is returned to escrow (currently it's stuck because the failure path after submission doesn't call sweep-back).
- Skip the token sweep step (no tokens were minted to the custodial wallet).

This turns confusing PumpPortal-side error strings into clear on-chain reverts and prevents stranded SOL in the custodial wallet.

### 4. `executor/src/executePumpfunLightning.ts` — also sweep SOL back when on-chain Buy reverts

The current code only calls `trySweepSolBack` on PumpPortal HTTP errors. With the new on-chain status check (item 3), add the sweep-back to the on-chain-revert branch too. The custodial wallet currently holds ~0.183 SOL stranded from this failed launch — once redeployed, the next successful launch will sweep it as residual on the way out, but adding the sweep-back here makes the failure path self-cleaning.

### 5. Documentation update

Update `.lovable/memory/features/custodial-wallet-locking.md` (or create a new memory file `pumpfun-lightning-buffer.md`) noting:
- Funding buffer is 0.025 SOL and covers ATA rent + Pump.fun protocol fee + priority + tx fee + margin.
- On-chain status MUST be verified after Lightning submission, since Lightning returns 200 + signature even for txs that revert on chain.
- Empty `errors: []` arrays from PumpPortal mean success.

## Files modified

- `executor/src/executePumpfunLightning.ts` — buffer + error check + on-chain verify + sweep-back
- `.lovable/memory/features/custodial-wallet-locking.md` — note the buffer + on-chain verify rules
- `.lovable/memory/index.md` — link the new/updated memory if a new file is created

## After deploy

Once you redeploy the **executor service on Railway**, the next Pump.fun test launch should:
1. Fund the custodial wallet with 0.025 SOL of buffer (instead of 0.01).
2. Submit via Lightning, get a signature.
3. Wait for on-chain confirmation, verify status is `Ok`.
4. Sweep tokens + residual SOL back to escrow.
5. Mark the launch `launched`.

The previously stranded ~0.183 SOL in the custodial wallet will be picked up as residual on the next successful launch's SOL sweep step.

## What I am NOT changing

- Distributor math, contribution flow, claim flow — none of these are involved.
- The 5% creator floor logic from the previous task — untouched.
- Bags launch path — failure was Pump.fun-specific.
