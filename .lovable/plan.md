# Fix PumpPortal /trade-local create failures

## Changes
- `supabase/functions/create-launch-pumpfun/index.ts`: store metadata as `https://ipfs.io/ipfs/<cid>`. Replace public-gateway preflight with `verifyMetadataViaPinata()` — authenticated GET through `gateway.pinata.cloud` using `PINATA_JWT`. Public gateways (ipfs.io / cloudflare) return 401/429 to Supabase Edge egress IPs, which caused spurious "Metadata URL not reachable" 503s.
- `executor/src/launchWithLocalSigning.ts`: inline metadata diagnostic on Railway egress before /trade-local — that's the network path that mirrors PumpPortal's own fetch.
- `executor/scripts/rewriteLegacyMetadataUrls.ts`: admin-gated repair script for legacy Pinata URLs in `launches.ipfs_metadata_url`.

## Why
The Supabase Edge Function and the executor (Railway) have very different egress-IP reputations on public IPFS gateways. The Edge Function should verify via Pinata's authenticated API; only the executor should probe the public gateway.