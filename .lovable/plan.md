## Why Louey failed

PumpPortal returned `400 Cannot read properties of undefined (reading 'toBuffer')` on both `/trade-local` attempts. The earlier `ipfs://` image fix worked (the metadata JSON now correctly uses an HTTPS Pinata URL). The remaining trigger is the **token name**: it is stored and sent as `"Louey "` — with a trailing space. PumpPortal's create handler runs server-side metadata processing on `name`/`symbol`, and the trailing whitespace is the most likely cause of the `undefined.toBuffer()` crash this round (the symbol is also uppercased to `LOUEY` but the name space is passed through verbatim).

A second, related fragility: we pass our own Pinata `metadataUri` to `/trade-local` instead of using PumpPortal's canonical `https://pump.fun/api/ipfs` upload. Self-hosted URIs work most of the time but are a documented source of intermittent `toBuffer` 400s because PumpPortal fetches and parses the JSON synchronously inside the request handler.

## Changes

### 1. Sanitize name/symbol everywhere they hit PumpPortal

**`executor/src/launchWithLocalSigning.ts`** and **`executor/src/executePumpfun.ts`** / **`executor/src/executePumpfunLightning.ts`** (wherever `tokenMetadata` is built):

- `name: launch.token_name.trim()`
- `symbol: launch.token_symbol.trim().toUpperCase()`
- Reject (skip + setFailed early) if either is empty after trim.

**`supabase/functions/create-launch-pumpfun/index.ts`**:

- Trim `name` and `symbol` before writing to the metadata JSON and before persisting `token_name` / `token_symbol` on the `launches` row. Existing trailing-space rows stay as-is (cosmetic) but new launches won't reproduce the bug.

### 2. Use pump.fun's canonical IPFS upload (defense-in-depth)

In `create-launch-pumpfun/index.ts`, after pinning the image to Pinata:

- Build a multipart form (file + `name`, `symbol`, `description`, `twitter`, `telegram`, `website`, `showName=true`).
- POST to `https://pump.fun/api/ipfs`.
- Use the returned `metadataUri` for `launch.ipfs_metadata_url`.
- Keep the Pinata image pin as fallback (so we still own the asset). If the pump.fun upload fails, fall back to the current Pinata-hosted metadata JSON path so we never block a launch on their service.

### 3. Manual fix for Louey's stored name

One-off SQL update via migration to trim the trailing space on the existing Louey row so a manual retry works without redeploy ordering games:

```sql
update launches set token_name = trim(token_name), token_symbol = trim(token_symbol)
where id = 'f3c209e1-9283-4d1e-a39c-b0eaa921a8a2';
```

(Optionally extend to all rows where `token_name <> trim(token_name)`.)

### 4. Update plan.md

Replace probe-removal notes with the new "trim + canonical IPFS" rationale.

## Files

- `executor/src/launchWithLocalSigning.ts`
- `executor/src/executePumpfun.ts`
- `executor/src/executePumpfunLightning.ts`
- `supabase/functions/create-launch-pumpfun/index.ts`
- new migration: trim existing token_name/symbol
- `.lovable/plan.md`

## Out of scope

- Refunds: already completed automatically (refunded=2, partial=1 as expected — partial is the on-chain tx-fee shortfall, surfaced in admin RefundsTab).
- Auto-retrying the failed Louey launch — handled by existing admin "retry" flow once the trim migration runs.

## Verification

After deploy:
1. Re-run Louey from admin → name is now `"Louey"` → `/trade-local` should succeed.
2. Next fresh launch will use pump.fun's IPFS endpoint, removing the last variable in the metadata path.
