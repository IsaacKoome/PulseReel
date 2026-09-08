-- PulseReel paid-attempt ledger smoke test.
-- Safe for the hosted project: every test row is rolled back at the end.
begin;

do $$
declare
  test_user_id uuid;
  test_reference text := 'sql-smoke-' || gen_random_uuid()::text;
  restored_attempt_id uuid := gen_random_uuid();
  completed_attempt_id uuid := gen_random_uuid();
  balance integer;
begin
  select id into test_user_id
  from auth.users
  order by created_at asc
  limit 1;

  if test_user_id is null then
    raise exception 'No authenticated PulseReel user exists for the smoke test';
  end if;

  insert into public.pulse_reel_paid_orders
    (reference, user_id, email, pack_id, amount, currency, attempts)
  values
    (test_reference, test_user_id, 'rollback-only@pulsereel.test',
     'five-attempts-kes-675-v1', 67500, 'KES', 5);

  balance := public.pulsereel_grant_paid_order(test_reference);
  if balance <> 5 then raise exception 'Expected 5 after purchase, got %', balance; end if;

  -- Repeating the same grant must not add another five.
  balance := public.pulsereel_grant_paid_order(test_reference);
  if balance <> 5 then raise exception 'Duplicate purchase grant changed balance to %', balance; end if;

  balance := public.pulsereel_reserve_paid_attempt(
    test_user_id, restored_attempt_id, 'sql-smoke-failed-project'
  );
  if balance <> 4 then raise exception 'Expected 4 after reservation, got %', balance; end if;

  perform public.pulsereel_finish_paid_attempt(restored_attempt_id, 'failed');
  perform public.pulsereel_finish_paid_attempt(restored_attempt_id, 'failed');
  select available into balance from public.pulse_reel_paid_wallets where user_id = test_user_id;
  if balance <> 5 then raise exception 'Failure restore was not idempotent; balance is %', balance; end if;

  balance := public.pulsereel_reserve_paid_attempt(
    test_user_id, completed_attempt_id, 'sql-smoke-completed-project'
  );
  if balance <> 4 then raise exception 'Expected 4 after second reservation, got %', balance; end if;

  perform public.pulsereel_finish_paid_attempt(completed_attempt_id, 'completed');
  -- A late failure event must not refund a completed attempt.
  perform public.pulsereel_finish_paid_attempt(completed_attempt_id, 'failed');
  select available into balance from public.pulse_reel_paid_wallets where user_id = test_user_id;
  if balance <> 4 then raise exception 'Completed attempt was incorrectly restored; balance is %', balance; end if;

  raise notice 'PASS: grant=5, duplicate grant=5, failed restore=5, completed attempt final balance=4';
end
$$;

rollback;
