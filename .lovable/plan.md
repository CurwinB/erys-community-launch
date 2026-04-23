

# Platform-specific contributor messaging on Launch Page

## What to build

Update the launch page so contributors clearly understand they receive **both tokens AND** (for Bags) **fee share** — not just fees. Make all messaging branch on `launch.platform` (`pumpfun` vs `bags`).

## Changes

### 1. `src/components/launch/HowItWorks.tsx`
- Convert to accept a `platform` prop (`"pumpfun" | "bags"`).
- Define two step arrays:
  - **Bags**: Contribute SOL → Receive Tokens → Earn Trading Fees Forever
  - **Pump.fun**: Contribute SOL → Receive Tokens at Launch Price → Early Entry Advantage
- Render the array matching the platform. Keep existing card styling (border, numbered badge).

### 2. `src/pages/LaunchPage.tsx`

**a. Pass platform to HowItWorks:**
```tsx
<HowItWorks platform={launch.platform} />
```

**b. Add a "What you receive" summary card directly above the SOL amount input** inside the contribute card (the `border border-primary/30 bg-card p-6` block). Bullet list with success-colored dots:
- Pump.fun: tokens proportional to contribution / earliest entry price / auto-sent at launch
- Bags: tokens proportional to contribution / permanent on-chain trading fee share / tokens + fees auto-sent at launch

**c. Update the existing escrow info banner** (the small text at the bottom of the contribute card) so it explicitly mentions tokens for both platforms:
- Bags: "Your SOL is held in escrow until launch. You will receive tokens AND be registered as a permanent Bags fee share recipient proportional to your contribution. If this launch is cancelled your SOL is refunded automatically."
- Pump.fun: "Your SOL is held in escrow until launch. You will receive tokens at the earliest possible entry price proportional to your contribution. If this launch is cancelled your SOL is refunded automatically." (already correct — leave as-is)

## Out of scope

No backend, schema, or other component changes. The current `HowItWorks` is a separate file (`src/components/launch/HowItWorks.tsx`), so it's edited there rather than inlined into `LaunchPage.tsx` — net behavior matches the request.

## Files edited

- `src/components/launch/HowItWorks.tsx`
- `src/pages/LaunchPage.tsx`

