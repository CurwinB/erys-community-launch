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
- Health line logged every 10 minutes for at-a-glance Railway monitoring.

Expected throughput: a 4-char base58 suffix needs ~11.3M attempts on
average per keypair. With 2 workers on a small Railway replica, a cold
1000-keypair pool fills over many hours; scale replicas to fill faster.