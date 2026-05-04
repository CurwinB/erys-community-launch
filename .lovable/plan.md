## Findings — full audit of `/trade-local` `create` flow vs. PumpPortal docs + working reference impls

I cross-checked `executor/src/launchWithLocalSigning.ts`, `executor/src/executePumpfun.ts`, and `supabase/functions/create-launch-pumpfun/index.ts` against:

- PumpPortal official docs (`pumpportal.fun/creation`, `pumpportal.fun/local-trading-api/trading-api`)
- PumpPortal official Local Transaction example (uses `https://ipfs.io/ipfs/<cid>` for both `image` and `tokenMetadata.uri`)
- Working community reference: `PlaydaDev/pumpmolt` (`src/launch.ts`)
- Metaplex `toBuffer` error pattern (issue metaplex-foundation/metaplex#2314 — fires when a field PumpPortal expects to PublicKey-wrap is `undefined`)

### Points of failure (priority order)

1. **PRIMARY ROOT CAUSE — Pinata public gateway in BOTH the metadata JSON's `image` field AND the URI we hand to PumpPortal.**
   - In `create-launch-pumpfun/index.ts`:
     - Line 116: `finalImageUrl = https://gateway.pinata.cloud/ipfs/${imgCid}` — embedded into `metadataObj.image`.
     - Line 169: `ipfsMetadataUrl = https://gateway.pinata.cloud/ipfs/${metadataCid}` — saved to DB and later sent as `tokenMetadata.uri`.
   - PumpPortal's own example uses `https://ipfs.io/ipfs/<cid>` for both. `gateway.pinata.cloud` is the shared free-tier gateway: it returns 429s, HTML challenges, and gateway-access-token errors against server-side fetchers. When PumpPortal fetches our URI server-side and gets HTML instead of JSON, their handler hits `undefined.toBuffer()` and returns the cryptic 400.
   - Our existing `rewriteToPublicIpfsGateway()` rewrites the URI at request time but the `image` field **inside** the metadata JSON is still Pinata. PumpPortal also fetches `image` to build the on-chain Metaplex record, so even with our rewrite we still depend on Pinata for the image.

2. **Dead fallback — `pump.fun/api/ipfs`** (lines 174–257 of `create-launch-pumpfun/index.ts`).
   - PumpPortal docs explicitly state: *"The old pump.fun/api/ipfs endpoint is no longer supported."* Sometimes it 200s, sometimes it 403s/timeouts. When it succeeds it overwrites our Pinata URI with a pump.fun URI; when it fails we silently fall back to the bad Pinata URI. This is non-deterministic flakiness, not a fix.

3. **Reachability probe noise** — `[LOCAL_SIGNING] PumpPortal reachable (400)` is normal: GETting `/trade-local` is unsupported and returns 400. It is NOT evidence the endpoint is down. Misleading log line.

4. **Metadata preflight does not assert `name`/`symbol`/`image` are present and non-empty** — `verifyMetadataReachable()` accepts any JSON with a parseable image URL. PumpPortal will still crash if `name` or `symbol` is missing/empty inside the JSON (they read these synchronously to build the Metaplex record).

5. **No retry classification for 429** — `callTradeLocal` treats only `>=500` and `toBuffer/undefined` as transient. A 429 Too Many Requests from PumpPortal would be marked permanent and not retried.

6. **Slippage 15** vs. PumpPortal example `10`. Cosmetic.

7. **`amount` precision** — `Number(initialBuyLamports) / 1e9`. Fine at SOL scale, no fix needed.

Items 1 and 2 are the real bugs. Items 3–5 are hardening.

---

## Plan

### 1. `supabase/functions/create-launch-pumpfun/index.ts`

- **Replace the Pinata gateway URL with `https://ipfs.io/ipfs/<cid>` everywhere** (both image and metadata URI), matching PumpPortal's own example exactly:
  - Line 116: `finalImageUrl = ` https://ipfs.io/ipfs/${imgCid} ``.
  - Line 169: `ipfsMetadataUrl = ` https://ipfs.io/ipfs/${metadataCid} ``.
- **Delete the entire `pump.fun/api/ipfs` block (lines 174–257)** — the endpoint is officially deprecated; it adds 10–30s latency and non-deterministic URI overwrites.
- **Tighten `verifyMetadataReachable`** so it requires `name`, `symbol`, and `image` to be non-empty strings inside the JSON; reject otherwise. Keep image-URL fetch check.
- **Stop uploading via `network: "public"` only** if a dedicated gateway env var is configured later (no change today, but leave a TODO).

### 2. `executor/src/launchWithLocalSigning.ts` and `executor/src/executePumpfun.ts`

- **Keep `rewriteToPublicIpfsGateway()`** as a safety net for legacy launch rows whose `ipfs_metadata_url` was stored as a Pinata URL before this fix.
- **Treat HTTP 429 as transient** in `callTradeLocal` (and the analogous code path in `executePumpfun.ts`).
- **Improve the reachability probe log line** to make clear that 400/405 on GET means "endpoint is up", not "endpoint failing".
- **Tighten the inline metadata diagnostic** to fail-fast (call `setFailed`) when the URI does not return JSON containing non-empty `name`/`symbol`/`image`. Today it only logs.

### 3. One-shot repair script

- Add `executor/scripts/rewriteLegacyMetadataUrls.ts` (admin-gated like `repairFailedMetadata.ts`) that scans `launches` rows with `ipfs_metadata_url LIKE '%gateway.pinata.cloud%'` or `'%pinata.cloud%'` and rewrites them to `https://ipfs.io/ipfs/<cid>` in place. Dry-run by default; `--apply` to write. Required so any pre-existing `scheduled` launches can be repaired without re-creating.

### 4. No DB schema / RLS / client UI changes required

The `ipfs_metadata_url` column already stores a plain string; we just write a different host into it.

---

## Why this fixes it

- PumpPortal's official, working example uses `ipfs.io` for the URI it fetches and the `image` it embeds. Switching to the same gateway eliminates the Pinata-rate-limit / HTML-challenge failure mode that triggers their `undefined.toBuffer()` 400. The `toBuffer` symptom is consistent with their server JSON-parsing HTML and then trying to PublicKey-wrap a missing field — exactly Metaplex's documented crash signature.
- Removing the `pump.fun/api/ipfs` fallback removes a non-deterministic source of bad URIs and 30s latency.
- The repair script unblocks any launches already created with the bad Pinata URL so we don't need to re-create them.

## Files touched

- edit `supabase/functions/create-launch-pumpfun/index.ts`
- edit `executor/src/launchWithLocalSigning.ts`
- edit `executor/src/executePumpfun.ts`
- new `executor/scripts/rewriteLegacyMetadataUrls.ts`
- update `.lovable/plan.md`
