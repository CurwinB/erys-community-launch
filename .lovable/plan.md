Change sponsored link expiry from 48 hours to 24 hours in `supabase/functions/create-sponsored-slot/index.ts`.

Line 34-36 currently reads:
```
// Link is valid for 48 hours; the influencer picks the actual launch
// time when they claim the slot.
const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
```

Change to:
```
// Link is valid for 24 hours; the influencer picks the actual launch
// time when they claim the slot.
const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
```

That's the only change needed. No database schema or other files are affected.