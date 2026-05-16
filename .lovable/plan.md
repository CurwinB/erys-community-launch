# Add purpose banner above hero

Add a thin strip directly under the navbar (above the H1 "Everyone gets in at the same price. Block one.") that signals what Erys is for: scheduling fair launches for Bags.fm and Pump.fun tokens.

## What it looks like

- Slim full-width band, subtle border-bottom, transparent/card background, centered text.
- Small mono uppercase eyebrow-style line:
  `Fair-launch presales for Bags.fm & Pump.fun tokens on Solana`
- Tiny Bags and Pump.fun text/word marks (or small badges) flanking the text — no new image assets, just inline labels styled with the existing primary accent.
- Uses existing design tokens (`border-border`, `text-muted-foreground`, `text-primary`, mono font). No new colors.

## Where it goes

In `src/pages/Index.tsx`, inside the hero `<section>`, as the first child of `container > div`, rendered before the H1 — so it sits directly under the navbar and above the headline.

## Out of scope

- No new routes, no config, no copy changes elsewhere.
- No logo image downloads — text labels only.
