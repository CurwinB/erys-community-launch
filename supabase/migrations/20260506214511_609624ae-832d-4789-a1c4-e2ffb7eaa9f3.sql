
create table public.pump_keypair_pool (
  id uuid primary key default gen_random_uuid(),
  public_key text not null unique,
  encrypted_private_key text not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by_launch_id uuid
);

create index pump_keypair_pool_unclaimed_idx
  on public.pump_keypair_pool (created_at)
  where claimed_at is null;

alter table public.pump_keypair_pool enable row level security;

create policy "Service role manages pump_keypair_pool"
  on public.pump_keypair_pool for all
  to service_role using (true) with check (true);

create policy "Deny public reads of pump_keypair_pool"
  on public.pump_keypair_pool for select
  to public using (false);

create or replace function public.claim_pump_keypair_from_pool(p_launch_id uuid default null)
returns table (id uuid, public_key text, encrypted_private_key text)
language sql
security definer
set search_path = public
as $$
  update public.pump_keypair_pool p
  set claimed_at = now(),
      claimed_by_launch_id = p_launch_id
  where p.id = (
    select id from public.pump_keypair_pool
    where claimed_at is null
    order by created_at asc
    limit 1
    for update skip locked
  )
  returning p.id, p.public_key, p.encrypted_private_key;
$$;

revoke all on function public.claim_pump_keypair_from_pool(uuid) from public, anon, authenticated;
grant execute on function public.claim_pump_keypair_from_pool(uuid) to service_role;
