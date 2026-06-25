-- Milestone 2 — athletes + athlete_user_links (brief §6.1, §6.8)

-- ── athletes ────────────────────────────────────────────────────────────────
-- The athlete profile. May exist before the owning user has an account, so
-- owner_user_id is nullable. created_by/owner_user_id use ON DELETE SET NULL —
-- deleting a user account must never destroy athlete data.
create table if not exists public.athletes (
  id                uuid primary key default gen_random_uuid(),
  owner_user_id     uuid references public.profiles (id) on delete set null,
  display_name      text not null,
  player_id         text,
  position          text,
  team              text,
  squad             text,
  date_of_birth     date,
  sex               text,
  height_cm         numeric,
  weight_kg         numeric,
  sport             text,
  profile_extras    jsonb not null default '{}'::jsonb,
  wellness_settings jsonb not null default '{"frequency":"daily","enabled_fields":{}}'::jsonb,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists athletes_owner_user_id_idx on public.athletes (owner_user_id);

drop trigger if exists athletes_set_updated_at on public.athletes;
create trigger athletes_set_updated_at
  before update on public.athletes
  for each row execute function public.set_updated_at();

-- ── athlete_user_links ──────────────────────────────────────────────────────
-- Many-to-many between users and athletes, carrying role + permissions + status.
-- user_id is nullable: a pending invite to someone without an account yet is
-- keyed by invited_email until they sign up and accept.
create table if not exists public.athlete_user_links (
  id            uuid primary key default gen_random_uuid(),
  athlete_id    uuid not null references public.athletes (id) on delete cascade,
  user_id       uuid references public.profiles (id) on delete cascade,
  role          text not null check (role in (
                  'self','head_coach','sc_coach','physio',
                  'clinician','consultant','club_admin')),
  permissions   jsonb not null default '{}'::jsonb,
  status        text not null default 'pending'
                  check (status in ('pending','active','revoked')),
  invited_by    uuid references public.profiles (id) on delete set null,
  invited_email text,
  accepted_at   timestamptz,
  revoked_at    timestamptz,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (athlete_id, user_id)
);

create index if not exists athlete_user_links_user_id_idx on public.athlete_user_links (user_id);
create index if not exists athlete_user_links_athlete_id_idx on public.athlete_user_links (athlete_id);

drop trigger if exists athlete_user_links_set_updated_at on public.athlete_user_links;
create trigger athlete_user_links_set_updated_at
  before update on public.athlete_user_links
  for each row execute function public.set_updated_at();

-- ── RLS: athletes ───────────────────────────────────────────────────────────
alter table public.athletes enable row level security;

-- Read: any user with an active link to the athlete (incl. the athlete).
drop policy if exists "athletes select" on public.athletes;
create policy "athletes select"
  on public.athletes for select
  using (public.has_athlete_access(id));

-- Insert: any authenticated user may create an athlete, but only as its creator.
-- (Athlete-profile creation lands in M3; access to others is gated by links.)
drop policy if exists "athletes insert" on public.athletes;
create policy "athletes insert"
  on public.athletes for insert
  with check (created_by = auth.uid());

-- Update/Delete: the athlete (owner/self) or a link with edit_profile.
drop policy if exists "athletes update" on public.athletes;
create policy "athletes update"
  on public.athletes for update
  using (public.has_athlete_permission(id, 'edit_profile'))
  with check (public.has_athlete_permission(id, 'edit_profile'));

drop policy if exists "athletes delete" on public.athletes;
create policy "athletes delete"
  on public.athletes for delete
  using (public.is_athlete_self(id));

-- ── RLS: athlete_user_links ─────────────────────────────────────────────────
alter table public.athlete_user_links enable row level security;

-- Read: your own link rows, or all links if you administer the athlete.
drop policy if exists "links select" on public.athlete_user_links;
create policy "links select"
  on public.athlete_user_links for select
  using (
    user_id = auth.uid()
    or public.has_athlete_admin(athlete_id)
  );

-- Write: the athlete (owner/self) or an admin of the athlete.
-- On the very first self-link, is_athlete_self() is satisfied via owner_user_id,
-- so an athlete can bootstrap their own self link.
drop policy if exists "links insert" on public.athlete_user_links;
create policy "links insert"
  on public.athlete_user_links for insert
  with check (public.has_athlete_admin(athlete_id));

drop policy if exists "links update" on public.athlete_user_links;
create policy "links update"
  on public.athlete_user_links for update
  using (public.has_athlete_admin(athlete_id))
  with check (public.has_athlete_admin(athlete_id));

drop policy if exists "links delete" on public.athlete_user_links;
create policy "links delete"
  on public.athlete_user_links for delete
  using (public.has_athlete_admin(athlete_id));
