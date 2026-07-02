-- Milestone 5.5 — athlete→practitioner invitations. The mirror of M5: the ATHLETE
-- invites a practitioner by email (they already have a profile from M3), the
-- practitioner accepts on their side and picks their own role → permissions
-- (client-computed from PERM_TEMPLATES; the athlete's review+revoke in
-- AthleteAccessView is the consent backstop). Run after 0010.

-- ── extend invitations with a direction + the initiating athlete ──────────────
alter table public.invitations
  add column if not exists direction text not null default 'practitioner_to_athlete'
    check (direction in ('practitioner_to_athlete','athlete_to_practitioner'));
alter table public.invitations
  add column if not exists athlete_id uuid references public.athletes (id) on delete cascade;

-- Tighten INSERT: an athlete-initiated invite may only attach the athlete's OWN
-- profile (practitioner-initiated invites carry no athlete_id).
drop policy if exists "invitations insert" on public.invitations;
create policy "invitations insert"
  on public.invitations for insert
  with check (
    inviter_user_id = auth.uid()
    and (athlete_id is null or public.is_athlete_self(athlete_id))
  );

-- ── unified accept_invitation (branches on direction) ────────────────────────
-- Drop the M5 single-arg version so the new signature (with optional accept-time
-- role/permissions for a2p) is unambiguous. M5's 1-arg calls resolve to this via
-- the defaults.
drop function if exists public.accept_invitation(uuid);

create or replace function public.accept_invitation(
  p_invitation_id uuid,
  p_role text default null,
  p_permissions jsonb default null
)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  v_email   text := lower(auth.email());
  v_inv     public.invitations%rowtype;
  v_athlete uuid;
  v_link_id uuid;
begin
  select * into v_inv from public.invitations
  where id = p_invitation_id
    and status = 'pending'
    and lower(invited_email) = v_email
    and (expires_at is null or expires_at > now());
  if not found then
    raise exception 'No matching pending invitation for this account';
  end if;

  if v_inv.direction = 'athlete_to_practitioner' then
    -- The accepting user IS the invited practitioner (the grantee). The link
    -- attaches the invitation's athlete; role/permissions come from the accept.
    v_athlete := v_inv.athlete_id;
    if v_athlete is null then
      raise exception 'Invitation is missing its athlete';
    end if;
    insert into public.athlete_user_links
      (athlete_id, user_id, role, permissions, status, invited_by, invited_email,
       accepted_at, expires_at)
    values
      (v_athlete, auth.uid(), coalesce(p_role, v_inv.role),
       coalesce(p_permissions, v_inv.permissions), 'active',
       v_inv.inviter_user_id, v_inv.invited_email, now(), v_inv.expires_at)
    on conflict (athlete_id, user_id) do update
      set role = excluded.role, permissions = excluded.permissions,
          status = 'active', accepted_at = now(), revoked_at = null,
          expires_at = excluded.expires_at
    returning id into v_link_id;
  else
    -- practitioner_to_athlete (M5): the accepting user is the athlete; the grantee
    -- is the inviter practitioner; role/permissions come from the invitation.
    select id into v_athlete from public.athletes
    where owner_user_id = auth.uid()
    order by created_at asc
    limit 1;
    if v_athlete is null then
      raise exception 'Create your athlete profile before accepting an invitation';
    end if;
    insert into public.athlete_user_links
      (athlete_id, user_id, role, permissions, status, invited_by, invited_email,
       accepted_at, expires_at)
    values
      (v_athlete, v_inv.inviter_user_id, v_inv.role, v_inv.permissions, 'active',
       v_inv.inviter_user_id, v_inv.invited_email, now(), v_inv.expires_at)
    on conflict (athlete_id, user_id) do update
      set role = excluded.role, permissions = excluded.permissions,
          status = 'active', accepted_at = now(), revoked_at = null,
          expires_at = excluded.expires_at
    returning id into v_link_id;
  end if;

  update public.invitations
    set status = 'accepted', accepted_at = now(), accepted_link_id = v_link_id
  where id = p_invitation_id;

  return v_athlete;
end;
$$;

grant execute on function public.accept_invitation(uuid, text, jsonb) to authenticated;

-- ── list_my_invitations: add direction + athlete name ────────────────────────
-- Drop first (return signature changes).
drop function if exists public.list_my_invitations();

create function public.list_my_invitations()
returns table (
  invitation_id   uuid,
  inviter_user_id uuid,
  inviter_name    text,
  inviter_title   text,
  role            text,
  permissions     jsonb,
  athlete_name    text,
  message         text,
  created_at      timestamptz,
  expires_at      timestamptz,
  direction       text
) language sql security definer stable
set search_path = public as $$
  select i.id, i.inviter_user_id, p.display_name, p.title,
         i.role, i.permissions,
         coalesce(a.display_name, i.athlete_name) as athlete_name,
         i.message, i.created_at, i.expires_at, i.direction
  from public.invitations i
  left join public.profiles p on p.id = i.inviter_user_id
  left join public.athletes a on a.id = i.athlete_id
  where i.status = 'pending'
    and lower(i.invited_email) = lower(auth.email())
    and (i.expires_at is null or i.expires_at > now())
  order by i.created_at desc;
$$;

grant execute on function public.list_my_invitations() to authenticated;
