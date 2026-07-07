import { supabase } from '../supabase';

// Data-access layer for injuries (brief §6.3, M7 Part 1: read + create + edit).
// DB is snake_case; App.jsx works in camelCase (bodyRegion, injuryType, rtpProgress…).
// These mappers are the single translation point so both injury cards keep working
// unchanged against real data.
//
// Part 1 scope — deliberately NOT here yet:
//   - concussion auto-linking (Part 2): createInjury does NOT inspect injuryType /
//     bodyRegion, so a "head" self-report saves as a plain injury row, no incident.
//   - medical-field read stripping + clinical-write gating (Part 2): every column is
//     mapped through as-is; RLS (0005) already gates whole-row access on view_injuries
//     / edit_injuries, and self always has full read/write to their own injuries.
//   - sharing writes (Part 2): `sharing` is read back but callers don't set it yet;
//     the column defaults to {"excluded":[],"included":[]} server-side.

const STATUSES = new Set(['out', 'modified', 'returned']); // 0005 CHECK constraint

// Clinical / medical fields, gated on view_medical (M2 decision 1 — app-layer,
// not RLS, since RLS is row-level). Camel keys for read-stripping the UI object;
// snake columns for stripping a write payload. `notes`, `followUp`, `painScale`
// are deliberately NOT medical — the demo shows them regardless of view_medical.
export const MEDICAL_FIELDS = [
  'diagnosis', 'icd10', 'osicsCode', 'imaging', 'imagingDate',
  'imagingFindings', 'romLimitation', 'clinicianNotes', 'treatment', 'prevention',
];
const MEDICAL_COLUMNS = [
  'diagnosis', 'icd10', 'osics_code', 'imaging', 'imaging_date',
  'imaging_findings', 'rom_limitation', 'clinician_notes', 'treatment', 'prevention',
];

// Null out clinical fields on a UI injury for a viewer without medical access to
// it. Caller decides access (role view_medical OR this injury's sharing.included
// OR self); this just applies the strip. Not a hard boundary — RLS still returns
// the columns over the wire (D3 caveat) — but keeps them out of the passed object.
export function stripMedicalFields(injury) {
  if (!injury) return injury;
  const out = { ...injury };
  for (const f of MEDICAL_FIELDS) out[f] = null;
  return out;
}

// today as YYYY-MM-DD (client-side; matches App.jsx today())
function today() {
  return new Date().toISOString().slice(0, 10);
}

// DB row → UI injury. rtp_progress / sharing are jsonb and pass through verbatim
// (rtp items keep their stage/achieved/date/completedBy keys).
export function rowToInjury(row) {
  if (!row) return null;
  return {
    id: row.id,
    athleteId: row.athlete_id,
    status: row.status,
    bodyRegion: row.body_region,
    side: row.side,
    injuryType: row.injury_type,
    mechanism: row.mechanism,
    contactMechanism: row.contact_mechanism,
    activity: row.activity,
    activityContext: row.activity_context,
    severity: row.severity,
    recurrence: row.recurrence,
    priorInjuryRef: row.prior_injury_ref,
    occurredOn: row.occurred_on,
    reportedOn: row.reported_on,
    reportedBy: row.reported_by,
    selfReported: !!row.self_reported,
    athleteDescription: row.athlete_description,
    whatYouFelt: row.what_you_felt,
    painScale: row.pain_scale,
    interventions: row.interventions,
    diagnosis: row.diagnosis,
    icd10: row.icd10,
    osicsCode: row.osics_code,
    imaging: row.imaging,
    imagingDate: row.imaging_date,
    imagingFindings: row.imaging_findings,
    romLimitation: row.rom_limitation,
    clinicianNotes: row.clinician_notes,
    treatment: row.treatment,
    prevention: row.prevention,
    followUp: row.follow_up,
    notes: row.notes,
    rtpProgress: row.rtp_progress || [],
    expectedRTP: row.expected_rtp,
    actualRTP: row.actual_rtp,
    statusChangedAt: row.status_changed_at,
    statusChangedBy: row.status_changed_by,
    sharing: row.sharing || { excluded: [], included: [] },
    linkedConcussionId: row.linked_concussion_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// UI injury (create input or edit patch) → DB row. Whitelist: only keys present on
// `input` are mapped, so updateInjury patches touch only what changed. athlete_id,
// created_by and reported_on are set by the callers below, not here. Server-managed
// fields (id, created_at, updated_at, linked_concussion_id) are never written here.
// `stillTraining` is a transient form field (derived into status) — intentionally dropped.
export function injuryToRow(input) {
  const row = {};
  const set = (col, val) => { row[col] = val; };
  if ('status' in input) set('status', STATUSES.has(input.status) ? input.status : null);
  if ('bodyRegion' in input) set('body_region', input.bodyRegion);
  if ('side' in input) set('side', input.side);
  if ('injuryType' in input) set('injury_type', input.injuryType);
  if ('mechanism' in input) set('mechanism', input.mechanism);
  if ('contactMechanism' in input) set('contact_mechanism', input.contactMechanism);
  if ('activity' in input) set('activity', input.activity);
  if ('activityContext' in input) set('activity_context', input.activityContext);
  if ('severity' in input) {
    const s = Number(input.severity);
    // 0005 CHECK: severity between 1 and 4. Demo seed used 1–5; clamp defensively.
    set('severity', Number.isFinite(s) ? Math.max(1, Math.min(4, Math.round(s))) : null);
  }
  if ('recurrence' in input) set('recurrence', input.recurrence);
  if ('priorInjuryRef' in input) set('prior_injury_ref', input.priorInjuryRef);
  if ('occurredOn' in input) set('occurred_on', input.occurredOn);
  if ('reportedOn' in input) set('reported_on', input.reportedOn);
  if ('reportedBy' in input) set('reported_by', input.reportedBy);
  if ('selfReported' in input) set('self_reported', !!input.selfReported);
  if ('athleteDescription' in input) set('athlete_description', input.athleteDescription);
  if ('whatYouFelt' in input) set('what_you_felt', input.whatYouFelt);
  if ('painScale' in input) {
    const p = Number(input.painScale);
    set('pain_scale', Number.isFinite(p) ? p : null);
  }
  if ('interventions' in input) set('interventions', input.interventions);
  if ('diagnosis' in input) set('diagnosis', input.diagnosis);
  if ('icd10' in input) set('icd10', input.icd10);
  if ('osicsCode' in input) set('osics_code', input.osicsCode);
  if ('imaging' in input) set('imaging', input.imaging);
  if ('imagingDate' in input) set('imaging_date', input.imagingDate || null);
  if ('imagingFindings' in input) set('imaging_findings', input.imagingFindings);
  if ('romLimitation' in input) set('rom_limitation', input.romLimitation);
  if ('clinicianNotes' in input) set('clinician_notes', input.clinicianNotes);
  if ('treatment' in input) set('treatment', input.treatment);
  if ('prevention' in input) set('prevention', input.prevention);
  if ('followUp' in input) set('follow_up', input.followUp);
  if ('notes' in input) set('notes', input.notes);
  if ('rtpProgress' in input) set('rtp_progress', input.rtpProgress || []);
  if ('expectedRTP' in input) set('expected_rtp', input.expectedRTP || null);
  if ('actualRTP' in input) set('actual_rtp', input.actualRTP || null);
  if ('statusChangedAt' in input) set('status_changed_at', input.statusChangedAt);
  if ('statusChangedBy' in input) set('status_changed_by', input.statusChangedBy);
  return row;
}

// All injuries for one athlete, most recent occurrence first. RLS returns what the
// caller may see (self → all own; linked → view_injuries and not excluded).
export async function listInjuries(athleteId) {
  if (!athleteId) return [];
  const { data, error } = await supabase
    .from('injuries')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('occurred_on', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToInjury);
}

// Injuries across several athletes at once (practitioner roster). RLS filters to the
// caller's linked athletes; the detail view then filters per selected athlete.
export async function listInjuriesForAthletes(athleteIds) {
  if (!athleteIds || !athleteIds.length) return [];
  const { data, error } = await supabase
    .from('injuries')
    .select('*')
    .in('athlete_id', athleteIds)
    .order('occurred_on', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToInjury);
}

// Create an injury. `author` is the acting user ({ id, name }). Insert is gated by
// RLS on edit_injuries (self always passes). reported_on defaults to today. Part 1:
// no concussion side-effects. Standard insert().select() — the injuries SELECT-policy
// helpers read athletes/links, not the just-inserted row, so no M3 RETURNING trap.
export async function createInjury(athleteId, input, author, opts = {}) {
  const row = {
    ...injuryToRow(input),
    athlete_id: athleteId,
    created_by: author?.id ?? null,
    reported_on: input.reportedOn || today(),
  };
  // Clinical-write gate (M7 Part 2, D2): writing medical fields needs view_medical
  // in addition to edit_injuries. When the caller lacks it, drop the clinical
  // columns so a non-medical editor can still create/edit the non-clinical record.
  if (opts.allowMedical === false) for (const c of MEDICAL_COLUMNS) delete row[c];
  const { data, error } = await supabase
    .from('injuries')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return rowToInjury(data);
}

// Patch an injury (edit fields, availability/status, RTP milestone toggles). Gated by
// RLS on edit_injuries (self always passes). Only mapped keys in `patch` are written.
export async function updateInjury(id, patch, opts = {}) {
  const row = injuryToRow(patch);
  if (opts.allowMedical === false) for (const c of MEDICAL_COLUMNS) delete row[c];
  const { data, error } = await supabase
    .from('injuries')
    .update(row)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return rowToInjury(data);
}

// Toggle a single RTP milestone atomically via the set_rtp_stage RPC (0013).
// Server-stamps completedBy/completedAt/date (or clears them on undo) and does a
// per-element jsonb_set — so a concurrent toggle of a DIFFERENT stage is not
// clobbered. Returns the full updated injury (caller re-applies medical stripping).
export async function setRtpStage(injuryId, index, achieved, byName) {
  const { data, error } = await supabase.rpc('set_rtp_stage', {
    p_injury_id: injuryId,
    p_index: index,
    p_achieved: achieved,
    p_by: byName ?? null,
  });
  if (error) throw error;
  // A function returning a single composite comes back as an object, but tolerate
  // a single-element array in case PostgREST treats it as set-returning.
  return rowToInjury(Array.isArray(data) ? data[0] : data);
}

// ── concussion incidents (read; auto-created by the 0013 trigger) ─────────────
export function rowToConcussionIncident(row) {
  if (!row) return null;
  return {
    id: row.id,
    athleteId: row.athlete_id,
    date: row.date,
    mechanism: row.mechanism,
    description: row.description,
    sport: row.sport,
    symptoms: row.symptoms,
    rtpStatus: row.rtp_status,
    scatData: row.scat_data,
    linkedInjuryId: row.linked_injury_id,
    autoCreated: !!row.auto_created,
    reportedBy: row.reported_by,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Concussion incidents for a set of athletes (practitioner roster). RLS gates on
// view_injuries. Part 2 reads these so trigger-created incidents surface; manual
// SCAT authoring stays out of scope (D8).
export async function listConcussionIncidents(athleteIds) {
  if (!athleteIds || !athleteIds.length) return [];
  const { data, error } = await supabase
    .from('concussion_incidents')
    .select('*')
    .in('athlete_id', athleteIds)
    .order('date', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToConcussionIncident);
}
