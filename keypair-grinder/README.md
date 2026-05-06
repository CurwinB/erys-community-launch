# keypair-grinder

Railway service that pre-generates Solana keypairs whose public keys end in
`pump` (case-insensitive) and stores them encrypted in the
`pump_keypair_pool` Supabase table. The `create-launch-pumpfun` edge
function pops one when a new Pump.fun launch is created.

## Env

See `.env.example`. `ESCROW_ENCRYPTION_KEY` must be the same 32-byte hex
key used by the rest of the platform (executor, edge functions).

## Run

```
npm install
npm run build
npm start
```

Railway: set the start command to `npm run build && npm start`.

## Behavior

- 2 worker threads (configurable) grind keypairs in parallel.
- Main thread encrypts each ground keypair and inserts into the pool.
- When `unclaimed >= TARGET_POOL_SIZE` (default 1000), workers pause and
  the main loop polls every 60s; resumes grinding when below target.
- `[alive]` heartbeat every 60s shows current grind rate (kp/s) so you
  can see workers are healthy even when no match has landed yet.
- `[health]` line logged every 10 minutes for at-a-glance Railway monitoring.

Expected throughput: case-sensitive 4-char base58 suffix (`pump`) needs
~11.3M attempts on average per keypair (58^4). On a small Railway
replica doing ~5–20K keypairs/sec/thread with 2 workers, expect roughly
5–20 minutes between matches. Cold-filling 1000 keypairs takes many
hours — scale `WORKER_COUNT` or run multiple replicas to fill faster.