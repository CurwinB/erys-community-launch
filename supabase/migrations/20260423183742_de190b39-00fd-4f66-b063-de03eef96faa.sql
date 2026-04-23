alter table public.contributions
  add column if not exists refund_shortfall_lamports bigint default 0;