

# Erys — Full Build Plan (Final)

All previous plan details remain unchanged. This is the single clarification added before implementation begins.

## Critical Fix: Claim Transaction Partial Signing

The `claim-txs/v3` endpoint returns a transaction that is **already partially signed by Bags**. The frontend must preserve that existing signature when the user signs via Privy.

**What must happen:**
1. `claim-fees` edge function calls `POST /token-launch/claim-txs/v3` and returns the serialized transaction to the frontend as-is
2. Frontend deserializes the transaction (as a `VersionedTransaction` or `Transaction` object)
3. Frontend uses Privy's `signTransaction` — which adds the user's signature without replacing existing signatures (partial sign)
4. Frontend submits the fully-signed transaction via `POST /solana/send-transaction`

**What must NOT happen:**
- Do not rebuild or re-create the transaction from scratch
- Do not use any signing method that clears existing signatures
- Do not call `signAndSendTransaction` if it would strip Bags' signature

This will be enforced in the frontend claim flow implementation.

## Implementation Order

1. Database migration — add columns to `launches` and `contributions`, create `platform_fee_claims` table, add service_role UPDATE policies
2. Save memory updates (fee-share construction, partial signing rule)
3. `execute-launch` edge function (fee-share/config → create-launch-transaction → send-transaction)
4. `claim-fees` edge function (claimable-positions proxy + claim-txs/v3 proxy)
5. `claim-partner-fees` edge function (automated platform fee claiming)
6. Dashboard wiring with real claimable balances and partial-sign claim flow
7. Privy integration scaffold across all pages

## Secrets Needed Before Edge Functions

| Secret | Status |
|---|---|
| `BAGS_API_KEY` | Not set — user must provide |
| `BAGS_PARTNER_WALLET` | Not set — user must provide |
| `BAGS_PARTNER_CONFIG` | Not set — user must provide |
| `ESCROW_ENCRYPTION_KEY` | Not set — user must provide |
| `ERYS_PLATFORM_PRIVATE_KEY` | Not set — user must provide |

Will prompt user for these before deploying edge functions.

