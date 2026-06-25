-- Milestone 2 — RLS helper functions (brief §6.8)
-- Run in the Supabase SQL Editor in order: 0002 → 0007 (schema + policies),
-- then 0008 (dev seed) and 0009 (verification). Committed for provenance.
--
-- WHY SECURITY DEFINER:
-- Policies on `athletes` need to read `athlete_user_links`, and policies on
-- `athlete_user_links` need to read `athletes`. If those reads went through RLS
-- they would recurse. These helpers run SECURITY DEFINER (as the migration owner)
-- so the reads bypass RLS — no recursion — while still keying off auth.uid().
--
-- ORDERING NOTE:
-- These functions reference public.athletes and public.athlete_user_links, which
-- are created in 0003. That is safe: PL/pgSQL does not resolve table references
-- until the function is executed, so creating the helpers first is fine.
--
-- OWNERSHIP RULE (Brad's call, M2):
-- The athlete (owner_user_id, or an active role='self' link) ALWAYS has full
-- access to their own data. The `permissions` JSON governs OTHER linked users only.

-- True if auth.uid() is the athlete themselves (account owner or active self link).
create or replace function public.is_athlete_self(p_athlete_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  return exists (
    select 1 from public.athletes a
    where a.id = p_athlete_id
      and a.owner_user_id = auth.uid()
  ) or exists (
    select 1 from public.athlete_user_links l
    where l.athlete_id = p_athlete_id
      and l.user_id = auth.uid()
      and l.role = 'self'
      and l.status = 'active'
  );
end;
$$;

-- True if auth.uid() has ANY active relationship to the athlete (self or any link).
-- This is the baseline "can see this athlete exists" check.
create or replace function public.has_athlete_access(p_athlete_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if public.is_athlete_self(p_athlete_id) then
    return true;
  end if;
  return exists (
    select 1 from public.athlete_user_links l
    where l.athlete_id = p_athlete_id
      and l.user_id = auth.uid()
      and l.status = 'active'
  );
end;
$$;

-- True if auth.uid() holds a specific permission flag on an active link.
-- Owner/self short-circuits to true (full access to own data).
create or replace function public.has_athlete_permission(p_athlete_id uuid, p_perm text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if public.is_athlete_self(p_athlete_id) then
    return true;
  end if;
  return exists (
    select 1 from public.athlete_user_links l
    where l.athlete_id = p_athlete_id
      and l.user_id = auth.uid()
      and l.status = 'active'
      and coalesce((l.permissions ->> p_perm)::boolean, false)
  );
end;
$$;

-- True if auth.uid() can administer links for this athlete:
-- the athlete themselves (owner/self) OR an active role='club_admin' link.
create or replace function public.has_athlete_admin(p_athlete_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
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
  );
end;
$$;
