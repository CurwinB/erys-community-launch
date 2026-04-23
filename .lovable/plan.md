

# Add mandatory creator contribution to Schedule flow

The creator becomes the first contributor at schedule time. SOL transfers from their wallet to the new escrow wallet immediately after the launch row is created.

## Changes — `src/pages/SchedulePage.tsx` only

No edge function, DB, or other file changes. Both `create-launch` and `create-launch-pumpfun` already return `escrow_wallet`, and `contribute` already verifies on-chain transfers and inserts the row.

### 1. Form state + new field

Add `creatorContribution: ""` to form state. Render a new required field at the top of the "Contribution Limits" card (or above it) labelled **Your Contribution (SOL)** with helper text:

> As the creator you must contribute SOL to seed your launch. This goes directly to the escrow wallet and demonstrates commitment to your community.

Input: `type="number"`, `min="0.05"`, `step="0.01"`, monospace, required.

### 2. SOL balance + live validation

On wallet connect, fetch the user's SOL balance using a `Connection` to `VITE_SOLANA_RPC_URL` (same pattern as `WalletDropdown`). Show real-time inline error under the input when:
- value is not a valid number
- value < 0.05
- value > `solBalance - 0.01` (reserve 0.01 SOL for fees)

Disable the submit button while invalid.

### 3. Multi-step submit flow

Replace the single `isSubmitting` boolean with a `step` state machine:

```text
idle → creating → awaiting_signature → confirming → recording → success
                                    ↘ error (with retry from saved launch_id)
```

Submit handler sequence:
1. **creating** — call `create-launch` or `create-launch-pumpfun`. Save returned `launch_id` and `escrow_wallet` into a `pendingLaunch` state object (so retries don't recreate the launch).
2. **awaiting_signature** — build a `SystemProgram.transfer` from `publicKey` → `escrow_wallet` for `creatorContribution * LAMPORTS_PER_SOL` lamports. Set `feePayer` and `recentBlockhash` (from `connection.getLatestBlockhash("confirmed")`). Call `wallet.getSigner()` then `signer.signAndSendTransaction(tx)`. Extract signature using the same normalization as `WalletDropdown` (string | `.signature` | `.hash`).
3. **confirming** — `connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed")`.
4. **recording** — call `contribute` edge function with `{ launch_id, wallet_address: publicKey, amount_lamports, tx_signature }`. The function re-verifies on-chain and inserts the contribution row (including basis-points eligibility for Bags fee shares — automatic, no extra fields needed).
5. **success** — show the existing success card.

### 4. Error handling + retry

If step 1 fails, show error and reset (no launch was created).

If step 2/3/4 fails, keep `pendingLaunch` in state and show:
- The error message
- A "Retry contribution" button that re-runs steps 2–4 against the existing `launch_id` + `escrow_wallet` (does NOT call create-launch again)
- A "Skip and view launch" link to the launch page (creator can contribute later via the normal launch page contribution flow if it exists)

### 5. Submit button states

Replace the existing label logic:
- `idle` + connected + valid → "Schedule Launch & Contribute"
- `creating` → "Creating launch…" (spinner)
- `awaiting_signature` → "Sign the transaction in your wallet…" (spinner)
- `confirming` → "Confirming on-chain…" (spinner)
- `recording` → "Recording contribution…" (spinner)
- error state with `pendingLaunch` → "Retry contribution"

Disabled while in any non-idle, non-error step.

## Technical notes

- Imports added: `Connection`, `PublicKey`, `SystemProgram`, `Transaction`, `LAMPORTS_PER_SOL` from `@solana/web3.js`; `isSolanaWallet` from `@dynamic-labs/solana`.
- Use `import.meta.env.VITE_SOLANA_RPC_URL` (already configured per WalletDropdown).
- Min contribution validation is independent of `form.minContribution` (the per-contributor minimum the creator sets for the launch). The 0.05 SOL floor is purely a UX guard for skin-in-the-game; it is NOT enforced by the edge function.
- `contribute` edge function will reject the creator's contribution if `amount_lamports < min_contribution_lamports` of the launch. Add a client-side check that creator contribution ≥ `form.minContribution` and surface a clear inline error if not (otherwise we'd create a launch then fail recording).
- The 5-min-before-launch contribution cutoff in `contribute` doesn't apply here because we already require launch_datetime ≥ 10 min from now in the existing validation.

## Files edited

- `src/pages/SchedulePage.tsx` — single-file change.

