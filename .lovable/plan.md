

# Fix `Invalid escrow secret key length: 29 (expected 64)`

## Root cause

A symmetric mismatch between how escrow keys are **encrypted** and how they are **decrypted**.

**Encryption** (in `create-launch`, `create-launch-pumpfun`, `claim-sponsored-slot`):
```ts
const dataBytes = hexToUint8Array(dataHex);   // 64 raw secret-key bytes
crypto.subtle.encrypt(..., dataBytes);         // ciphertext = 64 raw bytes
```
So the ciphertext plaintext is the **raw 64-byte Solana secret key**.

**Decryption** (in `refund-contributor`, `refund-launch`, executor, distributor):
```ts
const decrypted = await crypto.subtle.decrypt(...);   // 64 raw bytes — correct
return new TextDecoder().decode(decrypted);            // BUG: treats raw bytes as UTF-8
// caller then does hexToUint8Array(thatString) → garbage, ~29 bytes
```

`TextDecoder` lossily converts arbitrary bytes into a Unicode string (replacement chars, length changes), and `hexToUint8Array` then `parseInt`s pairs of that garbage string, returning ~29 bytes of `NaN`s. Hence `Invalid escrow secret key length: 29`.

The Railway executor / distributor exhibit the same bug but haven't been exercised on a real `bags` flow yet (no `bags` launch has reached `launched` status), so this only surfaced now via the admin refund button.

## The fix

Make `decryptEscrowKey` return the **raw 64-byte `Uint8Array`** that AES-GCM produced — no TextDecoder, no hex round-trip. Update every caller to use the bytes directly with `Keypair.fromSecretKey(bytes)`.

### Files to change

1. **`supabase/functions/refund-contributor/index.ts`**
   - Change `decryptEscrowKey` signature: `Promise<string>` → `Promise<Uint8Array>`. Drop the `TextDecoder().decode(...)` line — return the raw decrypted `Uint8Array`.
   - Drop the `hexToUint8Array(escrowPrivateKeyHex)` step at the call site. Use the returned bytes directly.
   - Keep the `if (escrowKeyBytes.length !== 64)` guard.

2. **`supabase/functions/refund-launch/index.ts`**
   - Same `decryptEscrowKey` fix (return raw bytes).
   - As a follow-up to the working refund-contributor, port this function to use `npm:@solana/web3.js@1.95.3` like the previous fix (replaces the broken hand-rolled signer with `Keypair.fromSecretKey` + `sendAndConfirmTransaction`). This kills the `Invalid key usage` error class entirely for cancel-launch refunds.

3. **`executor/src/decrypt.ts`** and **`distributor/src/decrypt.ts`**
   - Both currently do `decryptedBuf.toString("utf8")` → `Buffer.from(hexString, "hex")`. Replace with: return `decryptedBuf` directly (it's already the 64-byte secret key).
   - This prevents the same bug from biting the executor and distributor the first time a `bags` launch reaches `launched` status.

### What stays unchanged

- `ESCROW_ENCRYPTION_KEY` secret — same value, no rotation
- All existing encrypted records in the DB — they're already correct (raw bytes)
- The encryption code in `create-launch*` and `claim-sponsored-slot` — also already correct
- `decryptEscrowKey` for `pumpfun_mint_keypair_encrypted` — same fix applies wherever the mint key is decrypted (already covered by the executor `decrypt.ts` change)

## Validation after deploy

1. Click **Refund** on the TEST launch contributor (cancelled launch `637f3b75…`, contributor with 0.1 SOL in escrow `3mdZYeCn5yZkUsaeTV9MMpaEFCw2JojH52eENUtjZuu7`). Should succeed and return a Solscan tx link.
2. Confirm the contribution row gets `refund_tx_signature` set.
3. No DB migration. No frontend change. No new secrets.

## Files edited

- `supabase/functions/refund-contributor/index.ts`
- `supabase/functions/refund-launch/index.ts` (decrypt fix + port to @solana/web3.js)
- `executor/src/decrypt.ts`
- `distributor/src/decrypt.ts`

