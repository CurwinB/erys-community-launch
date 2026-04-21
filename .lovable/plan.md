

# Live-Updating Contribution Window Banners

The `windowClosed` and `closingSoon` flags on `LaunchPage` currently evaluate once per render, so a user sitting on the page won't see the 10-minute warning or the 5-minute closed banner appear until something else triggers a re-render. Tie them to a 1-second tick so they update live.

## Change — `src/pages/LaunchPage.tsx`

1. Remove the inline `const launchMs / windowClosed / closingSoon / canContribute` derivations.
2. Add a `now` state seeded with `Date.now()`.
3. Add a `useEffect` that starts a `setInterval(() => setNow(Date.now()), 1000)` once `launch` is loaded, and clears it on unmount / when `launch.launch_datetime` changes.
4. Recompute `launchMs`, `isPastLaunchTime`, `windowClosed`, `closingSoon`, and `canContribute` from `now` on every render — they will now refresh every second along with the existing `CountdownTimer`.

No new dependencies. No changes to the banner JSX, the contribute card, or any other component. `CountdownTimer` keeps its own internal interval — this fix mirrors that pattern at the page level so the banner visibility tracks the same clock.

## Files

- Edit: `src/pages/LaunchPage.tsx`

