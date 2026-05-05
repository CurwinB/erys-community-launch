## Problem

Railway log shows the launch failed with:
```
Metadata not reachable before /trade-local: metadata GET 504 (after 1 attempts)
```

The executor's `verifyMetadataReachable()` did a GET against `https://ipfs.io/ipfs/<cid>` and got HTTP 504 (Cloudflare gateway timeout) — `ipfs.io` was simply slow/overloaded for Railway's egress IP. The fetch took >12 s, so the 12 s deadline elapsed after a single attempt and we aborted before ever hitting `/trade-local`.

This is the third time `ipfs.io` has bitten us (401, 429, now 504). It is not a reliable fetch target and we should stop depending on it as a hard gate.

Two compounding root causes:

1. **The metadata `uri` we hand to PumpPortal points at `ipfs.io`** — a free, anonymous, heavily-rate-limited public gateway. Even when our pre-flight passes, PumpPortal's own fetch can still fail the same way.
2. **The executor pre-flight is a hard fail** — any single 504/timeout from one specific gateway aborts the launch even though PumpPortal's egress (different network, different reputation) might resolve the URI fine.

## Fix

### 1. Use Pinata's dedicated gateway for the metadata URI (`supabase/functions/create-launch-pumpfun/index.ts`)

Pinata provisions every account a dedicated subdomain (e.g. `<your-name>.mypinata.cloud`) that:
- Is rate-limit-isolated to your account (not the global `ipfs.io` pool)
- Serves public-network CIDs without auth headers (PumpPortal can fetch it)
- Is what Pinata's own docs recommend for production retrieval

Add a new edge secret `PINATA_GATEWAY_DOMAIN` (value like `your-name.mypinata.cloud`, no scheme, no path). Build both the `image` and metadata URIs as `https://${PINATA_GATEWAY_DOMAIN}/ipfs/<cid>` instead of `https://ipfs.io/ipfs/<cid>`. Fall back to `ipfs.io` only if the secret is not set, with a console.warn.

Keep the existing authenticated `verifyMetadataViaPinata` check — it stays as the strict server-side proof that the upload landed.

### 2. Make the executor pre-flight a soft warning, not a hard abort (`executor/src/launchWithLocalSigning.ts`)

- Increase per-attempt timeout to 8 s and bump retries: try the URL up to 4 times with 2 s backoff (~32 s total budget).
- If all attempts fail, **log a WARN with the status/reason but do NOT call `setFailed`/`return`** — proceed to `/trade-local` anyway. PumpPortal runs from a different network and its fetch frequently succeeds when ours doesn't. If PumpPortal genuinely can't reach the URI, its `/trade-local` will return a real error which we already capture and surface.
- Same change for the inline JSON-shape diagnostic block: if the GET fails, log it but don't abort. Only abort when the JSON is reachable AND missing required fields (because that's a deterministic content bug, not a flaky network).
- Drop `rewriteToPublicIpfsGateway()` — by the time we get here the DB already holds the dedicated-gateway URL.

### 3. Backfill existing scheduled launches (`executor/scripts/rewriteLegacyMetadataUrls.ts`)

Extend the existing rewrite script to also rewrite `https://ipfs.io/ipfs/<cid>` → `https://${PINATA_GATEWAY_DOMAIN}/ipfs/<cid>` for any `status='scheduled'` rows. Run it once with `--apply` after the secret is added so the failed launch (`499feaca…`) and any future ones use the dedicated gateway.

### 4. Add the secret

Use `add_secret` to request `PINATA_GATEWAY_DOMAIN` from the user. Pinata dashboard → Gateways → copy the subdomain (everything before the first slash, no `https://`). After it's added, redeploy `create-launch-pumpfun` and rebuild the executor on Railway.

### 5. Update `.lovable/plan.md`

Document: dedicated gateway is the canonical metadata host; executor pre-flight is advisory; PumpPortal is the source of truth for reachability.

## Why this is the right fix

- `ipfs.io` failures are external and recurring; the only stable cure is a gateway we control the rate-limit budget for. Pinata's dedicated gateway is exactly that.
- The executor pre-flight was added as a safety net for PumpPortal's `toBuffer` crash. With a reliable gateway and our existing Pinata-authenticated verify in the edge function, that safety net is now causing more failures than it prevents. Treating it as advisory restores the intended behavior: only abort on real, attributable failures.
- No on-chain funds are touched until after `/trade-local` succeeds, so letting `/trade-local` itself be the gate is still safe — refunds run normally on any failure path.

## Files touched

- `supabase/functions/create-launch-pumpfun/index.ts` — read `PINATA_GATEWAY_DOMAIN`, build URIs from it.
- `executor/src/launchWithLocalSigning.ts` — soften pre-flight + JSON diagnostic to warn-only, longer retry budget, remove gateway rewriter.
- `executor/scripts/rewriteLegacyMetadataUrls.ts` — add ipfs.io → dedicated-gateway rewrite case.
- `.lovable/plan.md` — note the new pattern.
- New edge secret: `PINATA_GATEWAY_DOMAIN`.
