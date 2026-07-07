-- DEV CHECK (manual, self-cleaning) — proves the injuries_autolink_concussion
-- trigger from 0013. Run it in the Supabase SQL editor. It wraps everything in a
-- transaction and ROLLBACKs at the end, so NOTHING persists — safe to run in prod.
-- It RAISEs an exception on any failed assertion; otherwise it prints PASS notices.
--
-- Not part of the schema — mirrors 0009_verify_rls_dev.sql's discipline. Do not
-- run through an automated migration runner (the begin/rollback is manual).

begin;

do $$
declare
  v_athlete uuid;
  v_inj     uuid;
  v_inj2    uuid;
  v_count   int;
  v_linked  uuid;
begin
  select id into v_athlete from public.athletes order by created_at limit 1;
  if v_athlete is null then
    raise notice 'SKIP: no athlete rows to test against';
    return;
  end if;

  -- ── Test 1a: null injury_type must NOT trigger (self-report "head" path) ─────
  insert into public.injuries (athlete_id, body_region, occurred_on, injury_type)
    values (v_athlete, 'Head', current_date, null)
    returning id into v_inj;
  select count(*) into v_count
    from public.concussion_incidents where linked_injury_id = v_inj;
  if v_count <> 0 then
    raise exception 'FAIL(1a): null injury_type auto-created % incident(s) — heuristic leaked', v_count;
  end if;
  raise notice 'PASS(1a): null injury_type did NOT auto-create an incident';

  -- ── Test 1b/1c: classify-later → auto-create + back-link ────────────────────
  update public.injuries set injury_type = 'Concussion' where id = v_inj;
  select count(*) into v_count
    from public.concussion_incidents
    where linked_injury_id = v_inj and auto_created = true;
  if v_count <> 1 then
    raise exception 'FAIL(1b): expected exactly 1 auto-created incident, got %', v_count;
  end if;
  raise notice 'PASS(1b): classifying injury_type=Concussion auto-created 1 incident with linked_injury_id set';

  select linked_concussion_id into v_linked from public.injuries where id = v_inj;
  if v_linked is null then
    raise exception 'FAIL(1c): injury.linked_concussion_id was not back-linked';
  end if;
  raise notice 'PASS(1c): injury.linked_concussion_id back-linked to the incident (two-way link)';

  -- ── Test 2: idempotent — re-classifying must NOT duplicate ──────────────────
  update public.injuries set injury_type = 'Concussion' where id = v_inj;
  select count(*) into v_count
    from public.concussion_incidents where linked_injury_id = v_inj;
  if v_count <> 1 then
    raise exception 'FAIL(2): re-saving Concussion duplicated the incident (count=%)', v_count;
  end if;
  raise notice 'PASS(2): idempotent — re-classifying did not create a second incident';

  -- ── Test 3: create-as-concussion (practitioner InjuryForm path) ─────────────
  insert into public.injuries (athlete_id, body_region, occurred_on, injury_type)
    values (v_athlete, 'Head', current_date, 'Concussion')
    returning id into v_inj2;
  select count(*) into v_count
    from public.concussion_incidents where linked_injury_id = v_inj2;
  if v_count <> 1 then
    raise exception 'FAIL(3): create-as-Concussion did not auto-create (count=%)', v_count;
  end if;
  raise notice 'PASS(3): inserting injury_type=Concussion auto-created the incident on INSERT';

  raise notice 'ALL PASS ✓ — rolled back, no data persisted';
end $$;

rollback;
