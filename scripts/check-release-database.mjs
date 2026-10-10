import { createClient } from '@supabase/supabase-js';

// Read-only schema readiness check. Never print credentials or account records.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Database readiness unverified: local server credentials are unavailable.');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
let failed = false;
for (const [table, columns] of [
  ['pulse_reel_user_blocks', 'blocker_id,blocked_user_id'],
  ['pulse_reel_content_reports', 'id,comment_id,status'],
  ['pulse_reel_account_deletion_requests', 'id,user_id,status'],
  ['pulse_reel_movie_likes', 'project_id,user_id'],
  ['pulse_reel_creator_follows', 'follower_id,creator_id'],
]) {
  const { error } = await db.from(table).select(columns).limit(0);
  console.log(`${table}: ${error ? `NOT READY (${error.code || 'unknown'})` : 'readable; expected columns present'}`);
  failed ||= Boolean(error);
}
console.log('This does not verify write grants, migration history, or backup coverage.');
process.exitCode = failed ? 1 : 0;
