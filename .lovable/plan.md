# Influencer-picked launch time for sponsored slots

## What changes

Today the admin enters the influencer wallet **and** the launch time, then sends a link. We're flipping that: the admin only generates the link, and the influencer picks their own launch time on the sponsored page (subject to the same scheduling rules as everyone else). Sponsored slots stay locked to Pump.fun — no platform choice on either side.

## User-facing behavior

**Admin (Sponsored tab)**
- Form simplifies to a single field: **Influencer wallet address**.
- "Launch time (1–72h ahead)" field is removed.
- Submitting creates an invite link valid for 48 hours. The launches table row is created in `sponsor_pending` status with no `launch_datetime` yet.
- Sponsored launches table: the "Launch time" column shows "Not yet picked" until the influencer claims.

**Influencer (`/sponsored/:token`)**
- Page now shows a **launch time picker** (datetime-local) with the same 1–72h-ahead constraint, alongside the existing token name/symbol/description/image/socials form.
- Helper text clarifies the launch is on Pump.fun and the time will auto-shift forward by a few minutes if their chosen minute is full (same rule as the public schedule page).
- On submit, `claim-sponsored-slot` runs the Pump.fun slot allocator, persists the (possibly adjusted) `launch_datetime`, and shows the final launch time + adjustment notice on the success screen.
- "Link expires in" countdown still uses the 48h link expiry (no longer tied to launch time).

## Technical changes

**`supabase/functions/create-sponsored-slot/index.ts`**
- Drop `launch_datetime` from the request body and validation.
- Insert row with `launch_datetime = null` (DB column currently `NOT NULL` — see migration below), `platform = 'pumpfun'`, `status = 'sponsor_pending'`.
- `sponsor_link_expires_at` always = `now + 48h` (no more "min(48h, launch-1h)" clamp).

**`supabase/functions/claim-sponsored-slot/index.ts`**
- Accept `launch_datetime` in the request body. Validate 1–72h ahead.
- Wrap the slot allocation + update in `withScheduleLock(supabase, "pumpfun", …)` and call `findNextAvailableSlot(supabase, "pumpfun", launch_datetime)` (same helpers used by `create-launch-pumpfun`).
- Persist the adjusted time on the launches row alongside the existing token-detail update.
- Return `adjusted_launch_datetime`, `original_launch_datetime`, `was_adjusted`, `offset_minutes` in the response.

**Migration (`supabase/migrations/...`)**
- `ALTER TABLE public.launches ALTER COLUMN launch_datetime DROP NOT NULL;` so `sponsor_pending` rows can exist without a time.
- Update `get_sponsor_slot_by_token` RPC return type — `launch_datetime` becomes nullable. The RPC body itself doesn't change.

**Frontend types**
- Regenerate `src/integrations/supabase/types.ts` so `launches.launch_datetime` is `string | null` and the RPC return type matches.

**`src/components/admin/SponsoredTab.tsx`**
- Remove `launchDatetime` state, the date input, and the `minDateTime`/`maxDateTime` memos.
- Submit body sends only `admin_wallet` + `influencer_wallet`.
- In the table, render `Not yet picked` when `launch_datetime` is null.

**`src/pages/SponsoredPage.tsx`**
- Add `launchDatetime` form state and a `datetime-local` input with `min = now+1h`, `max = now+72h`.
- `useCountdown` for `launch_datetime` only renders after a successful claim (use the value returned by the function, not the slot row).
- Pre-claim hero text: drop the "at [time]" line; add a short note that they pick their own launch time below and that it's a Pump.fun launch.
- On submit, pass `launch_datetime` to `claim-sponsored-slot`.
- Success card shows the final `adjusted_launch_datetime`, plus a small "shifted to the next open minute" note when `was_adjusted` is true.

**No changes needed**
- `cancel-sponsored-slot` (still keys off `launch_id`).
- Executor / distributor / fee-claim paths (sponsored launches already flow through Pump.fun infra once `status` flips to `scheduled`).
- `scheduleCapacity.ts` — reused as-is.

## Out of scope
- Letting influencers pick Bags vs Pump.fun (per request, sponsored stays Pump.fun only).
- Letting influencers reschedule after claiming.
