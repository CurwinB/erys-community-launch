I found the current failure pattern in the Railway log and database.

Plain English diagnosis:
- Yes, this launch is going through Railway. The uploaded log is from the Railway executor service.
- This latest failure is not the old “Config already exists” issue. The fee-share config was created and stored successfully for launch `96218ec7-e287-4d29-861e-3c5b3acc92b8`.
- The launch then failed at Bags launch transaction creation with `createLaunchTransaction failed: Request failed with status 400`.
- The Railway log is almost entirely `signatureSubscribe not found`. That means the executor/Bags SDK is trying to confirm Solana transactions using WebSocket subscription calls, but the configured RPC endpoint does not support that method. We already fixed this exact class of issue in the Pump.fun path with HTTP polling, but Bags still uses the SDK helper that depends on WebSocket confirmation.
- Because the Bags error handling only saved `err.message`, we lost the actual Bags 400 response body, so the database currently says “status 400” without the detailed reason from Bags.

Why this kept recurring:
- We fixed one Bags failure at a time: first the fee-share duplicate/config key issue, then refund safety.
- This latest failure exposed a separate infrastructure mismatch: Bags SDK/web3 confirmation expects `signatureSubscribe`; the Railway RPC path does not provide it.
- The code had enough logging for our own steps, but not enough error extraction for Bags API/SDK 400 responses, so each new Bags failure surfaced as an opaque message.

Plan to fix properly:

1. Remove WebSocket-dependent confirmation from the Bags path
   - Add a Bags-specific `sendVersionedTransactionWithHttpConfirm` helper in `executor/src/executeBags.ts`.
   - It will use `sendRawTransaction`, poll `getSignatureStatuses`, and rebroadcast idempotently, matching the proven Pump.fun pattern.
   - Replace Bags SDK `signAndSendTransaction` usage for:
     - LUT creation
     - LUT extension
     - fee-share single transactions
     - final Bags launch transaction
   - Keep using Bags SDK/API only to build transactions, not to confirm them over unsupported WebSockets.

2. Stop relying on SDK bundle confirmation where possible
   - For fee-share bundles returned by Bags, sign the transactions and submit/confirm them through the same HTTP polling path when safe.
   - If a Jito bundle path must remain, isolate it and add clear fallback/recovery logging so WebSocket confirmation does not hide the real state.

3. Capture the real Bags 400 error body
   - Improve `createLaunchTransaction` error handling to extract Axios/API response details, including status, response body, and request context.
   - Save that detailed reason in `execution_error` so the next failure, if any, is actionable immediately.

4. Make Bags launch failure refund-safe after on-chain setup
   - Since fee-share config was already created before Step 3, use the no-auto-refund failure path for `createLaunchTransaction` and final send failures.
   - This avoids draining escrow after on-chain setup work has happened and keeps retries/manual recovery possible.

5. Add an RPC capability preflight at executor startup or Bags execution start
   - Check whether `signatureSubscribe` is available and log a clear warning if not.
   - This will make future Railway/RPC configuration issues obvious instead of appearing as random Bags failures.

6. Add better step-level logging
   - Log launch id, token mint, fee-share config key, contributor count, net buy lamports, and exact step name around every external Bags/RPC call.
   - Redact secrets and never log encrypted/private keys.

Technical notes:
- The latest failed launch row has `fee_share_config_key = Bxj4fsjVMZo1soZezkQEwNKsftzFVNcEKUA6YDt7U1Ng`, so the fee-share config phase succeeded.
- The uploaded Railway log repeatedly shows `Method 'signatureSubscribe' not found`, which is an RPC/WebSocket capability problem.
- The current Bags executor imports and uses SDK `signAndSendTransaction`; that is the part I will replace with HTTP polling confirmation.
- I will not change the required Bags order: fee-share/config first, then create launch transaction, then send transaction.

After approval, I’ll implement this in `executor/src/executeBags.ts` and keep the change focused on the Railway executor path.