-- M11 pull-forward — practitioner self-revoke ("Remove athlete").
--
-- athlete_user_links UPDATE is gated on has_athlete_admin (0003), so a linked
-- practitioner (physio/S&C, not club_admin) cannot revoke their OWN link with a
-- direct update. This RPC gives them exactly that one operation — nothing more.
--
-- SECURITY DEFINER (bypasses RLS) but tightly scoped: it only sets status='revoked'
-- on a row where user_id = auth.uid() AND status='active'. It cannot change
-- permissions, role, or anyone else's link — so there is no self-escalation surface
-- (the reason we did NOT just broaden the UPDATE policy to self-rows).

create or replace function public.revoke_own_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.athlete_user_links
    set status = 'revoked', revoked_at = now()
    where id = p_link_id
      and user_id = auth.uid()
      and status = 'active';
  if not found then
    raise exception 'revoke_own_link: no active link % owned by caller', p_link_id
      using errcode = 'no_data_found';
  end if;
end;
$$;

grant execute on function public.revoke_own_link(uuid) to authenticated;
