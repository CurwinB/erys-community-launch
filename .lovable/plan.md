Plan to implement the requested diagnostics:

1. Update the local-signing reachability check in `executor/src/launchWithLocalSigning.ts`
   - Read the response body for every PumpPortal GET reachability response, not only 5xx.
   - Log it as:
     ```ts
     LOG(`PumpPortal reachable (${probeRes.status}): ${probeText}`);
     ```
   - Keep the existing behavior that only aborts on 5xx/network errors, but include the response body in both success and failure logs.

2. Log the exact `/trade-local` request JSON before sending it
   - Build the body as a plain object first, then stringify it.
   - Log:
     ```ts
     LOG(`/trade-local request body: ${JSON.stringify(requestBody)}`);
     ```
   - Continue using the same string-coerced `publicKey`, `mint`, and `tokenMetadata.uri` values.

3. Mirror the same diagnostics in `executor/src/executePumpfun.ts`
   - This is the older Pump.fun local-signing path and has the same reachability check pattern.
   - Add full reachability body logging and full request-body logging there too, so either execution route gives comparable logs.

4. Keep secrets safe
   - The request body only contains public values: escrow public key, mint public key, metadata URI, token name/symbol, SOL amount, slippage, priority fee, and pool.
   - Do not log decrypted escrow or mint secret keys.

No database changes or UI changes are needed.