# Crypto-Native Copy Refresh

Goal: make Erys read like a tool degens already understand. Keep the underlying flow identical — only the wording, labels, and microcopy change. No schema, no API, no business logic.

## Translation glossary (applied site-wide)

| Current wording | New crypto-native wording |
|---|---|
| Community Launch Platform | Presale Launchpad / Fair-Launch Presales |
| Schedule a Launch | Launch a Presale |
| Contribute / Contribution | Ape in / Allocation (contribution amount stays "SOL in") |
| Contributor | Presaler / Ape |
| SOL in Escrow | Presale Raise (SOL) |
| Min Contribution | Min Buy |
| Total Escrow | Total Raised |
| "Receive Tokens" | "Token Allocation Drops to Your Wallet" |
| "Earn Trading Fees Forever" | "Permanent Creator-Fee Share (on-chain)" |
| "Transparent Escrow" | "Non-Custodial Escrow" |
| "Two Platforms" | "Bags or Pump — your call" |
| Live | Live Presale |
| Launched | Migrated / Live on DEX |
| Scheduled | Presale Open |
| Bags.fm tag | Bags Fee-Share |
| Pump.fun tag | Pump Fair-Launch |

We keep "launch" as a verb (it's already crypto-native). We retire "community launch" as a noun and replace with "presale" / "fair-launch presale".

## Files to update (copy only)

1. **src/pages/Index.tsx** — hero, badge, feature blurbs, section titles ("Live Launches" → "Open Presales", "Completed Launches" → "Migrated Tokens"), empty states, SEO title/description, JSON-LD description.
2. **src/components/Navbar.tsx** — "Schedule a Launch" → "Launch a Presale".
3. **src/components/Footer.tsx** — tagline + "Schedule a Launch" link label.
4. **src/components/LaunchCard.tsx** — labels: "Escrow" → "Raised", "Contributors" → "Presalers", "Min Contribution" → "Min Buy", CTA "Participate" → "Ape In", "Launches in" → "Presale ends in", "View Details" → "View Token".
5. **src/components/launch/HowItWorks.tsx** — rewrite both `bagsSteps` and `pumpfunSteps` titles + bodies in presale language (Ape In → Get Allocation → Earn Fees / Trade Early).
6. **src/components/launch/LaunchStats.tsx** — "SOL in Escrow" → "Presale Raise", contributors label → "Presalers".
7. **src/components/launch/ContributionFeed.tsx** — "Recent Contributions" → "Recent Apes", empty state → "No apes yet. Be first in.".
8. **src/pages/SchedulePage.tsx** — page title, form section headers, button text ("Schedule" → "Open Presale"), helper text using "min buy / max buy / presale ends at".
9. **src/pages/LaunchPage.tsx** — section headings, contribute panel ("Contribute SOL" → "Ape In", "Your contribution" → "Your allocation"), success/error toasts.
10. **src/pages/DashboardPage.tsx** — tab labels and row copy ("Contributed" → "Aped", "View launch" → "View presale", empty states).
11. **src/pages/SponsoredPage.tsx** — "Sponsored Launch" → "Featured Presale Slot" wording pass.
12. **src/components/StatusBadge.tsx** — display strings for `scheduled` ("Presale Open"), `executing` ("Migrating"), `launched` ("Live on DEX"), `execution_failed` ("Refund Available"), `sweep_recovery` ("Recovering"), `cancelled` ("Cancelled"). Underlying enum values unchanged.
13. **src/components/Seo.tsx callers** + index.html `<title>`/meta description — presale-first SEO copy.
14. **public/sitemap.xml** unchanged. **public/robots.txt** unchanged.

## Hero rewrite (proposed)

- Badge: `PRESALES ON BAGS.FM & PUMP.FUN`
- H1: `Run a fair-launch presale on Solana.`
- Sub: `Open a presale, let your community ape in before the token migrates to Bags or Pump. Allocations drop on-chain the moment it goes live.`
- Primary CTA: `Launch a Presale`
- Secondary CTA: `How presales work`

## Feature trio rewrite

1. **Two launchpads, one presale flow.** Pick Bags for permanent creator-fee share or Pump for first-block entry.
2. **Apes get allocation, not promises.** Tokens hit presaler wallets the second the bonding curve opens.
3. **Non-custodial escrow.** SOL sits in a per-presale escrow. No mint, no migration → automatic refund.

## How-It-Works rewrite

Bags presale:
1. **Ape In** — Send SOL to the presale escrow before it ends.
2. **Get Your Allocation** — Tokens drop to your wallet at migration, pro-rata to your buy.
3. **Earn Creator Fees Forever** — You're written on-chain as a permanent fee-share recipient. Every trade, every block, forever.

Pump fair-launch presale:
1. **Ape In Early** — SOL into the presale escrow, locked in your spot before the curve opens.
2. **First-Block Entry** — Allocation lands at the bottom of the bonding curve, before any public buy.
3. **No Claim, No Wait** — Tokens are in your wallet the instant the presale migrates.

## Memory updates

Append to `mem://index.md` Core: `Copy convention: use "presale", "ape in", "allocation", "presaler", "raised", "min buy", "migrate". Avoid "community launch", "contribute", "contributor", "escrow" in user-facing copy.` Save a `mem://design/copy-voice` file with the full glossary so future edits stay consistent.

## Out of scope

- No DB column renames, no enum value changes, no API field renames.
- No visual / layout changes (button, color, spacing untouched).
- Admin pages (`src/components/admin/*`) keep technical wording — operators expect it.
- Legal pages (Terms / Privacy / Risk) keep precise language for compliance.

## Risk

Only string literals change. SEO will improve (presale is high-intent). One QA pass on `/`, `/schedule`, `/launch/:id`, `/dashboard` to confirm no hardcoded width breaks from longer/shorter labels.
