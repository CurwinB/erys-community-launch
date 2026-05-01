# Project Memory

## Core
Erys: Solana token launch platform on Bags.fm. Dark theme bg #0A0A0A, accent #00D4FF, cards #111111.
Inter body, JetBrains Mono for countdowns/numbers. Sharp edges, no rounded bubbly UI.
Escrow wallets use AES-256-GCM with ESCROW_ENCRYPTION_KEY secret. Never client-side decrypt.
Contributions require on-chain tx verification before DB insert.
Execute-launch order: fee-share/config FIRST, then create-launch-transaction, then send-transaction.
Launch status enum: scheduled → executing → launched | execution_failed | sweep_recovery | cancelled.
Claim txs from Bags are pre-signed. Dynamic must partial-sign, never replace existing signatures.
Partner wallet goes in `partner` field, NEVER in claimersArray. Max 100 claimers, BP sum = 10000.
Creator minimum: 750 BP fee share floor (10% of 7500), 5% token distribution floor.
ATA reserve: deduct numContributors * 0.00203928 SOL from initialBuyLamports before launch.
Dynamic.xyz for wallet auth, NOT Privy. embeddedWallets: createOnLogin: 'users-without-wallets'.
Alchemy RPC: SOLANA_RPC_URL (Supabase secret) + VITE_SOLANA_RPC_URL (frontend .env).
Pump.fun mints are Token-2022 — executor + distributor must detect mint owner program for ATA/transfer ops.
Refunds blocked when Pump.fun mint exists on-chain (signature persisted or status launched/sweep_recovery).
Copy voice: crypto-native — use "presale", "ape in", "allocation", "presaler", "raised", "min buy", "migrate". Avoid "community launch", "contribute", "contributor", "escrow" in user-facing copy. Admin and legal pages exempt.

## Memories
- [Brand tokens](mem://design/brand) — Full color palette, font choices, glow effects
- [Execute-launch order](mem://features/execute-launch) — Critical API call sequence for launch execution
- [Contribution flow](mem://features/contribution-flow) — On-chain verification before DB write
- [Escrow encryption](mem://features/escrow-encryption) — AES-256-GCM spec for private keys
- [Fee share config](mem://features/fee-share-config) — Exact API structure, basis points calc, 100 claimer limit
- [Claim flow](mem://features/claim-flow) — Partial signing rule, dashboard claim UX, automated platform claiming
- [Custodial wallet locking](mem://features/custodial-wallet-locking) — withCustodialLock serializes shared PumpPortal wallet ops across executor + distributor
- [Pump.fun creator fees](mem://features/pumpfun-creator-fees) — Verified: 0.30% creator fee on bonding curve since May 12 2025; custodial wallet IS the on-chain creator; collectCreatorFee batches all coins per API key
- [Token delivery wallet](mem://features/token-delivery-wallet) — Optional per-contribution override for token + Bags fee-share recipient; falls back to wallet_address
- [Creator token floor](mem://features/creator-token-floor) — Hard 5% creator floor on token-supply distribution, enforced with pre-send invariant assertion in distributor
- [Sweep recovery](mem://features/sweep-recovery) — sweep_recovery status auto-recovers post-mint sweep failures; refunds blocked once mint exists; Token-2022 detection end-to-end
- [Copy voice](mem://design/copy-voice) — Full crypto-native copy glossary (presale/ape/allocation/migrate)
