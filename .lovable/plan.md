## Plan: Show real raised/presaler counts on Launched Tokens cards

### Problem
On `src/pages/Index.tsx`, the "Launched Tokens" section passes hard-coded zeros to each `LaunchCard`:
```
totalEscrowLamports={0}
contributorCount={0}
```
Live launches already pull these from the public `contributions_public` view via a `useQuery` aggregation. Completed launches don't — that's why every card shows `0.00 SOL` raised and `0` presalers.

### Fix
**File:** `src/pages/Index.tsx`

1. Add a second `useQuery` (`completed-contribution-stats`) that mirrors the live one but keys off `completedLaunches?.map(l => l.id)`. Same `from("contributions_public").select("launch_id, amount_lamports").in("launch_id", ids)` aggregation into `{ total, count }` per launch_id.
2. Replace the two `totalEscrowLamports={0}` / `contributorCount={0}` pairs (mobile row + desktop grid for completed launches) with `stats?.total || 0` / `stats?.count || 0` lookups, identical to the live-launch pattern.
3. Drop `refetchInterval` for the completed query (these are static — one fetch per mount is enough), to keep RPC load low.

### Why this is safe
- `contributions_public` is the same already-public view used for live cards. No new data is exposed; wallet addresses, signatures, and PII are not selected — only `launch_id` and `amount_lamports`.
- No edge function, RLS policy, or DB function changes.
- No private keys, escrow data, or admin-only fields touched.

### Out of scope
No changes to the `LaunchCard` component, RLS, or any backend.