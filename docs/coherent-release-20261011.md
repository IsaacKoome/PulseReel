# MimiReel coherent release candidate — 11 October 2026

## Baseline and rollback

Prepared in the attached `mimireel-web-release` worktree on branch
`codex/mimireel-coherent-release`, based on production commit `5ac1b84`.
Local rollback reference: `codex/rollback-before-coherent-release-20261011`.
The original checkout and its local runtime/build files are preserved.

Do not infer deployment from a local commit. Confirm the deployed commit and Ready
status in Vercel, then smoke-test the live site. For rollback, promote the previous
known-good Vercel deployment; do not reset the original working directory.

## Release boundaries

- Server safety endpoints, authenticated blocked-creator filtering, and policy text.
- R2 support for new direct Seedance output, explicitly disabled unless opted in.
- Web playback does not preload movies before user intent.
- Mobile photo preparation, safety controls, branding, and lower buffering are
  source changes only until a separate Android release is built and published.
- No live database mutations, billing activation, media deletion, or bulk migration.
- Temporary files, local worker data, generated APK/AAB files, and credentials are
  not release source and must not be staged.

## Evidence and remaining gates

- Candidate tests: 38 application tests plus 3 playback/storage regression tests passed.
- Candidate production build and type-check passed after all dependency patches;
  38 application tests and 3 playback/storage tests passed again.
- Supabase screenshot: all five checked safety/social tables exist, RLS enabled,
  service_role SELECT/INSERT/UPDATE/DELETE granted, anon/authenticated SELECT absent.
  This is permission evidence, not an end-to-end test or a complete schema backup.
- Local production database credentials are unavailable. Read-only SQL verification
  was performed by the user; no secret was requested or printed.
- Patched Next.js to 16.3.8, tar to 7.5.22, and hosted sharp to 0.35.5;
  updated compatible affected dependencies. Production audit now has no critical
  advisories. Four affected packages remain in the legacy local background-removal
  stack (background-removal-node, its sharp/zod, and lodash). This stack is excluded
  from hosted functions; all deployment traces must verify that exclusion.
- Live authenticated report/block/deletion and real-device playback remain untested.
- R2 upload, range responses, CORS, and playback must pass before enabling storage.

The storage flag must remain unset during this release. Keep existing Blob variables
and files. No movie generation attempt should be spent without explicit approval.
