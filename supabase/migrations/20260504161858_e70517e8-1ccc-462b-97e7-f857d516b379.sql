ALTER TABLE public.contributions
  ADD COLUMN pending_orphan_refund boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_contributions_pending_orphan_refund
  ON public.contributions (pending_orphan_refund)
  WHERE pending_orphan_refund = true;