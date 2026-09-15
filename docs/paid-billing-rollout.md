# Paid billing rollout — KES 675 / 5 attempts

## Approved product

- Price: KES 675 (67500 Kenyan cents), five attempts. Approximate US$5 is display-only.
- One attempt: five-second 480p portrait clip with audio, current direct Seedance 1.5 Pro path.
- Confirmed technical failure restores one attempt. A creative variation consumes another.
- Do not promise perfect likeness. Do not sell the sandbox's KES 100 fixture.

## Implemented foundation

- `/billing` explains the pack and currency, displays the paid balance, and only enables
  checkout when the live key and explicit live-purchase flag are both configured.
- Signed-in navigation links to Credits.
- `lib/billing-pack.ts` defines the fixed pack.
- `supabase/migrations/202609080002_pulsereel_paid_attempts.sql` adds separate wallets,
  orders, attempt reservations and audit ledger. It does not touch beta or test tables.
- Grant, reserve and confirmed-failure restore functions are transactional and service-role-only.
  Row locks serialize wallet spending; repeated terminal events do not restore again.
- Paid balances now participate in hosted-generation eligibility after the free allowance is used.
  A paid attempt is bound to the project before Replicate submission and reconciled only from a
  confirmed provider outcome. Ambiguous submissions remain reserved for review.
- Customer billing activity shows paid and incomplete orders and supports a server-verified recheck.
- `/admin/billing` provides private order, reservation and ledger visibility, highlights reservations
  older than 30 minutes, and exposes guarded Paystack/project reconciliation actions.
- Live checkout initialization is limited per verified account, and live billing/webhook failures
  produce structured Vercel logs without exposing secrets to the customer.

## Database step — completed by the owner

Review and apply the complete migration in Supabase SQL Editor for PulseReel.
It must succeed as one transaction. Never paste Paystack keys into SQL.
The owner applied the migration and the rollback-only smoke test successfully in Supabase.

## Remaining launch verification

1. Complete one owner-authorized KES 675 live purchase and confirm exactly five attempts appear.
2. Generate one movie from the paid balance and confirm the balance decreases exactly once.
3. Confirm successful generation remains deducted and a confirmed provider failure restores once.
4. Confirm the live order, purchase ledger entry and attempt appear correctly in `/admin/billing`.
5. Review Vercel logs after the live test and confirm Paystack delivered the live webhook.

Test credits remain isolated and cannot purchase actual generation.
