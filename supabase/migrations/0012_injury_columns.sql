-- Milestone 7 (Part 1) — additive columns on injuries
--
-- The demo UI (App.jsx InjuryForm + edit paths) reads/writes seven fields that
-- 0005_injuries.sql never gave a column. Without them, the first practitioner
-- create silently drops treatment/prevention/etc. Part 1 has no medical-write
-- gating, so all seven flow to the DB immediately.
--
-- Additive only: nullable columns, no RLS change (0005's view_injuries /
-- edit_injuries / self-always model is exactly Part 1's permission model), no
-- data. Idempotent so it can be re-run safely.
--
-- Note on naming: 0005 already has `clinician_notes` (a clinical, medical-gated
-- field). This adds a separate general `notes` column — the demo shows `notes`
-- to anyone with view_injuries, so it must NOT collapse into the medical field.

alter table public.injuries add column if not exists imaging_findings text;  -- radiology read, shown under Imaging
alter table public.injuries add column if not exists treatment       text;  -- Plan: current treatment
alter table public.injuries add column if not exists prevention      text;  -- Plan: prevention notes
alter table public.injuries add column if not exists rom_limitation  text;  -- Clinical: range-of-motion limitation
alter table public.injuries add column if not exists actual_rtp      date;  -- set when status → returned
alter table public.injuries add column if not exists follow_up       text;  -- Plan: follow-up
alter table public.injuries add column if not exists notes           text;  -- general (non-medical) note
