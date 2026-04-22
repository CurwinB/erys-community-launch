

# Grant admin access to curwinbreedy@gmail.com via Dynamic wallet

The user already authenticates through Dynamic (the existing wallet login). No new login flow is needed. We add a proper roles system keyed on the **wallet address** that Dynamic gives us, and replace the shared-password admin gate with a wallet-based check.

## Approach

1. Find the wallet address Dynamic returns for `curwinbreedy@gmail.com` (user provides it, or we read it from the existing `launches.created_by_wallet` / `contributions.wallet_address` rows for that user — they've already used the site).
2. Create an `admin_wallets` table (single column: lowercased wallet address). Public-readable so the client can check, service-role-write only.
3. Seed `curwinbreedy@gmail.com`'s wallet into it.
4. Replace `AdminGate` password check with: "is the connected Dynamic wallet in `admin_wallets`?" If yes, unlock. If not, show "Connect admin wallet" prompt.
5. Keep `VITE_ADMIN_PASSWORD` as a fallback for emergency access (optional — can remove if you prefer).

## Why a table, not hardcoded

You'll want to add/remove admins later without a redeploy. One row per admin wallet, manageable from the Supabase SQL editor.

## Files

**New migration**
- Create `admin_wallets` table:
  - `wallet_address text primary key` (stored lowercase)
  - `email text` (nullable, just a label so you remember who it is)
  - `added_at timestamptz default now()`
- Enable RLS. Policies:
  - SELECT: public (so client can check membership)
  - INSERT/UPDATE/DELETE: service_role only
- Seed row: `curwinbreedy@gmail.com` → his wallet address

**New file**
- `src/hooks/useIsAdmin.ts` — React Query hook. Reads connected wallet from `useWallet()`, queries `admin_wallets` for that address (lowercased), returns `{ isAdmin, isLoading }`.

**Edited**
- `src/components/admin/AdminGate.tsx` — Replace password form with:
  - If wallet not connected → "Connect your admin wallet" + Dynamic widget
  - If wallet connected but not in `admin_wallets` → "This wallet does not have admin access" + show connected address + disconnect button
  - If wallet is admin → call `onAuthenticated()` immediately (no password)
  - Persist `admin_authenticated` in sessionStorage so refreshes don't re-flash the gate
- `src/pages/AdminPage.tsx` — Replace the `useEffect` that reads sessionStorage with the `useIsAdmin` hook directly. Re-check on wallet change (so disconnecting kicks them out).

## What I need from you

**The wallet address tied to curwinbreedy@gmail.com in Dynamic.** Two ways to get it:

- **Easiest:** ask him to open the site, connect, and copy his address from the wallet dropdown.
- **Or:** if he's already created a launch or contributed, I can pull it from the DB. Tell me a token name he launched or a tx he made and I'll find it.

Once I have the address, the migration seeds it directly. After that, granting admin to anyone else is a one-line SQL insert.

## Out of scope

- No Supabase email auth, no Google OAuth, no profiles table. Dynamic already handles identity; we just authorize one of its wallets.
- No changes to `Navbar`, `useWallet`, or any non-admin route.
- Not removing the `VITE_ADMIN_PASSWORD` env var (left in place but unused; can delete later).

