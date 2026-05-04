Add Pinata→public-gateway rewrite + inline metadata diagnostics before `/trade-local`.

## Changes

### 1. `executor/src/launchWithLocalSigning.ts`

Add a small helper near the bottom of the file:

```ts
function rewriteToPublicIpfsGateway(url: string): string {
  if (!url) return url;
  // gateway.pinata.cloud/ipfs/<cid>/...  →  https://ipfs.io/ipfs/<cid>/...
  const m = url.match(/^https?:\/\/[^/]*pinata[^/]*\/ipfs\/(.+)$/i);
  if (m) return `https://ipfs.io/ipfs/${m[1]}`;
  // ipfs://<cid>/... → https://ipfs.io/ipfs/<cid>/...
  const ipfsProto = url.match(/^ipfs:\/\/(.+)$/i);
  if (ipfsProto) return `https://ipfs.io/ipfs/${ipfsProto[1]}`;
  return url;
}
```

Right before building `requestBody` for `/trade-local`:
- Compute `originalUri` from `launch.ipfs_metadata_url`.
- Run it through `rewriteToPublicIpfsGateway` to get `uriField`.
- Log both: `LOG(\`uri original=${originalUri} rewritten=${uriField}\`)`.
- Inline diagnostic `fetch(uriField)`: log status, byte length, first 600 chars of body, and parsed `name`/`symbol`/`image` fields (or "did NOT return valid JSON").
- Pass the rewritten `uriField` as `tokenMetadata.uri`.

### 2. `executor/src/executePumpfun.ts`

Mirror the same helper + diagnostic + rewrite immediately before the `/trade-local` POST. Update the existing `verifyMetadataReachable` call site so the rewritten URI is what gets verified and what gets sent.

### 3. No DB / config / UI changes

No schema migration, no edge function changes, no secrets. Helper is local to each executor file (or extracted to a tiny shared util if both files end up identical — single-file duplication is fine for one tiny function).

## Why

PumpPortal fetches `tokenMetadata.uri` server-side during `create` and crashes with `Cannot read properties of undefined (reading 'toBuffer')` when the body isn't valid JSON with `name`/`symbol`/`image`. Pinata's public gateway frequently rate-limits or returns HTML challenges to server-side fetchers. `ipfs.io` is the more reliable public gateway for this case; the inline diagnostic confirms parseability before we hand it off.