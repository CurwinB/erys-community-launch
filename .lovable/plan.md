# Telegram UX additions

Two purely cosmetic changes. No data flow, storage, or API contracts touched.

## Files to touch

1. `src/pages/SchedulePage.tsx` — under the existing Telegram URL `<Input>` (around line 676), add a muted helper line.
2. `src/pages/SponsoredPage.tsx` — under the existing Telegram URL `<Input>` (around line 437), add the same muted helper line.
3. `src/pages/LaunchPage.tsx` — on the success `toast(...)` call (line 218, "You're in."), conditionally attach a `ToastAction` button labelled "Join the Telegram" when `launch.telegram_url` is a non-empty string.

## Details

### 1 & 2. Helper text under Telegram input

Insert directly after each Telegram `<Input>`:

```tsx
<p className="text-[10px] text-muted-foreground mt-1">
  Add your Telegram so contributors can coordinate the shill together.
</p>
```

Field label, input, state, validation, and the `telegram_url` payload sent to edge functions remain unchanged.

### 3. Contribution success — Telegram action

The "success popup" is the shadcn toast fired at line 218 of `LaunchPage.tsx`:

```ts
toast({ title: "You're in.", description: `${sol} SOL allocation locked on-chain.` });
```

Change to:

```ts
const tg = launch.telegram_url?.trim();
toast({
  title: "You're in.",
  description: `${sol} SOL allocation locked on-chain.`,
  ...(tg
    ? {
        action: (
          <ToastAction
            altText="Join the Telegram"
            onClick={() => window.open(tg, "_blank", "noopener,noreferrer")}
          >
            Join the Telegram
          </ToastAction>
        ),
      }
    : {}),
});
```

Add `import { ToastAction } from "@/components/ui/toast";` at the top of `LaunchPage.tsx`.

If `telegram_url` is null, empty, or whitespace, the toast renders exactly as today — no button, no layout change.

## Out of scope

- No changes to how `telegramUrl` / `telegram_url` is captured, validated, stored, or transmitted.
- No changes to the toast title/description copy or styling.
- No edge function, DB, or distributor/executor changes.
