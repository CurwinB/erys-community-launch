// Shared scheduling capacity logic for launch slot allocation.
//
// Pump.fun and Bags.fm have independent throughput ceilings and don't
// interfere with each other, so each platform gets its own per-minute slot
// budget. When a user requests a time slot that's already at capacity, we
// slide them forward to the next minute that has room.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

export type Platform = "bags" | "pumpfun";

// Per-minute base caps. Pump.fun's effective cap scales with the size of the
// PumpPortal wallet pool (1 wallet = 1 launch/min, N wallets = N/min) since
// each wallet is independently lockable. Workers publish the current pool
// size to app_settings on boot.
const BASE_CAPS: Record<Platform, number> = {
  pumpfun: 1,
  bags: 5,
};

let cachedPoolSize: { value: number; expires: number } | null = null;
const POOL_SIZE_TTL_MS = 30_000;

async function getPumpfunPoolSize(supabase: SupabaseClient): Promise<number> {
  if (cachedPoolSize && cachedPoolSize.expires > Date.now()) {
    return cachedPoolSize.value;
  }
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "pumpportal_wallet_pool_size")
      .maybeSingle();
    const parsed = parseInt(data?.value ?? "1", 10);
    const value = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    cachedPoolSize = { value, expires: Date.now() + POOL_SIZE_TTL_MS };
    return value;
  } catch {
    return 1;
  }
}

export async function getPlatformCap(
  supabase: SupabaseClient,
  platform: Platform
): Promise<number> {
  if (platform === "pumpfun") {
    const pool = await getPumpfunPoolSize(supabase);
    return BASE_CAPS.pumpfun * pool;
  }
  return BASE_CAPS[platform];
}

// Kept for callers that need a quick non-async lookup (legacy).
export const PLATFORM_CAPS: Record<Platform, number> = BASE_CAPS;

export interface SlotResult {
  adjustedTime: string; // ISO string
  wasAdjusted: boolean;
  originalTime: string; // ISO string
  offsetMinutes: number;
}

const LOOKAHEAD_MINUTES = 60;

/**
 * Find the next available minute slot for the given platform, starting from
 * `requestedTime` and walking forward. Returns the original time if it's
 * already free.
 *
 * Counts existing launches (status in 'scheduled' or 'executing') in the
 * surrounding window and buckets them by minute. Walks up to LOOKAHEAD_MINUTES
 * forward to find a minute with available capacity.
 */
export async function findNextAvailableSlot(
  supabase: SupabaseClient,
  platform: Platform,
  requestedTime: string
): Promise<SlotResult> {
  const cap = await getPlatformCap(supabase, platform);
  const requested = new Date(requestedTime);
  const windowStart = new Date(requested.getTime() - 60 * 60_000);
  const windowEnd = new Date(requested.getTime() + (LOOKAHEAD_MINUTES + 5) * 60_000);

  const { data, error } = await supabase
    .from("launches")
    .select("launch_datetime")
    .eq("platform", platform)
    .in("status", ["scheduled", "executing"])
    .gte("launch_datetime", windowStart.toISOString())
    .lte("launch_datetime", windowEnd.toISOString());

  if (error) {
    throw new Error(`Slot lookup failed: ${error.message}`);
  }

  // Bucket existing launches by minute (truncate seconds).
  const counts = new Map<number, number>();
  for (const row of data ?? []) {
    const t = new Date(row.launch_datetime).getTime();
    const minuteKey = Math.floor(t / 60_000) * 60_000;
    counts.set(minuteKey, (counts.get(minuteKey) ?? 0) + 1);
  }

  // Truncate requested time to the minute and walk forward.
  const requestedMinuteKey = Math.floor(requested.getTime() / 60_000) * 60_000;

  for (let i = 0; i <= LOOKAHEAD_MINUTES; i++) {
    const candidateKey = requestedMinuteKey + i * 60_000;
    const used = counts.get(candidateKey) ?? 0;
    if (used < cap) {
      const candidate = new Date(candidateKey);
      // Preserve the requested time's seconds/ms only if we're still on the
      // originally requested minute; otherwise snap to :00 for cleanliness.
      let adjustedDate: Date;
      if (i === 0) {
        adjustedDate = requested;
      } else {
        adjustedDate = candidate;
      }
      return {
        adjustedTime: adjustedDate.toISOString(),
        wasAdjusted: i !== 0,
        originalTime: requested.toISOString(),
        offsetMinutes: i,
      };
    }
  }

  // Extremely unlikely fallback: every minute in the lookahead window is full.
  // Push past the window and warn.
  const fallback = new Date(requestedMinuteKey + (LOOKAHEAD_MINUTES + 1) * 60_000);
  console.warn(
    `[scheduleCapacity] No free slot for ${platform} within ${LOOKAHEAD_MINUTES}min of ${requestedTime}; falling back to ${fallback.toISOString()}`
  );
  return {
    adjustedTime: fallback.toISOString(),
    wasAdjusted: true,
    originalTime: requested.toISOString(),
    offsetMinutes: LOOKAHEAD_MINUTES + 1,
  };
}

/**
 * Hash a platform key to a deterministic bigint for pg_advisory_lock.
 * Used to serialize slot allocation across concurrent submissions.
 */
export function platformLockKey(platform: Platform): string {
  return `schedule:${platform}`;
}

export async function withScheduleLock<T>(
  supabase: SupabaseClient,
  platform: Platform,
  fn: () => Promise<T>,
  maxWaitMs = 5_000
): Promise<T> {
  const key = platformLockKey(platform);
  const start = Date.now();
  // Try to acquire; if busy, retry briefly so concurrent submissions queue up
  // rather than racing on the same slot.
  while (true) {
    const { data, error } = await supabase.rpc("try_acquire_custodial_lock", {
      p_key: key,
    });
    if (error) throw new Error(`Lock acquire failed: ${error.message}`);
    if (data === true) break;
    if (Date.now() - start > maxWaitMs) {
      throw new Error("Scheduling is busy, please retry in a moment.");
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    return await fn();
  } finally {
    await supabase.rpc("release_custodial_lock", { p_key: key });
  }
}