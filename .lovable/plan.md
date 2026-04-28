## Goal

On mobile (<640px), replace the tall single-column launch cards with a compact horizontal list row, so users can scan ~20 launches per page before needing to paginate — mirroring the dense desktop grid we already optimized.

Tablet/desktop layout is unchanged.

## What the user will see

Mobile (current): One large card per launch (~400px tall with image, countdown, escrow grid, min contribution, and a full-width Participate button). User sees ~1.5 launches per screen.

Mobile (new): A compact list row per launch (~72–88px tall):

```text
┌────────────────────────────────────────────────┐
│ [img] Erys test  BAGS         LIVE  20:02 →   │
│       $ETEST                  0.26◎ · 2 ppl    │
└────────────────────────────────────────────────┘
```

- Left: 40px token image + name/symbol + small platform chip
- Right: LIVE dot, compact countdown (HH:MM:SS or "20m"), escrow + contributor count in mono
- Whole row is tappable → `/launch/:id`
- Long-press / tap a small copy icon (kept on the right, smaller) to copy share link
- For completed launches: show only image, name, BAGS/PUMP chip, and a muted "Launched" label (no escrow/contributors since those are 0 anyway)

This lets ~20 rows fit per page on a typical phone with normal scrolling, matching the desktop pagination size of 20.

## Technical changes

**`src/components/LaunchCard.tsx`**
- Add a new `variant?: "card" | "row"` prop (default `"card"`).
- When `variant === "row"`, render a compact horizontal layout instead of the existing vertical card. The row uses the same data and same `Link` target, so no behavior change.
- Compact countdown: reuse `CountdownTimer` with a new `size="xs"` (or render inline using the same target date with a tighter format). If adding a size to `CountdownTimer` is too invasive, render a minimal inline countdown directly in the row using a small `useEffect` tick (already a pattern in the project).
- Keep copy-link button as a 28px icon-only button on the right of the row.
- Keep the LIVE pulse dot on the row for scheduled launches.

**`src/pages/Index.tsx`**
- Use `useIsMobile()` (already in `src/hooks/use-mobile.tsx`) to switch rendering:
  - Mobile: render `paginatedLaunches` (and `paginatedCompleted`) inside a `flex flex-col divide-y divide-border border border-border bg-card` container, passing `variant="row"` to `LaunchCard`.
  - Desktop/tablet: keep the existing responsive grid (`sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`) with `variant="card"` (default).
- Pagination already uses `LAUNCHES_PER_PAGE = 20`, so no change there. The pagination footer stays the same on both layouts.
- Update the loading skeletons on mobile to be short row skeletons (~72px) instead of 288px card skeletons, so the perceived layout matches.

**`src/components/CountdownTimer.tsx`** (only if needed)
- Add an `xs` size variant that renders a single inline string like `20:02` or `2d 04:11` without the boxed day/hr/min/sec labels, for use inside the compact row.

## Out of scope

- No changes to desktop layout, pagination logic, data fetching, or routes.
- No changes to launch detail page, admin views, or backend.
