## Hypothesis

The fix is correct, but it made the grinder **16× slower** and Railway logs now look "silent" because no match has landed yet — not because grinding is broken.

Why 16×: a 4-char suffix has `58^4 ≈ 11.3M` keypairs per match when case-sensitive. The old case-insensitive check accepted any of `{p,P}{u,U}{m,M}{p,P}` = 16 variants, i.e. `58^4 / 16 ≈ 707K` attempts per match. Same throughput, 16× fewer "+1" log lines.

On a small Railway replica doing roughly 5–20K ed25519 keypairs/sec/thread with 2 workers, expected time per match is now **~5–20 minutes** instead of ~20–80 seconds. With zero heartbeat between matches, it looks dead.

DB confirms: pool has 1 row, last `created_at` is from before the fix. Nothing new has landed yet, but nothing proves the workers are stuck either.

## Plan

Add proof-of-life logging so we can see grinding is happening between matches, without changing the grind logic.

### 1. `keypair-grinder/src/worker.ts`
- Track `totalAttempts` and `lastReportAt` across the outer loop (not reset per match).
- Every 250K attempts, post a `{ type: "progress", attempts, sinceMs }` message to the parent.
- Keep the case-sensitive `endsWith(SUFFIX)` check unchanged.

### 2. `keypair-grinder/src/index.ts`
- Aggregate `progress` messages from all workers into running totals (`totalAttempts`, `attemptsPerSec`).
- Every 60s, log: `[grinder][alive] workers=N rate=~X kp/s total=Y attempts pool=Z/TARGET` so Railway shows a heartbeat even when no match lands.
- Keep the existing 10-min `[health]` line and the `+1 ...` per-match line.

### 3. `keypair-grinder/README.md`
- Update the throughput note: 4-char base58 suffix (case-sensitive) needs ~11.3M attempts on average per keypair; expect minutes per match on a small replica. Recommend bumping `WORKER_COUNT` or running multiple replicas to fill 1000 entries faster.

### Files touched
- `keypair-grinder/src/worker.ts`
- `keypair-grinder/src/index.ts`
- `keypair-grinder/README.md`

No DB changes, no edge function changes, no behavior changes to the matching logic.

## What this proves
After redeploy, within ~60s Railway logs will show an `[alive]` line with a non-zero `kp/s`. If the rate is healthy (e.g. 5K+ kp/s combined) but `+1` lines are sparse, grinding is fine and just needs time / more workers. If `kp/s` is zero or workers never report, we have a real bug to chase.
