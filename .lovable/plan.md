## Goal

Make the 0.3 SOL minimum-raise rule (and auto-refund if not met) clearly visible across the platform UI. Backend already enforces this in `executor/src/executeBags.ts` and `executor/src/executePumpfun.ts` (`MINIMUM_POOL_LAMPORTS = 300_000_000n`), but the UI never tells users.

## Single source of truth

Add `MIN_RAISE_SOL = 0.3` to `src/lib/constants.ts` so every surface uses the same number.

## UI touchpoints

1. **`src/pages/LaunchPage.tsx`** (contribution sidebar)
   - Add a prominent inline notice inside the contribution card (above the Ape In button), e.g. a bordered warning row:
     "Presale must reach **0.3 SOL** total by launch time. If it doesn't, the launch is cancelled and all SOL is refunded automatically to contributor wallets."
   - Reword existing footer microcopy (lines 526–530) to mention the 0.3 SOL threshold explicitly instead of the vague "If the presale is cancelled…".

2. **`src/components/launch/LaunchStats.tsx`**
   - Under the "Presale Raise (SOL)" tile, show progress vs. threshold: small caption like `Min to launch: 0.3 SOL` and a thin progress indicator (or check icon when reached).

3. **`src/pages/SchedulePage.tsx`** (creator flow)
   - In the "Buy Limits" card (around line 745) add a second line:
     "Presale must reach **0.3 SOL** total to launch. Your seed buy counts. If the threshold isn't met, every contributor (including you) is refunded automatically."

4. **`src/components/launch/HowItWorks.tsx`**
   - Append a 4th tile (both `bagsSteps` and `pumpfunSteps`) titled "0.3 SOL Threshold" with body: "If the presale doesn't reach 0.3 SOL by launch time, it's cancelled and SOL is refunded to every contributor's wallet automatically."
   - Adjust grid to `md:grid-cols-4`.

5. **`src/pages/Index.tsx`** (features list, line 156)
   - Change the "Non-Custodial Escrow" body to: "SOL sits in a per-presale escrow on Solana. Presales that don't reach 0.3 SOL are cancelled and refunded automatically."

6. **`src/pages/RiskPage.tsx`** (Section 5 — Refund mechanics, lines 61–64)
   - Add a sentence: "Any presale that fails to reach the 0.3 SOL minimum raise by its scheduled launch time is cancelled automatically and contributions are refunded to the originating wallets."

7. **`src/pages/SponsoredPage.tsx`** (sponsored claim flow)
   - In the "ready" state intro and the success/funding screens, surface a one-liner: "Your token must collect at least 0.3 SOL in presale contributions or it will be cancelled and all SOL refunded."

## Visual style

Reuse existing dark-theme tokens (`bg-card`, `border-border`, `text-muted-foreground`, accent `text-primary` for the `0.3 SOL` value, `JetBrains Mono` for the number). No new colors. Sharp edges, consistent with brand.

## Out of scope

No backend or threshold changes. No new database fields. Just copy + a tiny progress indicator on `LaunchStats`.