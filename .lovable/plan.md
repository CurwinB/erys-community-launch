

# Fix: Bags create-launch returns "non-2xx" error

## Root cause

The Bags `create-token-info` API returns the metadata URL at `response.tokenMetadata`, but `supabase/functions/create-launch/index.ts` reads it from `response.tokenLaunch.uri`, which doesn't exist. `ipfsMetadataUrl` becomes `null`, the function bails with a 500, and the form shows "Edge Function returned a non-2xx status code".

Confirmed from edge function logs:
```
create-token-info response: {"success":true,"response":{
  "tokenMint":"8NnLKEm2mkXxuiEXdiXgPjn2yFBZPaRk7LzBwA7vBAGS",
  "tokenMetadata":"https://ipfs.io/ipfs/QmTvqPgxnVJdpTntaZU3ybZfEuqKmDPcAG1JeQJ4wfrNFR",
  "tokenLaunch":{ ...no `uri` field... }
}}
tokenMint: 8NnLKEm2mkXxuiEXdiXgPjn2yFBZPaRk7LzBwA7vBAGS ipfsMetadataUrl: null
```

## Fix

Edit `supabase/functions/create-launch/index.ts` (line ~68):

- Change `ipfsMetadataUrl = tokenInfoData.response?.tokenLaunch?.uri || null;`
- To: `ipfsMetadataUrl = tokenInfoData.response?.tokenMetadata || tokenInfoData.response?.tokenLaunch?.uri || null;`

Keeping the `tokenLaunch.uri` fallback in case Bags ever changes the response shape back.

No other files need changing — the executor (`executor/src/executeBags.ts`) already passes whatever `launch.ipfs_metadata_url` contains as the `ipfs` field to `token-launch/create-launch-transaction`, and `https://ipfs.io/ipfs/Qm...` is the standard format Bags accepts.

## Cleanup of orphaned row

The failed attempt created a Bags token-info entry (`8NnLKEm2mkXxuiEXdiXgPjn2yFBZPaRk7LzBwA7vBAGS`) but no `launches` row (insert never ran). Nothing to clean up in our DB. The orphan token-info on Bags' side is harmless — it just won't be launched.

## Files edited

- `supabase/functions/create-launch/index.ts` — one-line fix to read `tokenMetadata` from the Bags response.

