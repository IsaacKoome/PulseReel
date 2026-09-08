-- Additive paid-billing foundation. Does not enable checkout or change free beta.
begin;

create table if not exists public.pulse_reel_paid_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  available integer not null default 0 check (available >= 0)
);
create table if not exists public.pulse_reel_paid_orders (
  reference text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  pack_id text not null check (pack_id = 'five-attempts-kes-675-v1'),
  amount integer not null check (amount = 67500),
  currency text not null check (currency = 'KES'),
  attempts integer not null check (attempts = 5),
  paid boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.pulse_reel_paid_attempts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id text unique,
  status text not null default 'reserved' check (status in ('reserved', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.pulse_reel_paid_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null unique,
  delta integer not null check (delta <> 0),
  created_at timestamptz not null default now()
);
create index if not exists pulse_reel_paid_orders_user_idx on public.pulse_reel_paid_orders(user_id);
create index if not exists pulse_reel_paid_attempts_user_idx on public.pulse_reel_paid_attempts(user_id);
create index if not exists pulse_reel_paid_ledger_user_idx on public.pulse_reel_paid_ledger(user_id);

alter table public.pulse_reel_paid_wallets enable row level security;
alter table public.pulse_reel_paid_orders enable row level security;
alter table public.pulse_reel_paid_attempts enable row level security;
alter table public.pulse_reel_paid_ledger enable row level security;
revoke all on public.pulse_reel_paid_wallets, public.pulse_reel_paid_orders,
  public.pulse_reel_paid_attempts, public.pulse_reel_paid_ledger from anon, authenticated, service_role;
grant select on public.pulse_reel_paid_wallets, public.pulse_reel_paid_orders,
  public.pulse_reel_paid_attempts, public.pulse_reel_paid_ledger to service_role;
grant insert on public.pulse_reel_paid_orders to service_role;

-- Call ONLY after server verification of a successful LIVE Paystack transaction,
-- matching the stored reference, email, KES amount and pack. Never for test orders.
create or replace function public.pulsereel_grant_paid_order(p_reference text)
returns integer language plpgsql security definer set search_path = '' as $$
declare o public.pulse_reel_paid_orders%rowtype; balance integer;
begin
  select * into o from public.pulse_reel_paid_orders where reference = p_reference for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  insert into public.pulse_reel_paid_wallets(user_id) values (o.user_id) on conflict do nothing;
  select available into balance from public.pulse_reel_paid_wallets where user_id = o.user_id for update;
  if not o.paid then
    update public.pulse_reel_paid_wallets set available = available + o.attempts where user_id = o.user_id
      returning available into balance;
    insert into public.pulse_reel_paid_ledger(user_id, event_key, delta)
      values(o.user_id, 'purchase:' || o.reference, o.attempts);
    update public.pulse_reel_paid_orders set paid = true where reference = o.reference;
  end if;
  return balance;
end;
$$;

-- Caller persists a stable attempt UUID before contacting the generation provider.
-- Wallet lock serializes concurrent requests so the balance cannot go negative.
create or replace function public.pulsereel_reserve_paid_attempt(p_user_id uuid, p_attempt_id uuid, p_project_id text)
returns integer language plpgsql security definer set search_path = '' as $$
declare balance integer; existing public.pulse_reel_paid_attempts%rowtype;
begin
  if p_project_id is null or length(p_project_id) = 0 then raise exception 'PROJECT_REQUIRED'; end if;
  select available into balance from public.pulse_reel_paid_wallets where user_id = p_user_id for update;
  if not found then raise exception 'INSUFFICIENT_ATTEMPTS'; end if;
  select * into existing from public.pulse_reel_paid_attempts where id = p_attempt_id;
  if found then
    if existing.user_id <> p_user_id or existing.project_id <> p_project_id then
      raise exception 'ATTEMPT_MISMATCH';
    end if;
    if existing.status <> 'reserved' then raise exception 'ATTEMPT_ALREADY_FINISHED'; end if;
    return balance;
  end if;
  if balance < 1 then raise exception 'INSUFFICIENT_ATTEMPTS'; end if;
  insert into public.pulse_reel_paid_attempts(id, user_id, project_id) values(p_attempt_id, p_user_id, p_project_id);
  update public.pulse_reel_paid_wallets set available = available - 1 where user_id = p_user_id
    returning available into balance;
  insert into public.pulse_reel_paid_ledger(user_id, event_key, delta)
    values(p_user_id, 'reserve:' || p_attempt_id::text, -1);
  return balance;
end;
$$;

-- Terminal states are immutable; repeated/late events cannot refund twice.
-- A provider timeout is NOT a confirmed failure. Reconcile it before calling this.
create or replace function public.pulsereel_finish_paid_attempt(p_attempt_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.pulse_reel_paid_attempts%rowtype; owner_id uuid;
begin
  if p_status not in ('completed', 'failed') or p_status is null then raise exception 'INVALID_STATUS'; end if;
  select user_id into owner_id from public.pulse_reel_paid_attempts where id = p_attempt_id;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  -- Same lock ordering as reserve: wallet, then attempt.
  perform 1 from public.pulse_reel_paid_wallets where user_id = owner_id for update;
  select * into a from public.pulse_reel_paid_attempts where id = p_attempt_id for update;
  if a.status <> 'reserved' then return; end if;
  update public.pulse_reel_paid_attempts set status = p_status, updated_at = now() where id = p_attempt_id;
  if p_status = 'failed' then
    update public.pulse_reel_paid_wallets set available = available + 1 where user_id = a.user_id;
    insert into public.pulse_reel_paid_ledger(user_id, event_key, delta)
      values(a.user_id, 'restore:' || p_attempt_id::text, 1);
  end if;
end;
$$;

revoke all on function public.pulsereel_grant_paid_order(text) from public, anon, authenticated;
revoke all on function public.pulsereel_reserve_paid_attempt(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.pulsereel_finish_paid_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.pulsereel_grant_paid_order(text) to service_role;
grant execute on function public.pulsereel_reserve_paid_attempt(uuid, uuid, text) to service_role;
grant execute on function public.pulsereel_finish_paid_attempt(uuid, text) to service_role;
commit;
