## Summary
Hardcode the token metadata description to `Community launch powered by https://erys.live` in two places.

## Changes

### 1. `supabase/functions/create-launch-pumpfun/index.ts`
- Line 142: update the hardcoded `description` field in the metadata object sent to Pinata.
- Old: `Community funded deployed via https://erys.live`
- New: `Community launch powered by https://erys.live`

### 2. `supabase/functions/claim-sponsored-slot/index.ts`
- Line 125: replace `description: description || ""` with the same hardcoded string in the metadata object uploaded to Supabase storage.
- This ensures sponsored launches use the identical description on-chain.

No DB schema changes, no UI changes, no other logic touched.