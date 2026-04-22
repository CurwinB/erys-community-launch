

# Sponsored launch system for influencer campaigns

Erys creates a sponsored slot in the admin dashboard, sends the influencer a unique link to fill in their token details, and automatically seeds the escrow with 0.1 SOL from the platform wallet (`ERYS_PLATFORM_PRIVATE_KEY`). The community sees a normal Pump.fun launch with an early seed already in the pool.

## Database changes (migration tool)

1. Extend `launch_status` enum with `'sponsor_pending'`.
2. Add to `public.launches`:
   - `is_sponsored boolean DEFAULT false`
   - `sponsored_by text` (e.g. `'erys_platform'`)
   - `sponsored_amount_lamports bigint DEFAULT 0`
   - `sponsored_tx_signature text`
   - `sponsor_link_token text UNIQUE`
   - `sponsor_link_expires_at timestamptz`
   - `sponsor_link_claimed_at timestamptz`
3. Index on `sponsor_link_token` (auto from UNIQUE) and partial index on `(status) WHERE status='sponsor_pending'`.
4. Add a public RPC `get_sponsor_slot_by_token(p_token text)` (`SECURITY DEFINER`, `STABLE`) returning only the safe fields needed by `/sponsored/:linkToken` (launch_datetime, sponsor_link_expires_at, status, sponsored_amount_lamports). This avoids exposing encrypted-key columns and lets the page resolve the slot without RLS gymnastics.
5. Schedule pg_cron job `expire-sponsored-slots` (every 10 min) that flips expired `sponsor_pending` rows to `cancelled` (uses Supabase insert tool, not migration, since it touches cron schema).

## Edge functions (new)

### `supabase/functions/create-sponsored-slot/index.ts`
- Admin-only. Validates that the caller wallet is in `admin_wallets` via `is_admin_wallet` RPC.
- Body: `{ admin_wallet, influencer_wallet, launch_datetime }`.
- Validates `launch_datetime` is 1–72h from now.
- Generates a 32-char random link token (`crypto.randomUUID().replace(/-/g,'')`).
- `expires_at = min(now + 48h, launch_datetime - 1h)`.
- Inserts placeholder launch row: `status='sponsor_pending'`, `is_sponsored=true`, `sponsored_by='erys_platform'`, `sponsored_amount_lamports=100_000_000`, `created_by_wallet=influencer_wallet`, `platform='pumpfun'`, placeholder `token_name='PENDING'`, `token_symbol='PENDING'`, `min_contribution_lamports=10_000_000`, plus dummy non-null `escrow_wallet_public_key='PENDING'` and `escrow_wallet_encrypted_private_key='PENDING'` (replaced on claim).
- Returns `{ launch_id, sponsor_link, expires_at }` where `sponsor_link` is built from a new secret `SITE_URL` (default `https://erys.live`).

### `supabase/functions/claim-sponsored-slot/index.ts`
- Public (no admin check; the link token IS the auth).
- Body: `{ link_token, token_name, token_symbol, description, image_url, twitter_url, telegram_url, website_url }`.
- Looks up launch by `sponsor_link_token` + `status='sponsor_pending'`. 404 if missing.
- If `sponsor_link_expires_at < now()`, sets status `cancelled` and returns 410.
- Builds metadata JSON, uploads to `token-metadata` storage bucket, verifies HEAD 200.
- Generates escrow + mint Ed25519 keypairs (reusing the helpers from `create-launch-pumpfun`: `generateSolanaKeypair`, `encryptKey`, `uint8ArrayToHex`, `hexToUint8Array`, `base58Encode`).
- Encrypts both with `ESCROW_ENCRYPTION_KEY` (AES-256-GCM, existing format).
- Funds the escrow: imports `Keypair`, `Transaction`, `SystemProgram`, `PublicKey` from `@solana/web3.js@1.91.1` and `bs58` from `npm:bs58@5`. Decodes `ERYS_PLATFORM_PRIVATE_KEY` via `bs58.decode` (matches existing `claim-partner-fees` pattern), fetches latest blockhash via `SOLANA_RPC_URL`, builds and signs a SystemProgram.transfer of `100_000_000 - 5_000` lamports to the new escrow public key, submits via `sendTransaction` RPC, captures the signature.
- Updates the launch row with all real values: token fields, image/socials, `ipfs_metadata_url`, `token_mint_address`, real `escrow_wallet_public_key`, real `escrow_wallet_encrypted_private_key`, `pumpfun_mint_keypair_encrypted`, `sponsored_tx_signature`, `sponsor_link_claimed_at=now()`, `status='scheduled'`.
- Returns `{ launch_id, launch_url, mint_address }`.

Both functions: standard CORS headers, set `verify_jwt = false` in `supabase/config.toml`.

## Frontend

### New page `src/pages/SponsoredPage.tsx` at route `/sponsored/:linkToken`
- On mount, calls the `get_sponsor_slot_by_token` RPC. Renders one of three states:
  - **Not found / claimed / expired** — error card with link back to home.
  - **Form** — branded "You have been selected for an Erys sponsored launch" header showing launch time + link expiry countdown; form with Token Name, Token Symbol, Description, Image upload (uploads to `token-images` bucket first, gets public URL), Twitter, Telegram, Website. No platform toggle, no launch time picker, no min-contribution field. Submit calls `claim-sponsored-slot` edge function.
  - **Success** — "Your launch is scheduled" card with launch URL, copy button, and tweet button. Tweet text: `I just scheduled a community token launch on @eryslive via Pump.fun.\n\nGet in before it goes live and secure your early position.\n\n{launch_url}`.
- Styled with existing Erys brand: dark bg, cyan accent, sharp edges, JetBrains Mono for the countdown.

### New `src/components/admin/SponsoredTab.tsx`
- **Create form**: influencer wallet input + datetime picker (validated 1–72h ahead) + "Create Sponsored Slot" button. On success shows the generated link + copy button + expiry timestamp.
- **Active slots table**: filters launches by `is_sponsored=true`, columns: Influencer Wallet, Status (color-coded badge: amber `sponsor_pending` → "Awaiting Details", cyan `scheduled` → "Ready", blue `executing`, green `launched`, red `cancelled`), Launch Time, Link Expires, Claimed At, Token symbol, Actions (copy link for pending, view launch for scheduled+, cancel for pending).
- Cancel action: edge function call (or direct service-role RPC) flips status to `cancelled`. To keep things simple and consistent with security posture, add a tiny `cancel-sponsored-slot` function that verifies admin and updates the row.

### `src/pages/AdminPage.tsx`
- Add a 7th tab `Sponsored` between Recovery and the end. Filter launches list to `is_sponsored=true` and pass to `SponsoredTab`.

### `src/lib/constants.ts`
- Add the new public columns (`is_sponsored`, `sponsored_by`, `sponsored_amount_lamports`, `sponsored_tx_signature`, `sponsor_link_token`, `sponsor_link_expires_at`, `sponsor_link_claimed_at`) to `LAUNCH_PUBLIC_COLUMNS` so admin queries return them.

### `src/App.tsx`
- Add `<Route path="/sponsored/:linkToken" element={<SponsoredPage />} />`.
- Update `ConditionalNavbar` to also hide the navbar on `/sponsored/*` (cleaner branded experience), or keep navbar — I'll keep the navbar for consistency.

## Status badge
- Extend `src/components/StatusBadge.tsx` `statusConfig` with `sponsor_pending: { label: "Awaiting Details", className: "border-amber-500/50 bg-amber-500/10 text-amber-400" }` and update its TS union.

## Secrets
- New: `SITE_URL = https://erys.live` (used by `create-sponsored-slot` to build the sponsor link).
- Reused: `ERYS_PLATFORM_PRIVATE_KEY`, `SOLANA_RPC_URL`, `ESCROW_ENCRYPTION_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Out of scope
- No Railway worker changes — existing `claim_executing_launch_for_worker` already picks up `scheduled` → `executing` → `launched` flow, which sponsored launches enter once claimed.
- No changes to distribution math: the 0.1 SOL Erys seed sits in the escrow as raw SOL, gets contributed to Pump.fun like any other balance, and the resulting tokens flow through normal proportional distribution. Erys's escrow-side share is not refundable (it's a real on-chain seed).
- No changes to `executeBags`/`executePumpfun` business logic.
- No frontend wallet connection required for the influencer — the link token is the only credential.

## Files created
- `supabase/functions/create-sponsored-slot/index.ts`
- `supabase/functions/claim-sponsored-slot/index.ts`
- `supabase/functions/cancel-sponsored-slot/index.ts`
- `src/pages/SponsoredPage.tsx`
- `src/components/admin/SponsoredTab.tsx`

## Files edited
- `src/App.tsx` (route)
- `src/pages/AdminPage.tsx` (new tab)
- `src/lib/constants.ts` (new columns)
- `src/components/StatusBadge.tsx` (new status)
- `supabase/config.toml` (verify_jwt for new functions)

