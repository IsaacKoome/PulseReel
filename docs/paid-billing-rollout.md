# Paid billing rollout — KES 675 / 5 attempts

## Approved product

- Price: KES 675 (67500 Kenyan cents), five attempts. Approximate US$5 is display-only.
- One attempt: five-second 480p portrait clip with audio, current direct Seedance 1.5 Pro path.
- Confirmed technical failure restores one attempt. A creative variation consumes another.
- Do not promise perfect likeness. Do not sell the sandbox's KES 100 fixture.

## Implemented foundation

- `/billing` explains the pack and currency; checkout is deliberately disabled.
- Signed-in navigation links to Credits.
- `lib/billing-pack.ts` defines the fixed pack.
- `supabase/migrations/202609080002_pulsereel_paid_attempts.sql` adds separate wallets,
  orders, attempt reservations and audit ledger. It does not touch beta or test tables.
- Grant, reserve and confirmed-failure restore functions are transactional and service-role-only.
  Row locks serialize wallet spending; repeated terminal events do not restore again.

## Database step

Review and apply the complete migration in Supabase SQL Editor for PulseReel.
It must succeed as one transaction. Never paste Paystack keys into SQL.
This migration has not been executed against the hosted database by the coding agent.

## Remaining before paid launch (do not turn on live keys yet)

1. Exercise the SQL functions on a test database: duplicate grant; concurrent reservations
   from a one-attempt wallet; duplicate failure restore; completed-then-failed event;
   rollback on mismatched attempts; anonymous/authenticated access rejection.
2. Implement live order initialize/verify endpoints with verified-user auth, same-origin
   checks, rate limiting, fixed server pack, live-domain verification and separate live key.
   Keep new purchase creation behind a default-off flag. Verification of existing orders
   must continue even when new purchases are paused.
3. Add live webhook routing without breaking existing test webhook behavior. Verify the
   raw-body signature, then reverify reference, amount, currency, customer and live domain
   before calling the grant function. Never grant from browser callback data alone.
4. Connect paid generation before provider submission: persist project and reservation
   first, use stable idempotency identifiers, enforce provider/settings and spending caps.
   Do not refund ambiguous provider timeouts; reconcile them to a confirmed final status.
   Do not allow retries of a finished reservation to launch a new provider job for free.
5. Add balance/history and purchase return UI. Test purchase-to-generation end to end,
   including provider success before webhook delivery, failed delivery, and concurrency.
6. Review refund/support terms and chargeback handling, obtain Paystack approval, confirm
   international-card enablement and payout account. Owner then authorizes a small live test.

Neither the disabled pricing page nor the SQL migration makes live billing launch-ready.
Test credits remain isolated and cannot purchase actual generation.
