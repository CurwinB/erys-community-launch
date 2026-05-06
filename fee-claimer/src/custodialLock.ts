import { supabase } from "./db";

/**
 * Coordination primitive that ensures only one worker (across any number of
 * executor / distributor replicas) is touching the shared PumpPortal
 * custodial wallet at a time.
 *
 * We use TWO mechanisms together:
 *   1. pg_advisory_lock — fast, in-memory, but session-scoped. With
 *      PgBouncer this can occasionally leak across pooled connections, so
 *      we don't trust it as the sole guard.
 *   2. A row in `custodial_wallet_locks` with a TTL — survives connection
 *      churn and worker crashes. Auto-heals after `ttlSeconds`.
 *
 * Both must be acquired to enter the critical section. Both are released in
 * a finally block. The TTL row is the source of truth.
 */

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_MS = 1_000;
const DEFAULT_TTL_SECONDS = 120;

export interface CustodialLockOptions {
  timeoutMs?: number;
  pollMs?: number;
  ttlSeconds?: number;
}

async function tryAdvisory(key: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("try_acquire_custodial_lock", {
    p_key: key,
  });
  if (error) {
    console.warn(`try_acquire_custodial_lock RPC error: ${error.message}`);
    return false;
  }
  return data === true;
}

async function releaseAdvisory(key: string): Promise<void> {
  const { error } = await supabase.rpc("release_custodial_lock", { p_key: key });
  if (error) console.warn(`release_custodial_lock RPC error: ${error.message}`);
}

async function tryRow(
  key: string,
  workerId: string,
  ttlSeconds: number
): Promise<boolean> {
  const { data, error } = await supabase.rpc("try_acquire_custodial_row_lock", {
    p_key: key,
    p_worker: workerId,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) {
    console.warn(`try_acquire_custodial_row_lock RPC error: ${error.message}`);
    return false;
  }
  return data === true;
}

async function releaseRow(key: string, workerId: string): Promise<void> {
  const { error } = await supabase.rpc("release_custodial_row_lock", {
    p_key: key,
    p_worker: workerId,
  });
  if (error) console.warn(`release_custodial_row_lock RPC error: ${error.message}`);
}

/**
 * Run `fn` while holding the custodial lock for `key`. Throws if the lock
 * cannot be acquired before `timeoutMs`. Always releases on the way out.
 */
export async function withCustodialLock<T>(
  key: string,
  workerId: string,
  fn: () => Promise<T>,
  opts: CustodialLockOptions = {}
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const ttlSeconds = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  const start = Date.now();
  let haveAdvisory = false;
  let haveRow = false;
  let attempts = 0;

  while (Date.now() - start < timeoutMs) {
    attempts++;
    if (!haveRow) haveRow = await tryRow(key, workerId, ttlSeconds);
    if (haveRow && !haveAdvisory) haveAdvisory = await tryAdvisory(key);
    if (haveRow && haveAdvisory) break;
    // Couldn't get both — back out the one we did get and wait.
    if (haveAdvisory && !haveRow) {
      await releaseAdvisory(key);
      haveAdvisory = false;
    }
    if (attempts === 1) {
      console.log(`Waiting for custodial lock on ${key.slice(0, 8)}...`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  if (!haveRow || !haveAdvisory) {
    if (haveAdvisory) await releaseAdvisory(key);
    if (haveRow) await releaseRow(key, workerId);
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for custodial lock on ${key}`
    );
  }

  console.log(`Acquired custodial lock on ${key.slice(0, 8)} (worker ${workerId})`);
  try {
    return await fn();
  } finally {
    await releaseAdvisory(key).catch(() => {});
    await releaseRow(key, workerId).catch(() => {});
    console.log(`Released custodial lock on ${key.slice(0, 8)}`);
  }
}