# MimiReel backup and smoke-test handoff

Prepared 1 October 2026. This is a preparation checklist, **not evidence that a live backup has been made**. No production configuration or data was changed while preparing it.

## 1. Back up before another production change

The Pulsereel Supabase project is `dmfuicqpkpbqjhqpdzqo`. The Supabase Free plan does not provide downloadable dashboard backups. Supabase's supported manual route is its CLI `db dump` command, which uses Docker. The Supabase CLI and Docker are not installed or available in this checkout, and no database password or connection string is configured locally. Do not paste the database password or a full connection string into chat, source code, terminal logs, or a Git commit.

When those prerequisites are available, use the Supabase dashboard's **Connect** panel to obtain the correct database connection method, and follow [Supabase's backup-and-restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) to export roles, schema, and data into a private folder **outside this repository**. Use the exact project reference above to verify the target before starting. Keep a dated manifest with file names, nonzero sizes, and checksums; do not treat an empty or failed dump as a backup.

The CLI's standard dump excludes Supabase-managed `auth` and `storage` schemas. These three SQL files therefore are **not a complete recovery image** for Google sign-in accounts, Supabase Storage, or Vercel Blob videos. Record any Auth, Storage, and Blob recovery needs separately before relying on a restore. Do not run `supabase db reset --linked`, `db push`, or a restore against production as a backup test: those commands change the live database.

Backup completion gate:

- [ ] Verify the target project reference and database connection in Supabase.
- [ ] Install/confirm a compatible Supabase CLI and running Docker.
- [ ] Export roles, schema, and data to a private folder outside the repo.
- [ ] Check all three files are present and nonempty; record hashes and date.
- [ ] Identify coverage gaps for Auth, Storage, and Vercel Blob media.
- [ ] Only then proceed with any production schema or storage migration.

## 2. Checks already completed locally (1 October 2026)

- `npm.cmd test`: 33 passed, 0 failed.
- `npm.cmd run build`: passed.
- `apps/mobile`: `npm.cmd run typecheck`: passed.
- `node scripts/check-deployment-traces.cjs`: passed (43 traces checked).
- Live public HTTP checks: the feed, Privacy, Terms, identity-safety, data-deletion, and the existing `getting-ready-to-go-creator-aaff6c` movie page each returned HTTP 200. This confirms only that the pages respond, not that their interactive behavior works.

These checks do **not** prove that the deployed site, phone build, Supabase project, worker, or paid generation path works end to end.

## 3. End-to-end smoke test, without spending a movie attempt

Use the existing release checklist at `apps/mobile/docs/google-play/release-checklist.md` for the full phone test. Start with these safe checks and record the device, app version, network, expected result, and actual result for each:

1. Open the public web feed and a shared movie link. Confirm playback, title, creator label, and navigation.
2. Open Privacy, Terms, identity-safety, and data-deletion pages while signed out.
3. On the current MimiReel phone build, sign in with **one** test account, close/reopen the app, and confirm the session is retained. Sign out and confirm protected screens request sign-in.
4. Test camera and gallery permissions and select/record a short source clip. Stop **before** the final generation/submit action; this avoids consuming a limited movie attempt.
5. View existing movies: playback, like, comment, follow/unfollow, share, and private/published labels. Test report/block only on designated test accounts or content, since those actions persist.
6. Background and resume the app; switch Wi-Fi/mobile data; confirm useful offline and retry states. Do not submit another generation during this pass.
7. Confirm a Play-release build does not open external Paystack checkout.

After the backup is verified and the user explicitly approves spending an attempt, run **one** paid/limited generation test with a chosen source clip, note its project ID, watch processing to completion, and check the movie on web and mobile. Do not retry automatically if the provider status is uncertain.

### References

- [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase CLI `db dump` reference](https://supabase.com/docs/reference/cli/v0/supabase-orgs#supabase-db-dump)
- [Supabase backup-and-restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
