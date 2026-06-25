-- Milestone 2 — workouts, wellness_checkins, tests (brief §6.2, §6.4, §6.8)

-- ── workouts ────────────────────────────────────────────────────────────────
-- session_load is generated (rpe * duration_min); null if either input is null.
create table if not exists public.workouts (
  id                    uuid primary key default gen_random_uuid(),
  athlete_id            uuid not null references public.athletes (id) on delete cascade,
  date                  date not null,
  type                  text,
  duration_min          integer check (duration_min >= 0),
  rpe                   integer check (rpe between 0 and 10),
  note                  text,
  source                text,
  session_load          integer generated always as (rpe * duration_min) stored,
  -- Optional GPS / external load, all nullable
  distance_m            numeric,
  high_speed_distance_m numeric,
  sprint_distance_m     numeric,
  sprint_efforts        integer,
  max_velocity_kmh      numeric,
  accelerations         integer,
  decelerations         integer,
  player_load           numeric,
  -- Optional HR
  hr_avg                integer,
  hr_max                integer,
  hr_zones              jsonb,
  -- Metadata
  external_id           text,
  edited_at             timestamptz,
  created_by            uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists workouts_athlete_id_idx on public.workouts (athlete_id);

drop trigger if exists workouts_set_updated_at on public.workouts;
create trigger workouts_set_updated_at
  before update on public.workouts
  for each row execute function public.set_updated_at();

-- ── wellness_checkins ───────────────────────────────────────────────────────
-- Subjective fields documented 0–7 (higher = worse). One row per athlete/day.
create table if not exists public.wellness_checkins (
  id            uuid primary key default gen_random_uuid(),
  athlete_id    uuid not null references public.athletes (id) on delete cascade,
  date          date not null,
  fatigue       integer check (fatigue between 0 and 7),
  soreness      integer check (soreness between 0 and 7),
  sleep         integer check (sleep between 0 and 7),
  stress        integer check (stress between 0 and 7),
  mood          integer check (mood between 0 and 7),
  motivation    integer check (motivation between 0 and 7),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (athlete_id, date)
);

create index if not exists wellness_checkins_athlete_id_idx on public.wellness_checkins (athlete_id);

drop trigger if exists wellness_checkins_set_updated_at on public.wellness_checkins;
create trigger wellness_checkins_set_updated_at
  before update on public.wellness_checkins
  for each row execute function public.set_updated_at();

-- ── tests ───────────────────────────────────────────────────────────────────
-- Performance test results. test_key matches the hardcoded frontend catalog.
-- §6.8 is silent on tests: read = any active link; write = self or edit_workouts
-- (treated as training-data edits). Documented in docs/schema.md.
create table if not exists public.tests (
  id          uuid primary key default gen_random_uuid(),
  athlete_id  uuid not null references public.athletes (id) on delete cascade,
  test_key    text not null,
  date        date not null,
  value       numeric,
  unit        text,
  notes       text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists tests_athlete_id_idx on public.tests (athlete_id);

drop trigger if exists tests_set_updated_at on public.tests;
create trigger tests_set_updated_at
  before update on public.tests
  for each row execute function public.set_updated_at();

-- ── RLS: workouts ───────────────────────────────────────────────────────────
alter table public.workouts enable row level security;

drop policy if exists "workouts select" on public.workouts;
create policy "workouts select"
  on public.workouts for select
  using (public.has_athlete_permission(athlete_id, 'view_workouts'));

drop policy if exists "workouts insert" on public.workouts;
create policy "workouts insert"
  on public.workouts for insert
  with check (public.has_athlete_permission(athlete_id, 'edit_workouts'));

drop policy if exists "workouts update" on public.workouts;
create policy "workouts update"
  on public.workouts for update
  using (public.has_athlete_permission(athlete_id, 'edit_workouts'))
  with check (public.has_athlete_permission(athlete_id, 'edit_workouts'));

drop policy if exists "workouts delete" on public.workouts;
create policy "workouts delete"
  on public.workouts for delete
  using (public.has_athlete_permission(athlete_id, 'edit_workouts'));

-- ── RLS: wellness_checkins (writes gated by edit_workouts per §6.8) ──────────
alter table public.wellness_checkins enable row level security;

drop policy if exists "wellness select" on public.wellness_checkins;
create policy "wellness select"
  on public.wellness_checkins for select
  using (public.has_athlete_permission(athlete_id, 'view_wellness'));

drop policy if exists "wellness insert" on public.wellness_checkins;
create policy "wellness insert"
  on public.wellness_checkins for insert
  with check (public.has_athlete_permission(athlete_id, 'edit_workouts'));

drop policy if exists "wellness update" on public.wellness_checkins;
create policy "wellness update"
  on public.wellness_checkins for update
  using (public.has_athlete_permission(athlete_id, 'edit_workouts'))
  with check (public.has_athlete_permission(athlete_id, 'edit_workouts'));

drop policy if exists "wellness delete" on public.wellness_checkins;
create policy "wellness delete"
  on public.wellness_checkins for delete
  using (public.has_athlete_permission(athlete_id, 'edit_workouts'));

-- ── RLS: tests ──────────────────────────────────────────────────────────────
alter table public.tests enable row level security;

drop policy if exists "tests select" on public.tests;
create policy "tests select"
  on public.tests for select
  using (public.has_athlete_access(athlete_id));

drop policy if exists "tests insert" on public.tests;
create policy "tests insert"
  on public.tests for insert
  with check (public.has_athlete_permission(athlete_id, 'edit_workouts'));

drop policy if exists "tests update" on public.tests;
create policy "tests update"
  on public.tests for update
  using (public.has_athlete_permission(athlete_id, 'edit_workouts'))
  with check (public.has_athlete_permission(athlete_id, 'edit_workouts'));

drop policy if exists "tests delete" on public.tests;
create policy "tests delete"
  on public.tests for delete
  using (public.has_athlete_permission(athlete_id, 'edit_workouts'));
