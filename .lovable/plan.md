

# Fix WalletDropdown: Balance Logging, SOL Logo, and Send Diagnostics

## Changes — all in `src/components/WalletDropdown.tsx`

### 1. Add diagnostic logging to SOL balance fetch (lines 57-59)
Replace the bare `getBalance` call with a try/catch that logs the wallet address, RPC URL, and lamport result. On failure, log the error and set balance to 0.

### 2. Use official SOL logo (lines 350-352)
Replace the gradient circle + "SOL" text with:
```html
<img src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" className="h-8 w-8 rounded-full object-cover" alt="SOL" />
```

### 3. Replace `handleSendSol` (lines 152-185)
Full rewrite with:
- Address validation before building tx
- Console logging at every step (from/to/amount/lamports/blockhash/signature)
- Solscan link in toast on success
- Signature extraction handles string, object with `.signature`, object with `.hash`, and fallback to JSON.stringify

### 4. Replace `handleSendToken` (lines 187-252)
Full rewrite with:
- Address validation before building tx
- Console logging at every step (token info, ATAs, recipient ATA existence, raw amount, blockhash, signature)
- Solscan link in toast on success
- Same robust signature extraction

### Note on Connection
The user's prompt suggests `useMemo` for the Connection, but it's already created as a module-level constant (line 34-35), which is correct and simpler. Keeping it as-is since module-level is equivalent and doesn't require hook overhead. The diagnostic logging in `loadBalances` will confirm the RPC URL is correct.

### Note on toast API
The current code uses `toast.success()` / `toast.error()` from sonner. The user's prompt uses `toast({ title, description, variant })` which is the shadcn/ui toast API. Will use sonner's API to stay consistent with the existing code, but include the Solscan links as JSX descriptions.

No other files changed.

