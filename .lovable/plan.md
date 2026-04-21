

# Add Pump.fun as Second Launch Platform

Adds Pump.fun alongside Bags.fm as a launch platform option. Creators choose at scheduling. Contribution flow, escrow, and token distribution are identical — only execution and post-launch fees differ.

## 1. Database migration

Add to `launches` table:
- `platform text NOT NULL DEFAULT 'bags'` with CHECK constraint (`bags`, `pumpfun`)
- `pumpfun_mint_keypair_encrypted text` — encrypted mint keypair (the token CA)
- `pumpfun_fees_last_claimed_at timestamptz`
- `pumpfun_fees_claimed_total bigint DEFAULT 0`
- `pumpfun_creator_fees_distributed bigint DEFAULT 0`

## 2. Storage bucket

Create public `token-metadata` bucket with public-read RLS policies (mirrors `token-images`). Holds JSON metadata files for Pump.fun tokens.

## 3. New edge function: `create-launch-pumpfun`

`supabase/functions/create-launch-pumpfun/index.ts` — same input shape as `create-launch`. Sequence:
1. Validate required fields including `created_by_wallet`
2. Build metadata JSON (`name`, `symbol`, `description`, `image`, `twitter`, `telegram`, `website`), upload as `{uuid}.json` to `token-metadata` bucket, get public URL
3. Generate two Ed25519 keypairs via Web Crypto: escrow + mint
4. AES-256-GCM encrypt both private keys with `ESCROW_ENCRYPTION_KEY` (format `iv:authTag:ciphertext` — same as `create-launch`)
5. Insert into `launches` with `platform='pumpfun'`, both keypair fields, `ipfs_metadata_url` = JSON URL, `token_mint_address` = mint pubkey (known up front), `status='scheduled'`
6. Return `launch_id` and shareable URL

Reuses base58 encoding and AES-GCM helpers from existing `create-launch/index.ts`.

## 4. Update `execute-launch`

Add platform routing right after fetching the launch (before the existing Bags logic):
```
if (launch.platform === 'pumpfun') {
  return await executePumpfunLaunch(launch, supabase, ESCROW_ENCRYPTION_KEY)
}
```

New `executePumpfunLaunch` function in same file:
- Decrypt escrow + mint private keys
- Fetch contributions, set status `executing`, increment `execution_attempts`
- Sum total lamports (no ATA reserve — full amount goes into initial buy since founders receive tokens, not fee shares)
- Pre-calculate proportional `token_amount` per contribution (as basis points out of 10000) for Railway distributor
- POST to `https://pumpportal.fun/api/trade-local`:
  ```
  { publicKey: escrow_wallet_public_key, action: "create",
    tokenMetadata: { name, symbol, uri: ipfs_metadata_url },
    mint: token_mint_address, denominatedInSol: "true",
    amount: totalLamports / 1e9, slippage: 15,
    priorityFee: 0.00005, pool: "pump" }
  ```
- Response is a serialized transaction (ArrayBuffer)
- Sign server-side with both decrypted keypairs (Ed25519 via Web Crypto). Build `VersionedTransaction.deserialize → sign(escrow, mint) → serialize`. Will use `@solana/web3.js` via `https://esm.sh/@solana/web3.js@1.91.1` and bs58 for keypair recovery (same approach as Bags signing path)
- Submit base64 to Alchemy RPC (`SOLANA_RPC_URL` secret) via `sendTransaction`
- On success set `status='launched'`; on failure call `setFailed`

No new secrets needed. Uses existing `ESCROW_ENCRYPTION_KEY` and `SOLANA_RPC_URL`.

## 5. Schedule page (`src/pages/SchedulePage.tsx`)

Add platform toggle above form fields:
- Two-button toggle: "Launch on Bags.fm" / "Launch on Pump.fm"
- Conditional description text below toggle:
  - Bags: "Contributors earn permanent on-chain trading fee shares proportional to their contribution."
  - Pump.fun: "Contributors receive tokens at the earliest possible entry price. Higher liquidity and trading volume."
- On submit, call `create-launch` if `bags`, `create-launch-pumpfun` if `pumpfun`
- Update info banner near bottom to reflect chosen platform

## 6. Launch cards (`src/components/LaunchCard.tsx`)

- Accept new `platform` prop
- Add platform badge in card header next to token name:
  - Pump.fun: green `#00FF88` styled badge
  - Bags: primary cyan styled badge
- Pass `platform` from `Index.tsx` and any other consumer

## 7. Launch page (`src/pages/LaunchPage.tsx` + `LaunchHeader.tsx`)

- Add `platform` to `LaunchHeader` interface; render badge next to status badge
- Conditional trade URL: `pump.fun/{mint}` for Pump.fun, `bags.fm/token/{mint}` for Bags
- Update "Trade on …" button label and footer "This token will be launched on …" line

## 8. Dashboard (`src/pages/DashboardPage.tsx`)

**My Contributions tab:**
- For Pump.fun launches that are launched: replace claim button with text: "Early entry position. Fees distributed to creator."
- View link → `pump.fun/{mint}` for Pump.fun launches

**My Launches tab:**
- Trade button uses conditional URL based on `l.platform`

## 9. Homepage hero copy

Light wording update in `Index.tsx` hero/feature cards to acknowledge dual platforms ("Launch on Bags.fm or Pump.fun") without overhauling the page.

## What we are NOT building (Railway will handle)

- Pump.fun creator fee claiming job (`collectCreatorFee` polling, 50/50 platform split, SOL transfer to creator)
- Token distribution loop is already platform-agnostic in the distributor

## Implementation order

1. Migration → 2. Storage bucket → 3. `create-launch-pumpfun` → 4. `execute-launch` routing → 5. Schedule page → 6. LaunchCard → 7. LaunchPage + Header → 8. Dashboard → 9. Hero copy

## Technical notes

- Ed25519 signing in Deno: import `@solana/web3.js` from esm.sh, reconstruct `Keypair.fromSecretKey(decryptedBytes)`, deserialize the PumpPortal-returned `VersionedTransaction`, call `.sign([escrowKeypair, mintKeypair])`, base64 the serialized output, submit via Alchemy `sendTransaction` RPC
- Decryption returns hex of 64-byte Solana secret key (matches `create-launch` encryption format)
- Pump.fun mint address is known at scheduling time (mint keypair generated up front), unlike Bags where it comes from the launch transaction response
- All existing Bags-platform code paths remain unchanged; `platform` defaults to `'bags'` for existing rows

