

# Fix admin refund failure — RPC error handling + visibility

## Root cause

The `refund-contributor` edge function called `await res.json()` on the Solana RPC response without checking HTTP status or content-type. The RPC returned a plain-text error starting with `"Unspecifie..."` (e.g. `"Unspecified origin"` / `"Unspecified API key"` / a 401/403/429 body), JSON.parse threw, and the admin saw the generic "Edge Function returned a non-2xx status code" toast with no detail.

Stack trace from logs:
```text
SyntaxError: Unexpected token 'U', "Unspecifie"... is not valid JSON
  at getLatestBlockhash (refund-contributor/index.ts:96)
```

The same unsafe pattern exists in `waitForConfirmation` and `buildAndSendTransfer` (and in `refund-launch` / `claim-sponsored-slot`, but those aren't what failed today — fix only the failing path now).

## Plan

### 1. `supabase/functions/refund-contributor/index.ts` — robust RPC handling

Add a single helper `rpcCall(rpcUrl, method, params)` that:
- POSTs to the RPC with the standard JSON-RPC body
- Reads the response as **text first**
- If `!res.ok`, throws `RPC <method> HTTP <status>: <truncated text>` (so the real upstream error reaches the client, e.g. `"Unspecified origin"`)
- Tries `JSON.parse(text)` in a try/catch — on failure, throws `RPC <method> returned non-JSON: <truncated text>`
- If parsed JSON has `.error`, throws `RPC <method> error: <JSON.stringify(error)>`
- Returns the parsed `result` field

Replace the three inline `fetch(...).json()` blocks (`getLatestBlockhash`, `waitForConfirmation`, `buildAndSendTransfer`'s `sendTransaction`) with this helper.

### 2. Surface the real error to admin UI

In the catch at line 108, return HTTP **200** with `{ error, errorDetail }` instead of 500. Reason: `supabase.functions.invoke()` swallows the body of non-2xx responses and only returns `"Edge Function returned a non-2xx status code"` — exactly what the screenshot shows. Returning 200 with an `error` field lets `RecoveryTab.refundOne` (which already checks `data?.error`) show the real message in the toast and inline error row.

### 3. Confirm secret is set, otherwise prompt

Before any RPC call, validate that `SOLANA_RPC_URL` is set and not the public mainnet endpoint (`api.mainnet-beta.solana.com` is heavily rate-limited and commonly returns the kind of plaintext errors we hit). If unset, return a clear error: `"SOLANA_RPC_URL secret is not configured"`.

If after this fix the surfaced message turns out to be `"Unspecified origin"` or similar from the RPC provider, the next step will be to update the `SOLANA_RPC_URL` secret to a working Helius/QuickNode endpoint with no origin restriction — but we'll know that from the new clear error message rather than guessing.

### 4. No frontend changes required

`RecoveryTab` already handles `data?.error` and displays it both in `toast.error` and in the inline `errors[contribution.id]` row. The current "Edge Function returned a non-2xx status code" message comes from `error.message` on the Functions client; once the function returns 200 with `{ error: "<real message>" }`, the admin will see the actual cause.

## Files changed

- `supabase/functions/refund-contributor/index.ts` — add `rpcCall` helper, replace 3 raw fetches, validate RPC URL secret, return errors as 200 + JSON `{ error }`

No DB migration, no frontend changes, no new secrets (unless the surfaced error reveals the RPC URL itself is the problem — handled in a follow-up).

