-- Milestone 2 — DEV SEED (NOT for production)
-- Creates four test auth users, one athlete, three links, a workout and an
-- injury, so the RLS policies can be proven by 0009. Re-runnable: it deletes the
-- fixed seed rows first. Run as the privileged SQL-Editor role (it inserts into
-- auth.users, which the trigger from 0001 turns into profiles rows).
--
-- Teardown: see the commented block at the bottom of this file.
--
-- If the auth.users INSERT errors with a NOT NULL violation on some token column,
-- your GoTrue version requires it: add that column to the column list with value
-- '' (empty string) and re-run. The four token columns already listed cover the
-- common case.
--
-- Seed cast:
--   a0001  athlete owner        — full access to their own data
--   a0002  physio (linked)      — view_injuries TRUE,  view_workouts FALSE
--   a0003  stranger (no link)   — must see nothing
--   a0004  S&C coach (linked)   — view_workouts TRUE, but EXCLUDED from the injury

-- ── clean previous seed (children cascade from these deletes) ────────────────
delete from public.athletes where id = '00000000-0000-0000-0000-0000000b0001';
delete from auth.users where id in (
  '00000000-0000-0000-0000-0000000a0001',
  '00000000-0000-0000-0000-0000000a0002',
  '00000000-0000-0000-0000-0000000a0003',
  '00000000-0000-0000-0000-0000000a0004'
);

-- ── auth users (trigger auto-creates matching public.profiles) ───────────────
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data,
   confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000a0001',
   'authenticated', 'authenticated', 'seed_athlete@tempo.test', '',
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}',
   '{"display_name":"Seed Athlete","default_role":"athlete"}',
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000a0002',
   'authenticated', 'authenticated', 'seed_physio@tempo.test', '',
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}',
   '{"display_name":"Seed Physio","default_role":"practitioner","title":"Physio"}',
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000a0003',
   'authenticated', 'authenticated', 'seed_stranger@tempo.test', '',
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}',
   '{"display_name":"Seed Stranger","default_role":"practitioner"}',
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000a0004',
   'authenticated', 'authenticated', 'seed_sc@tempo.test', '',
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}',
   '{"display_name":"Seed S&C","default_role":"practitioner","title":"S&C Coach"}',
   '', '', '', '');

-- ── athlete (owned by a0001) ─────────────────────────────────────────────────
insert into public.athletes (id, owner_user_id, display_name, sport, created_by)
values ('00000000-0000-0000-0000-0000000b0001',
        '00000000-0000-0000-0000-0000000a0001',
        'Seed Athlete', 'Football',
        '00000000-0000-0000-0000-0000000a0001');

-- ── links ────────────────────────────────────────────────────────────────────
insert into public.athlete_user_links
  (athlete_id, user_id, role, status, permissions, invited_by)
values
  -- a0001: the athlete's own self link
  ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000a0001',
   'self', 'active',
   '{"view_basic":true,"view_workouts":true,"view_wellness":true,"view_injuries":true,"view_medical":true,"view_notes":true,"edit_profile":true,"edit_workouts":true,"edit_injuries":true,"edit_notes":true}',
   '00000000-0000-0000-0000-0000000a0001'),
  -- a0002: physio — CAN see injuries, CANNOT see workouts
  ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000a0002',
   'physio', 'active',
   '{"view_basic":true,"view_workouts":false,"view_wellness":true,"view_injuries":true,"view_medical":false,"view_notes":true}',
   '00000000-0000-0000-0000-0000000a0001'),
  -- a0004: S&C — CAN see workouts; excluded from the injury below via sharing
  ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000a0004',
   'sc_coach', 'active',
   '{"view_basic":true,"view_workouts":true,"view_wellness":true,"view_injuries":true,"view_medical":false,"view_notes":true}',
   '00000000-0000-0000-0000-0000000a0001');

-- ── one workout ──────────────────────────────────────────────────────────────
insert into public.workouts (id, athlete_id, date, type, duration_min, rpe, created_by)
values ('00000000-0000-0000-0000-0000000c0001',
        '00000000-0000-0000-0000-0000000b0001',
        current_date, 'Run', 60, 7,
        '00000000-0000-0000-0000-0000000a0001');

-- ── one injury, with a0004 explicitly excluded from sharing ──────────────────
insert into public.injuries
  (id, athlete_id, body_region, occurred_on, status, severity, sharing, created_by)
values ('00000000-0000-0000-0000-0000000d0001',
        '00000000-0000-0000-0000-0000000b0001',
        'Calf', current_date, 'out', 2,
        '{"excluded":["00000000-0000-0000-0000-0000000a0004"],"included":[]}',
        '00000000-0000-0000-0000-0000000a0001');

-- ── TEARDOWN (uncomment to remove all seed data) ─────────────────────────────
-- delete from public.athletes where id = '00000000-0000-0000-0000-0000000b0001';
-- delete from auth.users where id in (
--   '00000000-0000-0000-0000-0000000a0001',
--   '00000000-0000-0000-0000-0000000a0002',
--   '00000000-0000-0000-0000-0000000a0003',
--   '00000000-0000-0000-0000-0000000a0004'
-- );
