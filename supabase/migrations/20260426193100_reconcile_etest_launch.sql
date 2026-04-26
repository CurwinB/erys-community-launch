-- One-shot reconciliation for the ETEST Pump.fun launch where the mint
-- succeeded on-chain but the executor's token sweep failed (Token-2022
-- detection bug). The on-chain mint signature was lost into execution_error
-- because setFailedNoRefund had not yet been deployed at the time. Auto-
-- refund then ran and could only refund a tiny dust amount before escrow
-- was empty (SOL is in the bonding curve already).
--
-- This migration:
--   1) Restores the launch signature on the row.
--   2) Flips status to the new sweep_recovery state.
--   3) Clears stale refund_tx_signature / refund_shortfall_lamports on
--      contributions so the upcoming token distribution treats both
--      contributors as live. The dust refund is left as a sunk cost; the
--      on-chain SOL balance reflects reality and contributors will be
--      paid in tokens, not SOL.
--   4) Clears any worker lock so recovery can claim it cleanly.
UPDATE public.launches
   SET pumpfun_launch_signature = '3T5aZSxFsTG1zEsM2rudWxbz99pbGqKquXEwaZtRxvjdgu7Bsou5999oKSf852VribibJAEJ7DhNDFeAvZroZfHC',
       status = 'sweep_recovery',
       worker_locked_at = NULL,
       worker_id = NULL
 WHERE id = '9caf31b8-af12-4feb-8f72-32539e903461';

UPDATE public.contributions
   SET refund_tx_signature = NULL,
       refund_shortfall_lamports = 0
 WHERE launch_id = '9caf31b8-af12-4feb-8f72-32539e903461';
