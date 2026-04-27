## What's actually going on

The wallet `BvpGuDSLDafZXSDeokapirQqiPshocaMFHG5N46c9rxV` has **15+ contributions** in the database, including two in the most recent launch (`Erys test` / TESTE, mint `5xTQrHxGKcD73qcVwkLNxkZ63ANafc8B6Muu6CTFGKY3`):

| Contribution | Amount | Tokens distributed | Distribution tx |
|---|---|---|---|
| `6d7975d2…` | 0.23 SOL | 5,957,020,458,136 TESTE | `4V7mR1do…` ✅ |
| `b27e1f0d…` | 0.0999 SOL | 2,589,879,394,396 TESTE | `23wDQbos…` ✅ |

Both rows have `tokens_distributed = true` and a real on-chain signature.

### Where did the tokens go?

They went exactly where they were supposed to:

- Contribution `6d7975d2…` had `token_delivery_wallet = F46AiunPJYzAZp1WysKNcPy7RphztugX6Zu9Lev69BEK`, so the distributor sent the tokens to that delivery wallet (not back to `BvpG…9rxV`).
- Contribution `b27e1f0d…` had no delivery wallet set, so the distributor sent the tokens straight to `BvpG…9rxV`.

You can verify both signatures on Solscan — the tokens are not lost. The user almost certainly has the TESTE balance in `F46Aiun…BEK` (their token-delivery wallet) for the bigger contribution and in `BvpG…9rxV` for the smaller one.

### Why the dashboard shows zero

The `contributions` table has RLS that denies all browser SELECT (`USING (false)`), so the dashboard **must** use an RPC to read it. `src/hooks/useDashboardNotifications.ts` calls:

```ts
supabase.rpc("list_my_contributions", { p_wallet: walletAddress })
```

That RPC **does not exist in the database** (confirmed via `pg_proc`). The query throws, react-query falls back to `[]`, and every tab — Notifications, My Tokens, My Fees, My Contributions — renders as empty. So the data is fine; the UI just can't see it.

## Fix

1. Create the missing RPC `public.list_my_contributions(p_wallet text)` as `SECURITY DEFINER`. It returns each contribution joined with the public-safe launch fields the dashboard needs (matching the shape `c.launches.{token_name, token_symbol, image_url, platform, token_mint_address, status, launch_datetime, distribution_completed_at, …}`). It only returns rows for the caller's own wallet (case-insensitive match on `wallet_address`).

   ```text
   list_my_contributions(p_wallet text) returns table (
     id uuid,
     wallet_address text,
     amount_lamports bigint,
     tx_signature text,
     contributed_at timestamptz,
     basis_points int,
     token_amount bigint,
     tokens_distributed bool,
     distribution_tx_signature text,
     distribution_error text,
     refund_tx_signature text,
     token_delivery_wallet text,
     is_fee_claimer bool,
     launches jsonb   -- nested object built from launches_public columns
   )
   ```

   Grant `EXECUTE` to `anon` and `authenticated`. The function is `STABLE SECURITY DEFINER` with `SET search_path = public` and filters strictly by `lower(wallet_address) = lower(p_wallet)` so wallets can only see their own data.

2. No frontend changes required — `useDashboardNotifications` already calls the RPC with the right name and argument and already destructures `c.launches.*`.

3. After deploy, the wallet will immediately see all 15+ contributions, the two TESTE distributions in "My Tokens", and the upcoming/scheduled contributions in "Notifications".

## Out of scope

- No tokens are missing or misrouted; no on-chain action needed.
- The `My Tokens` tab will surface the TESTE distribution to `F46Aiun…BEK` — if the user wants the dashboard to also display *which* wallet received the tokens (delivery wallet vs. connected wallet), that's a follow-up UI tweak we can do after this fix lands.
