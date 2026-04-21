

# Admin Dashboard at /admin — Password-Gated Accounting View

A read-only QuickBooks-style admin view over the existing database. No edge functions, no schema changes, no on-chain reads. Single-password gate via env var.

## Files

**New**
- `src/pages/AdminPage.tsx` — gate + dashboard shell + 4 tabs
- `src/components/admin/AdminGate.tsx` — password form
- `src/components/admin/AdminNavbar.tsx` — top bar with logo, red "Admin" badge, logout
- `src/components/admin/MetricCards.tsx` — 4 summary cards
- `src/components/admin/LaunchesTab.tsx` — launches ledger + expandable rows
- `src/components/admin/ContributorsTab.tsx` — contributor activity + filters
- `src/components/admin/PlatformRevenueTab.tsx` — Bags + Pump.fun revenue
- `src/components/admin/RefundsTab.tsx` — refunded contributions
- `src/utils/exportCsv.ts` — CSV download helper
- `src/lib/adminFormat.ts` — shared SOL/lamport/percent/wallet-truncation formatters

**Edited**
- `src/App.tsx` — add `<Route path="/admin" element={<AdminPage />} />`
- `.env` — add `VITE_ADMIN_PASSWORD=` placeholder (user sets the value)

## Step 1 — Password gate

`AdminPage` checks `sessionStorage.getItem("admin_authenticated") === "true"`. If absent, render `AdminGate`. Gate shows centered card on `#0A0A0A` with logo, single password input, and submit button. On submit, compare against `import.meta.env.VITE_ADMIN_PASSWORD`. If match → set sessionStorage, re-render dashboard. If mismatch → red error text below input, clear input. No auth library, no token, no router redirect — pure conditional render. Logout button in `AdminNavbar` clears sessionStorage and `navigate("/")`.

**Caveat (must mention):** `VITE_*` env vars are bundled into the client JS. Anyone who downloads the JS can extract the password. This matches the prompt's "internal use only" framing but is not real security. We'll add a one-line warning comment in `AdminGate.tsx` to make this explicit for future maintainers.

## Step 2 — Layout

```text
┌─────────────────────────────────────────────────┐
│ Erys logo  [Admin]                    [Logout]  │
├─────────────────────────────────────────────────┤
│ [Revenue] [Launches] [Active] [Contributors]    │ ← 4 metric cards
├─────────────────────────────────────────────────┤
│ Launches | Contributors | Revenue | Refunds     │ ← tabs
├─────────────────────────────────────────────────┤
│              {active tab content}               │
└─────────────────────────────────────────────────┘
```

Top metrics computed once via a single `useQuery` that fetches `launches` + `contributions` + `platform_fee_claims` aggregates. Reused across tabs via React Query cache.

## Step 3 — Launches tab

One query: `launches` ordered by `launch_datetime desc` + grouped contributions aggregate per launch. Columns exactly as specified.

Key calculations (all DB-derived, no on-chain):
- **SOL In** = `sum(contributions.amount_lamports) / 1e9`
- **ATA Reserve** = `contributorCount × (2_039_280 + 5_000) / 1e9`
- **Gas Reserve** = `50_000 / 1e9` (matches execute-launch constant)
- **Initial Buy** = `SOL In - ATA Reserve - Gas Reserve` (we don't persist `initialBuyLamports`; this is the only computable proxy)
- **SOL Distributed** = `sum(contributions.token_amount where tokens_distributed=true)` reframed: actually for SOL flow, "distributed" means tokens went out → show `sum(amount_lamports where tokens_distributed=true) / 1e9` as the SOL-equivalent that was honored
- **Platform Fee**:
  - Bags: 25% × sum of `platform_fee_claims` rows associated with this launch. **Problem:** `platform_fee_claims` has no `launch_id` column (verified in schema). For Bags we cannot attribute platform fees to a specific launch from the DB alone. Plan: show a single "—" with a tooltip "Platform fees pooled (not per-launch)" for Bags rows, and surface the pooled total only in the Platform Revenue tab.
  - Pump.fun: `pumpfun_fees_claimed_total × 0.5 / 1e9` ✓ (per-launch, works)
- **Creator Fee**: same split logic; Bags shows "—", Pump.fun shows `pumpfun_fees_claimed_total × 0.5 / 1e9`
- **Distribution Complete** = green badge if `distribution_completed`, else amber "Pending"

Each row has a chevron → expands a sub-table of that launch's contributions (wallet, SOL in, basis points, token_amount, tokens_distributed, distribution_tx_signature). CSV export above table downloads parent rows only (not expanded sub-rows).

## Step 4 — Contributors tab

Single query: `contributions` join `launches` (token_name, token_symbol, platform). Columns as spec'd.

- **Share %** = `basis_points / 100` formatted `12.34%`
- **Tokens Received** = `token_amount` if `tokens_distributed`, else "—"
- **Fee Claimed** = column shown for all rows but value only for Bags; uses `is_fee_claimer`. Pump.fun rows show "N/A" (Pump.fun fees auto-distributed by Railway, no per-contributor claim flag).

Filter bar:
- Platform select (All / Bags / Pump.fun)
- Status select (All / Distributed / Pending) — driven by `tokens_distributed`
- Wallet search (case-insensitive substring match, client-side filter on loaded set)

CSV export honors active filters.

## Step 5 — Platform Revenue tab

Two side-by-side cards (stack `<lg`).

**Bags Revenue** (left):
- Section total at top: `sum(platform_fee_claims.amount_lamports) / 1e9`
- Table: claimed_at, amount (SOL, 4dp), tx_signature → link `https://solscan.io/tx/{sig}`

**Pump.fun Revenue** (right):
- Section total at top: `sum(launches.pumpfun_fees_claimed_total × 0.5) / 1e9` for `platform=pumpfun AND pumpfun_fees_claimed_total > 0`
- Table: token_symbol, launch_datetime, total fees (SOL), Erys share (×0.5), creator share (×0.5), pumpfun_fees_last_claimed_at

Combined total banner above both: `Bags total + Pump.fun Erys total`.

CSV export: combined download with extra `platform` column distinguishing rows.

## Step 6 — Refunds tab

Query: `contributions where refund_tx_signature is not null` joined to `launches`. Columns as spec'd. **Reason column:** schema has no `refund_reason` field — we'll derive: if parent launch `status = 'cancelled'` → "Launch cancelled", else "Other". Acceptable since refunds only occur on cancellation in current flow.

Total SOL refunded at top. CSV export.

## Step 7 — CSV utility

Exact `exportToCsv` implementation from the prompt placed in `src/utils/exportCsv.ts`. Each tab calls it with its current visible rows.

## Step 8 — Styling

All components use existing Tailwind tokens already in `src/index.css` / `tailwind.config.ts`. Sharp corners (`rounded-none`), `bg-[#0A0A0A]`, cards `bg-[#111111]` borders `border-[#1A1A1A]`, accent `text-[#00D4FF]`, success `text-[#00FF88]`, error `text-[#FF4444]`. Platform badges: Bags cyan, Pump.fun green. JetBrains Mono for all numeric cells. SOL formatted to 4dp with `Intl.NumberFormat`. Wallet/tx truncation: `abc…xyz` (first 4, last 4).

## Step 9 — Routing

In `src/App.tsx` add the import and route inside `<Routes>`. No nav link — `/admin` is intentionally undiscoverable via UI.

## Out of scope

- No new tables, no migrations, no edge functions, no Railway changes.
- No on-chain RPC calls — all numbers come from existing DB columns.
- Per-launch attribution of Bags platform fees (schema doesn't support it) — shown as pooled total in Revenue tab only.
- Real auth — single shared password by design per the prompt.

