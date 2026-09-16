begin;

create extension if not exists pgcrypto;

create table if not exists public.pulse_reel_movie_likes (
  project_id text not null references public.pulse_reel_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.pulse_reel_movie_comments (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.pulse_reel_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null check (char_length(author_name) between 1 and 80),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.pulse_reel_creator_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, creator_id),
  check (follower_id <> creator_id)
);

create table if not exists public.pulse_reel_movie_shares (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.pulse_reel_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists pulse_reel_movie_likes_project_idx
  on public.pulse_reel_movie_likes (project_id, created_at desc);
create index if not exists pulse_reel_movie_comments_project_idx
  on public.pulse_reel_movie_comments (project_id, created_at desc);
create index if not exists pulse_reel_creator_follows_creator_idx
  on public.pulse_reel_creator_follows (creator_id, created_at desc);
create index if not exists pulse_reel_movie_shares_project_idx
  on public.pulse_reel_movie_shares (project_id, created_at desc);

alter table public.pulse_reel_movie_likes enable row level security;
alter table public.pulse_reel_movie_comments enable row level security;
alter table public.pulse_reel_creator_follows enable row level security;
alter table public.pulse_reel_movie_shares enable row level security;

-- Social state is validated and written only by PulseReel's authenticated API.
-- Mobile clients never receive the service-role credential or direct table access.
revoke all on public.pulse_reel_movie_likes, public.pulse_reel_movie_comments,
  public.pulse_reel_creator_follows, public.pulse_reel_movie_shares
  from anon, authenticated, service_role;
grant select, insert, delete on public.pulse_reel_movie_likes,
  public.pulse_reel_movie_comments, public.pulse_reel_creator_follows,
  public.pulse_reel_movie_shares to service_role;

commit;
