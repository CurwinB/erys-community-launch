# Rename "Presalers" → "Contributors" in UI

Replace the user-facing label "Presaler"/"Presalers" with "Contributor"/"Contributors" everywhere it appears in the UI.

## Files to update

- `src/components/LaunchCard.tsx` — stat label "Presalers" → "Contributors"
- `src/components/launch/LaunchStats.tsx` — stat label "Presalers" → "Contributors"
- `src/pages/SchedulePage.tsx` — 4 occurrences in helper text ("Presalers earn…", "Presalers get…", "All presaler SOL…" ×2) → "Contributors…"

## Out of scope

- Database column/field names, internal variable names, and the word "presale" itself (which describes the launch type, not the people). Only the noun referring to participants changes.
