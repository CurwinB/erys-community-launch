create or replace function public.try_acquire_custodial_lock(p_key text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select pg_try_advisory_lock(hashtextextended(p_key, 0));
$$;

create or replace function public.release_custodial_lock(p_key text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select pg_advisory_unlock(hashtextextended(p_key, 0));
$$;

create table if not exists public.custodial_wallet_locks (
  lock_key text primary key,
  locked_by text not null,
  locked_at timestamptz not null default now()
);

alter table public.custodial_wallet_locks enable row level security;

create policy "Service role manages custodial locks"
on public.custodial_wallet_locks
for all
to service_role
using (true)
with check (true);

create or replace function public.try_acquire_custodial_row_lock(
  p_key text,
  p_worker text,
  p_ttl_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  insert into public.custodial_wallet_locks (lock_key, locked_by, locked_at)
  values (p_key, p_worker, now())
  on conflict (lock_key) do update
    set locked_by = excluded.locked_by,
        locked_at = excluded.locked_at
    where public.custodial_wallet_locks.locked_at
        < now() - make_interval(secs => p_ttl_seconds);
  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;

create or replace function public.release_custodial_row_lock(
  p_key text,
  p_worker text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  delete from public.custodial_wallet_locks
   where lock_key = p_key and locked_by = p_worker;
  select true;
$$;