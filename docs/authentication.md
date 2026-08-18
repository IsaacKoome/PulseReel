# PulseReel accounts

PulseReel accounts use Supabase Auth with Google sign-in. Authentication is guarded by a
server-side feature flag, so deploying this code does not change the existing public creation
flow until all three environment variables are configured.

## Safe rollout order

1. Create a Supabase project on the free plan.
2. In Supabase, open **Authentication > URL Configuration**.
   - Site URL: `https://pulse-reel.vercel.app`
   - Redirect URL: `https://pulse-reel.vercel.app/auth/callback`
   - Optional local redirect URL: `http://localhost:3000/auth/callback`
3. In Google Cloud, create a Web OAuth client.
   - Authorized JavaScript origin: the Supabase project URL shown in the Supabase Google
     provider setup screen.
   - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
4. Add the Google client ID and secret in **Supabase > Authentication > Providers > Google**,
   then enable the provider.
5. Add these to Vercel Production and Preview environments:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
6. Redeploy and confirm the live site still works. Authentication remains off at this point.
7. Add `PULSEREEL_AUTH_ENABLED=true` in Vercel and redeploy.
8. Test Google sign-in, create one movie, confirm it appears under **My Movies**, sign out, and
   confirm the creation studio redirects to sign-in.

## Behavior

- `/` and `/watch/...` stay public.
- `/create` and `/movies` require an account only when the feature flag is enabled.
- New projects store the authenticated Supabase user ID as their owner.
- Account-owned movies can be deleted only by their signed-in owner.
- Existing legacy movies keep their original browser-token deletion behavior.
- With `PULSEREEL_AUTH_ENABLED=false` (or missing Supabase variables), the existing PulseReel
  experience remains unchanged.

## Rollback

Set `PULSEREEL_AUTH_ENABLED=false` and redeploy. This immediately restores the no-login creation
flow without removing any movie ownership data.
