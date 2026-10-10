-- Read-only release readiness check. Run in the MimiReel Supabase SQL Editor.
-- Does not read user records or change schema, data, or permissions.
select v.table_name,
       c.oid is not null as table_exists,
       c.relrowsecurity as rls_enabled,
       case when c.oid is not null then has_table_privilege('service_role', c.oid, 'SELECT') end as server_select,
       case when c.oid is not null then has_table_privilege('service_role', c.oid, 'INSERT') end as server_insert,
       case when c.oid is not null then has_table_privilege('service_role', c.oid, 'UPDATE') end as server_update,
       case when c.oid is not null then has_table_privilege('service_role', c.oid, 'DELETE') end as server_delete,
       case when c.oid is not null then has_table_privilege('anon', c.oid, 'SELECT') end as anonymous_select,
       case when c.oid is not null then has_table_privilege('authenticated', c.oid, 'SELECT') end as client_select
from (values
  ('pulse_reel_user_blocks'),
  ('pulse_reel_content_reports'),
  ('pulse_reel_account_deletion_requests'),
  ('pulse_reel_movie_likes'),
  ('pulse_reel_creator_follows')
) as v(table_name)
left join pg_namespace n on n.nspname = 'public'
left join pg_class c on c.relnamespace = n.oid and c.relname = v.table_name and c.relkind in ('r', 'p')
order by v.table_name;
