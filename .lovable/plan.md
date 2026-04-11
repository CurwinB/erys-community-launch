

# Replace Privy with Dynamic.xyz

## Summary
Remove all Privy packages and references. Install Dynamic.xyz SDK for Solana-only wallet connection. Update provider, hook, wallet button, and both page flows.

## Build error fix (CSS)
Move the `@import url(...)` in `src/index.css` from line 5 to line 1 (before `@tailwind` directives) to fix the `@import must precede all other statements` build error.

## Changes

### 1. Package swap
- **Remove**: `@privy-io/react-auth` (and any sub-packages)
- **Install**: `@dynamic-labs/sdk-react-core`, `@dynamic-labs/solana`

### 2. Environment variable
- Remove `VITE_PRIVY_APP_ID` from `.env`
- Add `VITE_DYNAMIC_ENVIRONMENT_ID` — will prompt user for value

### 3. `src/App.tsx`
- Remove `PrivyProvider`, `toSolanaWalletConnectors`, `PRIVY_APP_ID`
- Wrap app in `DynamicContextProvider` with `SolanaWalletConnectors` and `environmentId` from env

### 4. `src/hooks/useWallet.ts`
- Replace Privy hooks with `useDynamicContext` and `isSolanaWallet`
- Expose `ready` (sdkHasLoaded), `connected`, `publicKey`, `wallet`
- Remove `connect`/`disconnect` (handled by DynamicWidget)

### 5. `src/components/WalletButton.tsx`
- Replace entire component with `<DynamicWidget />` from `@dynamic-labs/sdk-react-core`

### 6. `src/components/Navbar.tsx`
- Use updated WalletButton (no interface change needed)

### 7. `src/pages/LaunchPage.tsx`
- Replace Privy `signAndSendTransaction` with Dynamic signer:
  ```
  const signer = await wallet.getSigner()
  const txSignature = await signer.signAndSendTransaction(tx)
  ```

### 8. `src/pages/DashboardPage.tsx`
- Replace Privy `signTransaction` with Dynamic signer:
  ```
  const signer = await wallet.getSigner()
  const signed = await signer.signTransaction(versionedTx)
  ```

### 9. Deploy and test
- Verify build succeeds
- Test wallet connect via DynamicWidget

## Technical details
- `DynamicWidget` provides built-in connect/disconnect, address display, and private key export — no custom UI needed
- `isSolanaWallet()` type guard is required before calling `getSigner()`
- No wagmi connector needed (Solana-only)

