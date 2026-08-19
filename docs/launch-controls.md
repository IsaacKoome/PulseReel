# PulseReel launch controls

These controls are opt-in so deploying the code does not change the working MVP.

## 1. Create the database objects

Run `supabase/migrations/202608190001_pulsereel_launch_controls.sql` in the Supabase SQL editor.
The inserted beta configuration is deliberately paused and capped at 20 attempts.

## 2. Add server-only Vercel variables

- `SUPABASE_SERVICE_ROLE_KEY` — never prefix this with `NEXT_PUBLIC_`.
- `PULSEREEL_SUPABASE_STORE_ENABLED=true` — switch project metadata from the legacy Blob JSON file.
- `PULSEREEL_LAUNCH_CONTROLS_ENABLED=true` — enforce one free managed generation per verified account.

Keep the last two flags off until the existing project records have been copied and the database has
been verified. Replicate routing is unaffected by these flags.

With the required values present in `.env.local`, copy the legacy project metadata with:

```powershell
npm run migrate:pulsereel-store
```

The migration is repeatable: it upserts by project ID and does not delete the legacy Blob file.

## 3. Open the controlled beta

The SQL migration creates `pulse_reel_beta_config` with generation paused. After funding Replicate,
open the beta deliberately:

```sql
update public.pulse_reel_beta_config
set generation_enabled = true,
    total_attempt_limit = 20,
    updated_at = now()
where id = true;
```

Emergency pause:

```sql
update public.pulse_reel_beta_config
set generation_enabled = false,
    updated_at = now()
where id = true;
```

The global counter is incremented atomically before a managed provider is called. Failed reservations
allow the user to retry, but the failed attempt still counts toward the global ceiling because provider
failures can still incur cost.
