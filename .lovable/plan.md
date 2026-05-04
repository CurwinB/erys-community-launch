# Add minimum pool check to executePumpfunLightning.ts

Mirror the auto-cancel/refund guard already present in `executeBags.ts` and `executePumpfun.ts` so Lightning launches can't proceed with under 0.3 SOL raised.

## Change

**File:** `executor/src/executePumpfunLightning.ts`

Insert at the top of `executePumpfunLightningLaunch`, immediately after computing `totalLamports` and constructing the `connection`, and **before** the `shouldChargeProcessingFee` block (so no fee is charged, no custodial wallet is funded, and no PumpPortal API call fires when the pool is too small):

```ts
const MINIMUM_POOL_LAMPORTS = 300_000_000n; // 0.3 SOL

if (totalLamports < MINIMUM_POOL_LAMPORTS) {
  console.log(
    `Launch ${launch.id} below minimum pool (${totalLamports} < ${MINIMUM_POOL_LAMPORTS}). Cancelling and refunding.`
  );
  await cancelAndRefund(connection, launch, contributions, escrowKeypair);
  return;
}
```

Add the import alongside the existing imports:

```ts
import { cancelAndRefund } from "./cancelAndRefund";
```

## Placement rationale

- After `escrowKeypair` decode → `cancelAndRefund` needs the escrow signer.
- After `connection` construction → reuses the same RPC connection.
- Before `chargeProcessingFee` → no treasury fee on cancelled raises.
- Before `withCustodialLock` / `fundCustodialWallet` / Lightning `create` call → no PumpPortal traffic, no custodial funding to unwind.

## Out of scope

- No changes to `executeBags.ts`, `executePumpfun.ts`, `cancelAndRefund.ts`, or DB schema (all already in place from the prior change).
- No frontend changes.

## Files changed

- `executor/src/executePumpfunLightning.ts` (1 import + ~6 line guard block)
