

# Fix Pump.fun Execution: Confirmation, Imports, Encoding, Symbol Casing

Four targeted fixes inside `executePumpfunLaunch` in `supabase/functions/execute-launch/index.ts`. No other files touched.

## Fix 1 — Confirm on-chain before marking `launched` (Medium)

Currently the function sets `status = "launched"` immediately after Alchemy returns a signature. If the tx fails on-chain (slippage, compute, etc.), the DB lies and Railway tries to distribute non-existent tokens.

After receiving `txSignature` from `rpcData.result`, poll `getSignatureStatuses` against `SOLANA_RPC_URL` every 2s for up to 30 attempts (60s total):

- If `status.err` is present → call `setFailed(...)` with the on-chain error and return `errorResponse(...)`.
- If `status.confirmationStatus` is `"confirmed"` or `"finalized"` → break out and update launch to `launched`.
- If 60s elapses without confirmation → `setFailed(...)` with timeout message and return.

Only after confirmation do we run the existing `update({ status: "launched" })`.

Also log the signature and a Solscan link before polling for easier debugging.

## Fix 2 — Remove redundant dynamic import (Low)

Inside `executePumpfunLaunch` there's:
```ts
const { Keypair, VersionedTransaction } = await import("https://esm.sh/@solana/web3.js@1.91.1");
```
`Keypair` and `VersionedTransaction` are already statically imported at the top of the file. Delete that line; the existing top-level imports are used directly.

## Fix 3 — Safer base64 encoding (Low)

Replace:
```ts
const txBase64 = btoa(String.fromCharCode(...signedBytes));
```
with a chunked helper added next to the other utility functions (near `hexToUint8Array` / `signWithKeypair`):
```ts
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 1024;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
```
Call site becomes `const txBase64 = uint8ArrayToBase64(signedBytes);`. Avoids stack-size blow-ups from spreading large transaction byte arrays.

## Fix 4 — Defensive `toUpperCase` on symbol (Low)

In the PumpPortal `trade-local` request body, change:
```ts
symbol: launch.token_symbol,
```
to:
```ts
symbol: launch.token_symbol.toUpperCase(),
```

## Out of scope

- Bags launch path, claim flows, distributor, frontend, DB schema — no changes.
- No new secrets. `SOLANA_RPC_URL` is already configured.

## Files

- Edit: `supabase/functions/execute-launch/index.ts`

