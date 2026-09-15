# PulseReel mobile

The first native PulseReel vertical slice, built with Expo SDK 57 and Expo Router.

## Product loop

1. Watch public movies in a full-screen vertical feed.
2. Tap the central **+** or **Star in this story**.
3. Record a ten-second clip or choose one from the library.
4. Describe one scene in plain language.
5. Follow generation, keep the result private, or publish it to the feed.

The permanent navigation contains only **Watch**, **+**, and **You**. Payment is intentionally not implemented inside the native app yet; store-compliant Apple and Google purchase flows are a separate release step.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Copy the existing public Supabase URL and publishable key into the two `EXPO_PUBLIC_SUPABASE_*` values. Never put the Supabase service role key or Paystack secret key in this app.
3. Add `pulsereel://auth/callback` to the Supabase authentication redirect allowlist.
4. Run `npm install` and then `npm start` from this directory.

Google OAuth should be tested in an Expo development build rather than Expo Go. The current direct mobile upload is deliberately capped at a ten-second, 3 MB clip so it stays within the existing Vercel request path. A later upload pass should move mobile video directly to Vercel Blob before project submission.

## Verification

- `npm run typecheck`
- `npx expo export --platform android --output-dir dist`
