## What actually went wrong

Two separate things, on the same Bags wallet (`ERYS_PLATFORM_PRIVATE_KEY` — the wallet that receives partner-fee payouts and is also the configured source for sponsored escrow funding):

**Launch `0bac9d01` ("Test Erys")** — escrow `CPUQA9...` actually holds **0.099995 SOL on-chain** (one finalized inbound transfer `4CQYPsy4...`). Funding **succeeded**, but the executor recorded it as failed and cancelled the launch. Sequence:

1. Attempt 1: Bags wallet sent 0.0999 SOL → tx landed on-chain, but `confirmTransaction` threw (RPC timeout / blockhash expiry / websocket drop). Executor's catch block recorded a failure. `attempts=1`.
2. Attempt 2: blockhash refreshed → simulation now sees the Bags wallet at ~0.07 SOL (the 0.0999 SOL really was sent in attempt 1). Pre-flight rejects: `insufficient lamports 69760924, need 99995000`. `attempts=2`.
3. Attempt 3: same → `attempts=3` → status flipped to `cancelled`.

**Launch `638c0f1a` ("Etest")** — escrow has 0 SOL, no on-chain history. Genuine failure caused entirely by the Bags wallet running out after attempt 1 above drained it. Correctly cancelled.

Root cause: the funding worker is not idempotent. If a tx silently lands, retries see depleted balance, fail, and burn the slot.

## Fix

### 1. Make `executor/src/fundSponsoredEscrow.ts` idempotent

Before sending any transfer, check the **escrow** balance on-chain:

- If `escrow balance >= transferAmount`, the escrow is already funded from a previous attempt. Skip the transfer entirely, mark `status='scheduled'` and clear lock fields. Try to populate `sponsored_tx_signature` from the escrow's most recent inbound signature (cheap `getSignaturesForAddress` with `limit:1`); fall back to leaving it null.
- Otherwise, proceed with the transfer as today.

Also harden the failure path: when an exception fires *after* `sendRawTransaction` returned a signature (i.e. we have a sig but `confirmTransaction` threw), wait briefly and re-check the escrow balance + the signature status before recording failure. If the SOL is there, treat it as success.

This way: a tx that secretly landed self-heals on the next tick instead of cancelling the slot.

### 2. Recover the stuck launch `0bac9d01` ("Test Erys")

Migration that flips it back into the funding pipeline:

```sql
UPDATE launches
   SET status = 'sponsor_pending_funding',
       sponsor_funding_attempts = 0,
       sponsor_funding_error = null,
       worker_locked_at = null,
       worker_id = null
 WHERE id = '0bac9d01-f5fc-484a-90e3-0d5133368bdd'
   AND status = 'cancelled';
```

After deploy, the next executor tick will see the escrow already holds 0.099995 SOL → mark `scheduled` immediately, no new transfer. Sponsor link works again.

The other launch (`638c0f1a` "Etest") stays cancelled — its escrow is genuinely empty and no SOL was actually moved to it.

### 3. Bags wallet needs a top-up (out of band, no code change)

The Bags wallet is currently at ~0.07 SOL. Once partner-fee claims run, it'll refill from launch fees, but in the meantime it can't fund another sponsored slot. You can either wait for fee claims to top it up or send it some SOL manually. Not a code fix — just calling it out so we don't pretend the next sponsor claim will magically work without enough balance.

## Files to change

- `executor/src/fundSponsoredEscrow.ts` — add pre-send escrow-balance check; harden post-send failure path with a balance/sig recheck before recording failure
- `supabase/migrations/<new>_recover_stuck_sponsored_launch.sql` — single UPDATE for `0bac9d01`

## Verification

1. Executor logs show `Escrow already funded for launch 0bac9d01..., marking scheduled` on the next tick.
2. `launches` row for `0bac9d01` shows `status='scheduled'`, escrow balance unchanged at 0.099995 SOL.
3. Sponsor landing page for that link transitions out of "Funding…" into the success card.
4. Future sponsor claims either fund cleanly or, if a tx silently lands, self-heal next tick instead of cancelling.
