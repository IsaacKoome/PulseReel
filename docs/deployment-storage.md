# Deployment storage maintenance

Runtime videos, uploads, worker jobs and Python environments must stay outside deployment output. `.gitignore` prevents future commits, `.vercelignore` excludes local-only inputs, and `outputFileTracingExcludes` prevents Next.js from packaging runtime directories into functions. Existing local files remain available to the local worker.

`lib/project-draft.ts` contains shared planning, source saving and poster creation without FFmpeg. Cloud providers import this module directly. The local renderer remains in `lib/pipeline.ts`, loaded when local rendering is requested.

After changing filesystem access or renderer imports, run:

```
npm run build
node scripts/check-deployment-traces.cjs
npm test
```

For existing Vercel usage, compare Deployment Storage and Functions Storage by project over the same date range. Review Resources on representative deployments before attributing team totals to PulseReel. Local trace sizes are diagnostic evidence, not measurements of deployed Linux bundles.

Review each project's Settings > Security > Deployment Retention Policy. Choose a rollback window before shortening retention. Preserve the active production deployment and a known-good rollback when removing obsolete deployments. Deleting deployments removes those preview URLs and rollback targets, not Git commits or independently stored Blob/Supabase media. Inspect selected deployments before deletion.

Code changes affect new deployments; they do not remove existing retained output. Retention cleanup and usage reporting are asynchronous, and usage accrued over the reporting period is not erased immediately.
