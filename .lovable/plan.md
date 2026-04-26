## Lower Pump.fun creator minimum to 0.1 SOL

The current minimum creator seed contribution is **0.21 SOL** for both platforms. The user wants Pump.fun lowered to **0.1 SOL**. Bags stays at **0.21 SOL** (Bags.fm's own protocol requires the net initial buy to be ≥ 0.2 SOL — we can't safely lower that one).

The hard floor enforced in `executor/src/executePumpfun.ts` is only **0.01 SOL** of net initial buy, so 0.1 SOL leaves ample headroom for ATA / tx-fee reserves.

### Change

In `src/pages/SchedulePage.tsx`:

```ts
const MIN_CREATOR_SOL_PUMPFUN = 0.1;   // was 0.21
const MIN_CREATOR_SOL_BAGS = 0.21;     // unchanged
```

Update the inline comment above these constants to reflect that Pump.fun's effective net-buy floor in our executor is 0.01 SOL, and we set the UI minimum to 0.1 SOL to give creators a meaningful initial buy while staying well above protocol/reserve requirements. Bags remains at 0.21 SOL because Bags.fm requires the net initial buy to be ≥ 0.2 SOL.

The existing live validation at line 122 (`creatorContribNum < minCreatorSol`) will automatically pick up the new value and update the error message ("Minimum 0.1 SOL (required by Pump.fun)").

### Files modified

- `src/pages/SchedulePage.tsx` — change `MIN_CREATOR_SOL_PUMPFUN` constant + update comment.

No DB, edge function, or executor changes required.</content>
