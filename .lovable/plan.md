I understand the frustration. This latest log is actually much clearer than the previous ones, and it shows a different failure than the last launch.

Plain English diagnosis:
- Latest failed launch: `017ef269-a234-418b-896f-301e8283bd45`.
- It failed during `Step 2: createBagsFeeShareConfig`.
- Bags returned 2 fee-share transactions for mint `72KB2wNG6vnVUBCS8yQ4QB4aaCj6sxZDPNM3JMg7BAGS`.
- Our executor tried to send `fee-share-tx-1`, but Solana rejected it before it even reached the chain:
  - `Transaction did not pass signature verification`
  - `Last signature: <none>`
- That means this was not a Bags launch 400, not the old “Config already exists” issue, and not the previous WebSocket confirmation issue.

The real cause:
- The last fix replaced WebSocket confirmation with our own HTTP sender.
- That part was the right direction, but the sender treated the Bags transaction like a transaction we fully own.
- Bags fee-share transactions can be prebuilt and partially signed by Bags/program-side signers.
- Our sender refreshed the blockhash and wiped all signatures before signing with only the escrow wallet.
- That invalidated/missing-preserved Bags signatures, so Solana rejected the transaction with signature verification failure.

So the blunt answer is: we fixed the WebSocket problem too aggressively and accidentally broke Bags’ partial-signature requirement. That is why this kept moving from one failure to another.

Plan to fix properly:

1. Split Bags transaction sending into two safe paths
   - Keep an “owned transaction” sender only for transactions we fully build and fully sign ourselves.
   - Add a separate “prebuilt Bags transaction” sender for transactions returned by Bags.
   - The Bags sender will never change `recentBlockhash` and never wipe existing signatures.

2. Preserve Bags signatures
   - For fee-share transactions from `/fee-share/config`, deserialize the transaction exactly as Bags returned it.
   - Add only the escrow wallet signature using `tx.sign([escrowKeypair])`.
   - Preserve all existing signatures already attached to the transaction.
   - Serialize and submit the exact signed transaction bytes.

3. Retry expiry by rebuilding, not mutating
   - If a Bags transaction expires or times out, do not refresh its blockhash locally.
   - Instead, call Bags `/fee-share/config` again to get fresh transactions with a fresh blockhash/signature set.
   - This keeps the Bags signing model intact.

4. Apply the same rule to final Bags launch transactions
   - Treat `createLaunchTransaction` output as a Bags-provided transaction.
   - Sign only with escrow and preserve any existing signatures.
   - Confirm with HTTP polling, but do not rewrite the transaction.

5. Improve logs so this cannot stay hidden again
   - Log transaction signer count, existing signature count, whether escrow signed, and the transaction label.
   - On `SendTransactionError`, capture `err.logs` / `getLogs()` where available.
   - Keep secrets/private keys out of logs.

6. Keep the latest failed launch recoverable
   - This latest failure had `Last signature: <none>` and no `fee_share_config_key`, so no fee-share transaction landed.
   - Because it used the no-auto-refund failure path, escrow funds should still be available for retry/manual recovery.
   - After the fix is deployed to Railway, retrying `017ef269...` should be safe from a double-launch perspective because nothing was submitted on-chain.

Technical notes:
- Main file to update: `executor/src/executeBags.ts`.
- The bad behavior is in `sendVersionedTransactionWithHttpConfirm`, specifically refreshing `tx.message.recentBlockhash` and resetting `tx.signatures` for Bags-returned transactions.
- Required Bags order will remain unchanged:

```text
fee-share/config first
then create-launch-transaction
then send-transaction
```

After approval, I’ll make the executor change focused on Bags partial-signature preservation and HTTP confirmation.

<lov-actions>
<lov-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</lov-link>
</lov-actions>