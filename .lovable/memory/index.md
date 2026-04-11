# Project Memory

## Core
Erys: Solana token launch platform on Bags.fm. Dark theme bg #0A0A0A, accent #00D4FF, cards #111111.
Inter body, JetBrains Mono for countdowns/numbers. Sharp edges, no rounded bubbly UI.
Wallet auth: Dynamic.xyz (NOT Privy). DynamicWidget for connect/disconnect. isSolanaWallet() guard before getSigner().
Escrow wallets use AES-256-GCM with ESCROW_ENCRYPTION_KEY secret. Never client-side decrypt.
Contributions require on-chain tx verification before DB insert.
Execute-launch order: fee-share/config FIRST, then create-launch-transaction, then send-transaction.
Launch status enum: scheduled → executing → launched | execution_failed | cancelled.
Claim txs from Bags are pre-signed. Dynamic signer must partial-sign, never replace existing signatures.
Partner wallet goes in `partner` field, NEVER in claimersArray. Max 100 claimers, BP sum = 10000.

## Memories
- [Brand tokens](mem://design/brand) — Full color palette, font choices, glow effects
- [Execute-launch order](mem://features/execute-launch) — Critical API call sequence for launch execution
- [Contribution flow](mem://features/contribution-flow) — On-chain verification before DB write
- [Escrow encryption](mem://features/escrow-encryption) — AES-256-GCM spec for private keys
- [Fee share config](mem://features/fee-share-config) — Exact API structure, basis points calc, 100 claimer limit
- [Claim flow](mem://features/claim-flow) — Partial signing rule, dashboard claim UX, automated platform claiming
