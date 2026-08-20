create table if not exists public.pulse_reel_movie_feedback (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.pulse_reel_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  identity_rating smallint not null check (identity_rating between 1 and 5),
  movie_rating smallint not null check (movie_rating between 1 and 5),
  willingness_to_pay text not null check (willingness_to_pay in ('yes', 'maybe', 'no')),
  comment text not null default '' check (char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create index if not exists pulse_reel_movie_feedback_created_idx
  on public.pulse_reel_movie_feedback (created_at desc);

alter table public.pulse_reel_movie_feedback enable row level security;

-- Feedback is written and reviewed only through PulseReel's server-side secret.
-- There are intentionally no browser-facing policies.
