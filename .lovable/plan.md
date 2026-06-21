## Erys Affiliate Program — Implementation Plan

Adds an admin-controlled affiliate referral system. When someone signs up via `erys.live/r/CODE`, attribution sticks to their wallet and to every launch they ever create. At sweep time, affiliated launches split 70/15/15 (creator / Erys / affiliate) instead of 70/30.

This app owns the **data layer + UI**. The actual on-chain payout change lives in the external `fee-claimer` Railway service and will be a follow-up there — but this plan ships the schema and queryable API it will need.

---

### 1. Data model (single migration)

Erys has no traditional auth/profile table — identity = wallet address. Attribution is therefore keyed by wallet.

**New tables (all in `public`, with GRANTs + RLS):**

- `affiliates`
  - `id uuid pk`, `wallet_address text unique not null` (lowercased), `referral_code text unique not null` (8-char base32, generated server-side), `status text` (`active` | `revoked`), `created_at`, `created_by_admin_wallet text`
  - RLS: public `SELECT` on `(referral_code, status, id)` via a `SECURITY DEFINER` lookup function only — full row reads are admin-only. No client writes.

- `affiliate_referrals` (wallet → affiliate mapping, the "permanent on signup" record)
  - `wallet_address text pk` (lowercased), `affiliate_id uuid not null references affiliates(id)`, `referral_code text not null`, `attributed_at timestamptz`
  - Written exactly once per wallet by an edge function (see §2). Never updated.
  - RLS: a wallet can read its own row; admins can read all. No client writes.

- `affiliate_earnings` (ledger)
  - `id`, `affiliate_id`, `launch_id`, `wallet_address` (affiliate payout wallet, snapshotted), `amount_lamports bigint`, `tx_signature text`, `status text` default `paid`, `created_at`
  - RLS: affiliate can read their own rows; admins read all. Inserts only by `service_role` (fee-claimer / edge function).

**New column on existing `launches` table:**

- `referred_by_affiliate_id uuid null references affiliates(id)` — set at launch creation by copying from `affiliate_referrals` for `created_by_wallet`. Null = unchanged 70/30 split.

**Helper SQL:**

- `SECURITY DEFINER` function `resolve_referral_code(p_code text)` → returns `{ affiliate_id, status }` for the signup landing page (no need to expose the table).
- `SECURITY DEFINER` function `attribute_wallet_to_affiliate(p_wallet, p_code)` — idempotent insert into `affiliate_referrals`; rejects if `p_wallet` is itself the affiliate's wallet (self-referral block); no-op if wallet already has a row (first attribution wins, never overwritten).
- `SECURITY DEFINER` function `get_launch_fee_split(p_launch_id uuid)` → returns `{ creator_wallet, creator_bps, treasury_bps, affiliate_wallet, affiliate_bps }`. This is the single API the fee-claimer will call to know how to split each sweep. Returns 7000/3000/0 when no affiliate, 7000/1500/1500 when set.
- Admin RPCs: `admin_create_affiliate(p_admin_wallet, p_wallet)`, `admin_revoke_affiliate(p_admin_wallet, p_affiliate_id)`, `admin_list_affiliates(p_admin_wallet)` (joins counts of referred wallets, launches, and total earnings). All gated by existing `is_admin_wallet`.

---

### 2. Signup / attribution flow

There is no email signup — "signing up" = first time a wallet connects. Flow:

1. **Landing route `/r/:code`** — new React route that:
   - Calls `resolve_referral_code` → if invalid/revoked, redirects to `/` with a toast.
   - Stores the code in `localStorage` under `erys_ref_code` (survives wallet connect / redirects).
   - Redirects to `/`.

2. **Wallet connect hook** — after Dynamic reports a connected wallet, if `localStorage.erys_ref_code` is set, call edge function `attribute-referral` with `{ wallet, code }`. Function calls `attribute_wallet_to_affiliate` and clears the code on success. Idempotent: if the wallet already has an attribution (any prior code), this is a no-op and the stored code is cleared.

This satisfies "permanent, never overwritten, no retroactive" requirements.

---

### 3. Launch creation

Update `create-launch` and `create-launch-pumpfun` edge functions: before insert, look up `affiliate_referrals` by `created_by_wallet` and copy `affiliate_id` into the new `launches.referred_by_affiliate_id` column. Revoking an affiliate later does NOT touch existing launch rows.

---

### 4. Fee split — data contract for external `fee-claimer`

This app does NOT modify the Railway fee-claimer code (it lives outside this repo and the user will update it separately). What we ship:

- The `get_launch_fee_split` RPC above (single call, returns everything claimer needs).
- An `affiliates_insert_earning(p_launch_id, p_amount_lamports, p_tx_signature)` `SECURITY DEFINER` RPC the claimer can call after a successful sweep tx to append to `affiliate_earnings`. Idempotent on `(launch_id, tx_signature)`.

The plan documents these endpoints in a short `AFFILIATES_INTEGRATION.md` so the fee-claimer change is a 1:1 mechanical update.

---

### 5. Affiliate dashboard (`/affiliate`)

New page, visible only when the connected wallet has a row in `affiliates` with status `active` (or `revoked`, read-only):

- Referral link with copy button (`erys.live/r/CODE`) and small QR.
- KPI cards: total referred wallets, total launches from referred wallets, total lifetime earnings (SOL).
- Table: referred creators (wallet, attribution date, # launches, total earned from them).
- Table: per-launch earnings (launch token, date swept, amount, tx signature link to Solscan).
- Simple earnings-over-time line chart (recharts, already in stack) grouped by day.

Powered by two new `SECURITY DEFINER` RPCs that filter by `lower(auth wallet) = affiliate wallet`: `affiliate_dashboard_summary` and `affiliate_dashboard_earnings`.

Link in the user dropdown (`WalletDropdown.tsx`) shown only when wallet is an active affiliate.

---

### 6. Admin additions

New `Affiliates` tab in `AdminPage.tsx`:

- Table of affiliates: wallet, code, status, # referred wallets, # attributed launches, total paid out, created date.
- "Add affiliate" dialog: paste wallet → server generates code → row created.
- Per-row "Revoke" action (sets `status='revoked'`; existing attributions and launches keep paying).
- Re-activate action for revoked rows.

---

### 7. Edge cases (handled in SQL)

- Self-referral: `attribute_wallet_to_affiliate` raises if `p_wallet = affiliates.wallet_address` for that code.
- No retroactive attribution: function only inserts; never updates. Wallet with no prior `affiliate_referrals` row that creates a launch gets `referred_by_affiliate_id = null` permanently for that launch.
- Revocation: only blocks NEW `attribute_wallet_to_affiliate` calls; existing referrals + launches keep their attribution and continue to earn.

---

### Technical summary

| Area | Change |
|---|---|
| Migration | 3 new tables + 1 column on `launches` + 6 RPCs + GRANTs + RLS |
| Edge functions | New `attribute-referral`; update `create-launch` & `create-launch-pumpfun` to copy attribution |
| Frontend routes | New `/r/:code` (redirect) and `/affiliate` (dashboard) |
| Frontend components | `AffiliateDashboard`, `AdminAffiliatesTab`, attribution hook in wallet provider, dropdown link |
| External | `AFFILIATES_INTEGRATION.md` documenting the two RPCs the Railway `fee-claimer` must call (no code change in this repo) |

### Out of scope (explicit)

- Modifying the `fee-claimer/` Railway service code — documented as a follow-up.
- Email notifications to affiliates.
- Self-serve affiliate signup (admin-controlled per spec).
- Payout-pending / unpaid states in the ledger (spec says payout is instant ⇒ status is always `paid`).
