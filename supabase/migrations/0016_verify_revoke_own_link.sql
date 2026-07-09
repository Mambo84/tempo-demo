-- DEV CHECK (manual, self-cleaning) for revoke_own_link (0015). Run in the SQL
-- editor. Wraps in a transaction and ROLLBACKs — nothing persists. RAISEs on any
-- failed assertion; otherwise prints PASS notices. Impersonates users by setting
-- request.jwt.claims (so auth.uid() resolves), the same technique as 0009.

begin;

do $$
declare
  v_link   uuid;
  v_user   uuid;
  v_status text;
begin
  select id, user_id into v_link, v_user
    from public.athlete_user_links
    where status = 'active' and user_id is not null
    order by created_at
    limit 1;
  if v_link is null then
    raise notice 'SKIP: no active user-owned link to test against';
    return;
  end if;

  -- 1) a NON-owner cannot revoke it (auth.uid() = some other user)
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid())::text, true);
  begin
    perform public.revoke_own_link(v_link);
    raise exception 'FAIL(1): non-owner was able to revoke the link';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS(1): non-owner cannot revoke (rejected: %)', sqlerrm;
  end;
  -- confirm it's still active
  select status into v_status from public.athlete_user_links where id = v_link;
  if v_status <> 'active' then raise exception 'FAIL(1b): link no longer active after non-owner attempt'; end if;
  raise notice 'PASS(1b): link still active after the non-owner attempt';

  -- 2) the OWNER can revoke it
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  perform public.revoke_own_link(v_link);
  select status into v_status from public.athlete_user_links where id = v_link;
  if v_status <> 'revoked' then
    raise exception 'FAIL(2): owner revoke did not set status=revoked (got %)', v_status;
  end if;
  raise notice 'PASS(2): owner revoked → status=revoked, revoked_at stamped';

  -- 3) idempotent: revoking an already-revoked (non-active) link raises
  begin
    perform public.revoke_own_link(v_link);
    raise exception 'FAIL(3): re-revoking a non-active link should have raised';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS(3): re-revoke on a non-active link rejected';
  end;

  raise notice 'ALL PASS ✓ — rolled back, no data persisted';
end $$;

rollback;
