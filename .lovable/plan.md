Why this keeps showing

The scanner is right to keep flagging this because the `launches` table still has a public RLS policy:

```text
Policy: "Launches are viewable by everyone"
Command: SELECT
Role: public
Using: true
```

That means every row in `launches` is publicly readable. The app previously tried to reduce risk with column-level `REVOKE`/`GRANT` and frontend-safe column lists, but the underlying table still contains sensitive fields such as:

- `escrow_wallet_encrypted_private_key`
- `pumpfun_mint_keypair_encrypted`
- `sponsor_link_token`
- `worker_id`, `worker_locked_at`
- internal execution / operational fields

Also, the current frontend public column list still includes some internal fields like `sponsor_link_token`, `worker_id`, and `worker_locked_at`, so the scanner still sees real public exposure risk.

Plan to fix it properly

1. Replace public table reads with a safe public API surface
   - Create a safe public view or RPC for launch listings/details that only exposes fields the website actually needs.
   - Exclude encrypted keys, sponsor tokens, worker locks, internal errors, and operational accounting fields.
   - Keep public fields such as token name/symbol, image, launch time, status, public escrow wallet, platform, and public launch signature.

2. Lock down `public.launches`
   - Drop the broad `"Launches are viewable by everyone"` SELECT policy.
   - Revoke direct browser SELECT grants on `public.launches` from `anon` and `authenticated`.
   - Keep full access for `service_role` so edge functions, executor, and distributor workers continue to work.

3. Update the frontend to use the safe surface
   - Update homepage launch lists to query the safe view/RPC instead of `launches` directly.
   - Update individual launch pages to use the safe public launch read.
   - Update contribution stat queries only as needed for public totals/recent activity.

4. Preserve admin functionality safely
   - The admin dashboard currently reads `launches` from the browser after checking `is_admin_wallet`, but that check is client-side and does not change database permissions.
   - Move admin launch reads behind a service-role edge function/RPC that verifies the connected admin wallet server-side before returning admin-only fields.
   - Keep sponsored link management working without exposing `sponsor_link_token` publicly.

5. Verify and clear the finding
   - Run the Supabase/security linter after the migration.
   - Confirm public pages still load.
   - Confirm admin sponsored links, launch management, and worker/executor flows still have the fields they need through service-role paths.

Technical notes

- Column-level grants alone are not enough for this finding because the table-level RLS policy is still public and permissive.
- The clean fix is: public users should not query `public.launches` directly. They should query a sanitized view/RPC.
- Edge functions and backend workers can continue using `select("*")` because they use `SUPABASE_SERVICE_ROLE_KEY`, which should remain server-only.