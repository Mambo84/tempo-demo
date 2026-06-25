-- Milestone 2 — RLS VERIFICATION (DEV) — proves the policies actually enforce.
-- Run AFTER 0008_seed_dev.sql. Read-only: everything runs inside a transaction
-- that is rolled back at the end.
--
-- HOW IT WORKS: we switch to the `authenticated` role (so RLS is enforced — the
-- migration owner would bypass it) and impersonate each seed user by setting the
-- JWT `sub` claim that auth.uid() reads. Then we count what each user can SEE.
--
-- Expected results (acceptance criteria, brief §M2):
--   stranger (no link) : 0 athletes, 0 workouts, 0 injuries
--   athlete  (owner)   : 1 athlete,  1 workout,  1 injury
--   physio   (linked)  : 1 athlete,  0 workouts (view_workouts:false), 1 injury
--   S&C      (linked)  : 1 athlete,  1 workout,  0 injuries (excluded via sharing)
--
-- A PASS/FAIL line is printed per check (look in the "Messages"/notices output).
-- If any check fails the script raises an exception so it cannot pass silently.

begin;
set local role authenticated;

do $$
declare
  u_athlete  constant uuid := '00000000-0000-0000-0000-0000000a0001';
  u_physio   constant uuid := '00000000-0000-0000-0000-0000000a0002';
  u_stranger constant uuid := '00000000-0000-0000-0000-0000000a0003';
  u_sc       constant uuid := '00000000-0000-0000-0000-0000000a0004';
  fails int := 0;
  n_ath int; n_wk int; n_inj int;
begin
  -- ── stranger: sees nothing ────────────────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  select count(*) into n_ath from public.athletes;
  select count(*) into n_wk  from public.workouts;
  select count(*) into n_inj from public.injuries;
  raise notice 'stranger  athletes=% (want 0) %, workouts=% (want 0) %, injuries=% (want 0) %',
    n_ath, case when n_ath=0 then 'PASS' else 'FAIL' end,
    n_wk,  case when n_wk=0  then 'PASS' else 'FAIL' end,
    n_inj, case when n_inj=0 then 'PASS' else 'FAIL' end;
  fails := fails + (n_ath<>0)::int + (n_wk<>0)::int + (n_inj<>0)::int;

  -- ── athlete (owner): full access ──────────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_athlete, 'role', 'authenticated')::text, true);
  select count(*) into n_ath from public.athletes;
  select count(*) into n_wk  from public.workouts;
  select count(*) into n_inj from public.injuries;
  raise notice 'athlete   athletes=% (want 1) %, workouts=% (want 1) %, injuries=% (want 1) %',
    n_ath, case when n_ath=1 then 'PASS' else 'FAIL' end,
    n_wk,  case when n_wk=1  then 'PASS' else 'FAIL' end,
    n_inj, case when n_inj=1 then 'PASS' else 'FAIL' end;
  fails := fails + (n_ath<>1)::int + (n_wk<>1)::int + (n_inj<>1)::int;

  -- ── physio: athlete + injury, but NO workouts (view_workouts:false) ───────
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_physio, 'role', 'authenticated')::text, true);
  select count(*) into n_ath from public.athletes;
  select count(*) into n_wk  from public.workouts;
  select count(*) into n_inj from public.injuries;
  raise notice 'physio    athletes=% (want 1) %, workouts=% (want 0) %, injuries=% (want 1) %',
    n_ath, case when n_ath=1 then 'PASS' else 'FAIL' end,
    n_wk,  case when n_wk=0  then 'PASS' else 'FAIL' end,
    n_inj, case when n_inj=1 then 'PASS' else 'FAIL' end;
  fails := fails + (n_ath<>1)::int + (n_wk<>0)::int + (n_inj<>1)::int;

  -- ── S&C: athlete + workout, but NO injury (excluded via sharing) ──────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_sc, 'role', 'authenticated')::text, true);
  select count(*) into n_ath from public.athletes;
  select count(*) into n_wk  from public.workouts;
  select count(*) into n_inj from public.injuries;
  raise notice 'sc_coach  athletes=% (want 1) %, workouts=% (want 1) %, injuries=% (want 0) %',
    n_ath, case when n_ath=1 then 'PASS' else 'FAIL' end,
    n_wk,  case when n_wk=1  then 'PASS' else 'FAIL' end,
    n_inj, case when n_inj=0 then 'PASS' else 'FAIL' end;
  fails := fails + (n_ath<>1)::int + (n_wk<>1)::int + (n_inj<>0)::int;

  if fails > 0 then
    raise exception 'RLS VERIFICATION FAILED: % check(s) did not match expected', fails;
  else
    raise notice 'RLS VERIFICATION PASSED: all checks matched expected.';
  end if;
end $$;

rollback;
