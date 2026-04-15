

# Fix Alchemy RPC Key and Remove Key Logging

## Problem
The `.env` has the literal placeholder `YOUR_KEY` instead of the real Alchemy API key, causing 401 errors. Also, the diagnostic logging prints the full RPC URL (including API key) to the browser console.

## Changes

### 1. Update `.env` — replace placeholder with real key
```
VITE_SOLANA_RPC_URL="https://solana-mainnet.g.alchemy.com/v2/<real-key>"
```
The user needs to provide their key (they shared it in chat: `wCCpZ1gym...`). I'll update it.

### 2. Edit `src/components/WalletDropdown.tsx` — mask RPC URL in logs
Replace:
```typescript
console.log("Using RPC:", ALCHEMY_RPC)
```
With:
```typescript
console.log("Using RPC:", ALCHEMY_RPC?.split("/v2/")[0] + "/v2/***")
```

This logs enough to confirm the endpoint without exposing the key.

### Security note
`VITE_` prefixed env vars are bundled into the client-side JS — anyone can find the key in the built source. This is standard for RPC keys (Alchemy rate-limits by key, not a true secret). But logging it to console makes it trivially visible, so masking the log is worthwhile.

No other changes needed.

