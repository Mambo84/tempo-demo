-- DEV CHECK (manual, self-cleaning) for get_invitation_preview (0017). Run in the
-- SQL editor. Wraps in a transaction and ROLLBACKs — nothing persists. RAISEs on a
-- failed assertion; otherwise prints PASS notices. Creates a throwaway pending
-- invitation, checks the preview, then confirms unknown/non-pending leak nothing.

begin;

do $$
declare
  v_inviter uuid;
  v_id      uuid;
  v_email   text;
  v_cnt     int;
begin
  select id into v_inviter from public.profiles order by id limit 1;
  if v_inviter is null then
    raise notice 'SKIP: no profiles to use as an inviter';
    return;
  end if;

  insert into public.invitations (inviter_user_id, invited_email, role, permissions, status, direction)
    values (v_inviter, 'preview-test@example.com', 'physio', '{}'::jsonb, 'pending', 'practitioner_to_athlete')
    returning id into v_id;

  -- 1) a pending invite returns the invited email
  select invited_email into v_email from public.get_invitation_preview(v_id);
  if v_email is distinct from 'preview-test@example.com' then
    raise exception 'FAIL(1): pending preview returned % (expected the invited email)', v_email;
  end if;
  raise notice 'PASS(1): pending invite preview returns invited_email + inviter';

  -- 2) an unknown id returns no rows
  select count(*) into v_cnt from public.get_invitation_preview(gen_random_uuid());
  if v_cnt <> 0 then raise exception 'FAIL(2): unknown id returned % row(s)', v_cnt; end if;
  raise notice 'PASS(2): unknown invitation id returns empty';

  -- 3) a non-pending (accepted/revoked) invite leaks nothing
  update public.invitations set status = 'accepted' where id = v_id;
  select count(*) into v_cnt from public.get_invitation_preview(v_id);
  if v_cnt <> 0 then raise exception 'FAIL(3): non-pending invite leaked % row(s)', v_cnt; end if;
  raise notice 'PASS(3): accepted/revoked invite returns empty (no leak)';

  raise notice 'ALL PASS ✓ — rolled back, no data persisted';
end $$;

rollback;
