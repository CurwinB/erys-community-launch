## Goal

Display scheduled launches in a 5-column wide grid (with up to 4 rows = 20 cards) before pagination kicks in, matching the density of pump.fun's "Explore coins" view.

## Changes

**`src/pages/Index.tsx`**

Update both grid containers (live launches + completed launches + skeleton placeholders) from:

```tsx
className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
```

to a responsive ladder that scales up to 5 columns on wide screens:

```tsx
className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
```

`LAUNCHES_PER_PAGE` already equals 20, so 5 × 4 = 20 fits exactly one page before "Next →" appears. No pagination logic changes needed.

Also bump skeleton placeholder count from 3 to 5 so the loading state matches the new grid width.

## Notes

- LaunchCard is already responsive — its image/avatar/typography work fine in narrower columns.
- Mobile (1 col) → small (2) → tablet (3) → desktop (4) → wide (5) keeps the layout readable at every breakpoint.
- The `xl` breakpoint (≥1280px) is where the 5-across appears, matching pump.fun's behavior on standard desktop widths.