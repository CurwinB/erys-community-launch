

# Fix `Invalid key usage` — replace Web Crypto Ed25519 with a real Solana signer

## Root cause

Deno's Web Crypto `Ed25519` implementation rejects the raw 32-byte seed import with `"Invalid key usage"`. It's been buggy across Deno/edge-runtime versions and is not reliable for Solana signing. The executor on Railway works because it uses Node + `@solana/web3.js` (which uses `tweetnacl` under the hood). The edge function tried to roll its own signer and hit this exact issue.

## Fix

Replace the hand-rolled Web Crypto signer + manual transaction encoder in `supabase/functions/refund-contributor/index.ts` with the official Solana SDK from npm. Deno supports `npm:` specifiers natively in edge functions.

### Imports
```ts
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "npm:@solana/web3.js@1.95.3";
```

### Refund flow becomes
```ts
const connection = new Connection(SOLANA_RPC_URL, "confirmed");
const escrowKeypair = Keypair.fromSecretKey(escrowKeyBytes); // 64 bytes, already decoded
const tx = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: escrowKeypair.publicKey,
    toPubkey: new PublicKey(contribution.wallet_address),
    lamports: Number(refundLamports),
  })
);
const txSignature = await sendAndConfirmTransaction(
  connection, tx, [escrowKeypair],
  { commitment: "confirmed", preflightCommitment: "confirmed" }
);
```

### What gets removed
- `buildAndSendTransfer` (hand-rolled message builder)
- `getLatestBlockhash` (web3.js handles it)
- `waitForConfirmation` (`sendAndConfirmTransaction` does this)
- `concatBytes`, `base58DecodeProper`, manual instruction encoding
- The `crypto.subtle.importKey("Ed25519", …)` call that throws `Invalid key usage`

### What stays
- CORS, request validation, Supabase queries, `decryptEscrowKey`, `hexToUint8Array`
- The 200-status error envelope so admin sees the real error message
- The `SOLANA_RPC_URL` validation guard (still useful)

### Why this is safe
- `@solana/web3.js` is the same library the existing executor uses successfully
- `npm:` specifiers in Supabase Edge Functions are stable and supported
- All on-chain semantics stay identical (System transfer, same amount minus 5000 lamport fee buffer, same escrow keypair derivation)

## Files changed

- `supabase/functions/refund-contributor/index.ts` — swap manual signer + RPC for `@solana/web3.js`. Net result: ~150 fewer lines, correct signing, same admin-facing API.

No DB migration. No frontend changes. No new secrets.

## Follow-up note

`refund-launch/index.ts` and `claim-sponsored-slot/index.ts` use the same broken hand-rolled signer. They'll hit the same error if/when invoked. Out of scope for this fix (you asked to unblock the refund button), but I'll flag them once this works so we can port them over too.

