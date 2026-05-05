## Root cause

PumpPortal's `/trade-local` with `action: "create"` requires the `mint` field to be the **base58-encoded mint keypair SECRET KEY** (their docs: `mint: bs58.encode(mintKeypair.secretKey)`). We've been sending the mint **public key** (`launch.token_mint_address`). PumpPortal tries to reconstruct the keypair server-side, fails, and crashes with `Cannot read properties of undefined (reading 'toBuffer')` — returned as a generic 400.

Every Pump.fun launch since the local-signing path went live has failed for this reason. Metadata, IPFS gateway, and `amount` were red herrings (verified: metadata is 200/valid, amount is a positive Number).

## Changes

### 1. `executor/src/launchWithLocalSigning.ts` — fix the request body

- We already decrypt `mintKeypair` at the top of the function. Encode its **secret key** (64 bytes) to base58 and send that as `mint`:
  ```ts
  import bs58 from "bs58";
  ...
  const mintField = bs58.encode(mintKeypair.secretKey); // 87–88 chars
  ```
- Remove the existing public-key-based `mintField` derivation and the `mint type/len/value` log line that printed the public key (do NOT log the secret-key bs58 — log only its length).
- Keep the existing `derivedMint === launch.token_mint_address` sanity check (already there, lines 84–89) — that still validates the keypair matches the stored mint address.
- Add explicit logging of `amount` type/value right before building the body, per user request:
  ```ts
  LOG(`amount type=${typeof requestBody.amount} value=${requestBody.amount} initialBuyLamports=${initialBuyLamports}`);
  ```
- Redact `mint` in the `/trade-local request body` log line (it's a private key) — log a placeholder like `"mint":"<redacted 88-char secret>"` instead of the raw body.

### 2. `executor/scripts/testTradeLocalRaw.ts` — new standalone probe

Minimal Node script with **zero** dependencies on our DB / launch row:

- Generates a fresh `Keypair` for the mint (so no real funds at risk).
- Uses a hardcoded test wallet pubkey from env (`TEST_WALLET_PUBKEY`) or a throwaway generated one.
- Hardcoded metadata URI from PumpPortal's own docs example.
- Sends both variants back-to-back and prints status + body:
  - **Variant A** (current/broken): `mint: mintKeypair.publicKey.toBase58()`
  - **Variant B** (per PumpPortal docs): `mint: bs58.encode(mintKeypair.secretKey)`
- Logs the exact request body (with mint redacted) and full response.

Run with: `cd executor && npx ts-node scripts/testTradeLocalRaw.ts`

This isolates whether the endpoint itself is healthy and proves which `mint` encoding it accepts.

### 3. Dependency

`bs58` is already used elsewhere in the executor (decrypt, pumpportal wallet pool). No new install.

## Verification

1. Run `testTradeLocalRaw.ts` — Variant B should return 200 + transaction bytes; Variant A should reproduce the `toBuffer` 400.
2. Manually re-trigger one of the failed launches via the admin "retry" path and watch Railway logs for `Received N-byte unsigned transaction`.
3. Confirm the on-chain mint pubkey of the resulting token matches `launch.token_mint_address` (the keypair is reused, so it must).

## Out of scope

- No changes to `create-launch-pumpfun` edge function (mint generation/encryption stays the same).
- No changes to the Lightning path (`executePumpfunLightning.ts`) — Lightning uses PumpPortal's hosted signing and was never affected.
- No retroactive refund changes; existing auto-refund flow already handled the failed launches.
