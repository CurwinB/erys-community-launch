

# Correction: Execute-Launch API Call Order

The user flagged a critical ordering issue in the `execute-launch` edge function sequence from the previous plan.

## Previous (incorrect) order:
1. `create-launch-transaction`
2. `send-transaction`
3. `fee-share/config`

## Correct order:
1. **`fee-share/config`** — register all contributor wallets as fee claimers with proportional basis points FIRST, so the fee share configuration exists on-chain before the token goes live
2. **`create-launch-transaction`** — build the launch transaction using total escrowed SOL as `initialBuyLamports`
3. **`send-transaction`** — submit the signed launch transaction; mark `launched` only after confirmation

The fee share config must be in place before the token launches, otherwise contributors won't be registered as claimers and fees would be lost. This will be enforced in the `execute-launch` edge function implementation. If the `fee-share/config` call fails, the function sets status to `execution_failed` and does not proceed to launch.

No other changes to the plan. Ready to begin implementation on approval.

