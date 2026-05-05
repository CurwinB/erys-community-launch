# Fix PumpPortal /trade-local create failures

## Canonical metadata host: Pinata dedicated gateway
- Edge Function builds image + metadata URIs as `https://${PINATA_GATEWAY_DOMAIN}/ipfs/<cid>`. Account-isolated rate limits — PumpPortal's server fetch no longer hits the shared ipfs.io 401/429/504 pool.
- Edge Function still verifies the upload via Pinata's authenticated gateway (`verifyMetadataViaPinata`) before inserting the row.
- Executor pre-flight against the URI is **advisory only** — failures log WARN and we proceed to `/trade-local`. PumpPortal's own egress is the source of truth; aborting on a Railway-side gateway hiccup was causing spurious failures.
- JSON-shape diagnostic still aborts when the URI is reachable but missing `name`/`symbol`/`image` (deterministic content bug).
- `executor/scripts/rewriteLegacyMetadataUrls.ts` rewrites `pinata.cloud` / `ipfs.io` / `cloudflare-ipfs` / `ipfs://` to the dedicated gateway. Run with `--apply` once after setting the secret.

## Secret
- `PINATA_GATEWAY_DOMAIN` (no scheme, no path) — e.g. `your-name.mypinata.cloud`.
