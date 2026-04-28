I understand the frustration. The last Bags launch failed at the same place as several earlier ones: Bags accepted metadata creation and fee-share config, but `createLaunchTransaction` returned a Bags-side 500 (`{"success":false,"response":"Internal server error"}`). Bags is now paused via the admin toggle, so users will not keep hitting this while we fix the execution path.

The current code is close in ordering, but it also contains custom workarounds that do not mirror the official Bags guide. The safest next move is to remove those assumptions and make our Bags executor match Bags’ documented TypeScript flow as literally as possible.

## What went wrong

Recent Bags failures show this pattern:

```text
1. createTokenInfoAndMetadata succeeded
2. fee-share/config succeeded and returned a configKey
3. createLaunchTransaction failed with Bags 500
```

The latest failed launch:

```text
launch: 750c96d7-e5b7-4f3c-90d2-0efb80e408cb
mint: 4FGo4Xtu6m4XGds7kkwjonAxKoJs4wkQt9zUQvkqBAGS
configKey: G6fACH6bo2M3iFqnxDtqbCwAwkbkt1NJAuEJT9zwT9AE
metadata: https://ipfs.io/ipfs/QmbMFWsDred5aDYAFLTvUENf6XE5zKB4GL2k3FXuowDLPV
error: createLaunchTransaction failed ... Request failed with status 500
```

This means the issue is not the schedule page, not contribution insertion, and not metadata being skipped. The failure is specifically in the Bags launch-transaction build call after the fee-share config is made.

## Confirmed mismatches from Bags docs

I compared `executor/src/executeBags.ts` to the official Bags launch guide and API reference. These are the concrete mismatches I will correct:

1. **SDK commitment**
   - Bags docs instantiate the SDK with `"processed"`.
   - Our code uses `"confirmed"`.
   - I will change Bags execution to use `"processed"` exactly like the docs.

2. **Lookup table call payload**
   - Bags docs call `getConfigCreationLookupTableTransactions({ payer, baseMint, feeClaimers })`.
   - Our code currently passes `payer` and `feeClaimers`, but not `baseMint`.
   - I will add `baseMint: tokenMint` so LUT creation matches the docs.

3. **Fee-share config creation path**
   - Bags docs use `sdk.config.createBagsFeeShareConfig(...)`.
   - Our code bypasses that with a manual REST `/fee-share/config` call.
   - I will refactor the primary path to use the SDK method exactly like Bags’ guide, including `payer`, `baseMint`, `feeClaimers`, `partner`, `partnerConfig`, and `additionalLookupTables`.

4. **Bundle sending**
   - Bags docs send bundle transactions via Jito using `createTipTransaction(...)` and `sendBundleAndConfirm(...)`.
   - Our code sends bundle transactions one by one with normal RPC.
   - I will add the documented `sendBundleWithTip(...)` helper and use it for fee-share bundles.

5. **Transaction sending helper**
   - Bags docs use `signAndSendTransaction(...)` for normal LUT/config/launch transactions.
   - Our code uses custom HTTP polling senders.
   - I will make the primary Bags path use the SDK helper. I will keep our custom HTTP sender only as a fallback if our RPC does not support the SDK confirmation method, but the default path will mirror Bags first.

6. **Creator handling**
   - Bags docs say the creator must always be explicitly included in `feeClaimers` with BPS, and if no extra fee claimers exist, creator gets `10000` BPS.
   - Our current “creator” is the largest contributor, not necessarily the launch creator / launch wallet.
   - I will update the Bags fee-claimer model so the launch wallet is explicitly included first as creator. Since Erys community launches share fees with contributors, contributor fee claimers will receive the remaining BPS, while creator BPS remains explicit and total still equals exactly `10000`.

7. **Field validation before Bags calls**
   - Bags requires: name <= 32, symbol <= 10, description non-empty <= 1000, and a valid image URL or image file.
   - I will add a strict preflight validator before calling Bags so we fail locally with a clear error instead of sending a payload Bags may reject opaquely.

8. **No metadata URL rewriting**
   - We already corrected this: the executor passes `tokenInfo.tokenMetadata` verbatim to `createLaunchTransaction`.
   - I will keep that unchanged.

## Implementation plan

### 1. Pause protection stays active
- Keep Bags disabled in `app_settings` until the refactor is complete and we intentionally re-enable it from admin.
- Do not affect Pump.fun launches.

### 2. Refactor `executor/src/executeBags.ts` to official Bags flow
The new execution order will be:

```text
createTokenInfoAndMetadata
  -> build feeClaimers with creator explicit and BPS sum 10000
  -> if needed: getConfigCreationLookupTableTransactions with baseMint
  -> sign/send LUT creation via Bags SDK helper
  -> wait one slot
  -> sign/send LUT extensions via Bags SDK helper
  -> createBagsFeeShareConfig via Bags SDK
  -> if bundles exist: sendBundleWithTip exactly like docs
  -> send normal config txs via Bags SDK helper
  -> createLaunchTransaction using tokenInfo.tokenMetadata verbatim
  -> signAndSendTransaction launch tx via Bags SDK helper
  -> mark launched
```

### 3. Preserve safe retry/accounting behavior
- Continue persisting `token_mint_address`, `ipfs_metadata_url`, `fee_share_config_key`, and `claimer_count` for audit/debugging.
- Keep auto-refunds only for failures before any possible on-chain launch spend.
- Keep no-refund behavior for ambiguous post-broadcast failures.
- Remove or downgrade custom retry hacks that conflict with the official Bags path.

### 4. Improve evidence for failures
If Bags still returns 500 after the exact documented flow, I will store a compact “Bags payload fingerprint” in `execution_error`, including:

```text
mint
metadata URL
configKey
launchWallet
initialBuyLamports
fee claimer count
BPS sum
whether bundles were used
```

This gives Bags support enough detail to inspect their backend logs without exposing secrets.

### 5. Add local checks for the latest failed pattern
- Validate fee-claimer array length and BPS sum.
- Validate no duplicate invalid wallets.
- Validate metadata URL is present and publicly reachable when possible.
- Validate `initialBuyLamports` is a safe integer and >= Bags example minimum of `10,000,000` lamports.

### 6. Verification after implementation
- Run the project’s tests/type checks through the normal Lovable validation pipeline.
- Review the updated executor code against the Bags docs line by line.
- Keep Bags paused until you confirm we should re-enable it and run a controlled small launch test.

## Files to change

- `executor/src/executeBags.ts`
  - Main Bags flow refactor.
- `executor/package.json` and lockfile only if needed
  - Ensure SDK helper imports are available from current `@bagsfm/bags-sdk`.
- Possibly `.lovable/plan.md`
  - Keep the plan/audit record updated.

## Important note

Even if Bags still returns a server-side 500 after this, we will then have removed our custom deviations from the docs. At that point the failure evidence will show Bags: “we are sending exactly the documented SDK flow and this exact payload still 500s,” which is the strongest path to a successful launch.