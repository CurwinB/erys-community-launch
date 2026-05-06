## Goal

Right now the date and time inputs only open their picker if you click the tiny calendar/clock icon at the right edge of the field. Clicking anywhere else in the box does nothing. Make clicking anywhere in the input pop the native picker open automatically — for the Pump.fun, Bags, and Sponsored launch forms.

## Approach

Use the browser-native `HTMLInputElement.showPicker()` API on `onClick` (and `onFocus` as a fallback). It's supported in all current Chromium, Firefox, and Safari versions, gracefully no-ops elsewhere. No new dependencies, no custom calendar component, behavior identical to today on mobile.

A tiny shared helper keeps it DRY:

```ts
// inline in each file (or src/lib/utils.ts if preferred)
const openPicker = (e: React.SyntheticEvent<HTMLInputElement>) => {
  try { (e.currentTarget as any).showPicker?.(); } catch {}
};
```

## Changes

### 1. `src/pages/SchedulePage.tsx` (Pump.fun + Bags forms — same form, lines 683–694)
Add `onClick={openPicker}` and `onFocus={openPicker}` to:
- the `Date` input (`type="date"`)
- the `Time` input (`type="time"`)

### 2. `src/pages/SponsoredPage.tsx` (Sponsored launch claim form — line ~370, the `launch_dt` field)
Add `onClick={openPicker}` and `onFocus={openPicker}` to the `datetime-local` input.

That's it. No styling changes, no logic changes, no new components. The native pickers already match the dark theme via existing CSS.

## Out of scope

- Replacing native inputs with a shadcn `<Calendar>` popover (heavier, different UX, and the user only asked to make the existing field easier to trigger).
- Admin tabs (`SponsoredTab`, `LocalSigningTestTab`, etc.) — user specified Pump / Sponsored / Bags public flows only.
