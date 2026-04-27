## Add quick-amount buttons to the wallet Send form

Add a row of percentage shortcuts (**25% · 50% · 75% · Max**) under the Amount input in `src/components/WalletDropdown.tsx`. Same UX for both SOL and token sends.

### Behavior

- Shortcuts compute against the currently-selected asset's balance:
  - SOL send: `solBalance`
  - Token send: `Number(selectedToken.balance) / 10^selectedToken.decimals`
- Buttons are disabled when balance is unknown / zero.
- Clicking writes the computed value into the existing `sendAmount` input (so all current validation, ATA-warning, and submit logic keeps working unchanged).

### Max button — safety buffers

- **SOL Max** subtracts a small reserve so the tx still has room for the network fee:
  - Reserve: `0.00001 SOL` (5 000 lamports — covers signature fee with margin)
  - If the recipient ATA needs creation in a token tx, that's already covered by the per-tx fee logic; SOL "Max" is independent.
- **Token Max** is the full token balance — no reserve needed since SPL transfers don't burn the token itself.

Other percentages don't need a buffer (they leave plenty behind).

### Display formatting

- SOL amounts: 6 decimal places trimmed (matches the existing `toFixed(4)` style but a bit more precision so 25% of e.g. 0.0429 doesn't get truncated).
- Token amounts: respect the token's own decimals.

### Visual

Four small square buttons in a single row, sharp edges, mono font, matching the dark theme already used in the dropdown — `border border-border bg-card hover:border-primary/50 text-xs px-2 py-1`. Sits between the Amount input and the warning/submit button.

### Files

- `src/components/WalletDropdown.tsx` — add a `setAmountByPercent(pct: 0.25 | 0.5 | 0.75 | 1)` helper and render the four buttons inside the existing send form block (around line 618).

No backend, schema, or other component changes.
