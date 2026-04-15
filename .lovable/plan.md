

# Build Custom Wallet Dropdown in Navbar

## Overview
Replace the default DynamicWidget display with a custom wallet dropdown showing SOL balance, Erys token balances, and send functionality. Dynamic still handles auth/signing. Alchemy RPC handles all balance reads.

## Changes

### 1. Install dependency
`npm install @solana/spl-token`

### 2. New file: `src/components/WalletDropdown.tsx`
Full custom dropdown component with:
- **Trigger**: Shortened wallet address button with chevron, monospace font
- **Dropdown panel**: Positioned below navbar, dark card background matching brand (`bg-card`, `border-border`)
- **SOL balance**: Fetched via `connection.getBalance()` from Alchemy RPC (`VITE_SOLANA_RPC_URL`)
- **Erys tokens**: Queried from Supabase (contributions + created launches), then on-chain balance read via `getAssociatedTokenAddress` + `getParsedAccountInfo` for each mint. Only shows tokens with non-zero balance.
- **Send SOL**: Form with recipient address + amount, builds `SystemProgram.transfer` transaction, signs via Dynamic's `wallet.getSigner().signAndSendTransaction()`
- **Send token**: Same UX per token, builds SPL transfer with automatic ATA creation for recipient via `createAssociatedTokenAccountInstruction`
- **Disconnect**: Calls `handleLogOut()` from `useDynamicContext()`
- **Outside click**: Closes dropdown on mousedown outside ref
- **Balance refresh**: Loads on every dropdown open

Uses `ErysToken` interface with `mint`, `name`, `symbol`, `image_url`, `balance` (bigint), `decimals`, `launch_id`.

### 3. Edit: `src/components/Navbar.tsx`
- Import `WalletDropdown`, `useDynamicContext`, `DynamicWidget`
- When connected: show `<WalletDropdown />` and a hidden `<DynamicWidget />` (keeps Dynamic internal state active)
- When not connected: show `<DynamicWidget />` as the connect button
- Remove the `WalletButton` import

### 4. Delete or keep `src/components/WalletButton.tsx`
No longer imported — can be deleted for cleanup.

## Technical notes
- `Connection` created with `import.meta.env.VITE_SOLANA_RPC_URL` (already in `.env`)
- Toast uses sonner-compatible `toast` from `sonner` (project has both legacy and sonner; will use sonner for consistency)
- All Supabase queries use existing `contributions` and `launches` tables — no schema changes needed
- Token decimals default to 6 (standard for Bags tokens), overridden by on-chain parsed data

## No database changes required

