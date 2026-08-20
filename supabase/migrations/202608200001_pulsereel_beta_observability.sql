create table if not exists public.pulse_reel_beta_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (
    event_type in (
      'sign_in_completed',
      'generation_reserved',
      'generation_submitted',
      'generation_completed',
      'generation_failed',
      'movie_downloaded',
      'movie_shared',
      'beta_paused',
      'beta_resumed'
    )
  ),
  user_id uuid references auth.users(id) on delete set null,
  project_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pulse_reel_beta_events_created_idx
  on public.pulse_reel_beta_events (created_at desc);

create index if not exists pulse_reel_beta_events_user_created_idx
  on public.pulse_reel_beta_events (user_id, created_at desc);

alter table public.pulse_reel_beta_events enable row level security;

-- There are intentionally no browser-facing policies. PulseReel records and reads
-- beta events only through its server-side Supabase secret.
