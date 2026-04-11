

# Full Build: 9 Fixes for Erys Platform (Revised)

## Corrections Applied

**Flag 1 — Keypair generation**: Use `Keypair.generate()` from `@solana/web3.js` in the create-launch edge function instead of `@noble/ed25519`. Already used elsewhere in the codebase, avoids adding a dependency.

**Flag 2 — ATA reserve before launch**: Do NOT silently skip contributors during token distribution. Instead, reserve SOL for ATA creation costs BEFORE the launch executes. Calculate `numContributors * 0.00203928 SOL` as the ATA reserve. Subtract it from `initialBuyLamports`. If the remaining amount is below 0.01 SOL, fail with a clear error. This guarantees every contributor gets their tokens.

---

## Fix 1: Replace all public Solana RPC with Alchemy

**Files:**
- `supabase/functions/contribute/index.ts` line 8 — replace hardcoded `SOLANA_RPC` with `Deno.env.get("SOLANA_RPC_URL")!`
- `src/pages/LaunchPage.tsx` line 77 — replace with `import.meta.env.VITE_SOLANA_RPC_URL`
- `.env` — add `VITE_SOLANA_RPC_URL`
- Add `SOLANA_RPC_URL` as Supabase secret (prompt user for Alchemy key)

---

## Fix 2: Dashboard nav link

**File:** `src/components/Navbar.tsx`
- Add `<Link to="/dashboard">` between "Schedule a Launch" and wallet button
- Only show when wallet is connected via `useWallet()` hook

---

## Fix 3: Create-launch edge function + Schedule page wiring

**New file:** `supabase/functions/create-launch/index.ts`
1. POST to Bags API `/token-launch/create-token-info` with token metadata
2. Generate escrow keypair via `Keypair.generate()` from `@solana/web3.js`
3. Encrypt private key with AES-256-GCM using `ESCROW_ENCRYPTION_KEY`
4. Insert into `launches` table with real escrow keys, token mint, status `scheduled`
5. Return launch ID and URL

**File:** `src/pages/SchedulePage.tsx`
- Replace direct Supabase insert with `supabase.functions.invoke("create-launch", { body: {...} })`
- Require wallet connection before submit

---

## Fix 4: Refund edge function

**New file:** `supabase/functions/refund-launch/index.ts`
- Verify launch status is `scheduled`, set to `cancelled`
- Decrypt escrow key, transfer SOL back to each contributor
- Record `refund_tx_signature` on each contribution

**DB migration:** Add `refund_tx_signature text` to `contributions`

**UI:** Cancel button on Dashboard "My Launches" tab for `scheduled` launches

---

## Fix 5: Creator minimum guarantees

**File:** `supabase/functions/execute-launch/index.ts`
- In basis points calc, identify creator from `launch.created_by_wallet`
- Fee share floor: max(proportional share, 750 BP out of 7500). Redistribute deficit among others
- Token distribution floor: max(proportional share, 5% of total tokens)

---

## Fix 6: ATA reserve + Token distribution in execute-launch

### ATA Reserve (BEFORE fee-share/config call)
Insert before the fee-share/config step (currently line ~154):
```
const ATA_COST_LAMPORTS = 2_039_280n; // 0.00203928 SOL
const ataReserve = ATA_COST_LAMPORTS * BigInt(filtered.length);
const netBuyLamports = allContribTotal - ataReserve;

if (netBuyLamports < 10_000_000n) { // 0.01 SOL minimum
  await setFailed(supabase, launch.id,
    `Insufficient SOL after ATA reserve. Total: ${allContribTotal}, Reserve: ${ataReserve}`);
  return errorResponse("Not enough SOL to cover ATA fees and minimum buy");
}
```
Use `netBuyLamports` as `initialBuyLamports` in the create-launch-transaction call instead of `allContribTotal`.

### Token distribution (AFTER launch confirms)
**DB migration — contributions columns:**
```sql
ALTER TABLE contributions
  ADD COLUMN IF NOT EXISTS token_amount bigint,
  ADD COLUMN IF NOT EXISTS tokens_distributed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS distribution_tx_signature text,
  ADD COLUMN IF NOT EXISTS distribution_error text;
```

**DB migration — launches columns:**
```sql
ALTER TABLE launches
  ADD COLUMN IF NOT EXISTS total_tokens_distributed bigint,
  ADD COLUMN IF NOT EXISTS distribution_completed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS distribution_completed_at timestamptz;
```

**Steps after `status: "launched"`:**
1. Read token balance via `getTokenAccountsByOwner` (retry 5x, 3s gaps) using `SOLANA_RPC_URL`
2. Calculate shares per contributor with creator 5% floor
3. For each contributor: derive ATA, create if needed (SOL reserved), transfer tokens, sign with escrow key
4. Update contribution records. On failure, log error and continue to next
5. Mark `distribution_completed` when all attempted

---

## Fix 7: Token links

- **DashboardPage:** "View on Bags" link per launched token → `https://bags.fm/token/{mint}`
- **LaunchPage:** "Trade on Bags" button for completed launches

---

## Fix 8: SOLANA_RPC_URL secret

- Add `SOLANA_RPC_URL` to Supabase secrets via tool
- Prompt user for Alchemy endpoint

---

## Fix 9: Dynamic embedded wallet config

**File:** `src/App.tsx`
- Add `embeddedWallets: { createOnLogin: 'users-without-wallets' }` to DynamicContextProvider settings

---

## Implementation order
1. Fix 1: Alchemy RPC everywhere
2. Fix 2: Dashboard nav link
3. Fix 8: Add SOLANA_RPC_URL secret
4. Fix 9: Dynamic embedded wallet config
5. DB migrations (contributions + launches columns)
6. Fix 3: create-launch edge function + Schedule page
7. Fix 4: Refund edge function
8. Fix 5: Creator minimum guarantees
9. Fix 6: ATA reserve + token distribution
10. Fix 7: Token links

