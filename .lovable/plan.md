You’re right. The evidence points to two real bugs on our side, not “no fees.”

What I found:
- `ETEST` is in the DB as `platform = pumpfun`, `status = launched`, with mint `JAQch38sjEK752q98NVMWMbmNuuZsjoENHVYc9b8Ceay`.
- The preview is getting `401 permission denied for table launches` on launch queries. That is why the UI can falsely show missing/no launched tokens. The processing-fee columns were added to the frontend select list, but the browser roles were not granted column-level SELECT for the new safe columns.
- The Pump.fun fee worker is fragile: it measures only the balance delta from the latest `collectCreatorFee` call and then fans out through escrow wallets. If the PumpPortal custodial wallet already has accumulated claimed SOL, or if a claim succeeds but the delta accounting is too small/negative after fees, the surplus can sit in the PumpPortal wallet and never get swept to treasury.
- Admin revenue/accounting still treats Pump.fun claimed fees as a 50% Erys share in places, even though the current business rule/code comments say Erys takes 100% of Pump.fun creator fees.

Plan to fix it:

1. Restore launch visibility in the app/admin UI
   - Add a Supabase migration granting browser roles SELECT on the newly added safe launch columns:
     - `processing_fee_lamports`
     - `processing_fee_tx_signature`
     - `pumpfun_last_claim_attempt_at`
     - `pumpfun_last_claim_error`
     - any other Pump.fun health columns the admin panel reads
   - Keep encrypted private-key columns revoked.
   - This fixes the “No launched Pump.fun tokens” / missing launch screen issue caused by permission-denied queries.

2. Replace the Pump.fun fee sweep path with a direct treasury sweep
   - Update `distributor/src/claimPumpfunFeesBatch.ts` so after `collectCreatorFee` it computes:
     ```text
     sweepable = current PumpPortal custodial balance - custodial floor - tx fee reserve
     ```
   - If `sweepable > 0`, send it directly from the PumpPortal custodial wallet to `BAGS_PARTNER_WALLET`.
   - This sweeps both newly claimed fees and any SOL already stuck in the PumpPortal wallet above the reserved floor.
   - Keep the custodial lock around claim + sweep so no executor/fee worker can race the shared wallet.

3. Add explicit Pump.fun treasury-sweep accounting
   - Add a `pumpfun_fee_sweeps` table with:
     - amount lamports sent to treasury
     - sweep transaction signature
     - source custodial wallet
     - treasury wallet
     - related launch id when attributable
     - timestamps and optional notes
   - Add a service-role-only insert/update policy.
   - Add a DB function like `record_pumpfun_fee_treasury_sweep(...)` that atomically:
     - inserts the sweep ledger row
     - updates launch claim/sweep totals
     - clears stale Pump.fun claim errors
     - releases/refreshes throttles correctly

4. Fix Pump.fun admin revenue math
   - Update `PlatformRevenueTab`, `AccountingTab`, and admin metric revenue calculations so Pump.fun fee revenue is treated as 100% of swept/claimed Pump.fun fees, not 50%.
   - Show actual treasury sweep tx signatures where available instead of only estimated rows.

5. Force the stuck `ETEST` balance through the fixed path
   - Clear the claim throttle/worker lock for the launched `ETEST` row so the next distributor cycle immediately retries.
   - Because the new logic sweeps existing custodial surplus, it should move the stuck PumpPortal-wallet SOL to treasury even if the next `collectCreatorFee` call itself returns no new fees.

6. Validate after implementation
   - Confirm the frontend launch queries no longer return 401.
   - Confirm `ETEST` appears as launched in the Pump.fun health panel.
   - Confirm the distributor logs a custodial-to-treasury transfer.
   - Confirm DB accounting rows/totals update after the sweep.
   - Confirm admin revenue/accounting no longer halves Pump.fun fees.

Technical details:
- Files expected to change:
  - `distributor/src/claimPumpfunFeesBatch.ts`
  - `distributor/src/db.ts`
  - `src/pages/AdminPage.tsx`
  - `src/components/admin/PumpfunFeeHealthPanel.tsx`
  - `src/components/admin/PlatformRevenueTab.tsx`
  - `src/components/admin/AccountingTab.tsx`
  - `src/lib/constants.ts`
  - new Supabase migration for grants/accounting table/RPC/throttle reset
- No changes to public contribution or scheduling UI.