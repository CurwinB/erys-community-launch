
## Overview

Two independent changes bundled together:

1. **Pump.fun fees → 100% to platform.** Remove the 50/50 split in the distributor. All claimed creator fees go to the Erys platform wallet.
2. **Alternative token-delivery wallet.** Let contributors (and the creator at scheduling time) optionally specify a different Solana address to receive tokens / Bags fee shares than the wallet they contribute from.

---

## Change 1: 100% of Pump.fun creator fees → platform

### `distributor/src/claimPumpfunFees.ts`

- Set `PLATFORM_SHARE = 1.0` (or just delete the constant — it's no longer needed).
- `TX_FEE_RESERVE`: drop from `10_000` → `5_000` (only one outgoing transfer now).
- Delete the entire creator-share `SystemProgram.transfer` block (lines ~177–201) and the `creatorShareLamports` calculation.
- Replace the two split log lines with a single:
  `console.log(`Platform claiming 100% of creator fees: ${distributableLamports / LAMPORTS_PER_SOL} SOL`)`
- Final stamp condition becomes `if (platformSent)` (drop `&& creatorSent`).
- Tighten the failure log to mention only the platform leg.

No DB or schema changes for this part — `pumpfun_creator_fees_distributed` column stays in place but will simply remain 0 going forward (we can leave it; removing it is a separate cleanup).

### `src/pages/LaunchPage.tsx` — Pump.fun copy update

Update the bottom info paragraph for Pump.fun launches to remove any creator-fee-share language. New copy:

> "Your SOL is held in escrow until launch. You will receive tokens at the earliest possible entry price proportional to your contribution. A small platform fee covers infrastructure costs. If this launch is cancelled your SOL is refunded automatically."

The "What you receive" bullet list for Pump.fun is already correct (it doesn't promise fee shares) — no change needed there.

Bags copy: untouched. Bags contributors still get permanent on-chain fee shares.

---

## Change 2: Optional alternative token-delivery wallet

### Database migration

```sql
ALTER TABLE public.contributions
ADD COLUMN IF NOT EXISTS token_delivery_wallet text;
```

Nullable. When null, fall back to `wallet_address`. No backfill needed.

### `supabase/functions/contribute/index.ts`

- Accept optional `token_delivery_wallet` in the request body.
- Validate: if provided, must be a non-empty string between 32 and 44 chars (base58 length range for a Solana pubkey). Trim whitespace. Reject otherwise with 400.
- Insert it (or `null`) on the contributions row alongside the existing fields.

No on-chain verification is required for `token_delivery_wallet` — it's just a destination preference, not the signer.

### `src/pages/LaunchPage.tsx` — contribution card

- Add `tokenDeliveryWallet` state (string).
- Render an optional input below the SOL amount input:
  - Label: "Receive tokens at a different wallet? (optional)"
  - Helper text varies by platform:
    - Pump.fun: "Enter your Pump.fun wallet to trade immediately after launch."
    - Bags: "Enter your Bags wallet to claim fees and trade immediately after launch."
- Client-side validation in `handleContribute`: if non-empty, length 32–44; otherwise toast error and abort. (Server re-validates.)
- Pass `token_delivery_wallet: tokenDeliveryWallet.trim() || null` to the `contribute` invoke.
- Clear the field after a successful contribution (alongside `setSolAmount("")`).

### `src/pages/SchedulePage.tsx` — creator's seed contribution

- Add `creatorDeliveryWallet: ""` to `form` state.
- In the "Your seed contribution" section, add the same optional input + helper text (creator-flavored copy: "Receive your tokens at a different wallet? (optional)").
- Same client-side length validation.
- In `recordContribution`, pass `token_delivery_wallet: form.creatorDeliveryWallet.trim() || null` to the `contribute` invoke.

### `distributor/src/db.ts`

Extend the `Contribution` interface:
```ts
token_delivery_wallet: string | null;
```
`getPendingContributions` already does `select("*")`, so the field flows through automatically.

### `distributor/src/distribute.ts`

In the per-contributor loop inside `distributeTokensForLaunch`, compute:
```ts
const recipientWallet = contribution.token_delivery_wallet || contribution.wallet_address;
```
Pass `recipientWallet` to `sendTokensToContributor` instead of `contribution.wallet_address`. Update the log line to mention both addresses when they differ (helps debugging):
> `Sending X tokens to <recipient> (contributor: <wallet_address>)`

`calculateSharesFromBalance` keeps using `contribution.wallet_address` as its key (which is what the creator-floor logic compares against `launch.created_by_wallet`) — that's correct, since the creator floor is anchored to the contributing wallet, not the delivery wallet.

### `executor/src/db.ts`

Same `Contribution` interface extension:
```ts
token_delivery_wallet: string | null;
```

### `executor/src/executeBags.ts`

In `buildFeeClaimers`, change:
```ts
user: new PublicKey(c.wallet_address),
```
to:
```ts
user: new PublicKey(c.token_delivery_wallet || c.wallet_address),
```

This means the contributor's chosen delivery wallet becomes the on-chain Bags fee-share recipient. The 100-claimer cap, BPS math, and creator-floor logic are unchanged — they all operate on contribution rows, not on wallet identity.

**One subtle interaction to confirm:** `buildFeeClaimers` treats `contributions[0]` (highest lamport amount) as "the creator" for the 750 bps floor. That assumption is unchanged by this feature — the floor still anchors to whoever contributed the most, which is typically the creator. The delivery-wallet swap only changes the on-chain recipient pubkey. (If the creator sets a delivery wallet, their floor BPS now flows to that delivery wallet, which is the desired behavior.)

### `executor/src/executePumpfun.ts` / `executePumpfunLightning.ts`

No changes needed at execution time. Pump.fun launches don't register fee-share recipients on-chain — token delivery happens later via `distributor/src/distribute.ts`, which we already updated.

---

## Files touched

**Migration:**
- `contributions.token_delivery_wallet` column added

**Edge function:**
- `supabase/functions/contribute/index.ts`

**Frontend:**
- `src/pages/LaunchPage.tsx` (contribution card + Pump.fun copy update from Change 1)
- `src/pages/SchedulePage.tsx`

**Distributor:**
- `distributor/src/claimPumpfunFees.ts`
- `distributor/src/db.ts`
- `distributor/src/distribute.ts`

**Executor:**
- `executor/src/db.ts`
- `executor/src/executeBags.ts`

---

## Out of scope / explicit non-goals

- We are NOT touching the dashboard / claim page. The dashboard currently lists earnings by `wallet_address`; if a contributor used a delivery wallet, their dashboard view (queried by their connected wallet, which equals `wallet_address`) still shows the contribution correctly. Tokens/fees just land in the delivery wallet on-chain.
- We are NOT migrating `pumpfun_creator_fees_distributed` out of the schema. It stays as a historical column and will simply remain 0 going forward.
- We are NOT changing Bags fee economics (still 100% to claimers via on-chain split).

## Memory updates

After implementation, update `mem://features/pumpfun-creator-fees` to record that the platform now takes 100% of Pump.fun creator fees (was 50/50). Add a short new memory `mem://features/token-delivery-wallet` documenting the optional override field and which code paths consume it (distributor token send, Bags fee-share claimer registration).
