## Files I read first

- `src/pages/SchedulePage.tsx` — the live user launch form (fields, validation, submit flow, edge function call, contribution step).
- `supabase/functions/create-launch-pumpfun/index.ts` — the edge function the form invokes (Pinata upload, escrow + mint keypair generation, row insert with `status='scheduled'`, `platform='pumpfun'`, `pumpfun_mint_keypair_encrypted`).
- `executor/src/executeLaunch.ts` — the Railway worker. `claimNextExecutingLaunch` claims rows where `status='executing'`; for `platform='pumpfun'` it branches on `process.env.USE_LOCAL_SIGNING === "true"` and calls `launchWithLocalSigning(launch, contributions)`.
- `executor/src/launchWithLocalSigning.ts` — the local-signing path that will run on Railway.
- `src/components/admin/LocalSigningTestTab.tsx` — the current synthetic test tab (to be replaced).

## What changes

Confirmed end-to-end: the existing user form already creates a row that the executor picks up; with `USE_LOCAL_SIGNING=true` on Railway, Pump.fun launches automatically run through `launchWithLocalSigning`. No new edge function, no manual trigger, no Lightning API.

So the LOCAL SIGNING TEST tab becomes a 1:1 admin-side replica of `SchedulePage`, hardcoded to `pumpfun`.

### 1. Replace `src/components/admin/LocalSigningTestTab.tsx`

Rewrite as a full clone of `SchedulePage.tsx`'s pumpfun branch. Specifically:

- Identical form fields: `tokenName`, `tokenSymbol`, `description`, image upload (Supabase storage `token-images`), `twitterUrl`, `telegramUrl`, `websiteUrl`, `launchDate`, `launchTime`, `creatorContribution`, `creatorDeliveryWallet`.
- Identical client-side validation: pumpfun symbol regex `[A-Z0-9]{1,10}`, name ≤ 32 chars, ≥ 10 min and ≤ 72 h from now, min creator SOL `0.1`, wallet balance ≥ contribution + `FEE_RESERVE_SOL`, platform-paused check via `get_launch_platform_status`.
- Same submit flow:
  1. Upload image to `token-images` bucket (if provided).
  2. `supabase.functions.invoke("create-launch-pumpfun", { body: { token_name, token_symbol, description, image_url, twitter_url, telegram_url, website_url, launch_datetime, created_by_wallet } })`.
  3. Run the same contribution flow (`performContribution`) — connect via `useWallet`, build SOL transfer to `escrow_wallet`, sign with the connected wallet, confirm, then record via the existing `contribute` edge function.
- Same step state machine (`idle → creating → awaiting_signature → confirming → recording → success / error`), same retry handler, same slot-adjustment notice.
- Same success card with launch URL + copy button.
- Hardcode `platform = "pumpfun"`; remove the bags toggle.
- Keep the existing admin styling (sharp edges, mono labels) and add a single banner at the top: "This form creates a real launch using the same flow as the public form. With `USE_LOCAL_SIGNING=true` on Railway, the executor will run `launchWithLocalSigning` when launch_datetime is reached. No manual execution trigger."

Implementation note: extract the form into a shared component or just duplicate the JSX/handlers from `SchedulePage.tsx` verbatim — duplication is acceptable here since the goal is an isolated test surface that mirrors production exactly.

### 2. Remove the synthetic test plumbing

- Delete `supabase/functions/test-local-signing/index.ts`.
- Remove its entry from `supabase/config.toml`.
- Remove the `launches` and `adminWallet` props that the old tab consumed; the new tab uses `useWallet()` like the public form.

### 3. Tab wiring in `src/pages/AdminPage.tsx`

- Keep the `LOCAL SIGNING TEST` tab. Update the props it passes (drop `launches`, drop `adminWallet`), since the new component is self-contained.
- Keep the `data-[state=active]:text-destructive` styling on the trigger.

## What does NOT change

- `executor/src/launchWithLocalSigning.ts` — untouched.
- `executor/src/executeLaunch.ts` — untouched.
- `executor/scripts/testLocalSigning.ts` — kept as a Railway-side fallback CLI.
- `supabase/functions/create-launch-pumpfun/index.ts` — untouched. The admin tab calls it as-is.
- `supabase/functions/contribute/index.ts` — untouched.
- The `USE_LOCAL_SIGNING` env flag — already true on Railway, no app-side toggle.

## Behavior the user gets

1. Admin fills the form on the LOCAL SIGNING TEST tab and submits.
2. `create-launch-pumpfun` runs (Pinata pin, keypair generation, row insert with `status='scheduled'`).
3. Connected wallet signs the seed contribution; recorded via `contribute`. The launch appears on the homepage immediately and accepts contributions from any wallet under all existing rules (min/max, presale window, etc.).
4. At `launch_datetime`, the scheduler flips it to `status='executing'`. Railway's executor claims it and, because `USE_LOCAL_SIGNING=true`, runs `launchWithLocalSigning` — no Lightning API call.
5. On success, status moves to `launched` with the on-chain signature; distribution and fee-claim flows continue as normal.
