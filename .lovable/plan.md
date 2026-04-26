## What failed

The latest Pump.fun test did not fail at creation. The on-chain Pump.fun create/buy transaction succeeded:

- Launch: `9caf31b8-af12-4feb-8f72-32539e903461`
- Token: `Erys test` / `ETEST`
- Mint: `JAQch38sjEK752q98NVMWMbmNuuZsjoENHVYc9b8Ceay`
- Pump.fun tx: `3T5aZSxFsTG1zEsM2rudWxbz99pbGqKquXEwaZtRxvjdgu7Bsou5999oKSf852VribibJAEJ7DhNDFeAvZroZfHC`
- Solscan shows `Success` and the custodial wallet owns `6,077,420.048119 ETEST`.

The launch failed after creation during our sweep step:

```text
Lightning create succeeded (...) but token sweep failed after retries:
Custodial wallet has no token account for mint JAQch38...
```

## Root cause

The new Pump.fun token was created under the **Token-2022 program**:

```text
Owner Program: Token 2022 Program
TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
```

But `executor/src/pumpportalCustodial.ts` currently derives and reads the custodial ATA using the legacy SPL Token program only:

```ts
getAssociatedTokenAddress(mintPubkey, custodial.publicKey)
getAccount(connection, sourceAta)
createTransferInstruction(..., TOKEN_PROGRAM_ID)
```

For Token-2022 mints, the associated token account address is different because the token program id is part of ATA derivation. Our code looked for the legacy-token ATA, so it concluded there was no token account even though the Token-2022 ATA exists and holds the dev-buy supply.

## Important side effect

Because the launch was marked `execution_failed`, `setFailed()` auto-triggered refunds. The escrow had already funded/spent most SOL into Pump.fun, so the refunds are partial/short:

- First contribution got only a small partial refund, with a shortfall recorded.
- Second contribution has no refund signature and near-full shortfall.

The dev-buy tokens are still recoverable from the PumpPortal custodial wallet. We should not run normal refund logic for this type of post-create sweep failure going forward.

## Fix plan

### 1. Make custodial token sweeps Token-2022 aware

Update `executor/src/pumpportalCustodial.ts` to support both token programs:

- Import `TOKEN_2022_PROGRAM_ID` from `@solana/spl-token`.
- Detect the mint owner program with `connection.getAccountInfo(mintPubkey)`.
- If the mint owner is `TOKEN_2022_PROGRAM_ID`, use Token-2022 for:
  - `getAssociatedTokenAddress(mint, owner, false, TOKEN_2022_PROGRAM_ID)`
  - `getAccount(connection, sourceAta, commitment, TOKEN_2022_PROGRAM_ID)`
  - `createAssociatedTokenAccountInstruction(..., TOKEN_2022_PROGRAM_ID)`
  - `createTransferInstruction(..., TOKEN_2022_PROGRAM_ID)`
- If the mint owner is legacy `TOKEN_PROGRAM_ID`, keep current behavior.
- If the owner is neither, throw a clear unsupported-token-program error.

### 2. Fix the post-create failure behavior

Update `executor/src/executePumpfunLightning.ts` so a successful Pump.fun create followed by sweep failure is treated as a recovery-needed state, not as a failed launch that auto-refunds contributors.

Recommended minimal code change:

- Add a new DB helper in `executor/src/db.ts`, e.g. `setExecutionErrorOnly(launchId, reason)` or `markLaunchNeedsRecovery(...)`, that updates `execution_error` without calling `refundFailedLaunch()`.
- Use that helper in the token-sweep failure branch instead of `setFailed()`.
- Keep the status as either `executing` for a safe retry after the Token-2022 fix, or move to an existing admin-visible failure state only if it does not auto-refund. The safest immediate behavior is to leave it recoverable and avoid refunds once the token exists on-chain.

### 3. Add clearer diagnostics around the sweep

Add logs for:

- Mint program owner (`legacy SPL` vs `Token-2022`).
- Derived source ATA and destination ATA.
- Token amount found before sweep.

This will make the next Railway log review obvious instead of showing only “no token account”.

### 4. Optional but recommended: suppress the remaining WebSocket log spam

There is still one `connection.confirmTransaction` call in `executePumpfunLightning.ts` after PumpPortal returns the Lightning signature. On Alchemy this can still trigger `signatureSubscribe` spam.

Replace that confirmation block with HTTP polling using `getSignatureStatuses`, similar to the existing custom helper, or at least stop relying on `confirmTransaction` for that path. This is not the cause of this latest failure, but it makes Railway logs usable.

### 5. Recovery after deploy

After deploying the executor:

1. Manually recover/sweep the existing `ETEST` Token-2022 balance from custodial wallet `8fjQrCqeJfNgc5QQRarykX1eBwL7Xt5dvFi5hA2bqGed` to the launch escrow `6HDsA9hFh4dPnJUpJv7nxtN8JZGpeYuLNSMw3GyW5RXV`.
2. Update the launch record to store the Pump.fun signature and move it to the correct launched/recovery-complete status, or run a small controlled recovery script that calls the fixed sweep path.
3. Review the two contribution refund records because auto-refund already ran with shortfalls.

## Files to modify

- `executor/src/pumpportalCustodial.ts` — Token-2022 detection and sweep support.
- `executor/src/executePumpfunLightning.ts` — avoid auto-refund on post-create token sweep failure; remove noisy `confirmTransaction` path if included.
- `executor/src/db.ts` — add a non-refunding error/recovery helper.
- `.lovable/memory/features/custodial-wallet-locking.md` — record that Pump.fun mints may be Token-2022 and sweep helpers must derive ATAs with the mint owner program.

## Why this should fix the latest failure

The latest transaction succeeded and the token account exists on-chain; our code simply looked under the wrong token program. Once the sweep helper derives Token-2022 ATAs and sends transfers through the Token-2022 program, it should find and move the `6,077,420.048119 ETEST` balance instead of failing with “no token account.”