## Change

Update the hardcoded token metadata description used when creating Pump.fun launches on Erys.

**File:** `supabase/functions/create-launch-pumpfun/index.ts` (line 142)

- From: `description: "Deployed using https://erys.live",`
- To: `description: "Get in early on tokens like this before they go live. https://erys.live",`

This string is pinned into the IPFS metadata JSON consumed by Pump.fun, so only newly created launches after deploy will use the updated description. Existing launches keep their already-pinned metadata.

No other occurrences of the old string exist in the codebase. Bags launches (`executor/src/executeBags.ts`) use the user-supplied `launch.description` and are unaffected.

## Deploy

Redeploy the `create-launch-pumpfun` edge function after the edit.
