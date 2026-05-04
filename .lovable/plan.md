## Problem

When a user apes an amount below the platform minimum (0.1 SOL), the toast shows:

> **Ape failed** — Edge Function returned a non-2xx status code

That's the generic `FunctionsHttpError.message` from `supabase.functions.invoke`. The real, helpful message ("Minimum contribution is 0.1 SOL. You sent 0.05 SOL.") lives in the edge function's JSON response body but is never read.

Note: the `contribute` edge function currently only enforces a single platform floor of **0.1 SOL** — there is no creator-set min/max anymore (per-launch overrides were removed). So in practice the only "below min" case is < 0.1 SOL, and there is no "above max" case. The fix focuses on surfacing whatever message the edge function returns, plus a client-side pre-check for the common case.

## Fix

Edit `src/pages/LaunchPage.tsx` `handleContribute`:

1. **Client-side pre-check before signing.** If `sol < 0.1`, show a friendly toast immediately and return — no wallet popup, no tx, no edge call:
   - Title: `Below minimum buy`
   - Description: `Minimum ape is 0.1 SOL. You entered {sol} SOL.`

2. **Read the real edge-function error body.** When `supabase.functions.invoke("contribute", …)` returns an `error`, parse `error.context` (the underlying `Response`) to extract the JSON `{ error: "..." }` field returned by the function, and use that as the toast description. Fallback to `err.message` only if parsing fails.

3. **Friendlier titles by status code:**
   - 400 / 422 → `Couldn't place ape` (validation / not-confirmed-yet)
   - 404 → `Launch unavailable`
   - 409 → `Already recorded` (duplicate tx)
   - 500 / other → keep `Ape failed`

4. **Tweak the input helper text** under the SOL input from `Min buy: 0.1 SOL` to make it clear it's a hard floor (already says this — no change needed unless we also want to disable the Ape In button when amount < 0.1, which is a nice touch). Add: button stays enabled but the pre-check in step 1 catches it.

## Technical detail

```ts
// Replace the catch / error branch:
const { error } = await supabase.functions.invoke("contribute", { body: {...} });
if (error) {
  let serverMsg = error.message;
  let status = 0;
  try {
    const ctx = (error as any).context as Response | undefined;
    if (ctx) {
      status = ctx.status;
      const body = await ctx.clone().json();
      if (body?.error) serverMsg = body.error;
    }
  } catch {}
  const title =
    status === 400 || status === 422 ? "Couldn't place ape"
    : status === 404 ? "Launch unavailable"
    : status === 409 ? "Already recorded"
    : "Ape failed";
  toast({ title, description: serverMsg, variant: "destructive" });
  return;
}
```

And add at the top of `handleContribute`, right after the existing `sol <= 0` check:

```ts
if (sol < 0.1) {
  toast({
    title: "Below minimum buy",
    description: `Minimum ape is 0.1 SOL. You entered ${sol} SOL.`,
    variant: "destructive",
  });
  return;
}
```

No edge-function, DB, or executor changes. Single file edit: `src/pages/LaunchPage.tsx`.

## Out of scope

- Re-introducing per-launch creator min/max (none exists today; would require schema + edge changes).
- Changing the platform 0.1 SOL floor.
