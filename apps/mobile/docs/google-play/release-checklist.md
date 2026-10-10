# Google Play release checklist

## Current configuration

- App name: MimiReel
- Android package planned for first Play upload: `com.mimireel.app` (not yet registered or checked in Play Console)
- Release version: `1.0.0`
- Local Android version code: `1`
- Production EAS profile: Android App Bundle (`app-bundle`), automatic version-code increment
- Orientation: portrait
- Camera permission: used to record a chosen movie clip
- Microphone permission: used to include the user's voice in a recorded clip
- Photo/video permission: used to select a clip for movie creation
- Production Play flag: `EXPO_PUBLIC_GOOGLE_PLAY_RELEASE=true`
- External Paystack checkout: disabled in production Play builds

## Must be completed before the first upload

- [ ] Verify `com.mimireel.app` is available and confirm it as the permanent package name in Play Console before the first upload.
- [x] Add `mimireel://auth/callback` to the Supabase redirect allowlist (confirmed by screenshot). New-build Google sign-in still needs phone testing.
- [x] Replace the generic Expo placeholder icon with the existing brand icon; review its fit for MimiReel before submission.
- [x] Create a 512 × 512 PNG store icon (`assets/pulsereel-play-store-icon-v1.png`).
- [ ] Create a 1024 × 500 feature graphic.
- [ ] Capture at least two polished phone screenshots from the release build.
- [ ] Set and test a public support email in `NEXT_PUBLIC_PULSEREEL_SUPPORT_EMAIL`.
- [ ] Confirm the public privacy, terms, and deletion pages load without authentication.
- [ ] Update the existing web pages and shared movie links from PulseReel to MimiReel before Play submission; the `pulse-reel.vercel.app` domain may remain temporarily, but public copy must match the app.
- [x] Apply `supabase/migrations/202609160001_pulsereel_social_controls.sql`, `supabase/migrations/202609200001_pulsereel_safety_controls.sql`, and `supabase/migrations/202609220001_pulsereel_social_upsert_permissions.sql` to the PulseReel production Supabase project.
- [ ] Verify movie reporting, comment reporting, and creator blocking on two separate accounts.
- [ ] Verify the in-app deletion request reaches the pending-deletion table.
- [ ] Decide whether version 1 launches without purchases or after Google Play Billing is implemented.
- [ ] Complete the Data safety form using `data-safety.md`, checking every answer against the release build and provider contracts.
- [ ] Complete content rating, target-audience, ads, app-access, and AI-content declarations in Play Console.
- [x] Compile a new MimiReel 32-bit local test APK with the Play release flag enabled. Existing PulseReel binaries are historical and use `com.pulsereel.app`.
- [ ] Compile a new MimiReel universal AAB after configuring a production upload key.
- [x] Verify the new APK package/version/SDK metadata, OAuth scheme, and debug signature locally. AAB checks remain outstanding.
- [ ] Configure a secure production upload key and rebuild the upload-ready universal AAB.
- [ ] Finish physical-device testing of the new MimiReel APK. Installation, launch, feed playback, and Google sign-in succeeded on the Neon Smarta 2; the full smoke test remains.
- [ ] Complete the closed-test plan with at least 12 opted-in testers for 14 continuous days if Play Console requires it for this personal account.

## Release blockers already identified

1. The verified local AAB is the old PulseReel package, development-signed, and ARM64-only. A new MimiReel package build, secure production upload key, and universal AAB are required before Play upload.
2. Google Play Billing is not implemented. The release profile safely hides the Paystack checkout, so version 1 can launch without selling attempt packs.
3. The social and safety tables are migrated, but report, block, and deletion-request flows still need phone testing.
4. A public support email still needs to be confirmed.

## Final smoke test

- [x] Fresh install and Google sign-in on the new MimiReel package (confirmed by September 23 phone screenshots)
- [ ] Record a clip with camera and microphone
- [ ] Select an existing clip from the device
- [ ] Upload/generate over Wi-Fi and mobile data
- [ ] Background and resume during generation
- [ ] Watch, like, comment, follow, and share
- [ ] Report a movie and a comment
- [ ] Block a creator and confirm their movies disappear after refresh
- [ ] Open Privacy, Terms, and deletion instructions
- [ ] Submit an in-app deletion request
- [ ] Confirm no Paystack/browser purchase flow appears in the Play release
- [ ] Confirm graceful messages for generation limit, server error, and offline state
