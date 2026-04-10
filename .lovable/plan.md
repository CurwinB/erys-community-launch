

# Fix API Headers, ConfigKey Parsing, Build Contribute Function

## 1. Fix `Authorization: Bearer` → `x-api-key` (10 occurrences across 3 files)

**`execute-launch/index.ts`** — lines 162, 209, 251:
```
Authorization: `Bearer ${BAGS_API_KEY}`  →  "x-api-key": BAGS_API_KEY
```

**`claim-fees/index.ts`** — lines 33, 66, 104:
```
Authorization: `Bearer ${BAGS_API_KEY}`  →  "x-api-key": BAGS_API_KEY
```

**`claim-partner-fees/index.ts`** — lines 30, 62, 85:
```
Authorization: `Bearer ${BAGS_API_KEY}`  →  "x-api-key": BAGS_API_KEY
```

## 2. Fix configKey extraction in `execute-launch`

Line 181: change `feeShareData.configKey` → `feeShareData.response?.meteoraConfigKey`

The existing null check on line 183 already handles the undefined case and will call `setFailed` — no additional code needed since the guard is already there.

## 3. Database: Add unique constraint on `contributions.tx_signature`

Migration:
```sql
ALTER TABLE public.contributions ADD CONSTRAINT contributions_tx_signature_unique UNIQUE (tx_signature);
```

This prevents double-recording at the database level regardless of edge function race conditions.

## 4. Build `contribute` edge function

New file: `supabase/functions/contribute/index.ts`

**Input:** `{ launch_id, wallet_address, amount_lamports, tx_signature }`

**Verification sequence:**

1. Validate all required fields present
2. Verify launch exists, `status = 'scheduled'`, `launch_datetime` is in the future
3. Verify amount is within `min_contribution_lamports` / `max_contribution_lamports`
4. **On-chain verification with retry** — call Solana RPC `getTransaction` with `commitment: "confirmed"`, retry up to 3 times with 2-second gaps if transaction not found yet
5. **Verify destination** — confirm the transaction transfers SOL to the launch's `escrow_wallet_public_key`
6. **Verify amount** — confirm transferred lamports matches `amount_lamports`
7. **Verify signer** — confirm `wallet_address` matches the actual signer/fee-payer of the on-chain transaction (prevents someone claiming another person's tx)
8. Insert into `contributions` table (unique constraint on `tx_signature` catches any race condition duplicates)

**Solana RPC:** Uses public `https://api.mainnet-beta.solana.com` (or devnet equivalent). The `getTransaction` response includes `transaction.message.accountKeys[0]` as the fee payer — compare against `wallet_address`.

**Retry logic:**
```
for attempt 1..3:
  call getTransaction(tx_signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
  if found → proceed to validation
  if not found and attempt < 3 → wait 2 seconds
  if not found after 3 attempts → return error "Transaction not confirmed yet, try again"
```

## 5. Deploy and test all 4 functions

Deploy `execute-launch`, `claim-fees`, `claim-partner-fees`, and `contribute`. Test each with `curl_edge_functions`.

## Implementation order

1. Fix all 10 `x-api-key` headers across 3 files
2. Fix `configKey` → `feeShareData.response?.meteoraConfigKey`
3. Add unique constraint migration on `contributions.tx_signature`
4. Build `contribute` edge function with retry + signer verification
5. Deploy and test all functions

