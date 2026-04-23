

# Contributor Dashboard Redesign

Transform the existing `/dashboard` from a 2-tab launches/contributions view into a contributor-focused 4-tab dashboard with notifications, plus a notification dot on the navbar.

## Tab structure

The page header changes to "Dashboard" with the connected wallet address shown as a chip. The existing "My Launches" view (cancel + view created launches) is removed from the dashboard — this page is now contributor-only. Tabs:

1. **Notifications** (default) — actionable cards
2. **My Tokens** — distributed token positions
3. **My Fees** — Bags fee positions and total claimable
4. **My Contributions** — full historical log

## Notifications tab

Three notification card types, derived from existing data:

- **Tokens received (success/green border)** — for any contribution where `tokens_distributed = true` and `launches.distribution_completed_at` is within the last 7 days. Shows token logo, "You received X $SYMBOL", date, "Trade on Pump.fun/Bags.fm" link, and a dismiss (X) button.
- **Claimable fees (amber border)** — for any Bags contribution where `claimableDisplayAmount > 0.001` SOL. Shows amount + inline "Claim" button calling existing `claim-fees` flow.
- **Launch executing soon (cyan border)** — for any contribution whose `launches.status = 'scheduled'` and `launch_datetime` is within the next 2 hours. Shows countdown text and escrowed SOL amount.

Dismissal: dismissed notification IDs (the contribution `id` for token-received cards) are persisted in `localStorage` under `erys.dismissedNotifications` (string array). Only "tokens received" cards are dismissible — claimable fees and upcoming launches stay until the underlying state changes.

Empty state: bell icon + "No new notifications" + helper copy.

## My Tokens tab

For each contribution where `tokens_distributed = true`, render a card showing token image/initial, name, symbol, platform badge, formatted token amount, contributed SOL, distribution date, and a "Trade →" external link to Pump.fun or Bags.fm.

Empty state: "No tokens yet" + link to homepage.

## My Fees tab

Bags-only. Top summary card with **Total claimable** (sum of `claimableDisplayAmount` across positions) and a "Claim All" button that sequentially runs the existing `claim-fees` claim+sign+send flow per mint with non-zero claimable.

Below: one card per Bags contribution where `is_fee_claimer !== false`. Shows token, claimable SOL amount, your share (`basis_points / 100`%), contributed SOL, and a per-position "Claim" button (disabled when claimable = 0). Excluded contributions render the existing destructive "excluded from fee share" notice instead of a claim button.

Empty state: "No fee positions" + helper copy.

## My Contributions tab

Full historical list (already-shown data, restyled): token info, contributed SOL, status badge, platform, contribution date, token amount or "Pending", and a "View launch →" link to `/launch/:id`.

## Navbar notification dot

`src/components/Navbar.tsx` extracts notification count via a small shared hook (`useDashboardNotifications`) that:

- Fetches the same contributions + claimable-positions queries (gated on `connected`)
- Reads dismissed IDs from localStorage
- Returns `hasUnread = true` when any of: undismissed recent token distribution, claimable fee > 0.001 SOL, or upcoming launch in next 2h

When `hasUnread` is true, render a small `bg-primary` pulsing dot (absolutely positioned top-right) on the existing Dashboard button.

## Files

**New:**
- `src/hooks/useDashboardNotifications.ts` — shared hook returning `{ tokenNotifications, feeNotifications, upcomingNotifications, hasUnread, dismiss, dismissedIds }`. Used by both `DashboardPage` and `Navbar`.

**Edited:**
- `src/pages/DashboardPage.tsx` — full rewrite: 4 tabs, notification cards, removes "My Launches" tab and cancel mutation (creator launch management stays accessible from `/launch/:id`).
- `src/components/Navbar.tsx` — add notification dot wrapper around the Dashboard button using the new hook.

**Unchanged:** No edge function, schema, route, or env changes. `claim-fees` and `LAUNCH_PUBLIC_COLUMNS` reused as-is. `formatSol`, `formatDate`, `StatusBadge`, `Skeleton` reused.

## Out of scope

- "My Launches" (creator-side cancel/view) is intentionally dropped from this page per the new spec. If you'd like to keep it as a 5th tab, say so before approval.
- No new Supabase tables for notifications — dismissal stays client-side in localStorage.

