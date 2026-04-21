

# Fix Critical Bags API Field Mismatches

Three bugs in the Bags launch flow that prevent any Bags launch from succeeding. All in Supabase edge functions, no DB or frontend changes.

## Fix 1 — `supabase/functions/create-launch/index.ts`

The Bags `create-token-info` response is shaped as `{ success, response: { tokenMint, tokenLaunch: { uri } } }`. We're currently reading `tokenInfoData.mint || tokenInfoData.tokenMint` and `tokenInfoData.metadataUrl || tokenInfoData.ipfsUrl` — both wrong, so `ipfs_metadata_url` and `token_mint_address` are stored as NULL.

Change the parsing block (lines 64-71) to:

```ts
if (tokenInfoRes.ok) {
  const tokenInfoData = await tokenInfoRes.json();
  console.log("create-token-info response:", JSON.stringify(tokenInfoData));
  tokenMint = tokenInfoData.response?.tokenMint || null;
  ipfsMetadataUrl = tokenInfoData.response?.tokenLaunch?.uri || null;
  console.log("tokenMint:", tokenMint, "ipfsMetadataUrl:", ipfsMetadataUrl);
} else {
  const errText = await tokenInfoRes.text();
  console.error("create-token-info failed:", errText);
  return errorResponse(`Bags create-token-info failed: ${errText}`, 500);
}

if (!tokenMint || !ipfsMetadataUrl) {
  return errorResponse("Bags API did not return tokenMint or metadata URI. Cannot create launch.", 500);
}
```

This converts a previously silent failure into a hard fail at scheduling time so launches don't get stored without a mint/ipfs.

## Fix 2 — `supabase/functions/execute-launch/index.ts` — fee-share/config transaction submission

`fee-share/config` returns `response.transactions[]` (each `{ transaction: base58 }`) plus `response.meteoraConfigKey`. Right now we read `meteoraConfigKey` but throw away the transactions array — those transactions must be sent before `create-launch-transaction`, especially when there are >15 claimers and lookup tables are needed.

Right after the existing `configKey` block (after line 266) and **before** the "Store configKey" update, add:

```ts
const feeShareTransactions = feeShareData.response?.transactions || [];
console.log(`fee-share/config returned ${feeShareTransactions.length} transactions`);

for (let i = 0; i < feeShareTransactions.length; i++) {
  const txObj = feeShareTransactions[i];
  const sendRes = await fetch(`${BAGS_API_BASE}/solana/send-transaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": BAGS_API_KEY },
    body: JSON.stringify({
      transaction: txObj.transaction,
      signerPrivateKey: escrowPrivateKey,
    }),
  });
  if (!sendRes.ok) {
    const errText = await sendRes.text();
    await setFailed(supabase, launch.id, `fee-share tx ${i + 1}/${feeShareTransactions.length} failed: ${errText}`);
    return errorResponse(`fee-share transaction failed: ${errText}`);
  }
  await new Promise((r) => setTimeout(r, 500));
}
```

## Fix 3 — `supabase/functions/execute-launch/index.ts` — create-launch-transaction body

The current POST body (lines 285-296) sends `creator`, `name`, `symbol`, `description`, `imageUrl`, `twitter`, `telegram`, `website` — none of which this endpoint accepts. Replace the body with exactly the five fields the endpoint expects:

```ts
body: JSON.stringify({
  ipfs: launch.ipfs_metadata_url,
  tokenMint: launch.token_mint_address,
  wallet: launch.escrow_wallet_public_key,
  initialBuyLamports: Number(netBuyLamports),
  configKey,
}),
```

Also add a guard immediately before the call so we fail loudly if either value is somehow null (e.g. legacy rows scheduled before Fix 1):

```ts
if (!launch.ipfs_metadata_url || !launch.token_mint_address) {
  await setFailed(supabase, launch.id, "Missing ipfs_metadata_url or token_mint_address — cannot build launch transaction");
  return errorResponse("Launch is missing IPFS URI or token mint");
}
```

The downstream `mintAddress` write (lines 307-314) becomes a no-op for new launches but stays harmless — keep as-is.

## Out of scope

- No changes to Pump.fun flow, distributor, frontend, or DB schema.
- No changes to `send-transaction` body shape (the `transaction` + `signerPrivateKey` pair is already correct and matches the existing successful Pump.fun send pattern).

## Files

- Edit: `supabase/functions/create-launch/index.ts`
- Edit: `supabase/functions/execute-launch/index.ts`

