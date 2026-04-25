---
name: Optional token delivery wallet override
description: Contributors and creators can specify an alternative Solana address to receive tokens and Bags fee shares; falls back to the contributing wallet when null
type: feature
---

## Column

`contributions.token_delivery_wallet text NULL` — added 2026-04-25.

If null, tokens / fee-share registration default to `contributions.wallet_address` (the wallet that signed the SOL transfer). If set, it must be a valid base58 Solana pubkey (length 32–44, base58 charset).

## Capture points

- **Launch page** (`src/pages/LaunchPage.tsx`) — optional input under SOL amount in the contribution card.
- **Schedule page** (`src/pages/SchedulePage.tsx`) — optional input under the creator seed contribution input. Lives in `form.creatorDeliveryWallet`.

Both validate client-side (length + base58 charset), then pass `token_delivery_wallet` in the body of the `contribute` edge function.

## Validation

`supabase/functions/contribute/index.ts` re-validates: trimmed, length 32–44, base58 charset (`/^[1-9A-HJ-NP-Za-km-z]+$/`). Empty / null / undefined all stored as NULL.

No on-chain verification required — it's a destination preference only, not the signer.

## Consumption

- **Bags fee-share registration:** `executor/src/executeBags.ts` `buildFeeClaimers` uses `c.token_delivery_wallet || c.wallet_address` as the on-chain claimer pubkey. The contributor's chosen wallet receives both the tokens and the permanent Bags fee share.
- **Token distribution (both platforms):** `distributor/src/distribute.ts` sends SPL tokens to `contribution.token_delivery_wallet || contribution.wallet_address`.
- **Share math:** `calculateSharesFromBalance` continues to key on `wallet_address` (creator-floor logic compares to `launch.created_by_wallet`). The override only changes the destination, not the BPS allocation.

## Out of scope

- Dashboard / claim page is not aware of the override. Contributors viewing their dashboard via the connecting wallet still see the contribution row correctly; tokens/fees just landed in the override wallet on-chain.
