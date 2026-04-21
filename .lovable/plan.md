

# Homepage Redesign — Lead with Live Launches

## 1. `src/pages/Index.tsx` — restructure

**Hero (minimal):**
- Keep badge pill: `Launch on Bags.fm or Pump.fun`
- Keep headline: `The Community Launch Platform for Solana Tokens.`
- Remove the long subheadline paragraph
- Buttons: `Schedule a Launch` (no rocket icon) + `How it works ↓` (anchors to `#how-it-works`, smooth scroll)
- Remove "View Launches" button
- Remove the three feature cards from above-the-fold

**Live launches (immediately below hero, no section header):**
- Grid renders directly under the hero
- Empty state: single centered card with "No launches scheduled yet." + `Schedule the First Launch` button (replaces the current rocket-icon empty state)
- Loading skeletons unchanged

**Completed launches:** keep section as-is, below live launches.

**How it works (new section at bottom):**
- Add `id="how-it-works"` anchor
- Heading: `How it works`
- The three existing feature cards (Two Platforms / Community First / Transparent Escrow) move here unchanged

**Smooth scroll:** apply `scroll-behavior: smooth` via Tailwind `scroll-smooth` on the anchor target or use `<a href="#how-it-works">` with CSS — already supported by `html { scroll-behavior: smooth }` if present, otherwise add `scroll-smooth` class to `<html>` via index.css. Simpler: use an `onClick` that calls `document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })`.

## 2. `src/components/Navbar.tsx` — trim

- Keep Erys logo (left)
- **Remove** the "Powered by Bags.fm" center text block
- Keep Schedule a Launch button + Dashboard button (when connected) + wallet widget (right)

## 3. Imports to clean up in `Index.tsx`

- Remove `Rocket` import (no longer used in hero or empty state button)
- Remove `Coins`, `Clock`, `Shield` only if they're now unused — they're still used in the feature cards which are kept (just relocated), so keep them
- Remove `ExternalLink` if unused

## Files

- Edit: `src/pages/Index.tsx`
- Edit: `src/components/Navbar.tsx`

No other files, no new dependencies, no DB or edge function changes.

