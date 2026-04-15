

# Clean up execute-launch: Remove distribution, add token amount pre-calculation

## What changes

### Edit: `supabase/functions/execute-launch/index.ts`

**1. Remove SOLANA_RPC_URL** (line 26) — no longer needed since distribution is handled by Railway.

**2. Add token amount pre-calculation** — Insert after the basis points update loop (after line 173), before the escrow decryption:

```typescript
// Pre-calculate proportional token amounts for Railway distributor
const totalLamportsForTokenCalc = filtered.reduce(
  (sum: bigint, f) => sum + BigInt(f.contribution.amount_lamports),
  0n
);

for (let i = 0; i < filtered.length; i++) {
  const proportionalBps = Math.floor(
    (Number(BigInt(filtered[i].contribution.amount_lamports)) / Number(totalLamportsForTokenCalc)) * 10000
  );
  await supabase
    .from("contributions")
    .update({ token_amount: proportionalBps })
    .eq("id", filtered[i].contribution.id);
}
```

**3. Remove distribute-tokens invoke** (lines 321-325) — delete the `supabase.functions.invoke("distribute-tokens", ...)` call. The function ends right after marking status as "launched" and returning the success response.

**4. Remove comment on line 347** — delete `// (Token distribution moved to distribute-tokens edge function)`

### Also: Delete `supabase/functions/distribute-tokens/index.ts`
This edge function is no longer needed since Railway handles distribution externally.

### Deploy
Redeploy `execute-launch` after changes.

## What stays unchanged
- ATA reserve calculation (lines 196-214) — kept as-is
- All fee-share/config, create-launch-transaction, send-transaction steps
- All utility functions (setFailed, errorResponse, decryptEscrowKey, hexToUint8Array)

