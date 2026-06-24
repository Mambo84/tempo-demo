-- Milestone 1 — profiles table + auto-create trigger
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- (Committed here for provenance; the Supabase CLI can adopt these files later.)

-- profiles: extends auth.users with display info (brief §6.1)
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  title        text,                                   -- e.g. "Physio", "S&C Coach"
  default_role text check (default_role in ('athlete', 'practitioner')), -- UI hint, not auth
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A user can read and update only their own profile row.
drop policy if exists "Profiles are viewable by owner" on public.profiles;
create policy "Profiles are viewable by owner"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Profiles are updatable by owner" on public.profiles;
create policy "Profiles are updatable by owner"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
-- No INSERT policy: rows are created by the security-definer trigger below,
-- which bypasses RLS. The frontend never inserts profiles directly.

-- Keep updated_at fresh on every update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row whenever a new auth user is created.
-- Pulls display_name / default_role / title from the signup metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, default_role, title)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    coalesce(new.raw_user_meta_data ->> 'default_role', 'athlete'),
    coalesce(new.raw_user_meta_data ->> 'title', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
