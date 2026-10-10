begin;

create extension if not exists pgcrypto;

create table if not exists public.pulse_reel_user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_user_id),
  check (blocker_id <> blocked_user_id)
);

create table if not exists public.pulse_reel_content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null references public.pulse_reel_projects(id) on delete cascade,
  comment_id uuid references public.pulse_reel_movie_comments(id) on delete cascade,
  reported_user_id uuid references auth.users(id) on delete set null,
  reason text not null check (reason in (
    'inappropriate',
    'harassment',
    'sexual_content',
    'violence',
    'misleading',
    'other'
  )),
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.pulse_reel_account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'completed', 'cancelled')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists pulse_reel_user_blocks_blocked_idx
  on public.pulse_reel_user_blocks (blocked_user_id, created_at desc);
create index if not exists pulse_reel_content_reports_status_idx
  on public.pulse_reel_content_reports (status, created_at asc);
create index if not exists pulse_reel_deletion_requests_status_idx
  on public.pulse_reel_account_deletion_requests (status, requested_at asc);

alter table public.pulse_reel_user_blocks enable row level security;
alter table public.pulse_reel_content_reports enable row level security;
alter table public.pulse_reel_account_deletion_requests enable row level security;

-- Safety data is accepted only by authenticated PulseReel API routes.
-- It is not directly readable or writable from the mobile client.
revoke all on public.pulse_reel_user_blocks,
  public.pulse_reel_content_reports,
  public.pulse_reel_account_deletion_requests
  from anon, authenticated, service_role;
grant select, insert, update, delete on public.pulse_reel_user_blocks,
  public.pulse_reel_content_reports,
  public.pulse_reel_account_deletion_requests
  to service_role;

commit;
