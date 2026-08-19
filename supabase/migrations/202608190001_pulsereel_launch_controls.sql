create extension if not exists pgcrypto;

create table if not exists public.pulse_reel_projects (
  id text primary key,
  slug text not null unique,
  owner_id uuid references auth.users(id) on delete set null,
  visibility text not null default 'unlisted' check (visibility in ('public', 'unlisted')),
  status text not null check (status in ('draft', 'processing', 'published', 'failed')),
  project jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists pulse_reel_projects_owner_created_idx
  on public.pulse_reel_projects (owner_id, created_at desc);

alter table public.pulse_reel_projects enable row level security;

drop policy if exists "owners can read their PulseReel projects" on public.pulse_reel_projects;
create policy "owners can read their PulseReel projects"
  on public.pulse_reel_projects for select
  to authenticated
  using (auth.uid() = owner_id);

drop policy if exists "owners can delete their PulseReel projects" on public.pulse_reel_projects;
create policy "owners can delete their PulseReel projects"
  on public.pulse_reel_projects for delete
  to authenticated
  using (auth.uid() = owner_id);

create table if not exists public.pulse_reel_beta_config (
  id boolean primary key default true check (id),
  generation_enabled boolean not null default false,
  total_attempt_limit integer not null default 20 check (total_attempt_limit >= 0),
  total_attempt_count integer not null default 0 check (total_attempt_count >= 0),
  updated_at timestamptz not null default now()
);

insert into public.pulse_reel_beta_config (id, generation_enabled, total_attempt_limit)
values (true, false, 20)
on conflict (id) do nothing;

create table if not exists public.pulse_reel_generation_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id text,
  provider text not null,
  status text not null default 'reserved'
    check (status in ('reserved', 'submitted', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pulse_reel_one_active_generation_per_user_idx
  on public.pulse_reel_generation_reservations (user_id)
  where status in ('reserved', 'submitted', 'completed');

alter table public.pulse_reel_beta_config enable row level security;
alter table public.pulse_reel_generation_reservations enable row level security;

drop policy if exists "users can read their PulseReel generation record" on public.pulse_reel_generation_reservations;
create policy "users can read their PulseReel generation record"
  on public.pulse_reel_generation_reservations for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.pulsereel_reserve_generation(
  p_user_id uuid,
  p_provider text
)
returns table (reservation_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  config_row public.pulse_reel_beta_config%rowtype;
  new_reservation_id uuid;
begin
  select * into config_row
  from public.pulse_reel_beta_config
  where id = true
  for update;

  if not found or not config_row.generation_enabled then
    raise exception 'PULSEREEL_GENERATION_PAUSED';
  end if;

  if config_row.total_attempt_count >= config_row.total_attempt_limit then
    raise exception 'PULSEREEL_GLOBAL_LIMIT_REACHED';
  end if;

  if exists (
    select 1
    from public.pulse_reel_generation_reservations
    where user_id = p_user_id
      and status in ('reserved', 'submitted', 'completed')
  ) then
    raise exception 'PULSEREEL_FREE_GENERATION_USED';
  end if;

  insert into public.pulse_reel_generation_reservations (user_id, provider)
  values (p_user_id, p_provider)
  returning id into new_reservation_id;

  update public.pulse_reel_beta_config
  set total_attempt_count = total_attempt_count + 1,
      updated_at = now()
  where id = true;

  return query select new_reservation_id;
end;
$$;

revoke all on function public.pulsereel_reserve_generation(uuid, text) from public;
revoke all on function public.pulsereel_reserve_generation(uuid, text) from anon;
revoke all on function public.pulsereel_reserve_generation(uuid, text) from authenticated;
grant execute on function public.pulsereel_reserve_generation(uuid, text) to service_role;
