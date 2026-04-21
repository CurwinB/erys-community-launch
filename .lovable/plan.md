

# Five Pre-Launch Fixes

Backend, frontend, and validation tightening across schedule, contribute, execute-launch, and create-launch-pumpfun. No DB changes, no new dependencies.

## Fix 1 — `supabase/functions/contribute/index.ts`

After the existing "launch_datetime has passed" check (line 44), add a 5-minute buffer check:

```ts
const launchTime = new Date(launch.launch_datetime).getTime();
if (launchTime - Date.now() < 5 * 60 * 1000) {
  return errorResponse("Contribution window is closed. This launch executes in less than 5 minutes.", 400);
}
```

## Fix 2 — `supabase/functions/execute-launch/index.ts` (Pump.fun ATA reserve)

In `executePumpfunLaunch`, replace the current `initialBuyLamports` calc (lines ~495-503) with one that reserves SOL for ATA creation per contributor:

```ts
const ATA_COST_PER_CONTRIBUTOR = 2_039_280n;
const TX_FEE_PER_CONTRIBUTOR = 5_000n;
const PRIORITY_FEE_LAMPORTS = 50_000n;

const contributorCount = BigInt(contributions.length);
const ataReserve = contributorCount * (ATA_COST_PER_CONTRIBUTOR + TX_FEE_PER_CONTRIBUTOR);
const initialBuyLamports = totalLamports - ataReserve - PRIORITY_FEE_LAMPORTS;

if (initialBuyLamports < 10_000_000n) {
  await setFailed(supabase, launch.id,
    `Insufficient SOL after ATA reserve. Total: ${totalLamports}, Reserve: ${ataReserve}, Net: ${initialBuyLamports}`);
  return errorResponse("Not enough SOL to cover token distribution costs and initial buy");
}
```

## Fix 3 — `supabase/functions/create-launch-pumpfun/index.ts` (verify metadata URL)

Right after `const ipfsMetadataUrl = urlData.publicUrl;` and before generating keypairs, add a HEAD-fetch verification:

```ts
try {
  const verifyRes = await fetch(ipfsMetadataUrl, { method: "HEAD" });
  if (!verifyRes.ok) {
    return errorResponse(`Metadata URL is not publicly accessible: ${ipfsMetadataUrl}`, 500);
  }
} catch (err: any) {
  return errorResponse(`Failed to verify metadata URL accessibility: ${err.message}`, 500);
}
```

The `token-metadata` bucket is already public (confirmed in storage config), so this is a safety net for future regressions.

## Fix 4 — `src/pages/SchedulePage.tsx` (1–72h validation)

In `handleSubmit`, after `setIsSubmitting(true)` (or just before), compute the launch datetime and reject out-of-range values with destructive toasts:

```ts
const launchDatetime = new Date(`${form.launchDate}T${form.launchTime}`);
const diffHours = (launchDatetime.getTime() - Date.now()) / 3_600_000;
if (diffHours < 1) { toast({ title: "Launch time too soon", description: "Launch must be scheduled at least 1 hour from now.", variant: "destructive" }); return; }
if (diffHours > 72) { toast({ title: "Launch time too far", description: "Launch must be scheduled within 72 hours from now.", variant: "destructive" }); return; }
```

Update the existing helper text under the date/time inputs (line 274) to read:
> "Launch must be between 1 and 72 hours from now. Your timezone: {tz}"

## Fix 5 — `src/pages/LaunchPage.tsx` (window closing UX)

Replace the existing `canContribute` derivation (line 138) with:

```ts
const launchMs = new Date(launch.launch_datetime).getTime();
const windowClosed = Date.now() >= launchMs - 5 * 60 * 1000;
const closingSoon = !windowClosed && Date.now() >= launchMs - 10 * 60 * 1000;
const canContribute = isScheduled && !isPastLaunchTime && !windowClosed;
```

Add two banner blocks above the contribute card (right column, sticky):
- Yellow/warning bordered card: "Contribution window closes in less than 10 minutes." (when `closingSoon && isScheduled`)
- Muted card: "Contribution window closed. Launch executes shortly." (when `windowClosed && isScheduled`)

Existing button states already cover "Contributions Closed" via `canContribute`.

## Fix 6 — `src/pages/SchedulePage.tsx` (tweet text + success heading)

Replace the `tweetText` definition (lines 122-126) with a single platform-aware string mentioning `@eryslive`:

```ts
const platformLabel = platform === "pumpfun" ? "Pump.fun" : "Bags.fm";
const tweetText = encodeURIComponent(
  `I just scheduled a community token launch on @eryslive via ${platformLabel}.\n\nGet in before it goes live and secure your early position.\n\n${successData?.url || ""}`
);
```

In the success screen, add a small "Launching on {Pump.fun|Bags.fm}" subline directly under the "Launch Scheduled!" heading (line 136), styled in muted/platform-accent text.

## Files

- Edit: `supabase/functions/contribute/index.ts`
- Edit: `supabase/functions/execute-launch/index.ts`
- Edit: `supabase/functions/create-launch-pumpfun/index.ts`
- Edit: `src/pages/SchedulePage.tsx`
- Edit: `src/pages/LaunchPage.tsx`

No DB migrations, no new secrets, no new packages.

