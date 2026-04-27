## What the screenshot actually tells us

The Recovery tab's **Pump.fun Fee-Claim Health** panel says **"No launched Pump.fun tokens"** and the custodial wallet holds only **0.0519 SOL**. That contradicts the previous diagnosis (truthy-empty-array bug on `ETEST`). Two different things are likely true:

1. **No rows qualify for claiming.** The panel queries launches where `platform = 'pumpfun'` AND `status = 'launched'`. If `ETEST` is in a different status (e.g. `executing`, `pending`, `failed`, `sweep_recovery`) or not on the Pump.fun platform, the distributor never sees it and no sweep can ever happen. This alone explains the empty `platform_fee_claims`.
2. **The custodial wallet is underfunded.** Even if a launch did appear, the batch claimer's wallet-health gate (`SINGLE_CLAIM_PRIORITY_FEE_LAMPORTS + fanout × TX_FEE_RESERVE + 0.002 SOL floor`) needs at least ~0.0025 SOL — but in practice with a single-launch fan-out we'd want headroom. 0.0519 SOL is borderline; if the wallet drains further, every cycle aborts with a "starved" error.

The fix we just shipped (truthy `errors: []`) is still correct, but it isn't what's blocking sweeps right now — there's nothing to sweep.

## Investigation plan (read-only, no code changes)

Before changing anything, I want to confirm the actual DB state with three quick queries:

1. **Find `ETEST` and its status/platform fields**
   ```sql
   SELECT id, token_symbol, platform, status,
          pumpfun_fees_last_claimed_at,
          pumpfun_last_claim_error,
          pumpfun_low_volume_throttle_until,
          worker_locked_at,
          distribution_completed,
          launch_tx_signature
   FROM launches
   WHERE token_symbol = 'ETEST' OR token_name ILIKE '%ETEST%';
   ```

2. **Count Pump.fun launches per status**
   ```sql
   SELECT status, COUNT(*) FROM launches
   WHERE platform = 'pumpfun' GROUP BY status;
   ```

3. **List anything that looks like it should have swept but didn't** — Pump.fun launches in `launched` status with a `launch_tx_signature` and `pumpfun_fees_claimed_total = 0`.

## Likely outcomes and the next plan

Depending on the queries, one of these is the real fix:

- **If `ETEST` is stuck in `executing`** → the executor never finished it. We'd need to look at `executePumpfunLightning.ts` logs / state and either retry execution or move it to `launched` if the on-chain launch actually happened. The Recovery tab's "Launches needing recovery" row at the bottom of the screenshot ("No launches need…") suggests the recovery worker isn't seeing it either.
- **If `ETEST` is in `launched` but `platform != 'pumpfun'`** (e.g. it's actually a Bags launch) → no Pump.fun fee claim is expected; sweeps for Bags go through a different path.
- **If `ETEST` is in `launched` + `platform = 'pumpfun'` but throttled** by `pumpfun_low_volume_throttle_until` or `worker_locked_at` from the old bug → one click on **Force retry** in the admin panel clears it. That RPC was just updated to also null `pumpfun_last_claim_error`.
- **If the custodial wallet is the only blocker** → top up `PUMPPORTAL_CUSTODIAL_WALLET` (`8fjQrCqeJfNgc5QQRarykX1eBwL7Xt5dvFi5hA2bqGed`) by ~0.05–0.1 SOL and the next 30s poll sweeps automatically.

## What I'd like to do next

Run the three queries above against the live DB so we know exactly which case we're in, then come back with a precise, scoped fix plan (force-retry click, executor re-poke, wallet top-up, or a code change). No production changes happen as part of this step — it's pure investigation.
