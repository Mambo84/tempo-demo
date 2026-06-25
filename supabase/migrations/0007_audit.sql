-- Milestone 2 — audit_log (brief §6.7, §6.8)
--
-- Append-only access log. §6.8: athletes read their own athlete's log; staff can
-- read only the rows for access THEY made. Inserts must be attributed to the
-- caller (user_id = auth.uid()). No update/delete policies → the log is immutable
-- through the API. Audit-write wiring lands in M11; the table + policies exist now
-- so nothing has to change schema-side later.

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles (id) on delete set null,
  athlete_id  uuid references public.athletes (id) on delete cascade,
  action      text,
  detail      text,
  ip_hash     text,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_athlete_id_idx on public.audit_log (athlete_id);
create index if not exists audit_log_user_id_idx on public.audit_log (user_id);

alter table public.audit_log enable row level security;

-- Read: the athlete sees all access to their data; everyone else sees only their
-- own access rows.
drop policy if exists "audit select" on public.audit_log;
create policy "audit select"
  on public.audit_log for select
  using (
    user_id = auth.uid()
    or public.is_athlete_self(athlete_id)
  );

-- Insert: you may only log your own access.
drop policy if exists "audit insert" on public.audit_log;
create policy "audit insert"
  on public.audit_log for insert
  with check (user_id = auth.uid());

-- No update/delete policies: the audit log cannot be mutated via the anon/auth API.
