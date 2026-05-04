# Fix PumpPortal /trade-local create failures

## Changes
- `supabase/functions/create-launch-pumpfun/index.ts`: use `https://ipfs.io/ipfs/<cid>` for both image and metadata URI; remove deprecated `pump.fun/api/ipfs` fallback; preflight requires non-empty name/symbol/image.
- `executor/src/launchWithLocalSigning.ts`: fail-fast inline metadata diagnostic; treat 429 as transient; clarify probe log.
- `executor/src/executePumpfun.ts`: clarify probe log.
- `executor/scripts/rewriteLegacyMetadataUrls.ts`: admin-gated repair script for legacy Pinata URLs in `launches.ipfs_metadata_url`.

## Why
PumpPortal's official example uses ipfs.io. gateway.pinata.cloud rate-limits server-side fetchers and triggers their `undefined.toBuffer()` 400 path.
