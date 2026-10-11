# MimiReel tester feedback batch — October 11, 2026

## Source changes

- Completed movies open in an unobstructed, contained native-control preview. Play, pause, scrub, replay and fullscreen are supported. Actions are below the video.
- Your Movies and Back to Watch replace the vague completion path. Unpublished movies stay saved; another take warns that a generation attempt is used.
- Android Download is in the feed More menu and completed movie screen. Completed public movies are downloadable by everyone; unpublished movies by their owner. The movie is streamed to a cache file and saved to the gallery, with cleanup and duplicate-request protection.
- Library thumbnails are extracted from existing and new completed movies, sequentially, without autoplay. A poster is a fallback.
- Both recorded and gallery videos allow selecting an identity frame using native controls, with an existing gallery photo fallback. No mandatory new camera photo. The chosen identity is shown before submission.
- Selected photos up to 25 MB are re-encoded and compressed to <=1 MB before multipart submission. Unsupported image decoding returns actionable guidance, not native exception text. This is error handling, not a guarantee that all formats decode.
- Signed direct video uploads are capped at 100 MB in authorization, metadata validation and mobile selection. Inputs still use Blob; no private inputs moved to public R2. Multipart limits are unchanged.
- Movie status adds authenticated owner information for owner-only controls; ownership is enforced server-side for publishing.

## Validation

- Expo 57 versioned documentation read before edits, per mobile AGENTS.md.
- Mobile TypeScript check and Android Metro/Hermes export passed.
- Existing 38 tests and 4 new feedback checks passed (new UI checks are source-level; download policy has behavior assertions).
- ADB identifies connected Android 14/API 34 armeabi-v7a device, installed MimiReel versionCode 5. No data reset or uninstall.

## Required device checks before calling release complete

1. Existing completed video: native controls, full frame, seek/replay, fullscreen, no action overlay.
2. Your Movies: thumbnails for old and new movies, scrolling responsive, no unintended audio.
3. Public feed Download: movie appears in gallery and plays with sound. Repeat tap and offline/storage failure handling.
4. Video gallery selection: seek to a face, select frame, inspect identity preview, replace with gallery photo without camera permission.
5. Large inputs: 50–100 MB video direct upload; 10–25 MB photo compresses safely on low-memory phone. Boundary rejection.
6. Owner-only unpublished download/publish; public share; another-take warning; return navigation.
7. Fresh generation preview: tester approval before publishing. No generation purchased automatically for testing.

Use one managed-signing feedback APK after source validation. Backend release required for the 100 MB cap and owner status. Do not uninstall on signature mismatch. Keep old APK/AAB and production rollback revision.
