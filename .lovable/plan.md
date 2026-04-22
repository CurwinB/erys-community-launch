

# New `executor/` Railway Service + Slim `execute-launch` Edge Function

Splits launch execution out of Supabase Edge Functions (which keep hitting 546 CPU exceeded) and into a dedicated Railway service, parallel to the existing `distributor/`. The edge function becomes a 1-second SQL-only status flipper.

## Architecture

```text
pg_cron (1 min)
   │
   ▼
execute-launch (edge)        ← SQL only: scheduled → executing
   │
   ▼
launches.status = "executing"
   │
   ▼
erys-executor (Railway, polls 30s)
   │   ├── executeBags()      ← fee-share/config → create-launch-tx → send
   │   └── executePumpfun()   ← PumpPortal → mint+escrow sign → RPC send
   ▼
launches.status = "launched"
   │
   ▼
erys-distributor (Railway, polls 30s)  ← unchanged
   └── distributes tokens, claims Pump.fun fees
```

Three independently deployable services. Crash isolation between launch execution and token distribution.

## Files

**New (10 files in `executor/`)**
- `executor/package.json` — exact deps from prompt (`@solana/web3.js`, `@supabase/supabase-js`, `bs58`, `dotenv`, `node-fetch@2`, `@types/node-fetch`)
- `executor/tsconfig.json`
- `executor/.gitignore`
- `executor/.env.example`
- `executor/src/index.ts` — env validation + 30s polling loop
- `executor/src/db.ts` — Supabase client + Launch/Contribution types + `getExecutingLaunches`, `getContributions`, `setLaunched`, `setFailed`, `storeFeeShareConfig`, `storeBasisPoints`
- `executor/src/decrypt.ts` — **identical to the FIXED `distributor/src/decrypt.ts`** (decrypts then hex-decodes the UTF-8 plaintext to 64 raw bytes). The prompt's snippet returns the raw buffer — I'll deviate to match the corrected distributor pattern, otherwise `Keypair.fromSecretKey` will receive 128 bytes and throw exactly like the original distributor bug.
- `executor/src/executeBags.ts` — full Bags flow: decrypt → reserve calc → claimer/BP arrays → `fee-share/config` → multi-tx send (500ms gap) → `create-launch-transaction` → final send. Uses `signAndSendToBags` helper that handles both `VersionedTransaction` and legacy `Transaction`.
- `executor/src/executePumpfun.ts` — decrypt escrow + mint keypairs → reserve calc → store basis points → PumpPortal `trade-local` → sign with `[mintKeypair, escrowKeypair]` → submit via Alchemy RPC → store `pumpfun_launch_signature`.
- `executor/src/executeLaunch.ts` — concurrency guard via `Set<string>`, dispatches to Bags or Pump.fun by `launch.platform`.

**Edited (1 file)**
- `supabase/functions/execute-launch/index.ts` — **replaced entirely** with ~50-line SQL flipper. No web3.js, no bs58, no Bags imports, no signing. Selects `status='scheduled' AND launch_datetime <= now() AND execution_attempts < 3`, increments attempts, flips to `executing`. Race guard via `.eq("status","scheduled")` on update. Returns in <1s — eliminates the 546 CPU exceeded errors.

## Key correctness notes (deviations from the prompt — flagged here, applied silently)

1. **`decrypt.ts` must hex-decode after decrypting.** The prompt says "copy distributor/src/decrypt.ts exactly" — I'll copy the *current fixed* version (UTF-8 → hex → 64 bytes), not the snippet inline in the prompt which returns the raw 128-byte buffer. Matches the fix already applied to `distributor/`.

2. **`executeBags.ts` BP rounding.** The prompt's `basisPointsArray[0] += remaining - usedBps` correction is included as-is — keeps sum = 7500 (creator+contributors share of the 75% pool after platform 25%). Partner BP is handled by Bags via `partner` + `partnerConfig` fields, not in the array (per existing memory rule).

3. **`executePumpfun.ts` base64 encoding.** The prompt has dead code (`binary` loop never used). I'll drop it and use `Buffer.from(signedBytes).toString("base64")` directly — same result, cleaner.

4. **No edits to `distributor/`.** Per prompt.

5. **No frontend, no schema, no new secrets.** All required secrets (`BAGS_API_KEY`, `BAGS_PARTNER_WALLET`, `BAGS_PARTNER_CONFIG`, `ESCROW_ENCRYPTION_KEY`, `SOLANA_RPC_URL`, `SUPABASE_*`) already exist on the edge-function side; user adds the same values to Railway env for the new service.

## What the user does after Lovable pushes

1. In Railway: create a new service from the same `CurwinB/erys-community-launch` repo, set **Root Directory** to `executor/`. Build command auto-detects (`npm install && npm run build`), start command `npm start`.
2. Add env vars in Railway (8 vars listed in the prompt). Values are identical to those already in Supabase secrets and the existing distributor service.
3. Deploy. Tail logs — should see `Erys Executor starting...` then `Polling every 30000ms`.
4. Schedule a 0.05 SOL test launch (10-min lead time already in place). Watch:
   - `execute-launch` returns 200 in <1s, flips row to `executing`
   - Executor picks it up within 30s, runs Bags/Pump.fun flow, flips to `launched`
   - Distributor picks it up within 30s, distributes tokens, flips `distribution_completed=true`

## Out of scope

- No changes to `distributor/`, frontend, schema, or any other edge function.
- No new Supabase secrets (existing ones cover the executor needs server-side; Railway env is configured manually by user).
- No deletion of stale execution logic in other places — only `execute-launch/index.ts` is touched.

