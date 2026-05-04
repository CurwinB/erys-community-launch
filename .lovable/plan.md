## Goal

Give admins a UI in the existing admin panel to trigger the local-signing Pump.fun launch path (`executor/src/launchWithLocalSigning.ts`) without SSHing into Railway or running CLI scripts. Support dry-run (safe, no on-chain submission, no DB mutation) and live runs.

## Architecture

The executor lives on Railway and is not HTTP-callable from the browser. The cleanest bridge is a new Supabase edge function that:

1. Verifies the caller is an admin wallet (via `is_admin_wallet` RPC).
2. Loads the target launch + contributions server-side using the service role.
3. Runs the same local-signing logic (decrypt keypairs → call PumpPortal `/trade-local` → sign locally → optionally submit via RPC).
4. Returns structured logs + the resulting tx signature (or dry-run summary) to the UI.

This keeps the browser zero-trust (no keypairs, no admin token), reuses existing RLS/admin gating, and matches the pattern already used by `execute-launch`, `retry-failed-launch`, etc.

## What gets built

### 1. New edge function: `supabase/functions/test-local-signing`

- Inputs (POST JSON): `{ launchId: string, dryRun: boolean, adminWallet: string }`
- Auth: requires `Authorization: Bearer <anon>` (standard) AND verifies `adminWallet` via `is_admin_wallet` RPC. Reject 403 if not admin.
- Safety guards:
  - Reject if `launch.platform !== 'pumpfun'`.
  - Reject if `launch.status !== 'executing'` AND `dryRun === false` (matches the CLI rule).
  - Require `pumpfun_mint_keypair_encrypted` and `escrow_wallet_encrypted_private_key` to be present.
- Logic (port of `launchWithLocalSigning.ts` to Deno):
  - Decrypt both keypairs using `ESCROW_ENCRYPTION_KEY` (reuse — never generate).
  - Verify `mintKeypair.publicKey === launch.token_mint_address`.
  - Compute pool total, reserves, `initialBuyLamports`.
  - POST to `https://pumpportal.fun/api/trade-local` with `mint = launch.token_mint_address` (public key string), 30s timeout.
  - Deserialize response as `Uint8Array` → `VersionedTransaction`.
  - Sign with `[mintKeypair, escrowKeypair]`.
  - **Dry-run path:** return `{ ok: true, dryRun: true, txSizeBytes, escrowPubkey, mintPubkey, mintMatch: true, logs: [...] }`. NO RPC submission. NO DB writes.
  - **Live path:** `connection.sendRawTransaction(signed, { skipPreflight:false, preflightCommitment:"confirmed", maxRetries:3 })` → call `setLaunched` (update launches row to `launched` + tx sig) → return `{ ok: true, dryRun: false, txSignature, solscanUrl, logs }`.
- Logging: every step pushed into a `logs: string[]` array (prefixed `[LOCAL_SIGNING]`) so the UI can render them, in addition to `console.log` for Supabase function logs.
- Error returns: `{ ok: false, error, logs }` with HTTP 200 so the UI can always render the captured logs.

### 2. New admin tab component: `src/components/admin/LocalSigningTestTab.tsx`

UI layout (matches existing admin styling — sharp edges, mono uppercase headers, dark cards):

```text
┌─ LOCAL SIGNING TEST ─────────────────────────────────────┐
│  WARNING: This invokes the alternative /trade-local      │
│  signing path. Use dry-run first.                        │
│                                                          │
│  Launch:   [ Select pumpfun launch ▾ ]                   │
│           (filtered to platform=pumpfun, shows           │
│            symbol · status · short id)                   │
│                                                          │
│  Mode:    ( ) Dry run  ( ) Live submit                   │
│                                                          │
│  [ RUN TEST ]                                            │
├──────────────────────────────────────────────────────────┤
│  RESULT                                                  │
│  Status:    OK / FAILED                                  │
│  Tx size:   1232 bytes                                   │
│  Escrow:    7xKX...abcd                                  │
│  Mint:      9pM2...ef01    ✓ matches launch              │
│  Tx sig:    (live only) → solscan link                   │
│                                                          │
│  LOGS                                                    │
│  ┌───────────────────────────────────────────────────┐  │
│  │ [LOCAL_SIGNING] Loaded escrow keypair: ...        │  │
│  │ [LOCAL_SIGNING] Loaded mint keypair: ...          │  │
│  │ [LOCAL_SIGNING] Pool total: 0.85 SOL ...          │  │
│  │ [LOCAL_SIGNING] Received 1232-byte unsigned tx    │  │
│  │ [LOCAL_SIGNING] [DRY RUN] Transaction ready ...   │  │
│  └───────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

Behavior:
- Launch dropdown: filter `launches` (already loaded by AdminPage) to `platform === 'pumpfun'` with `pumpfun_mint_keypair_encrypted != null`. Show all statuses but visually mark which are valid for live mode.
- Mode: radio group, default `Dry run`. Selecting `Live submit` shows an `AlertDialog` confirmation on click ("This will submit a real transaction on-chain and mark the launch as launched. Proceed?").
- Run button: disabled until launch + mode chosen. Shows spinner during call.
- Result card: renders the structured fields from the response.
- Logs: monospace `<pre>` block, scrollable, copy-to-clipboard button.
- All errors surfaced via `toast` + inline error state.

### 3. AdminPage wiring

In `src/pages/AdminPage.tsx`:
- Add new `<TabsTrigger value="local-signing">LOCAL SIGNING TEST</TabsTrigger>` (use `data-[state=active]:text-destructive` like the Recovery tab to signal it's a sensitive tool).
- Add `<TabsContent value="local-signing">` rendering `<LocalSigningTestTab launches={launches} adminWallet={publicKey!} />`.

## Security model

- Edge function requires admin wallet check via existing `is_admin_wallet` RPC (same pattern as `admin_list_launches`).
- `ESCROW_ENCRYPTION_KEY`, `SOLANA_RPC_URL`, `SUPABASE_SERVICE_ROLE_KEY` already exist as Supabase secrets — no new secrets needed.
- Browser never sees keypairs, secret keys, or the admin test token. The CLI's `ADMIN_TEST_TOKEN` gate is replaced by the wallet-based admin check, which is the standard pattern in this codebase.
- Edge function uses service role only for the launch read + `setLaunched` update on success — same access pattern as `execute-launch`.
- Live mode requires `status='executing'` (same guardrail as the CLI).

## Out of scope / unchanged

- `executor/src/launchWithLocalSigning.ts` is NOT modified.
- `executor/scripts/testLocalSigning.ts` CLI remains as the Railway-side fallback.
- `USE_LOCAL_SIGNING` env flag is NOT touched — this UI bypasses the worker entirely (same as the CLI).
- Existing Lightning launch flow is unaffected.

## Files

**New**
- `supabase/functions/test-local-signing/index.ts` — Deno port of `launchWithLocalSigning` with admin gating.
- `src/components/admin/LocalSigningTestTab.tsx` — UI panel.

**Modified**
- `src/pages/AdminPage.tsx` — add tab trigger + content.
- `supabase/config.toml` — register the new function (verify_jwt = true).

## Acceptance

1. Admin opens `/admin`, sees a new "LOCAL SIGNING TEST" tab.
2. Selecting a pumpfun launch + Dry run + Run shows tx size, both pubkeys, mint-match confirmation, and `[DRY RUN] Transaction ready — not submitted` in the log panel — with zero on-chain or DB side effects.
3. Selecting Live submit on an `executing` launch (after confirmation dialog) submits the tx, returns a Solscan link, and the launch row flips to `launched`.
4. Non-admin wallets cannot access the tab and the edge function returns 403 if called directly.