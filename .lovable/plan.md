

# Add Accounting tab to admin dashboard

A new "Accounting" tab between Platform Revenue and Refunds that presents a unified, date-filtered ledger of every SOL movement through Erys-controlled wallets, with summary cards, totals row, and CSV export. Pure client-side derivation from data already in the React Query cache — no new edge functions, RPC calls, schema changes, or secrets.

## Files

### New: `src/components/admin/AccountingTab.tsx`

Props: `{ launches, contributions, claims }` — same shapes already loaded by `AdminPage`.

**Local state:**
- `from` / `to` dates (default: 30 days ago → today)
- `typeFilter` (multi-select: all 7 ledger types)
- `platformFilter` (`all | bags | pumpfun`)
- `search` (matches wallet address or token name/symbol, case-insensitive)
- `sortBy` / `sortDir`

**Derive ledger entries (memoized):**

For every entry: `{ date, type, description, launchId, tokenName, tokenSymbol, platform, wallet, amountSol, direction, txSignature | null, estimated }`.

| Type | Source | Direction | TX | Estimated |
|---|---|---|---|---|
| Contribution | `contributions` row | in | `tx_signature` | false |
| Bags Fee Claimed | `platform_fee_claims` row | in | `tx_signature` | false |
| Pump.fun Fee Claimed | `launches` where `platform=pumpfun` and `pumpfun_fees_last_claimed_at` set; amount = `pumpfun_fees_claimed_total * 0.5 / 1e9` (Erys 50%) | in | none | true |
| Token Buy | `launches` where `status=launched`; amount = sum(non-refunded contributions) − ATA reserve − gas reserve | out | `pumpfun_launch_signature` if pumpfun, else none | true unless pumpfun sig present |
| Creator Fee Paid | same source as Pump.fun Fee Claimed; amount = `pumpfun_fees_claimed_total * 0.5 / 1e9` (creator 50%) | out | none | true |
| Refund Issued | `contributions` where `refund_tx_signature` not null | out | `refund_tx_signature` | false |
| Gas & ATA Reserve | `launches` where `status=launched`; amount = `(contributorCount × (ATA_RENT + ATA_FEE) + gasReserve) / 1e9` (gas reserve = 20_000 for bags, 50_000 for pumpfun) | out | none | true |

Date used for filtering per type:
- Contribution: `contributed_at`
- Bags Fee: `claimed_at`
- Pump.fun Fee + Creator Fee: `pumpfun_fees_last_claimed_at`
- Token Buy + Gas/ATA Reserve: `launch_datetime`
- Refund: `contributed_at` (per spec)

Constants for reserves come from existing `src/lib/adminFormat.ts` (`ATA_RENT_LAMPORTS`, `ATA_TX_FEE_LAMPORTS`). Add a local `BAGS_GAS_RESERVE = 20_000` and reuse `GAS_RESERVE_LAMPORTS = 50_000` for pumpfun.

**Layout:**

1. **Filter bar** (sticky-ish at top): two shadcn `Popover` + `Calendar` date pickers (with `pointer-events-auto`), Apply button (no-op since filter is reactive but kept for spec parity), Export CSV button on the right.
2. **Summary cards** (4-up grid): Total SOL In · Total SOL Out · Net Platform Revenue · Total Refunded — all reflect current filters. Net Platform Revenue = Bags fees + Pump.fun Erys share within range. Each card shows a small "includes estimates" tag when any estimated entry contributes.
3. **Secondary filters row**: Type multi-select (`DropdownMenu` with checkboxes), Platform select, search `Input`.
4. **Ledger table** with the 10 columns from the spec. Type column uses colored pill badges (cyan/purple/green/amber/red/gray). Direction column uses `ArrowUp`/`ArrowDown` from lucide-react. TX column links to `https://solscan.io/tx/{sig}` or shows an amber "Estimated" badge.
5. **Sticky totals row** at the bottom: Total Inflows | Total Outflows | Net.

**CSV export**: `exportToCsv("erys-accounting-{from}-to-{to}", rows)` with full (untruncated) wallets and TX signatures, ISO datetimes, and `Estimated: "true"|"false"` column. Filename uses the date range from current filter (override the utility's default by including dates in the filename string — utility appends today's date but leaving as-is is acceptable; I'll keep the requested filename by passing `erys-accounting-{from}-to-{to}` and accepting the trailing `-YYYY-MM-DD` from the utility).

### Edited: `src/pages/AdminPage.tsx`

- Import `AccountingTab`
- Insert a `<TabsTrigger value="accounting">Accounting</TabsTrigger>` between the Platform Revenue and Refunds triggers
- Insert matching `<TabsContent value="accounting">` rendering `<AccountingTab launches={launches} contributions={contributions} claims={claims} />`

## Out of scope

- No new Supabase queries — uses the existing `["admin-dashboard"]` cache
- No edge functions, no RPC calls, no schema changes
- No live escrow wallet balance lookup
- No changes to existing tabs

## Notes

- All "Estimated" entries are visually distinguished and exported with `Estimated=true` so downstream reconciliation can separate verifiable vs. derived figures.
- Net Platform Revenue card shows an inline note when estimates are included so the figure is never misread as fully on-chain-verified.

