# Launch Profile expansion (additive, isolated from launch pipeline)

Goal: let creators attach optional cosmetic metadata (hook, description, category, links, memes, checklist, launch window) that is displayed on the contribution page and shown as a preparedness badge in listings. **Zero changes to the create-launch / create-launch-pumpfun / execute-launch / on-chain / wallet code paths.**

## Hard guardrails

- Do not edit `supabase/functions/create-launch/`, `create-launch-pumpfun/`, `execute-launch/`, or anything in `executor/`, `fee-claimer/`, `distributor/`, `keypair-grinder/`.
- New profile fields are never read by any on-chain code, metadata pinning code, or wallet code.
- New profile fields are persisted via a **separate** edge function called after the launch row exists.

## 1. Database migration

Add nullable columns to `public.launches` (all default null / empty so existing rows untouched):

- `hook text` (CHECK length ≤ 100 when not null)
- `profile_description text` (CHECK length ≤ 500 when not null) — separate from the existing `description` column, which stays exactly as-is and continues feeding token metadata
- `twitter_handle text`
- `category text` (CHECK in `meme`,`community`,`tech`,`other` when not null)
- `meme_images text[]` default `'{}'`
- `launch_checklist jsonb` (expected shape `{memes_ready, posts_scheduled, community_notified}`)
- `launch_window text`

`website_url` already exists — reuse it.

Update the `launches_public` view to expose the new columns so the contribution page can read them with the current anon-readable path.

## 2. New edge function: `save-launch-profile`

`supabase/functions/save-launch-profile/index.ts` — only touches the profile columns. Body:

```ts
{ launch_id: uuid, created_by_wallet: string, profile: {
  hook?, profile_description?, twitter_handle?, category?,
  website_url?, meme_images?: string[], launch_checklist?: {...}, launch_window?
}}
```

Validates with zod (length/enum caps, ≤3 meme URLs, only `http(s)://` URLs, twitter handle stripped of `@`). Confirms the row exists and `created_by_wallet` matches the row's `created_by_wallet` before issuing an `UPDATE` (service role). Returns `{ ok: true }`. CORS enabled.

This call is fire-and-forget from the UI: if it fails, the launch itself is unaffected — we just show a toast that profile didn't save and offer a retry.

## 3. New edge function: `upload-meme-to-pinata`

`supabase/functions/upload-meme-to-pinata/index.ts`. Accepts multipart upload (image/png|jpeg|gif|webp, ≤4 MB). Pins via existing `PINATA_JWT`, returns `{ url }` built from `PINATA_GATEWAY_DOMAIN`. Does NOT write the DB. Pattern mirrors the existing Pinata calls in `create-launch-pumpfun` but is a brand new function.

## 4. SchedulePage form additions

After the existing fields, add `Launch Profile (optional)` section with subtle helper text. Controls:

- Hook input (100 char counter)
- Description textarea (500 char counter) — bound to local `profile_description` state, **never sent to create-launch**
- Category segmented control (Meme · Community · Tech/Product · Other), clearable
- Move existing Website URL input into this section
- Twitter/X handle input
- 3 meme upload slots calling `upload-meme-to-pinata` on file pick, with previews + remove
- Launch window text input
- 3 `Switch` toggles for the checklist

Submit flow change in `SchedulePage.tsx`:
1. Call existing `create-launch` / `create-launch-pumpfun` with the **same payload as today** (no new fields).
2. Run existing creator-contribution flow (unchanged).
3. After success, fire `save-launch-profile` with the new fields if any are non-empty. Failures show a toast and offer retry but do not block success state.

## 5. Contribution page restructure (`src/pages/LaunchPage.tsx` + `LaunchHeader.tsx`)

Left column new ordering — render each block only when underlying data exists:

```text
1. token image · name · ticker · platform badge · category badge · hook line
2. description block + website link + Twitter handle link
3. meme previews (horizontal row, open in new tab on click)
4. launch signals: checked items + "Launch window: …"
5. existing scheduled-countdown / stats / progress / feed / HowItWorks
```

Right column Ape-In card untouched.

New components:
- `src/components/launch/LaunchProfile.tsx` (the four new blocks)
- `src/components/launch/CategoryBadge.tsx`

## 6. Prepared Launch badge

New helper `src/lib/preparedness.ts` exporting `getPreparednessTier(launch)`:

Score 1 point each for: `hook`, `profile_description`, `category`, (`website_url` || `twitter_handle`), `meme_images?.length >= 1`, any `launch_checklist` value `=== true`, `launch_window`.

- score ≥ 5 → `prepared` (green "Prepared Launch" badge)
- score 3–4 → `in_progress` (yellow "In Progress" badge)
- score < 3 → none

New `src/components/launch/PreparednessBadge.tsx` rendered next to the token name on:
- `LaunchPage` header
- `LaunchCard` (both `card` and `row` variants)

Update listing queries (`Index.tsx`, `DashboardPage.tsx`, anywhere that feeds `LaunchCard`) to select the new profile columns from `launches_public` and pass the computed tier into `LaunchCard`.

## 7. Files touched

New:
- migration SQL
- `supabase/functions/save-launch-profile/index.ts`
- `supabase/functions/upload-meme-to-pinata/index.ts`
- `src/components/launch/LaunchProfile.tsx`
- `src/components/launch/CategoryBadge.tsx`
- `src/components/launch/PreparednessBadge.tsx`
- `src/lib/preparedness.ts`

Edited (display + form only — no launch-pipeline files):
- `src/pages/SchedulePage.tsx` (add section, post-create profile save)
- `src/pages/LaunchPage.tsx`
- `src/components/launch/LaunchHeader.tsx`
- `src/components/LaunchCard.tsx`
- `src/pages/Index.tsx`, `src/pages/DashboardPage.tsx` and other `LaunchCard` callers (pass-through prop only)

Explicitly untouched:
- `supabase/functions/create-launch/`, `create-launch-pumpfun/`, `execute-launch/`, `contribute/`, `validate-contribution/`, `claim-*`, `refund-*`
- All of `executor/`, `fee-claimer/`, `distributor/`, `keypair-grinder/`
- `LaunchPage` Ape-In card and contribution logic

## Open questions

1. OK to add the new copy as `profile_description` (separate from existing `description` column used for token metadata)?
2. Meme upload limit 4 MB per file and types `png/jpeg/gif/webp` OK?
3. Category badges: neutral styling, or color-coded per category?
