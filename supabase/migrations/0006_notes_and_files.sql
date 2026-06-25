-- Milestone 2 — notes, athlete_files (brief §6.5, §6.6, §6.8)

-- ── notes ───────────────────────────────────────────────────────────────────
create table if not exists public.notes (
  id              uuid primary key default gen_random_uuid(),
  athlete_id      uuid not null references public.athletes (id) on delete cascade,
  author_user_id  uuid references public.profiles (id) on delete set null,
  author_name     text,
  author_role     text,
  type            text,
  visibility      text not null default 'staff'
                    check (visibility in ('athlete','staff','medical')),
  text            text not null,
  acknowledged    boolean not null default false,
  acknowledged_at timestamptz,
  archived        boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists notes_athlete_id_idx on public.notes (athlete_id);

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

-- ── athlete_files ───────────────────────────────────────────────────────────
-- Table only at M2. The Storage bucket + storage RLS land in M10.
create table if not exists public.athlete_files (
  id          uuid primary key default gen_random_uuid(),
  athlete_id  uuid not null references public.athletes (id) on delete cascade,
  name        text,
  description text,
  file_path   text,
  mime_type   text,
  size_bytes  integer,
  uploaded_by uuid references public.profiles (id) on delete set null,
  visibility  text not null default 'staff'
                check (visibility in ('athlete','staff','medical')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists athlete_files_athlete_id_idx on public.athlete_files (athlete_id);

drop trigger if exists athlete_files_set_updated_at on public.athlete_files;
create trigger athlete_files_set_updated_at
  before update on public.athlete_files
  for each row execute function public.set_updated_at();

-- ── RLS: notes ──────────────────────────────────────────────────────────────
-- §6.8: read if active link with view_notes AND visibility allows; the athlete
-- always sees visibility='athlete' notes about themselves (and ONLY those — the
-- staff/medical branch is gated to non-self, so athletes don't see staff chatter).
-- visibility='medical' additionally requires view_medical.
alter table public.notes enable row level security;

drop policy if exists "notes select" on public.notes;
create policy "notes select"
  on public.notes for select
  using (
    (public.is_athlete_self(athlete_id) and visibility = 'athlete')
    or (
      not public.is_athlete_self(athlete_id)
      and public.has_athlete_permission(athlete_id, 'view_notes')
      and (
        visibility in ('athlete','staff')
        or (visibility = 'medical'
            and public.has_athlete_permission(athlete_id, 'view_medical'))
      )
    )
  );

-- Write: the athlete (self) or a link with edit_notes; you may only author as
-- yourself.
drop policy if exists "notes insert" on public.notes;
create policy "notes insert"
  on public.notes for insert
  with check (
    author_user_id = auth.uid()
    and (public.is_athlete_self(athlete_id)
         or public.has_athlete_permission(athlete_id, 'edit_notes'))
  );

drop policy if exists "notes update" on public.notes;
create policy "notes update"
  on public.notes for update
  using (public.is_athlete_self(athlete_id)
         or public.has_athlete_permission(athlete_id, 'edit_notes'))
  with check (public.is_athlete_self(athlete_id)
         or public.has_athlete_permission(athlete_id, 'edit_notes'));

drop policy if exists "notes delete" on public.notes;
create policy "notes delete"
  on public.notes for delete
  using (public.is_athlete_self(athlete_id)
         or public.has_athlete_permission(athlete_id, 'edit_notes'));

-- ── RLS: athlete_files ──────────────────────────────────────────────────────
-- §6.8 is silent on files. Read: the athlete sees all their own files; linked
-- users see by visibility (medical files require view_medical, others need any
-- active link). Write: athlete or athlete-admin, attributed to the uploader.
-- A dedicated file permission is deferred to M10 (documented in docs/schema.md).
alter table public.athlete_files enable row level security;

drop policy if exists "files select" on public.athlete_files;
create policy "files select"
  on public.athlete_files for select
  using (
    public.is_athlete_self(athlete_id)
    or case visibility
         when 'medical' then public.has_athlete_permission(athlete_id, 'view_medical')
         else public.has_athlete_access(athlete_id)
       end
  );

drop policy if exists "files insert" on public.athlete_files;
create policy "files insert"
  on public.athlete_files for insert
  with check (
    uploaded_by = auth.uid()
    and public.has_athlete_admin(athlete_id)
  );

drop policy if exists "files update" on public.athlete_files;
create policy "files update"
  on public.athlete_files for update
  using (public.has_athlete_admin(athlete_id))
  with check (public.has_athlete_admin(athlete_id));

drop policy if exists "files delete" on public.athlete_files;
create policy "files delete"
  on public.athlete_files for delete
  using (public.has_athlete_admin(athlete_id));
