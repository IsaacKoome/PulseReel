create table if not exists public.pulse_reel_user_beta_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  free_movie_limit integer not null default 1
    check (free_movie_limit between 0 and 10000),
  updated_at timestamptz not null default now()
);

alter table public.pulse_reel_user_beta_limits enable row level security;

-- There are intentionally no browser-facing policies. PulseReel reads and writes
-- personal beta allowances only through its server-side Supabase secret.

drop index if exists public.pulse_reel_one_active_generation_per_user_idx;

create index if not exists pulse_reel_generation_reservations_user_created_idx
  on public.pulse_reel_generation_reservations (user_id, created_at desc);

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
  personal_limit integer;
  personal_attempt_count integer;
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

  select coalesce(
    (
      select free_movie_limit
      from public.pulse_reel_user_beta_limits
      where user_id = p_user_id
    ),
    1
  ) into personal_limit;

  select count(*)::integer into personal_attempt_count
  from public.pulse_reel_generation_reservations
  where user_id = p_user_id
    and status in ('reserved', 'submitted', 'completed');

  if personal_attempt_count >= personal_limit then
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
