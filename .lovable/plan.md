## Goal

Give admins a switch (per platform) to temporarily disable new Bags or Pump.fun launches. When disabled, the Schedule Launch page shows a polished "We're upgrading this experience" message instead of the form, and the create-launch edge functions reject new submissions as a safety net.

## UX

**Schedule page (`/schedule`)**
- The platform tab (Bags / Pump.fun) still toggles freely.
- If the selected platform is disabled:
  - The form is hidden.
  - A trust-inspiring card appears in its place:
    > **Bags.fm launches are temporarily paused**
    > We're upgrading our Bags.fm integration to deliver a smoother, more reliable launch experience. New Bags launches are paused for a few hours while we ship improvements. Pump.fun launches remain fully open — switch above to launch now, or check back shortly.
  - A subtle pulsing dot + "Maintenance in progress" label.
  - CTA button: "Switch to Pump.fun" (or vice versa) when the other platform is enabled.
- If both are disabled, show a single global maintenance card with no switch CTA.
- The disabled-platform tab button gets a small "Paused" badge so the state is obvious before the user clicks.

**Admin page (`/admin`)**
- Add a new top-of-page **Platform Status** panel (above the existing tabs, next to MetricCards) with two switches:
  - "Bags.fm launches enabled" — on/off + last-changed timestamp + who toggled it
  - "Pump.fun launches enabled" — same
- Toggling shows a confirm dialog ("Disable Bags launches? Users will see a maintenance message on the Schedule page.") before applying, then a toast.

## Technical Plan

### 1. Storage (migration)

Use the existing `app_settings` table. Add two keys (no schema change needed):
- `launches_bags_enabled` → `"true"` / `"false"` (default `"true"`)
- `launches_pumpfun_enabled` → `"true"` / `"false"` (default `"true"`)

Migration also seeds defaults via `INSERT … ON CONFLICT DO NOTHING`.

Add two SECURITY DEFINER RPCs:
- `get_launch_platform_status()` → returns `{ bags_enabled boolean, pumpfun_enabled boolean }`. `GRANT EXECUTE … TO anon, authenticated` (public — read only, no secrets).
- `set_launch_platform_status(p_admin_wallet text, p_platform text, p_enabled boolean)` → checks `is_admin_wallet(p_admin_wallet)`, upserts the matching key, returns the new status. Grant to `authenticated`.

`app_settings` already has a public SELECT policy, so the RPC is essentially a typed wrapper, but using RPC keeps the admin-write path locked down.

### 2. Frontend — schedule page

In `src/pages/SchedulePage.tsx`:
- New `useQuery(["launch-platform-status"])` calling `supabase.rpc("get_launch_platform_status")` with a 30s `staleTime` and `refetchOnWindowFocus`.
- Derive `bagsEnabled` / `pumpfunEnabled`.
- Replace the form rendering with conditional logic:
  - If selected platform disabled → render new `<PlatformPausedCard platform={platform} otherEnabled={…} onSwitch={…} />` instead of the form + submit button.
  - Tab buttons get a "Paused" pill when disabled (still clickable so users can read the message).
- New component: `src/components/schedule/PlatformPausedCard.tsx` — dark card matching brand (bg `#111`, accent `#00D4FF` for Bags, `#00FF88` for Pump), pulsing dot, headline, body copy, and conditional "Switch to {other}" button.
- Block `handleSubmit` early with a toast if the platform is disabled (defense-in-depth in case status is stale).

### 3. Frontend — admin page

- New component: `src/components/admin/PlatformStatusPanel.tsx`.
  - Uses `useQuery` + `useMutation` against the two RPCs.
  - Two rows: platform label, enabled `Switch`, "last updated" timestamp.
  - Wrap toggle in `AlertDialog` confirm.
  - On success: invalidate `["launch-platform-status"]` and `["admin-platform-status"]`.
- Mount in `AdminPage.tsx` between `<MetricCards />` and `<Tabs>`.

### 4. Backend — edge function guards

In `supabase/functions/create-launch/index.ts` and `supabase/functions/create-launch-pumpfun/index.ts`, near the top of the handler (before any wallet/escrow work):
- Read the matching `app_settings` row via the service-role client.
- If disabled, return HTTP 503 with `{ error: "platform_paused", message: "Bags launches are temporarily paused for maintenance. Please try again shortly." }`.
- The frontend surfaces this message in the existing error toast as a fallback.

### 5. Types

After the migration, `src/integrations/supabase/types.ts` is auto-regenerated to include the new RPCs — no manual edits.

## Out of Scope

- No change to in-flight launches (already-scheduled launches still execute normally; this only blocks **new** launch creation).
- No change to contributions on existing launches.
- No per-user overrides or scheduled maintenance windows — single global toggle per platform.

## Files Touched

- New migration under `supabase/migrations/`
- `src/pages/SchedulePage.tsx` (conditional render + tab badges + submit guard)
- `src/components/schedule/PlatformPausedCard.tsx` (new)
- `src/components/admin/PlatformStatusPanel.tsx` (new)
- `src/pages/AdminPage.tsx` (mount panel)
- `supabase/functions/create-launch/index.ts` (guard)
- `supabase/functions/create-launch-pumpfun/index.ts` (guard)
