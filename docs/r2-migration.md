# MimiReel R2 cutover checklist

Playback changes are local until the web deployment and a new Android build ship.
Generated direct-Seedance movies support an opt-in R2 destination. Source uploads,
identity photos, other generation paths, and existing media still use their current storage.
Do not delete Blob files or enable R2 until the following checks pass.

1. Enable R2 in Cloudflare and create a Standard storage bucket.
2. Attach a production custom domain (for example media.your-domain) to that bucket.
   Public movie playback requires public delivery; keep private identity photos separate.
3. Create a bucket-scoped Object Read & Write API token. Store credentials only in
   server-side Vercel environment variables, never EXPO_PUBLIC variables or chat.
4. Configure R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
   and R2_PUBLIC_BASE_URL (HTTPS custom domain). Leave MIMIREEL_MEDIA_STORAGE unset.
5. Set bucket CORS for the actual web origins with GET and HEAD; verify Content-Type,
   range requests (206), Content-Length and Cache-Control on a test MP4. CORS is not authorization.
6. Exercise upload and Android/web playback in a preview deployment with
   MIMIREEL_MEDIA_STORAGE=r2. Check anonymous public playback and seeking.
7. Enable MIMIREEL_MEDIA_STORAGE=r2 in production only after verification.
   This changes new direct-Seedance output, not existing URLs.
8. Copy existing generated files in batches, verify size/checksum and playback,
   then update database URLs with a saved old-to-new mapping for rollback.
   Copying Blob data consumes remaining Blob transfer allowance; budget it first.
9. Retain originals during a rollback window. Move source uploads/identity photos
   separately with ownership validation, short-lived signed uploads, and deletion handling.

Rollback new writes by unsetting MIMIREEL_MEDIA_STORAGE and redeploying.
Keep R2 public URLs operational for movies already written there.
