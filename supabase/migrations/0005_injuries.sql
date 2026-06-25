-- Milestone 2 — injuries, concussion_incidents, concussion_baselines
-- (brief §6.3, §6.8)
--
-- MEDICAL FIELDS (Brad's call, M2): RLS is row-level, not column-level, so it
-- cannot hide individual medical columns. For M2 the WHOLE injury row is gated on
-- view_injuries (+ not excluded). Hiding clinical columns (diagnosis, icd10,
-- clinician_notes, …) from users without view_medical is enforced in the
-- data-access layer when injuries are wired up in M7. Documented in docs/schema.md.
--
-- injuries.linked_concussion_id and concussion_incidents.linked_injury_id form a
-- cyclic reference, so both tables are created first and the two FK constraints
-- are added afterwards.

-- ── injuries ────────────────────────────────────────────────────────────────
create table if not exists public.injuries (
  id                   uuid primary key default gen_random_uuid(),
  athlete_id           uuid not null references public.athletes (id) on delete cascade,
  status               text check (status in ('out','modified','returned')),
  body_region          text not null,
  side                 text,
  injury_type          text,
  mechanism            text,
  contact_mechanism    text,
  activity             text,
  activity_context     text,
  severity             integer check (severity between 1 and 4),
  recurrence           text,
  prior_injury_ref     text,
  occurred_on          date not null,
  reported_on          date,
  reported_by          text,
  self_reported        boolean not null default false,
  -- Athlete self-report
  athlete_description  text,
  what_you_felt        text,
  pain_scale           integer,
  interventions        text,
  -- Clinical (app-layer gated by view_medical in M7)
  diagnosis            text,
  icd10                text,
  osics_code           text,
  imaging              text,
  imaging_date         date,
  clinician_notes      text,
  -- RTP progression
  rtp_progress         jsonb not null default '[]'::jsonb,
  expected_rtp         date,
  -- Status change audit
  status_changed_at    timestamptz,
  status_changed_by    text,
  -- Per-injury sharing overrides: {"excluded":[user_id,…],"included":[user_id,…]}
  sharing              jsonb not null default '{"excluded":[],"included":[]}'::jsonb,
  -- Concussion linking (FK added below)
  linked_concussion_id uuid,
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists injuries_athlete_id_idx on public.injuries (athlete_id);

drop trigger if exists injuries_set_updated_at on public.injuries;
create trigger injuries_set_updated_at
  before update on public.injuries
  for each row execute function public.set_updated_at();

-- ── concussion_incidents ────────────────────────────────────────────────────
create table if not exists public.concussion_incidents (
  id               uuid primary key default gen_random_uuid(),
  athlete_id       uuid not null references public.athletes (id) on delete cascade,
  date             date not null,
  mechanism        text,
  description      text,
  sport            text,
  symptoms         text,
  rtp_status       text,
  scat_data        jsonb,
  linked_injury_id uuid,
  auto_created     boolean not null default false,
  reported_by      text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists concussion_incidents_athlete_id_idx on public.concussion_incidents (athlete_id);

drop trigger if exists concussion_incidents_set_updated_at on public.concussion_incidents;
create trigger concussion_incidents_set_updated_at
  before update on public.concussion_incidents
  for each row execute function public.set_updated_at();

-- Cyclic FKs, added now that both tables exist. ON DELETE SET NULL: unlinking a
-- record must not cascade-delete the other.
alter table public.injuries
  drop constraint if exists injuries_linked_concussion_id_fkey;
alter table public.injuries
  add constraint injuries_linked_concussion_id_fkey
  foreign key (linked_concussion_id)
  references public.concussion_incidents (id) on delete set null;

alter table public.concussion_incidents
  drop constraint if exists concussion_incidents_linked_injury_id_fkey;
alter table public.concussion_incidents
  add constraint concussion_incidents_linked_injury_id_fkey
  foreign key (linked_injury_id)
  references public.injuries (id) on delete set null;

-- ── concussion_baselines ────────────────────────────────────────────────────
create table if not exists public.concussion_baselines (
  id          uuid primary key default gen_random_uuid(),
  athlete_id  uuid not null references public.athletes (id) on delete cascade,
  recorded_on date not null,
  data        jsonb,
  created_at  timestamptz not null default now(),
  unique (athlete_id, recorded_on)
);

create index if not exists concussion_baselines_athlete_id_idx on public.concussion_baselines (athlete_id);

-- ── RLS: injuries ───────────────────────────────────────────────────────────
-- Read: view_injuries AND not in sharing.excluded. The athlete (self) always
-- sees their own injuries regardless of the exclusion list. `included` only
-- governs MEDICAL FIELD visibility (app-layer, M7), not row access.
alter table public.injuries enable row level security;

drop policy if exists "injuries select" on public.injuries;
create policy "injuries select"
  on public.injuries for select
  using (
    public.is_athlete_self(athlete_id)
    or (
      public.has_athlete_permission(athlete_id, 'view_injuries')
      and not (coalesce(sharing -> 'excluded', '[]'::jsonb) ? (auth.uid())::text)
    )
  );

drop policy if exists "injuries insert" on public.injuries;
create policy "injuries insert"
  on public.injuries for insert
  with check (public.has_athlete_permission(athlete_id, 'edit_injuries'));

drop policy if exists "injuries update" on public.injuries;
create policy "injuries update"
  on public.injuries for update
  using (public.has_athlete_permission(athlete_id, 'edit_injuries'))
  with check (public.has_athlete_permission(athlete_id, 'edit_injuries'));

drop policy if exists "injuries delete" on public.injuries;
create policy "injuries delete"
  on public.injuries for delete
  using (public.has_athlete_permission(athlete_id, 'edit_injuries'));

-- ── RLS: concussion_incidents (injury-adjacent → view_injuries / edit_injuries)
alter table public.concussion_incidents enable row level security;

drop policy if exists "concussion_incidents select" on public.concussion_incidents;
create policy "concussion_incidents select"
  on public.concussion_incidents for select
  using (public.has_athlete_permission(athlete_id, 'view_injuries'));

drop policy if exists "concussion_incidents insert" on public.concussion_incidents;
create policy "concussion_incidents insert"
  on public.concussion_incidents for insert
  with check (public.has_athlete_permission(athlete_id, 'edit_injuries'));

drop policy if exists "concussion_incidents update" on public.concussion_incidents;
create policy "concussion_incidents update"
  on public.concussion_incidents for update
  using (public.has_athlete_permission(athlete_id, 'edit_injuries'))
  with check (public.has_athlete_permission(athlete_id, 'edit_injuries'));

drop policy if exists "concussion_incidents delete" on public.concussion_incidents;
create policy "concussion_incidents delete"
  on public.concussion_incidents for delete
  using (public.has_athlete_permission(athlete_id, 'edit_injuries'));

-- ── RLS: concussion_baselines (sibling of incidents → view_injuries / edit_injuries)
-- Read uses view_injuries (not view_medical) so it matches concussion_incidents
-- and stays symmetric with the edit_injuries write gate — no row a writer can
-- create but not read.
alter table public.concussion_baselines enable row level security;

drop policy if exists "concussion_baselines select" on public.concussion_baselines;
create policy "concussion_baselines select"
  on public.concussion_baselines for select
  using (public.has_athlete_permission(athlete_id, 'view_injuries'));

drop policy if exists "concussion_baselines insert" on public.concussion_baselines;
create policy "concussion_baselines insert"
  on public.concussion_baselines for insert
  with check (public.has_athlete_permission(athlete_id, 'edit_injuries'));

drop policy if exists "concussion_baselines update" on public.concussion_baselines;
create policy "concussion_baselines update"
  on public.concussion_baselines for update
  using (public.has_athlete_permission(athlete_id, 'edit_injuries'))
  with check (public.has_athlete_permission(athlete_id, 'edit_injuries'));

drop policy if exists "concussion_baselines delete" on public.concussion_baselines;
create policy "concussion_baselines delete"
  on public.concussion_baselines for delete
  using (public.has_athlete_permission(athlete_id, 'edit_injuries'));
