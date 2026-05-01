---
name: Crypto-native copy voice
description: Copy glossary and voice rules — use presale/ape/allocation/migrate, never community-launch/contribute/escrow in user-facing copy
type: design
---
Voice: crypto-native, terse, degen-friendly. No corporate "platform" language in user-facing copy.

Glossary (apply site-wide except admin and legal pages):
- "community launch" → "presale" / "fair-launch presale"
- "Schedule a Launch" → "Launch a Presale"
- "Contribute" / "Contribution" → "Ape In" / "Buy" / "Allocation"
- "Contributor" → "Presaler"
- "SOL in Escrow" → "Presale Raise" / "Raised"
- "Min Contribution" → "Min Buy"
- "Max Contribution" → "Max Buy"
- "Receive Tokens" → "Allocation Drops" / "Token Allocation"
- "Trading Fees" → "Creator Fees"
- "Transparent Escrow" → "Non-Custodial Escrow"
- "Live" (status) → "Live Presale" / "Presale Open"
- "Launched" / "Completed" → "Migrated" / "Live on DEX"
- "Launches in" → "Presale ends in"
- "Launch Time" → "Migration Time"
- CTA "Participate" / "Contribute SOL" → "Ape In"

Keep "launch" as a verb only. Status enum values, DB columns, and API field names stay unchanged — this is purely a UI copy convention.

Out of scope: admin pages (`src/components/admin/*`) and legal pages (Terms / Privacy / Risk) keep precise/technical wording.

Hero pattern:
- Badge: short ALLCAPS context
- H1: action verb + "presale on Solana"
- Sub: one line on flow + outcome
- Primary CTA: "Launch a Presale"