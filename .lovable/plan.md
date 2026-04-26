# Why metadata isn't showing in the wallet dropdown

## What I confirmed in the database

Wallet `BvpGuDSLDafZXSDeokapirQqiPshocaMFHG5N46c9rxV` **did receive its tokens**:

| Field | Value |
|---|---|
| Launch | ETEST (`9caf31b8…`) — status `launched`, `distribution_completed = true` |
| Mint | `JAQch38sjEK752q98NVMWMbmNuuZsjoENHVYc9b8Ceay` (Token-2022) |
| Tokens distributed to BvpGuD… | `3,038,710,024,059` base units |
| Distribution tx | `4sS6gknmh7T8Y7jWbNfQdAGARKmd6kJKkXid45zn1tHdsk1BGXX3ou2mLsYtdv4sqnuhNjLrrcnNMvDJe4m5vWjn` |

The IPFS metadata is also fine — `https://ipfs.io/ipfs/bafkreiao…` returns the proper `{ name, symbol, image, description }` JSON, and Pump.fun set the on-chain Token-2022 metadata extension to point at it. External wallets (Phantom, Solflare) will display the name + image once their indexers pick it up.

## The actual bug — `src/components/WalletDropdown.tsx`

Pump.fun mints are owned by the **Token-2022 program**, not the legacy SPL Token program. Token-2022 ATAs are derived with the Token-2022 program id as part of the seed, which produces a **different address** from the legacy ATA.

`WalletDropdown.tsx` hardcodes the legacy program everywhere it touches a token:

- **Line 133** — `getAssociatedTokenAddress(mintPubkey, walletPubkey)` defaults to `TOKEN_PROGRAM_ID`. For ETEST this returns the wrong ATA, `getAccountInfo` returns `null`, the balance stays `0n`, and the token gets filtered out by `tokens.filter(t => t.balance > 0n)` → **"No Erys tokens yet"** even though the user owns 3T base units.
- **Lines 260–261** — same wrong derivation in `handleSendToken` for `fromAta`/`toAta`.
- **Line 294** — `createTransferInstruction(..., TOKEN_PROGRAM_ID)` hardcodes legacy. A Token-2022 transfer must use the Token-2022 program id; otherwise the instruction errors out at preflight.
- **Line 374** — same wrong derivation in the recipient-ATA-exists check (recipient would always look "missing", and even if ATA creation ran it'd create the wrong one).

This is the same Token-2022 vs. legacy SPL bug we already fixed in the executor (`pumpportalCustodial.ts`) and distributor (`distributor/src/distribute.ts`). The frontend was missed.

## Plan

### 1. Token-2022-aware helper in `WalletDropdown.tsx`

Add a small helper that fetches the mint account once and resolves the right token program:

```ts
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ... } from "@solana/spl-token";

async function getMintTokenProgram(mint: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`Mint ${mint.toBase58()} not found`);
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  throw new Error(`Unsupported token program ${info.owner.toBase58()}`);
}
```

Cache the result per mint inside `loadBalances` so we don't re-fetch on every render.

### 2. Fix `loadBalances` (line 129–147)

For each token, look up the program id, then:
- `getAssociatedTokenAddress(mint, owner, false, programId)`
- `getParsedAccountInfo(ata)` — the parser already understands Token-2022 accounts, so balance + decimals continue to work.

Also store `programId` on the `ErysToken` shape so the send flow can reuse it.

### 3. Fix `handleSendToken` (lines 234–341)

- Use the stored `programId` (or re-derive) for both `fromAta` and `toAta`.
- Pass `programId` as the 4th arg to `getAssociatedTokenAddress`.
- Pass `programId` to `createAssociatedTokenAccountInstruction` (5th arg).
- Pass `programId` to `createTransferInstruction` (last arg) — replacing the hardcoded `TOKEN_PROGRAM_ID` on line 294.

Note: amount math should switch to passing the `bigint` directly (current code does `Number(amount)` which loses precision above 2^53). Out of scope for this bug, but worth flagging — happy to fix in the same change if you want.

### 4. Fix the recipient-ATA preview check (lines 364–383)

Same fix: derive ATA using the mint's program id before `getAccountInfo`.

### 5. No backend / RPC changes needed

The data is already correct on-chain and in the DB. This is a pure frontend display + send-flow fix.

## Files touched
- `src/components/WalletDropdown.tsx` (single file)

## What the user will see after the fix
- Reopening the wallet dropdown shows **Erys test (ETEST)** with the correct balance and the IPFS image (because we already store `image_url` on the launch row and pass it through).
- "Send" works for the ETEST token (and any future Pump.fun-launched token).
- Bags-launched tokens, which are legacy SPL, continue to work because the helper falls through to `TOKEN_PROGRAM_ID`.

## Out of scope (separate concerns)
- External wallets (Phantom/Solflare) showing the token name+image is **not our code path** — that's their indexer reading the Token-2022 metadata extension, which is already set correctly by Pump.fun. Usually appears within minutes; can take longer for fresh mints. No action on our side.
- The `Number(amount)` precision issue in send — not blocking the reported bug; can be folded in if you want.
