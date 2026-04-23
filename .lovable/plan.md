

# Update tweet text to use platform Twitter handles

## What to build

Replace the platform name (e.g., "Pump.fun") with the platform's Twitter handle (e.g., "@pumpfun") in both tweet sharing locations.

## Implementation

### 1. LaunchPage.tsx (line ~161-163)
Replace `platformName` with `platformTag` in the tweet text:
- Add `const platformTag = isPumpfun ? "@pumpfun" : "@BagsApp"`
- Update `tweetText` to use `${platformTag}` instead of `${platformName}`

### 2. SchedulePage.tsx (line ~361-364)
Replace `platformLabel` with `platformTag` in the tweet text:
- Add `const platformTag = platform === "pumpfun" ? "@pumpfun" : "@BagsApp"`
- Update `tweetText` to use `${platformTag}` instead of `${platformLabel}`

## Files edited

- `src/pages/LaunchPage.tsx`
- `src/pages/SchedulePage.tsx`

