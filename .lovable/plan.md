# Fix: PumpPortal toBuffer 400 — metadata URI unreachable

## What's actually happening

Every recent Pump.fun launch (Loup, Louey, Loopy, Rupper) failed with the same PumpPortal error:

```
400 Cannot read properties of undefined (reading 'toBuffer')
```

This is **not** a payload problem on our side. It's PumpPortal's server crashing while trying to fetch and parse our `tokenMetadata.uri`. From the `create-launch-pumpfun` edge logs for Loup:

- `pump.fun /api/ipfs returned 403; keeping Pinata URL` — our canonical-upload fallback is being blocked (likely by Cloudflare on the Supabase edge runtime's default User-Agent).
- `Metadata CID ... not propagated within timeout — proceeding anyway` — the Pinata gateway didn't have the JSON ready when we wrote the URL to the DB.

By the time the executor calls `/trade-local` (~minutes later), PumpPortal fetches `https://gateway.pinata.cloud/ipfs/<cid>` and either gets a 404 or a JSON whose `image` field it can't resolve, then crashes inside its image-buffer code.

## Plan

### 1. Make pump.fun /api/ipfs upload actually work (primary fix)

In `supabase/functions/create-launch-pumpfun/index.ts`:

- Send the multipart POST to `https://pump.fun/api/ipfs` with a **realistic browser User-Agent** and `Origin: https://pump.fun`, `Referer: https://pump.fun/create`. Cloudflare's 403 is almost certainly bot fingerprinting on the default Deno fetch headers.
- On success, store the returned `metadataUri` (an `https://cf-ipfs.com/...` or `ipfs://` URL) as `ipfs_metadata_url`. Pump.fun's own URI is the only one PumpPortal is guaranteed to be able to read instantly.
- Retry up to 3 times with backoff before falling back.

### 2. Verify metadata is actually reachable before saving

If we do fall back to Pinata, do not just check the CID — `GET` the full URL we're about to store and require a 200 with valid JSON whose `image` field also returns 200. Loop with backoff for up to 30s. If it never resolves, fail the create-launch call cleanly so the user sees an error before contributions open, instead of failing at execution time after funds are pooled.

### 3. Last-resort warm-up before /trade-local

In both `executor/src/launchWithLocalSigning.ts` and `executor/src/executePumpfun.ts`, immediately before the `/trade-local` POST:

- `GET launch.ipfs_metadata_url`, parse JSON, then `GET` the `image` field once.
- If either fails, abort with a clear `metadata not reachable` error (refunds will trigger normally) instead of letting PumpPortal crash and emit the cryptic toBuffer message.

This costs ~200ms and converts every future toBuffer failure into a diagnosable error.

### 4. Retry the 4 failed launches from admin

Loup, Louey, Loopy, Rupper all have valid escrows and mint keypairs. After the fix ships, re-uploading metadata via pump.fun's IPFS endpoint and patching `ipfs_metadata_url` on these rows will let the existing admin "retry failed launch" flow execute them. Done as a one-off script in `executor/scripts/`.

## Files to change

- `supabase/functions/create-launch-pumpfun/index.ts` — UA headers, retry, real reachability check
- `executor/src/launchWithLocalSigning.ts` — pre-flight metadata fetch
- `executor/src/executePumpfun.ts` — same pre-flight
- `executor/scripts/repairFailedMetadata.ts` (new) — re-upload + patch the 4 stuck launches
- `.lovable/plan.md` — record root cause and fix

## Out of scope

- Refunds for the 4 launches (already auto-refunded by `refundFailedLaunch`).
- Touching the Lightning path beyond what's already aligned.
