## Verification: local-signing path end-to-end

I traced the full lifecycle (create → execute → distribute → claim fees) against `launchWithLocalSigning.ts` and our PumpPortal `/trade-local` integration. **Three of the four invariants hold. One does NOT — fee claiming is broken for any launch executed via local signing.**

### 1. Launch creation via PumpPortal — OK

`launchWithLocalSigning` calls `https://pumpportal.fun/api/trade-local` with `action: "create"`, the metadata URI, mint pubkey, dev-buy amount, and `pool: "pump"`. PumpPortal returns unsigned tx bytes; we sign with `[mintKeypair, escrowKeypair]` and submit via our own RPC. This matches PumpPortal's documented Local Trading API. Confirmed.

### 2. Wallet ownership — OK, but different from Lightning path

| Role | Lightning path | Local-signing path |
|---|---|---|
| Initial buyer / dev wallet | PumpPortal custodial wallet | **Escrow wallet** (decrypted) |
| On-chain creator | PumpPortal custodial wallet | **Escrow wallet** |
| Tokens land in | Custodial ATA (then swept to escrow) | **Escrow ATA directly** |
| Mint authority | Mint keypair (signs create) | Mint keypair (signs create) |

This is actually simpler — no custodial sweep required, escrow already holds the tokens.

### 3. Token distribution to contributors — OK

`distribute.ts` reads the token balance from `escrow_wallet_encrypted_private_key`'s ATA and fans out to contributors (with the 5% creator floor enforced). Because local-signing buys directly into the escrow ATA, distribution works unchanged. Gas is paid from the escrow's residual SOL just like today.

### 4. Gas accounting on launch — OK

Same reserve math as `executePumpfun.ts`: `ataReserve = N * (ATA_COST + TX_FEE + PRIORITY_FEE_PER_CONTRIBUTOR)`, plus `PRIORITY_FEE`. Subtracted from pool before computing `initialBuyLamports`. Processing fee (`shouldChargeProcessingFee`) is charged escrow → treasury before the buy. Min 0.3 SOL pool → otherwise `cancelAndRefund`. All identical to production.

### 5. Creator fee claiming — BROKEN

This is the problem. Our fee-claim system in `distributor/src/claimPumpfunFeesBatch.ts` assumes the on-chain creator is one of the PumpPortal custodial wallets in the pool:

```text
distributor cycle:
  for each wallet in pumpportal pool:
    rows = claim_pumpfun_launches_batch_for_worker(p_wallet_pubkey = wallet.pubkey)
    vaultPda = PDA(["creator-vault", wallet.pubkey])  // <-- custodial, not escrow
    PumpPortal collectCreatorFee with that wallet's API key
    sweep wallet -> treasury
```

For a local-signing launch:
- `pumpportal_wallet_pubkey` is **never set** (we skipped `resolveLaunchWallet` / the `db.update`).
- The DB filter `pumpportal_wallet_pubkey IS NOT DISTINCT FROM p_wallet_pubkey` therefore **never matches** any pool wallet — these launches are silently skipped forever.
- Even if we hacked the filter, the creator vault PDA is derived from the **escrow** pubkey, not any custodial wallet. PumpPortal's `collectCreatorFee` is keyed by API-key → wallet, so no pool API key can claim it.
- The escrow keypair can sign, but PumpPortal does not expose `collectCreatorFee` for arbitrary externally-held wallets, and our own tooling has no path to call the on-chain `collect_creator_fee` instruction directly from the escrow.

**Net effect:** every coin launched via the local-signing path will accrue creator fees into a PDA we control (escrow is creator) but never sweeps them. Funds are recoverable later but not by current code.

### 6. Other invariants — verified

- Escrow encryption: AES-256-GCM, `ESCROW_ENCRYPTION_KEY`, decrypted only in executor process. Local-signing uses identical `decryptEscrowKey` helper. OK.
- Contribution flow / on-chain tx verification: unchanged (uses production `contribute` edge function from the admin form). OK.
- 5% creator-token floor: enforced in `distribute.ts` against `created_by_wallet`. OK — admin form already passes this.
- Status transitions: `scheduled → executing → launched | execution_failed | cancelled`. Local signing calls `setLaunched` / `setFailed` / `cancelAndRefund` exactly like Lightning path. OK.
- Worker locking via `claim_executing_launch_for_worker` + `releaseLaunchLock`. OK.

## Required fix before testing on mainnet

Add a creator-fee claim path for local-signing launches. Two viable options — pick one:

**Option A (recommended): direct on-chain `collect_creator_fee` call.**
Build the Pump.fun `collect_creator_fee` instruction in `claimPumpfunFees.ts`, signed by the escrow keypair (decrypted with `decryptEscrowKey`). PDA: `["creator-vault", escrowPubkey]`. Sweep proceeds escrow → treasury. Add a new worker claim function (`claim_pumpfun_local_signing_launches_batch_for_worker`) that filters `pumpportal_wallet_pubkey IS NULL AND platform='pumpfun' AND status='launched'`. Same throttle / empty-claim / vault-balance gates as the existing path.

**Option B: assign a pool wallet as creator at launch time.**
Add the custodial wallet as a co-signer on the create+buy tx so it appears as creator on-chain, and stash `pumpportal_wallet_pubkey` on the row. The existing batch claim path then works unchanged. Costs one extra signature and adds funding pressure on the pool, but reuses everything.

I recommend **Option A** — it keeps the local-signing path self-contained (the whole point of removing the custodial dependency) and only touches the distributor.

## What I will build (Option A)

1. **DB migration** — new RPC `claim_local_signing_pumpfun_launches_batch_for_worker(p_worker_id, p_limit, p_lock_expiry_seconds)` that selects `platform='pumpfun' AND status='launched' AND pumpportal_wallet_pubkey IS NULL` with the same throttle / empty-claim / lock semantics.

2. **`distributor/src/claimLocalSigningFees.ts`** — new module:
   - decrypts escrow key per launch
   - peeks `creator-vault` PDA balance, applies the same `PUMPFUN_MIN_CLAIM_LAMPORTS` gate
   - constructs and signs the on-chain `collect_creator_fee` instruction with the escrow keypair
   - sweeps `escrow → treasury` minus rent floor + tx fee
   - records via existing `recordPumpfunFeeTreasurySweep` / `recordPumpfunEmptyClaim` / `recordPumpfunFeeClaimFailure`

3. **`distributor/src/index.ts`** — also call the new claim path inside `pollAndClaimFees()` after the existing pool batch.

4. **Smoke test in admin** — once deployed, schedule a small (0.3 SOL) launch from the LOCAL SIGNING TEST tab, confirm:
   - launch executes via Railway (`USE_LOCAL_SIGNING=true`)
   - tokens distribute to contributors (existing flow)
   - creator fees accrue and the new claim job sweeps them to treasury

No env vars need to be added; everything reuses `SOLANA_RPC_URL`, `BAGS_PARTNER_WALLET`, `ESCROW_ENCRYPTION_KEY`.

Approve to switch to default mode and implement.