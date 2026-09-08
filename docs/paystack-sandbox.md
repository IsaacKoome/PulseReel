# Paystack sandbox setup

This implementation is test-only and admin-only. It rejects live keys and live
transactions. The KES 100 / 5-credit pack is a testing fixture, not agreed pricing.
Test credits never change free-beta limits or authorize real AI generation.

1. Run `supabase/migrations/202609080001_pulsereel_paystack_test.sql` in the project's Supabase SQL editor.
2. Set these **server-only** environment variables in your local environment or deployment:
   - `PULSEREEL_PAYSTACK_TEST_ENABLED=true`
   - `PAYSTACK_TEST_SECRET_KEY=sk_test_...`
   - `PULSEREEL_PAYMENT_ORIGIN=https://pulse-reel.vercel.app` (or `http://localhost:3000` locally)
   - Keep existing Supabase server configuration and `PULSEREEL_ADMIN_EMAILS` configured.
3. In Paystack **Test Mode**, set webhook URL to `https://pulse-reel.vercel.app/api/webhooks/paystack`.
   The checkout sets its own callback URL. Never paste secret keys into chat, git, or client variables.
4. Sign in as a verified admin and open `/billing/test`. Use Paystack's official test payment details,
   not real payment details: https://paystack.com/docs/payments/test-payments/
5. Complete checkout, return, and click Verify returned payment. Verify again: the balance must
   not increase a second time. A signed webhook can also record the same payment independently.
6. Check cancelled/failed payments do not credit, other accounts cannot verify this order, and
   existing generation behavior is unchanged. Test mode does not prove actual settlement/refunds.

The database has one immutable order reference per grant. Verification compares the server-stored
amount, currency, customer, reference, successful status and test domain. Repeated/concurrent
callbacks only set the same paid flag; the test balance sums those orders once. Browser clients
have no direct table permissions. Webhook failures return non-2xx for retries.

Run `node --test --experimental-strip-types tests/paystack.test.ts`, `npm test`, and `npm run build`.

Before live launch: confirm PulseReel business approval/name, payout destination, final pricing,
refund terms and fees; build an atomic spend/reservation/refund ledger for real generation;
review commercial hosting requirements; then separately authorize a small live settlement test.
Do not simply replace the test key with a live key: this version intentionally rejects it.

Reference: https://paystack.com/docs/payments/accept-payments/ and
https://paystack.com/docs/payments/webhooks/
