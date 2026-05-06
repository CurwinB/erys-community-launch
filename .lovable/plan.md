## Goal
Replace the raw, overflowing "Send Failed" error (currently dumping the full Solana RPC simulation log into a toast) with a short, friendly message and an optional "details" affordance.

## Scope
File: `src/components/WalletDropdown.tsx` — both `handleSendSol` (line 232) and `handleSendToken` (line 309) catch blocks (lines 299-306, 422-429).

## What the user sees today
A sonner toast titled "Send Failed" with `err.message` verbatim, e.g.:
> Transaction simulation failed. Message: Transaction simulation failed: Transaction results in an account (0) with insufficient funds for rent. Logs: [ "Program 11111…" … ]. Catch the SendTransactionError and call getLogs() on it for details.

This overflows the toast on mobile and is unreadable.

## Proposed UX

1. Add a small helper `parseSolanaError(err): { title: string; description: string }` near the top of the file (or in `src/lib/edgeError.ts` style). It maps known patterns to friendly copy:
   - `insufficient funds for rent` / `insufficient lamports` → title `"Not enough SOL"`, description `"This wallet doesn't have enough SOL to cover the transfer plus the network rent/fee. Try a smaller amount or top up."`
   - `User rejected` / `rejected the request` / `User declined` → title `"Cancelled"`, description `"You cancelled the transaction in your wallet."` (use `toast.message` instead of `toast.error`)
   - `blockhash not found` / `block height exceeded` → title `"Network timeout"`, description `"The transaction expired before it was confirmed. Please try again."`
   - `Invalid public key` / `Non-base58` → title `"Invalid address"`
   - Any `Transaction simulation failed` → title `"Transaction would fail"`, description = first line only, stripped of `Logs: […]` and the `Catch the SendTransactionError…` SDK hint.
   - Default fallback → title `"Send failed"`, description = `err.message` truncated to ~140 chars with `…`.

2. In both catch blocks, call the helper and pass the result to `toast.error` (or `toast.message` for cancellation). Keep `console.error` with the full error for debugging.

3. Cap the toast description visually: pass `style={{ maxWidth: 360 }}` and rely on sonner's built-in wrapping; the truncation in step 1 is the real fix.

4. Optional: include a `Copy details` action button on the toast that copies the raw `err.message` to clipboard, so power users still have the full text.

## Out of scope
- No change to the actual send logic, balance loading, or signing flow.
- No change to other toasts in the app (this issue is specific to wallet send).

## Technical notes
- Sonner supports `toast.error(title, { description, action: { label, onClick } })` — already imported via `import { toast } from "sonner"`.
- Truncation helper: `s.length > 140 ? s.slice(0, 137) + "…" : s`.
- Strip Solana noise with a regex: `/\s*Logs:\s*\[[\s\S]*$/` and `/Catch the .*SendTransactionError.*$/`.
