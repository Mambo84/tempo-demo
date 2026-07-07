-- Milestone 7 (Part 2) — collaborative injury editing
--
-- Two server-side pieces:
--   1. injuries_autolink_concussion — trigger that auto-creates a linked
--      concussion_incident when an injury is classified as a concussion.
--   2. set_rtp_stage(injury, index, achieved, by) — RPC that toggles a single
--      RTP milestone atomically (no whole-array clobber), server-stamping who/when.
--
-- Both run SECURITY INVOKER, so existing RLS (view_injuries / edit_injuries /
-- self-always from 0005) governs them — no privilege escalation. Idempotent /
-- re-runnable.

-- ── 1. Concussion auto-link trigger ──────────────────────────────────────────
-- Detection keys ONLY on the practitioner's clinical classification
-- (injury_type = 'Concussion'). No bodyRegion/diagnosis heuristics: a "head"
-- self-report (which leaves injury_type null) must NOT auto-create an incident
-- (M7 Part 2 decision, and consistent with the Part 1 self-report behaviour).
--
-- Fires on INSERT (created as a concussion) OR UPDATE OF injury_type (the
-- practitioner classifies a previously-null-type self-report later). Idempotent:
-- the linked_concussion_id guard means re-saving never creates a second incident.
create or replace function public.tg_injuries_autolink_concussion()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_incident_id uuid;
begin
  if lower(coalesce(new.injury_type, '')) <> 'concussion' then
    return new;                       -- not a concussion classification
  end if;
  if new.linked_concussion_id is not null then
    return new;                       -- already linked — don't duplicate
  end if;

  -- Mirror the demo's auto-created incident shape (App.jsx addInjury).
  insert into public.concussion_incidents (
    athlete_id, date, mechanism, description, sport, symptoms,
    rtp_status, linked_injury_id, auto_created, reported_by, notes
  ) values (
    new.athlete_id,
    coalesce(new.occurred_on, current_date),
    coalesce(new.mechanism, 'Reported via injury log'),
    coalesce(new.activity_context, new.athlete_description, 'Auto-linked from injury record'),
    new.activity,
    new.what_you_felt,
    'stage_1',
    new.id,
    true,
    coalesce(new.reported_by, 'Auto-linked'),
    'Auto-created from injury record. Update with SCAT details and assessment.'
  )
  returning id into v_incident_id;

  -- Back-link the injury. This UPDATE touches linked_concussion_id only (not
  -- injury_type), so `after update of injury_type` does NOT re-fire — no recursion.
  update public.injuries
    set linked_concussion_id = v_incident_id
    where id = new.id;

  return new;
end;
$$;

drop trigger if exists injuries_autolink_concussion on public.injuries;
create trigger injuries_autolink_concussion
  after insert or update of injury_type on public.injuries
  for each row execute function public.tg_injuries_autolink_concussion();

-- ── 2. set_rtp_stage RPC (atomic single-milestone toggle) ────────────────────
-- Replaces the client's whole-array read-modify-write (last-write-wins → clobber
-- when two people toggle different stages). jsonb_set reads the current array in
-- the same UPDATE, so a concurrent toggle of a DIFFERENT stage survives.
--
-- who/when are stamped server-side: completedBy = p_by (the acting user's name,
-- denormalised like notes.author_name), completedAt = now() (ISO), date =
-- current_date (kept for the cards' existing `s.date` display read). Undo
-- (p_achieved = false) clears all three. The stage's other keys (e.g. `stage`
-- label) are preserved via the `||` merge.
--
-- SECURITY INVOKER: the UPDATE is gated by the injuries update policy
-- (edit_injuries). UPDATE ... RETURNING is governed by that USING policy, not a
-- separate SELECT policy (unlike the INSERT RETURNING trap), so it returns the
-- row for any editor.
create or replace function public.set_rtp_stage(
  p_injury_id uuid,
  p_index     integer,
  p_achieved  boolean,
  p_by        text
)
returns public.injuries
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row   public.injuries;
  v_patch jsonb;
begin
  if p_achieved then
    v_patch := jsonb_build_object(
      'achieved',    true,
      'completedBy', p_by,
      'completedAt', to_jsonb(now()),
      'date',        to_jsonb(current_date::text)
    );
  else
    v_patch := jsonb_build_object(
      'achieved',    false,
      'completedBy', null,
      'completedAt', null,
      'date',        null
    );
  end if;

  -- coalesce(...->p_index, '{}') guards the NULL-nuke: if p_index is out of range
  -- the element is NULL and `NULL || patch` would make jsonb_set return NULL,
  -- wiping the whole column. With create_missing = false an out-of-range index is
  -- then a safe no-op.
  update public.injuries
    set rtp_progress = jsonb_set(
          rtp_progress,
          array[p_index::text],
          coalesce(rtp_progress -> p_index, '{}'::jsonb) || v_patch,
          false
        )
    where id = p_injury_id
    returning * into v_row;

  if not found then
    raise exception 'set_rtp_stage: injury % not found or not editable', p_injury_id
      using errcode = 'insufficient_privilege';
  end if;

  return v_row;
end;
$$;

grant execute on function public.set_rtp_stage(uuid, integer, boolean, text) to authenticated;
