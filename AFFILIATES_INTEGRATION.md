# Affiliate Program — fee-claimer integration

The Erys app owns the affiliate **data layer**. The on-chain payout split
lives in the external `fee-claimer/` Railway service. To turn on the
70/15/15 split for affiliated launches, the claimer needs two small
changes wired against the RPCs added in migration `*_affiliates_program`.

## RPCs to call

### 1. `get_launch_fee_split(p_launch_id uuid)`

Returns the destination wallets and basis points for a single launch.

| column | type | notes |
|---|---|---|
| `launch_id` | uuid | |
| `creator_wallet` | text | always `launches.created_by_wallet` |
| `creator_bps` | int  | always `7000` |
| `treasury_bps` | int  | `3000` if no affiliate, `1500` if affiliated |
| `affiliate_id` | uuid | nullable |
| `affiliate_wallet` | text | nullable, the affiliate payout wallet |
| `affiliate_bps` | int  | `0` if no affiliate, `1500` if affiliated |

Replace the hard-coded `CREATOR_BPS = 7000` / `TREASURY_BPS = 3000` constants
in `fee-claimer/src/harvestPerLaunchFees.ts` with a single call to this RPC
per launch, then split:

- `creator_lamports = floor(gross * creator_bps / 10000)`
- `affiliate_lamports = floor(gross * affiliate_bps / 10000)`
- `treasury_lamports = gross - creator_lamports - affiliate_lamports` (absorbs remainder)

The affiliate cut is paid out in the **same sweep transaction** as the
creator and treasury cuts (just add another `SystemProgram.transfer`
instruction to the existing tx).

### 2. `record_affiliate_earning(p_launch_id uuid, p_amount_lamports bigint, p_tx_signature text, p_status text)`

After a successful sweep tx, call this for any launch where `affiliate_bps > 0`.
It is idempotent on `(launch_id, tx_signature)`. Pass `status = 'paid'` on
success; `'failed'` if the on-chain payout to the affiliate sub-leg
reverted. This appends a row to `affiliate_earnings` which powers the
affiliate dashboard.

Use the existing `service_role` Supabase client — `record_affiliate_earning`
is granted only to `service_role`.

## What does NOT change

- Existing 70/30 launches keep working unchanged: `referred_by_affiliate_id`
  is null, the RPC returns `affiliate_bps = 0`, and the claimer's existing
  split code still works (just sourced from the RPC instead of constants).
- No new env vars, no new secrets. Uses the same Supabase connection the
  claimer already has.
- Revoking an affiliate in the admin panel does NOT touch
  `launches.referred_by_affiliate_id` — past and future launches from
  already-attributed creators keep paying out. Revocation only blocks
  *new* wallet attributions going forward.