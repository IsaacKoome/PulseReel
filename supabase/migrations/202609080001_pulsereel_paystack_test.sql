-- Sandbox only: no connection to generation allowances or real-money balances.
create table if not exists public.pulse_reel_test_orders (
  reference text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  amount integer not null check (amount > 0),
  currency text not null check (currency = 'KES'),
  credits integer not null check (credits > 0),
  paid boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists pulse_reel_test_orders_user_idx on public.pulse_reel_test_orders(user_id);
alter table public.pulse_reel_test_orders enable row level security;
revoke all on public.pulse_reel_test_orders from anon, authenticated;
grant select, insert, update on public.pulse_reel_test_orders to service_role;
