-- Milestone 5 — practitioner→athlete invitations, profiles broadening, expiry
-- enforcement. Run in the Supabase SQL Editor after 0002–0009.
--
-- DIRECTION (M5): the PRACTITIONER initiates. They invite an athlete by email
-- before that athlete may even have an account, so the pending invite cannot live
-- in athlete_user_links (athlete_id is NOT NULL and the practitioner isn't an
-- admin of a not-yet-existent athlete). Option A: a dedicated invitations table
-- holds the intent; accept_invitation() creates the real athlete_user_links row.
-- (Athlete→practitioner invites are M5.5.)

-- ── invitations ──────────────────────────────────────────────────────────────
create table if not exists public.invitations (
  id               uuid primary key default gen_random_uuid(),
  inviter_user_id  uuid not null references public.profiles (id) on delete cascade,
  invited_email    text not null,
  role             text not null check (role in (
                     'head_coach','sc_coach','physio','clinician','consultant','club_admin')),
  permissions      jsonb not null default '{}'::jsonb,
  athlete_name     text,        -- optional label the practitioner typed (their own display)
  message          text,        -- optional personal note to the athlete
  status           text not null default 'pending'
                     check (status in ('pending','accepted','revoked')),
  expires_at       timestamptz,
  accepted_at      timestamptz,
  accepted_link_id uuid references public.athlete_user_links (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists invitations_invited_email_idx on public.invitations (lower(invited_email));
create index if not exists invitations_inviter_idx on public.invitations (inviter_user_id);

drop trigger if exists invitations_set_updated_at on public.invitations;
create trigger invitations_set_updated_at
  before update on public.invitations
  for each row execute function public.set_updated_at();

-- ── RLS: invitations ─────────────────────────────────────────────────────────
-- Only the inviter can read/manage their invites. Invitee discovery goes through
-- list_my_invitations() (SECURITY DEFINER, email-scoped) so nothing is exposed by
-- email through the table itself.
alter table public.invitations enable row level security;

drop policy if exists "invitations select (inviter)" on public.invitations;
create policy "invitations select (inviter)"
  on public.invitations for select
  using (inviter_user_id = auth.uid());

drop policy if exists "invitations insert" on public.invitations;
create policy "invitations insert"
  on public.invitations for insert
  with check (inviter_user_id = auth.uid());

drop policy if exists "invitations update (inviter)" on public.invitations;
create policy "invitations update (inviter)"
  on public.invitations for update
  using (inviter_user_id = auth.uid())
  with check (inviter_user_id = auth.uid());
-- No delete policy: accepted/revoked rows are kept as an audit trail.

-- ── Expiry enforcement in the access helpers (M5 decision 3) ──────────────────
-- Re-create the four M2 helpers to also require the active link be unexpired.
-- Self-link branch keeps its owner short-circuit; self links carry no expiry.
create or replace function public.is_athlete_self(p_athlete_id uuid)
returns boolean language plpgsql security definer stable
set search_path = public as $$
begin
  return exists (
    select 1 from public.athletes a
    where a.id = p_athlete_id and a.owner_user_id = auth.uid()
  ) or exists (
    select 1 from public.athlete_user_links l
    where l.athlete_id = p_athlete_id
      and l.user_id = auth.uid()
      and l.role = 'self'
      and l.status = 'active'
      and (l.expires_at is null or l.expires_at > now())
  );
end;
$$;

create or replace function public.has_athlete_access(p_athlete_id uuid)
returns boolean language plpgsql security definer stable
set search_path = public as $$
begin
  if public.is_athlete_self(p_athlete_id) then
    return true;
  end if;
  return exists (
    select 1 from public.athlete_user_links l
    where l.athlete_id = p_athlete_id
      and l.user_id = auth.uid()
      and l.status = 'active'
      and (l.expires_at is null or l.expires_at > now())
  );
end;
$$;

create or replace function public.has_athlete_permission(p_athlete_id uuid, p_perm text)
returns boolean language plpgsql security definer stable
set search_path = public as $$
begin
  if public.is_athlete_self(p_athlete_id) then
    return true;
  end if;
  return exists (
    select 1 from public.athlete_user_links l
    where l.athlete_id = p_athlete_id
      and l.user_id = auth.uid()
      and l.status = 'active'
      and (l.expires_at is null or l.expires_at > now())
      and coalesce((l.permissions ->> p_perm)::boolean, false)
  );
end;
$$;

create or replace function public.has_athlete_admin(p_athlete_id uuid)
returns boolean language plpgsql security definer stable
set search_path = public as $$
begin
  if public.is_athlete_self(p_athlete_id) then
    return true;
  end if;
  return exists (
    select 1 from public.athlete_user_links l
    where l.athlete_id = p_athlete_id
      and l.user_id = auth.uid()
      and l.status = 'active'
      and l.role = 'club_admin'
      and (l.expires_at is null or l.expires_at > now())
  );
end;
$$;

-- ── profiles SELECT broadening (M2 follow-up) ────────────────────────────────
-- Linked users can see each other's display info. Keyed off a shared active
-- athlete link (the athlete's own self link makes athlete<->practitioner work).
create or replace function public.shares_athlete_with(p_other uuid)
returns boolean language plpgsql security definer stable
set search_path = public as $$
begin
  if p_other is null then return false; end if;
  return exists (
    select 1
    from public.athlete_user_links a
    join public.athlete_user_links b on a.athlete_id = b.athlete_id
    where a.user_id = auth.uid() and a.status = 'active'
      and (a.expires_at is null or a.expires_at > now())
      and b.user_id = p_other and b.status = 'active'
      and (b.expires_at is null or b.expires_at > now())
  );
end;
$$;

drop policy if exists "Profiles are viewable by owner" on public.profiles;
drop policy if exists "Profiles are viewable by owner or linked users" on public.profiles;
create policy "Profiles are viewable by owner or linked users"
  on public.profiles for select
  using (auth.uid() = id or public.shares_athlete_with(id));

-- ── accept_invitation(invitation_id) ─────────────────────────────────────────
-- Called by the invited ATHLETE. Verifies the pending invite is addressed to
-- their email, then creates the real athlete_user_links row (user_id = inviter
-- practitioner) with the invitation's role/permissions, and marks the invite
-- accepted. SECURITY DEFINER so it can write the link the invitee couldn't insert
-- directly; the email + owns-the-athlete checks enforce consent.
create or replace function public.accept_invitation(p_invitation_id uuid)
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
    set role = excluded.role,
        permissions = excluded.permissions,
        status = 'active',
        accepted_at = now(),
        revoked_at = null,
        expires_at = excluded.expires_at
  returning id into v_link_id;

  update public.invitations
    set status = 'accepted', accepted_at = now(), accepted_link_id = v_link_id
  where id = p_invitation_id;

  return v_athlete;
end;
$$;

-- ── list_my_invitations() ────────────────────────────────────────────────────
-- The invited athlete's pending invitations, with the inviter's name/title joined
-- (profiles are otherwise unreadable pre-accept). Email-scoped to the caller.
create or replace function public.list_my_invitations()
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
  expires_at      timestamptz
) language sql security definer stable
set search_path = public as $$
  select i.id, i.inviter_user_id, p.display_name, p.title,
         i.role, i.permissions, i.athlete_name, i.message, i.created_at, i.expires_at
  from public.invitations i
  left join public.profiles p on p.id = i.inviter_user_id
  where i.status = 'pending'
    and lower(i.invited_email) = lower(auth.email())
    and (i.expires_at is null or i.expires_at > now())
  order by i.created_at desc;
$$;

grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.list_my_invitations() to authenticated;
