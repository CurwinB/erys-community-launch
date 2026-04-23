

# Fix Dashboard blank-screen flash

## Root cause

The dashboard renders, then a runtime error throws during render and React unmounts the tree → black screen. The `RESET_BLANK_CHECK` console message is Lovable's blank-screen detector firing. There is no `ErrorBoundary` in `src/App.tsx`, so any render-time throw inside `DashboardPage` (or its hook) wipes the page.

The most likely throw source is `useDashboardNotifications`:

- The `claim-fees` edge function `claimable-positions` action proxies the Bags API and returns its raw JSON. The hook assumes that JSON is `ClaimablePosition[]`, but the Bags API wraps results as `{ success, response: [...] }` (matches the pattern used elsewhere in the codebase). When `data` is an object instead of an array, `claimablePositions.find(...)` inside `getClaimableForMint` throws `TypeError: claimablePositions.find is not a function`, which crashes both the Navbar and DashboardPage at render time.
- Even if Bags returns an array today, the hook has no defensive normalization, so any future shape variance (or an error response body) re-creates the crash.

Secondary risk: if any field on a contribution / launch is unexpectedly null, several `.toFixed`, `Number(...)`, or template-literal calls in `DashboardPage` render paths can throw too.

## Fix

### 1. `src/hooks/useDashboardNotifications.ts`
- Normalize the `claimable-positions` response: accept either a raw array or `{ response: [...] }` / `{ data: [...] }` and fall back to `[]` if neither.
- Guard the response with `Array.isArray(...)` before assigning to `claimablePositions`.
- Make `getClaimableForMint` defensive: if `claimablePositions` is not an array, return `0` instead of calling `.find`.
- Wrap `queryFn` errors so a Bags API failure doesn't reject the query and tear down dependent renders — return `[]` on failure and surface a single `console.warn` (the dashboard still works without fee data).

### 2. `src/App.tsx`
- Add a lightweight `ErrorBoundary` around `<Routes>` so a single page throw shows a fallback ("Something went wrong — Reload") instead of the entire app going black. This both fixes the symptom for any future render bug and gives us a visible error in the UI.

### 3. `src/pages/DashboardPage.tsx`
- Treat all numeric fields defensively in render: `Number(x ?? 0)` before `.toFixed`, fall back to `0` for `totalClaimable` if `NaN`, and skip notification cards whose `launches` relation is null (`c.launches == null`) instead of dereferencing.
- Memoize `bagsContributions`, `claimableMints`, `uniqueClaimableMints`, `totalClaimable`, and `distributedContributions` with `useMemo` so they don't recompute on every render and can't trigger derived renders mid-tear-down.

## Out of scope

- No edge function changes, no schema changes, no new env vars, no UI redesign. The hook contract (`tokenNotifications`, `feeNotifications`, etc.) stays the same so `Navbar` keeps working unchanged.

## Files edited

- `src/hooks/useDashboardNotifications.ts`
- `src/App.tsx`
- `src/pages/DashboardPage.tsx`

