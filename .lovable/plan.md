

# Fix Bags API Base URL + Build Priority Features

## 1. Fix BAGS_API_BASE in all edge functions

All three functions currently use:
```
https://api.bags.fm
```

Must be changed to:
```
https://public-api-v2.bags.fm/api/v1
```

**Files:** `claim-fees/index.ts`, `claim-partner-fees/index.ts`, `execute-launch/index.ts`

This single change fixes the 404s across all Bags API calls.

---

## 2. Wire contribute flow on LaunchPage (highest priority)

Update `src/pages/LaunchPage.tsx`:
- The "Connect Wallet to Contribute" button currently does nothing
- Wire it to: (1) connect wallet via Privy, (2) send SOL transfer to escrow wallet, (3) call `contribute` edge function with `launch_id`, `wallet_address`, `amount_lamports`, `tx_signature`
- Show loading/success/error states
- Disable contribution if launch is not `scheduled` or launch time has passed

This requires Privy to be integrated first (step 3 below), so both will be built together.

---

## 3. Privy wallet integration scaffold

- Install `@privy-io/react-auth` and `@privy-io/solana` (or equivalent)
- Create a `PrivyProvider` wrapper in `App.tsx`
- Create a `useWallet` hook that exposes: `connect`, `disconnect`, `publicKey`, `signTransaction`, `sendTransaction`
- Wire connect/disconnect button into `Navbar.tsx`
- Wire into LaunchPage contribute flow and DashboardPage claim flow (replacing TODO markers)

**Secret needed:** `PRIVY_APP_ID` — this is a publishable client-side key, will be stored in `.env` as `VITE_PRIVY_APP_ID`

---

## 4. Wire Schedule page to create-launch edge function (lower priority, after above)

Currently `SchedulePage.tsx` inserts directly into Supabase with placeholder escrow keys. Instead it should call an edge function that generates a real escrow wallet and stores the encrypted private key.

---

## Implementation order

1. Fix `BAGS_API_BASE` in all 3 edge functions → redeploy → test with curl
2. Ask user for Privy App ID
3. Install Privy, create provider + hook
4. Wire contribute flow on LaunchPage
5. Wire claim flow on DashboardPage (replace TODOs with real partial-sign logic)
6. Wire Schedule page to edge function (if time permits)

