

# Make Dashboard reachable on mobile

## Problem

The Dashboard link in `Navbar.tsx` is wrapped in `hidden sm:inline-flex`, so it only appears on viewports ≥640px. On mobile (the user's 414px screenshot), connected users have no way to navigate to `/dashboard`. The "Schedule a Launch" button has the same `hidden sm:inline-flex` issue, but the request is specifically about Dashboard.

## Fix

Two coordinated changes so Dashboard is always reachable when connected:

### 1. `src/components/Navbar.tsx`
Remove `hidden sm:inline-flex` from the Dashboard link wrapper so it shows on all viewports. To keep the mobile navbar uncluttered, render a compact icon-only button on mobile and the labeled "Dashboard" button on `sm+`:

- Mobile (`<sm`): square `variant="outline"` button with a `LayoutDashboard` icon (lucide-react), same notification dot positioning.
- Desktop (`sm+`): existing labeled "Dashboard" button, unchanged.

This keeps the navbar visually balanced on a 414px screen alongside the wallet chip and the Dynamic widget, while always exposing the route.

### 2. `src/components/WalletDropdown.tsx`
Add a "Dashboard" entry inside the open wallet dropdown panel (right above "Export Private Key"), as a secondary access point. It's a `Link to="/dashboard"` styled like the existing "Export Private Key" / "Log out" rows, and closes the dropdown on click. This matches the user's mental model — wallet-related stuff lives in the wallet menu — and guarantees discoverability even if the navbar icon is missed.

## Out of scope

- Not changing "Schedule a Launch" visibility, the homepage hero already has a prominent "Schedule a Launch" CTA, but Dashboard has no fallback entry point — that's why this fix is Dashboard-only.
- No styling overhaul of the navbar, no hamburger menu introduction.
- No changes to routes, hooks, or `useDashboardNotifications`.

## Files edited

- `src/components/Navbar.tsx`
- `src/components/WalletDropdown.tsx`

