import { supabase } from '../supabase';

// Data-access layer for athlete profiles (brief §6.1). Maps between the DB row
// (snake_case, dedicated columns + profile_extras/wellness_settings jsonb) and
// the UI athlete shape used throughout App.jsx.
//
// Fields with no dedicated column (dominant side, contact/emergency/GP/medical
// details, contactSharing) live in `profile_extras`. injuryStatus/injuryNote are
// derived from the injuries table (M7); a real athlete defaults to 'available'.
// wellness_settings is owned by M4 — here we only read it tolerantly and let the
// DB default apply on create.

const FULL_SELF_PERMISSIONS = {
  view_basic: true, view_workouts: true, view_wellness: true, view_injuries: true,
  view_medical: true, view_gps: true, view_hr: true, view_notes: true,
  view_reports: true, view_export: true,
  edit_profile: true, edit_workouts: true, edit_injuries: true, edit_notes: true,
};

const DEFAULT_CONTACT_SHARING = {
  phone: false, email: false, emergencyContact: false, gp: false, notes: '',
};

// Tolerant of both UI (`enabledFields`) and DB (`enabled_fields`) key styles so a
// profile created before M4 formalises wellness still reads cleanly.
function wellnessToUi(ws) {
  const src = ws || {};
  const ef = src.enabledFields || src.enabled_fields || {};
  const on = (v) => v !== false; // default-on unless explicitly disabled
  return {
    frequency: src.frequency || 'daily',
    enabledFields: {
      fatigue: on(ef.fatigue), soreness: on(ef.soreness), sleep: on(ef.sleep),
      stress: on(ef.stress), mood: on(ef.mood), motivation: on(ef.motivation),
    },
  };
}

// DB row → UI athlete.
export function rowToAthlete(row) {
  if (!row) return null;
  const extras = row.profile_extras || {};
  const { contactSharing, ...profileExtras } = extras;
  return {
    id: row.id,
    name: row.display_name,
    playerId: row.player_id || null,
    team: row.team || null,
    squad: row.squad || null,
    position: row.position || null,
    sport: row.sport || null,
    ownerUserId: row.owner_user_id || null,
    // Injury-derived (M7). A freshly created real athlete is available by default.
    injuryStatus: 'available',
    injuryNote: null,
    profile: {
      dob: row.date_of_birth || '',
      sex: row.sex || '',
      height: row.height_cm ?? null,
      weight: row.weight_kg ?? null,
      ...profileExtras,
    },
    contactSharing: contactSharing || { ...DEFAULT_CONTACT_SHARING },
    wellnessSettings: wellnessToUi(row.wellness_settings),
  };
}

// UI wellness settings (camelCase `enabledFields`) → DB jsonb. Canonical stored
// shape is snake_case `enabled_fields`, matching the column default and schema
// doc; wellnessToUi() above reads either style back.
function wellnessToRow(ws) {
  const src = ws || {};
  const ef = src.enabledFields || src.enabled_fields || {};
  const on = (v) => v !== false;
  return {
    frequency: src.frequency || 'daily',
    enabled_fields: {
      fatigue: on(ef.fatigue), soreness: on(ef.soreness), sleep: on(ef.sleep),
      stress: on(ef.stress), mood: on(ef.mood), motivation: on(ef.motivation),
    },
  };
}

// UI athlete → DB row (for profile edits). Wellness is intentionally NOT written
// here — it has its own updateWellnessSettings() below.
export function athleteToRow(a) {
  const p = a.profile || {};
  const { dob, sex, height, weight, ...restProfile } = p;
  const extras = { ...restProfile };
  if (a.contactSharing) extras.contactSharing = a.contactSharing;
  return {
    display_name: a.name,
    player_id: a.playerId || null,
    position: a.position || null,
    team: a.team || null,
    squad: a.squad || null,
    sport: a.sport || null,
    date_of_birth: dob || null,
    sex: sex || null,
    height_cm: height ?? null,
    weight_kg: weight ?? null,
    profile_extras: extras,
  };
}

// Resolve the logged-in user's own athlete profile, or null if they have none.
// Primary path: owner_user_id (set on self-created profiles). Fallback: an active
// self link (covers profiles bulk-created before the user claimed them — future).
export async function getMyAthlete(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('athletes')
    .select('*')
    .eq('owner_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) { console.error('getMyAthlete (owner)', error); return null; }
  if (data && data.length) return rowToAthlete(data[0]);

  const { data: links, error: linkErr } = await supabase
    .from('athlete_user_links')
    .select('athlete_id')
    .eq('user_id', userId)
    .eq('role', 'self')
    .eq('status', 'active')
    .limit(1);
  if (linkErr || !links || !links.length) return null;
  const { data: viaLink } = await supabase
    .from('athletes')
    .select('*')
    .eq('id', links[0].athlete_id)
    .limit(1);
  return viaLink && viaLink.length ? rowToAthlete(viaLink[0]) : null;
}

// Create the athlete profile AND the owning `self` link (brief §4: the owning
// user has role 'self').
//
// Sequencing matters. The athletes SELECT policy calls is_athlete_self(), a
// SECURITY DEFINER helper that RE-QUERIES the athletes table. A row inserted by
// the current command is not visible to a re-scan within that same command
// (Postgres command-snapshot visibility), so an `INSERT ... RETURNING` (i.e.
// `.insert().select()`) is denied with 42501 even though owner_user_id matches.
//
// So we: (1) generate the id client-side and insert WITHOUT returning (only the
// WITH CHECK `created_by = auth.uid()` runs — no readback); (2) insert the self
// link in a separate statement, by which point the committed athlete row makes
// is_athlete_self() true; (3) re-read on a fresh snapshot where RLS now passes.
export async function createAthlete(input, userId) {
  const id = globalThis.crypto?.randomUUID?.();
  if (!id) throw new Error('crypto.randomUUID unavailable — cannot create athlete profile.');

  const row = {
    id,
    owner_user_id: userId,
    created_by: userId,
    display_name: (input.displayName || input.name || '').trim(),
    position: input.position?.trim() || null,
    sport: input.sport?.trim() || null,
    team: input.team?.trim() || null,
    squad: input.squad?.trim() || null,
    // wellness_settings omitted → DB default ('daily', all fields) applies (M4 owns it)
  };

  // No .select(): avoids the RETURNING SELECT-policy check on the just-inserted row.
  const { error } = await supabase.from('athletes').insert(row);
  if (error) throw error;

  const { error: linkErr } = await supabase
    .from('athlete_user_links')
    .insert({
      athlete_id: id,
      user_id: userId,
      role: 'self',
      status: 'active',
      permissions: FULL_SELF_PERMISSIONS,
      accepted_at: new Date().toISOString(),
    });
  if (linkErr) throw linkErr;

  // Fresh statement — the athlete row is now committed and visible, so the
  // owner branch of is_athlete_self() admits this read.
  const { data } = await supabase.from('athletes').select('*').eq('id', id).limit(1);
  if (data && data.length) return rowToAthlete(data[0]);
  return rowToAthlete(row); // fallback: functional, minus DB-defaulted columns
}

// Update an existing athlete profile (top-level columns + profile_extras).
export async function updateAthlete(id, patch) {
  const { data, error } = await supabase
    .from('athletes')
    .update(athleteToRow(patch))
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return rowToAthlete(data);
}

// Persist the athlete's wellness settings (frequency + enabled fields) to the
// athletes.wellness_settings jsonb. RLS gate is edit_profile — the owner bypass
// lets the athlete change their own settings. Returns the refreshed UI athlete.
export async function updateWellnessSettings(athleteId, settings) {
  const { data, error } = await supabase
    .from('athletes')
    .update({ wellness_settings: wellnessToRow(settings) })
    .eq('id', athleteId)
    .select()
    .single();
  if (error) throw error;
  return rowToAthlete(data);
}
