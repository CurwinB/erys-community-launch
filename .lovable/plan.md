## Diagnosis recap (confirmed)

The new observability code captured the real PumpPortal error from launch `c2e13da7…`:

> `PumpPortal create failed (400): Cannot read properties of undefined (reading 'toBuffer') | Bad Request`

Reproducing the exact request — and even reproducing PumpPortal's own example payload verbatim — both crash with the **same `toBuffer` server-side stack trace**. A `buy` action against the same endpoint works fine (returns a coherent error). **The `/api/trade-local` `create` action is broken on PumpPortal's side for everyone right now.** No payload change on our end can fix this. The Lightning endpoint (`/api/trade`) lives on a different code path and responds normally (auth-rejects cleanly, no crash), so it's a viable alternative.

You picked **Lightning API migration**. Here's exactly what changes.

---

## Architectural impact

PumpPortal Lightning signs and sends transactions with **their custodial wallet**, identified by `PUMPPORTAL_API_KEY`. That custodial wallet — not our per-launch escrow — becomes:
- the on-chain **token creator** (so creator fees accrue to it, not to escrow)
- the recipient of the **initial buy tokens** (so the dev-buy supply lands in PumpPortal custody, not in escrow)

This breaks two existing flows unless we add sweeps:
1. **Distributor** (`distributor/src/distribute.ts`) reads escrow's token ATA and distributes from there → would find 0 tokens.
2. **Fee claimer** (`distributor/src/claimPumpfunFees.ts`) currently calls `collectCreatorFee` Local with escrow as signer → that wouldn't work because escrow isn't the creator anymore.

We solve both with two sweeps after each Lightning call.

---

## Required new secrets

I'll add one runtime secret to Supabase:

- **`PUMPPORTAL_API_KEY`** — generated at https://pumpportal.fun by clicking "Create Wallet & API Key". This generates a custodial wallet + linked API key.

You'll also need to **fund the custodial wallet** with a small SOL float (recommend ~0.1 SOL kept topped up) for tx fees on the create + sweep transactions. PumpPortal collects the launch SOL spend separately from the API call. The custodial wallet's address is shown to you when you create the key — I'll add it as a second secret `PUMPPORTAL_CUSTODIAL_WALLET` so the executor can verify balances and log it for monitoring.

Both secrets are runtime-only (used inside the executor and one edge function); never exposed to the browser.

---

## Code changes

### 1. New executor module: `executor/src/executePumpfunLightning.ts`

Replaces the broken Local create flow. Steps inside `executePumpfunLaunch`:

1. **Pre-flight checks** (unchanged): decrypt escrow, validate mint keypair, sum contributions, calculate ATA reserves and `initialBuyLamports`, store basis points.
2. **Fund PumpPortal custodial wallet** — single SystemProgram.transfer from escrow → PumpPortal custodial wallet for `initialBuyLamports + sweep_buffer` (~0.005 SOL extra for the post-create sweeps PumpPortal will charge fees on). Signed by escrow; we wait for confirmation. This replaces the role escrow used to play as fee payer + initial buyer.
3. **Call Lightning create** — `POST https://pumpportal.fun/api/trade?api-key=…` with body:
   ```json
   {
     "action": "create",
     "tokenMetadata": { "name", "symbol", "uri": ipfs_metadata_url },
     "mint": "<bs58 of mint SECRET key>",
     "denominatedInSol": "true",
     "amount": <initialBuyLamports / 1e9>,
     "slippage": 15,
     "priorityFee": 0.00005,
     "pool": "pump"
   }
   ```
   Note: Lightning expects `mint` as the **bs58-encoded mint secret key** (per official example), not the public key. PumpPortal needs the secret to sign the create instruction.
4. **Parse response** — Lightning returns `{ signature: "..." }` on success or `{ errors: [...] }` on failure. On failure: refund the custodial-wallet float (sweep SOL back), call `setFailed` with the real error, return.
5. **Sweep tokens custodial → escrow ATA** — call Lightning `transfer` action (or PumpPortal's withdraw endpoint, see step 5b below) to move 100% of newly minted dev-buy tokens from the custodial wallet to the escrow's ATA. We keep all downstream distribution logic identical.
6. **Sweep residual SOL custodial → escrow** — pull any leftover SOL (priority-fee dust, unused buffer) back so we don't bleed funds across many launches. Leave a small floor (~0.002 SOL) so the custodial wallet stays rent-exempt for next launch.
7. **`setLaunched(launch.id, txSignature)`** — same as today. Distributor picks it up next poll, sees tokens in escrow ATA, distributes per `basis_points` exactly as it does for Bags.

> **5b — withdraw mechanics:** PumpPortal Lightning supports an `action: "transfer"` on the same `/api/trade` endpoint for moving tokens out of the custodial wallet, plus a SOL withdraw via `https://pumpportal.fun/api/withdraw`. I'll wrap both in helpers (`sweepTokens`, `sweepSol`) and verify against the docs at implementation time. If the documented withdraw doesn't cover SPL tokens, the fallback is to re-derive the custodial keypair via the API (PumpPortal does NOT expose this), so the actual mechanism will be Lightning's `sell 100%` if needed — but that defeats the purpose. The cleanest path is the documented `transfer` action; I'll confirm during implementation and adapt before shipping.

### 2. Updated `executor/src/executeLaunch.ts`

Tiny dispatch tweak: route `platform === "pumpfun"` to `executePumpfunLightning.ts` instead of the existing `executePumpfun.ts`. Keep the old file in place for one release as a safety rollback (renamed `executePumpfunLocal.ts.bak` or just unreferenced) — easy to revert if Lightning surprises us.

### 3. Updated `distributor/src/claimPumpfunFees.ts`

Today: signs `collectCreatorFee` with escrow keypair via Local API. After migration, escrow is no longer the creator — the custodial wallet is. New flow:

1. Call Lightning `POST /api/trade?api-key=…` with `{ "action": "collectCreatorFee", "mint": <token_mint_address>, "priorityFee": 0.00005, "pool": "pump" }`. PumpPortal sweeps the fees into the custodial wallet.
2. Read custodial wallet SOL balance delta to know how much was claimed.
3. Call PumpPortal withdraw (or fall back to a Lightning SOL transfer action) to move the claimed SOL into the escrow wallet.
4. Existing logic from line 120 onward (split 50/50 platform vs. creator, `SystemProgram.transfer` from escrow to each, stamp DB) runs unchanged. Escrow is back to being the source of truth for SOL math.

### 4. No DB migration required

We already store everything we need (`token_mint_address`, `escrow_wallet_public_key`, `pumpfun_*` fee-tracking columns). The custodial wallet doesn't need a per-launch column — it's a single shared platform wallet.

### 5. Admin observability

Add a tiny indicator on the `RecoveryTab` / `LaunchesTab` admin UI showing PumpPortal custodial wallet balance (read-only via Helius RPC), so you notice if it dries up before launches start failing. One small fetch in an existing tab — no new pages.

---

## What stays exactly the same

- ✅ Creator fees still enabled (every Pump.fun token gets them automatically — set by the bonding curve program on `create`, not by us)
- ✅ Erys still gets 50% of creator fees (we sweep them back to escrow before splitting)
- ✅ Original creator wallet still gets 50% (same SystemProgram.transfer logic)
- ✅ Contributors still receive their proportional token share (we sweep dev-buy tokens back to escrow before distribution runs)
- ✅ Escrow wallet remains the canonical record-keeping wallet on-chain
- ✅ Bags launches completely unaffected (different code path)
- ✅ Refund flow for failed Pump.fun launches unchanged (still returns SOL from escrow to contributors via `refundFailedLaunch.ts`)

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| PumpPortal Lightning has rate limits | Lightning advertises ≤1s latency; we run launches one at a time, claims at most every 10 min. Well below any reasonable limit. |
| Custodial wallet runs out of SOL | Step 2 funds it per-launch from escrow. Plus admin UI balance widget. |
| Sweep-tokens step fails after create succeeds | We mark launch `launched` only AFTER the sweep confirms. If sweep fails, status stays `executing` and the existing worker retry loop reclaims it. Tokens aren't lost — they're sitting in custodial wallet awaiting next sweep attempt. |
| Lightning `create` also breaks someday | Old Local code preserved as `.bak` for one-flag rollback. Longer-term option C (direct Pump.fun program calls) remains on the table if PumpPortal proves unreliable. |
| `mint` field semantics differ between Local and Lightning | Lightning needs bs58 secret key; we already store the encrypted secret. New code decrypts and bs58-encodes — straightforward. |

---

## Files to be touched

- **Add secret:** `PUMPPORTAL_API_KEY` (and `PUMPPORTAL_CUSTODIAL_WALLET` for monitoring)
- **New:** `executor/src/executePumpfunLightning.ts`
- **Edit:** `executor/src/executeLaunch.ts` — route pumpfun to Lightning
- **Edit:** `executor/.env.example` — document new env vars
- **Edit:** `distributor/src/claimPumpfunFees.ts` — switch to Lightning collect + sweep
- **Edit:** `distributor/.env.example` — document new env vars
- **Edit (small):** `src/components/admin/RecoveryTab.tsx` or `LaunchesTab.tsx` — add custodial-wallet balance widget
- **No DB migration**

After approval, the secret-add step happens first (you'll get a prompt to paste the API key from pumpportal.fun), and then code rolls out.