## Apply WebSocket fix to every executor Connection

`executor/src/executeBags.ts` already passes `wsEndpoint`. The other five files still build the Connection with the old `(SOLANA_RPC_URL, "confirmed")` signature, so any `confirmTransaction` call inside them (or inside libs we pass the connection to) will keep hitting Alchemy's missing `signatureSubscribe`. Bring all six sites to the same shape and make the WSS URL a hard env requirement so a missing Railway var fails fast at boot instead of mid-launch.

### Files

```text
executor/src/executePumpfunLightning.ts     line 122
executor/src/recoverPumpfunSweep.ts         line 70
executor/src/refundFailedLaunch.ts          line 78
executor/src/fundSponsoredEscrow.ts         line 190
executor/src/sweepCancelledSponsorEscrows.ts line 145
executor/src/index.ts                        validateEnv()
executor/.env.example                        SOLANA_WSS_URL line
```

### Change in each of the 5 executor files

At the top of the module (next to the existing `SOLANA_RPC_URL` constant), add:

```ts
const SOLANA_WSS_URL =
  process.env.SOLANA_WSS_URL ||
  SOLANA_RPC_URL.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
```

(For `fundSponsoredEscrow.ts` and `sweepCancelledSponsorEscrows.ts` the RPC URL is read into a local `rpcUrl` inside the function — derive `wssUrl` the same way in that local scope.)

Then replace the constructor:

```ts
// before
const connection = new Connection(SOLANA_RPC_URL, "confirmed");
// after
const connection = new Connection(SOLANA_RPC_URL, {
  commitment: "confirmed",
  wsEndpoint: SOLANA_WSS_URL,
});
```

No other behavior changes — same commitment, same RPC, just an explicit WS endpoint so `signatureSubscribe` works on Helius/Triton/QuickNode if the operator points `SOLANA_WSS_URL` there.

### `executor/src/index.ts`

Add `"SOLANA_WSS_URL"` to the `required` array in `validateEnv()` so the worker refuses to boot without it. Keep the existing startup log line (it already prints whether the override is set).

### `executor/.env.example`

The file already documents `SOLANA_WSS_URL`. Change the placeholder line from the generic `wss://your-ws-capable-rpc` to a copy-pasteable Alchemy template so it matches the existing `SOLANA_RPC_URL` example:

```text
SOLANA_WSS_URL=wss://solana-mainnet.g.alchemy.com/v2/your-key
```

Also drop the now-stale "Optional." word from the comment block above it (it is required after this change).

### Out of scope

- No change to `executor/src/processingFee.ts` — it receives `connection` as a parameter, as the prompt notes.
- No change to `distributor/` (separate service, separate fix if needed later).
- No change to platform pause toggle. Operator re-enables Bags from admin once Bags' 500s clear.

### One caller-decision flag

Hardening `validateEnv` to require `SOLANA_WSS_URL` means the Railway deploy will crash-loop until you actually set it. That's the intent of your prompt and is the right behavior for production, but I want to confirm before shipping — say "go" and I'll apply.
