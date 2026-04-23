

# Add private key export to wallet dropdown

The Disconnect button is already correctly wired in `WalletDropdown.tsx` (verified). Add an "Export Private Key" action above it that opens Dynamic's built-in user profile modal — which contains the secure key-export UI for embedded wallets.

## Changes — `src/components/WalletDropdown.tsx` only

1. **Pull `setShowDynamicUserProfile` from the existing `useDynamicContext()` call** (already imported, already destructuring `handleLogOut`):

   ```ts
   const { handleLogOut, setShowDynamicUserProfile } = useDynamicContext();
   ```

2. **Add an "Export Private Key" button** directly above the existing Disconnect button at the bottom of the dropdown panel. Visible whenever `publicKey` is set (the dropdown only renders when connected, so no extra guard needed):

   ```tsx
   <button
     onClick={() => {
       setShowDynamicUserProfile(true);
       setOpen(false);
     }}
     className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-2 border-t border-border"
   >
     Export Private Key
   </button>
   <p className="px-3 pt-2 pb-1 text-[10px] text-center text-muted-foreground/70 leading-relaxed">
     Your keys are non-custodial. Export to use in any Solana wallet.
   </p>
   ```

3. **Leave the Disconnect button as-is** — it already calls `handleLogOut()` and `setOpen(false)` (verified in current file).

## Why `setShowDynamicUserProfile` (not `connector.exportWallet()`)

Confirmed from the installed `@dynamic-labs/sdk-react-core` types: `setShowDynamicUserProfile` is exposed on the public `useDynamicContext()` return type. It opens Dynamic's own modal, which for embedded (Turnkey-backed) wallets includes the official "Export private key" flow. `connector.exportWallet?.()` is not a guaranteed method on the public connector interface, so the user-profile modal is the safe, version-agnostic path.

## Files edited

- `src/components/WalletDropdown.tsx` — single-file change. No new dependencies.

