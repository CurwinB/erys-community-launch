## Goal

Make the system aware of its own throughput limits when users schedule launches. Instead of rejecting overlapping launches, **automatically slide each new launch into the next available time slot** for its platform — and show the user the adjusted time before they confirm.

Pump.fun and Bags.fm have separate capacity ceilings and don't interfere with each other, so each platform is scheduled on its own independent timeline.

## Capacity Rules (per platform)

Based on the bottleneck analysis:

| Platform  | Throughput per minute | Slot size | Reason |
|-----------|-----------------------|-----------|--------|
| Pump.fun  | 1 launch / minute     | 60 seconds | Serialized by `withCustodialLock` on the shared PumpPortal wallet (~10s per launch + safety margin) |
| Bags.fm   | 5 launches / minute   | 12 seconds | Independent escrows; bounded by RPC rate limits and replica count |

These ceilings live in a single config file (`supabase/functions/_shared/scheduleCapacity.ts`) so they're easy to tune later.

## How it Works

### 1. Slot picker (shared edge-function helper)

A new helper `findNextAvailableSlot(platform, requestedTime)`:
- Queries `launches` for all rows on the same platform within a ±60-minute window of `requestedTime`, where `status IN ('scheduled','executing')`.
- Buckets them into per-minute counts.
- Walks forward from `requestedTime` minute-by-minute until it finds a minute whose count is below the platform's cap.
- For Pump.fun (cap = 1), this means: if 8:00 PM is taken, try 8:01, 8:02, etc.
- For Bags (cap = 5), 8:00 PM holds 5 launches before pushing to 8:01.
- Returns `{ adjustedTime, wasAdjusted, originalTime, offsetMinutes }`.

### 2. Server-side enforcement (source of truth)

Both `create-launch` and `create-launch-pumpfun` edge functions:
- Run `findNextAvailableSlot(platform, launch_datetime)` before inserting.
- Insert with the **adjusted** time, not the user-requested time.
- Return `{ launch_id, escrow_wallet, adjusted_launch_datetime, original_launch_datetime, was_adjusted }` in the response.
- Wrap the slot lookup + insert in an advisory lock (`pg_try_advisory_lock` keyed by platform) so two simultaneous submissions can't both grab the same slot.

### 3. Client-side preview (UX)

`SchedulePage.tsx`:

**a. Live availability hint under the time picker.** When the user picks a date+time, debounce 300ms and call a new lightweight edge function `check-launch-slot` that returns the adjusted time without inserting anything. Show one of:
- ✅ "8:00 PM is available."
- ⚠ "8:00 PM is full on Pump.fun — your launch will be scheduled for **8:03 PM**."

**b. Confirmation on submit.** If the server returns `was_adjusted: true`, show a toast/inline message after creation:
> "Your launch was moved from 8:00 PM to 8:03 PM — the original slot was full."

The success screen also displays the actual scheduled time.

### 4. Display in calendar / dashboard

`Index.tsx` and `DashboardPage.tsx` already render launches by `launch_datetime`. No changes needed — they'll naturally show the adjusted time.

## Technical Details

**New files:**
- `supabase/functions/_shared/scheduleCapacity.ts` — caps + `findNextAvailableSlot()` helper, shared between create + check functions.
- `supabase/functions/check-launch-slot/index.ts` — public read-only function: takes `{ platform, launch_datetime }`, returns adjusted slot. No DB writes.

**Modified files:**
- `supabase/functions/create-launch/index.ts` — call slot picker, insert adjusted time, return adjustment metadata. Use advisory lock `schedule:bags` during the lookup+insert.
- `supabase/functions/create-launch-pumpfun/index.ts` — same pattern with lock key `schedule:pumpfun`.
- `src/pages/SchedulePage.tsx` — debounced availability check, inline hint UI, toast on adjustment, success screen shows actual time.

**No DB migration needed.** All logic uses the existing `launches.launch_datetime` + `launches.platform` + `launches.status` columns. Both columns are already indexed via the worker-claim queries; if performance becomes an issue we can add a partial index later.

**Lookahead window:** the slot picker scans up to 60 minutes forward. If somehow every minute is full for an hour (extremely unlikely), it falls back to the next minute past the window with a warning logged. This avoids unbounded loops.

**Existing "10 min from now / within 72 hr" guard stays**, applied to the *original* requested time. The adjusted time may push a few minutes past 72h in the worst case — we accept this since the offset is small.

## Out of Scope

- Adjusting capacity caps dynamically based on replica count (manual tune for now).
- Reshuffling already-scheduled launches when capacity changes.
- Sponsored-slot reservation logic (separate concern; current sponsored-slot flow is unaffected because it goes through its own path).
