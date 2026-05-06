# Saved Pump/Bags Wallets

## Where wallets are entered today

Three flows ask the user to type a Solana destination wallet, all sent to backend as `token_delivery_wallet` / `creator_delivery_wallet`:

1. **Contribution** — `src/pages/LaunchPage.tsx` (`tokenDeliveryWallet` input, ~line 468). Label: "Send allocation to a different wallet?". Used for both Pump.fun and Bags launches.
2. **Schedule a launch** — `src/pages/SchedulePage.tsx` (`form.creatorDeliveryWallet`, ~line 770). Used when the creator seeds their own presale.
3. **Sponsored slot claim** — `src/pages/SponsoredPage.tsx` (`creatorDeliveryWallet`, ~line 467). Pump.fun-only.

Each is a free-text `<Input>`. Same address often gets retyped across launches/contributions by the same connected wallet.

The connected wallet (Dynamic SDK) is exposed via `useWallet()` → `publicKey`. There is no Supabase `auth.uid()` in this app — user-scoped reads use `p_wallet text` RPC params (e.g. `list_my_contributions`), which is the established pattern.

## Proposed UX

Add a lightweight wallet book:

- New small component `SavedWalletPicker` rendered above each of the 3 inputs.
- Shows a row of chips: each saved wallet (label + truncated address). Clicking one fills the input.
- Below the input: "Save this wallet" checkbox + optional label field (e.g. "Phantom main", "Bags hot"). Defaults to checked when the field has a valid new address.
- Each entry is tagged `pumpfun` or `bags` (matched to the current launch's platform) so the picker only shows wallets relevant to the current flow. A wallet can carry both tags.
- Saved entries are scoped to the currently connected wallet (`publicKey`).
- Small "Manage" link opens a modal to rename/delete entries.

When the connected wallet changes or disconnects, the picker hides.

## Storage approach

**Option A — localStorage (recommended for v1):** key `erys.savedWallets.<connectedWallet>` → array of `{ address, label, platforms: ('pumpfun'|'bags')[], lastUsedAt }`. Zero backend work, instant, private to the user's browser. Trade-off: doesn't sync across devices/browsers.

**Option B — Supabase table `saved_wallets`:** columns `(id, owner_wallet, address, label, platforms text[], last_used_at, created_at)`. Reads via an RPC `list_saved_wallets(p_owner_wallet)` (matches existing `list_my_contributions` pattern — unauthenticated, owner-scoped by param; not sensitive since they're public addresses). Writes go through a new edge function `save-wallet` that requires the caller to **sign a short message with the connected wallet** (Dynamic signer) so we can verify ownership before insert/update/delete. This prevents a third party from polluting someone else's wallet book.

I recommend starting with **Option A** to ship fast and avoid the signature prompt on every save. We can migrate to Option B later (with a one-time import from localStorage) if cross-device sync is requested.

## Implementation steps (Option A)

1. `src/lib/savedWallets.ts` — typed helpers: `listSavedWallets(owner, platform?)`, `saveWallet(owner, entry)`, `removeSavedWallet(owner, address)`, `touchSavedWallet(owner, address)`. Uses `localStorage`, namespaced per `owner`.
2. `src/components/SavedWalletPicker.tsx` — chips row + "Manage" sheet (using existing shadcn `Sheet` + `Dialog`). Props: `platform`, `value`, `onChange`. Validates Solana address format (reuse the regex already in `LaunchPage.tsx`).
3. `src/components/SaveWalletToggle.tsx` — checkbox + label input shown under the address `Input` when it holds a new valid address.
4. Wire into:
   - `LaunchPage.tsx` (platform = `launch.platform`)
   - `SchedulePage.tsx` (platform = current `platform` state)
   - `SponsoredPage.tsx` (platform = `pumpfun`)
5. On successful submit in each flow, call `saveWallet` (if toggle checked) and `touchSavedWallet` so most-recently-used floats to the front.

## Out of scope

- No DB migration, no edge functions, no auth changes for v1.
- Existing `creator_delivery_wallet` / `token_delivery_wallet` payload shape is unchanged — backend stays exactly the same.

## Question before implementation

Pick **Option A (localStorage)** or **Option B (Supabase + signed save)**? Option A is what I'll build unless you say otherwise.
