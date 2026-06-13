# Rebuild "How It Works" page

Replace the existing `src/pages/HowItWorksPage.tsx` with a new long-form page at `/how-it-works`. Route, nav, and footer are already wired — no routing changes.

## Page structure

All sections live inside a single `<article className="container mx-auto max-w-3xl px-4 py-16">` (same shell as AntiSniperPage). Sections separated by `border-t border-border pt-10` dividers. Section headings: `text-2xl font-semibold text-foreground`. Body copy: `text-sm leading-relaxed text-muted-foreground`.

1. **Header** — "Learn" eyebrow + H1 "How Erys Works" + intro paragraph.
2. **Section 1 — Contribution flow**: heading, body paragraph, then a vertical timeline of 5 steps. Each step = a row with a fixed left column containing a numbered dot (`h-3 w-3 rounded-full bg-primary`) connected by a vertical line (`border-l border-border`) running through all 5 rows. Right column = mono uppercase step label (`font-mono text-[11px] uppercase tracking-widest text-primary`), title (`text-base font-semibold text-foreground`), and body. Step 5's dot uses `bg-muted-foreground` and label color `text-muted-foreground` to mark it as an outcome.
3. **Section 2 — Escrow mechanic**: heading + body + callout block + 2x2 grid of mechanic cards. Cards: `border border-border bg-card p-4` with a Lucide icon (`Lock`, `ShieldCheck`, `ArrowLeftRight`, `Eye`) above title and body.
4. **Section 3 — Block one execution**: heading + 2 body paragraphs + callout block.
5. **Section 4 — Refunds**: heading + body + callout + body.
6. **Section 5 — Two platforms**: heading + intro + 2-column grid of platform cards. Each card: small badge at top (`inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border rounded-none`) — Pump badge `border-success text-success`, Bags badge `border-primary text-primary` (reusing the project's existing PlatformBadge color convention). Title + body below. Closing body paragraph below the cards.
7. **Section 6 — Common questions**: heading + shadcn `Accordion` (type="multiple") with the 6 Q/A items, styled to match `FaqPage.tsx`.
8. **CTA band**: bordered block (`border border-border bg-card p-8 text-center`) with heading, subheading, and two side-by-side buttons — primary "Browse launches" → `/`, outline "Schedule a launch" → `/schedule`.
9. **Disclaimer**: small muted paragraph (`text-xs text-muted-foreground`) below the CTA band.

## Callout component

Inline reusable block:
```
<div className="border-l-2 border-primary bg-muted/50 p-4 text-sm text-muted-foreground">
  {children}
</div>
```

## Design tokens

Uses only existing tokens — no new colors, gradients, or shadows:
- Primary accent: `text-primary` / `bg-primary` / `border-primary` (the site's cyan-green `--primary`, already used for accents/active dots elsewhere).
- Surfaces: `bg-card`, `bg-muted/50` for callouts.
- Borders: `border-border`.
- Body/muted text: `text-muted-foreground`.
- Mono labels: `font-mono` (JetBrains Mono, already loaded).
- Card radius and badge sharp edges follow existing PlatformBadge/HowItWorks patterns.

## SEO

Update `Seo` props on the page: title "How Erys Works — Block-One Token Launches", description matching the intro, `path="/how-it-works"`, and Article JSON-LD. Keeps existing footer link working.

## Files touched

- `src/pages/HowItWorksPage.tsx` — full rewrite.

No other files change. Nav, Footer, App routes, design system, and shadcn Accordion are already in place.
