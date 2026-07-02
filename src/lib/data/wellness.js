import { supabase } from '../supabase';

// Data-access layer for wellness check-ins (brief §6.2). One row per athlete per
// day (UNIQUE(athlete_id, date)); the athlete-facing form only ever writes
// "today", so create and re-do are a single upsert on that key. No update/delete
// endpoints — there's no UI for either (M4). The `note` column exists but the
// form doesn't capture it yet; it's mapped through for a future UI.
//
// Fields are 0–7, higher = worse. wellness_checkins has NO created_by column.

// DB row → UI check-in. Nulls become `undefined` so a disabled/omitted field
// reads the same as it did in the in-memory prototype (absent).
export function rowToCheckin(row) {
  if (!row) return null;
  const und = (v) => (v === null || v === undefined ? undefined : v);
  return {
    id: row.id,
    athleteId: row.athlete_id,
    date: row.date,
    fatigue: und(row.fatigue),
    soreness: und(row.soreness),
    sleep: und(row.sleep),
    stress: und(row.stress),
    mood: und(row.mood),
    motivation: und(row.motivation),
    note: und(row.note),
  };
}

// UI check-in → DB row. All six fields are emitted explicitly (null when absent)
// so an upsert-replace fully overwrites the day's row — a field toggled off in
// settings is stored null rather than leaving a stale prior value.
export function checkinToRow(input) {
  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  return {
    date: input.date,
    fatigue: num(input.fatigue),
    soreness: num(input.soreness),
    sleep: num(input.sleep),
    stress: num(input.stress),
    mood: num(input.mood),
    motivation: num(input.motivation),
    note: input.note ?? null,
  };
}

// All check-ins for an athlete, newest first. RLS enforces view_wellness.
export async function listWellness(athleteId) {
  if (!athleteId) return [];
  const { data, error } = await supabase
    .from('wellness_checkins')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('date', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToCheckin);
}

// Check-ins for several athletes at once (practitioner roster summaries). RLS
// filters to those the caller may view (view_wellness).
export async function listWellnessForAthletes(athleteIds) {
  if (!athleteIds || !athleteIds.length) return [];
  const { data, error } = await supabase
    .from('wellness_checkins')
    .select('*')
    .in('athlete_id', athleteIds)
    .order('date', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToCheckin);
}

// Create or replace today's check-in (upsert on the athlete_id+date unique key).
export async function saveWellness(athleteId, checkin) {
  const row = { ...checkinToRow(checkin), athlete_id: athleteId };
  const { data, error } = await supabase
    .from('wellness_checkins')
    .upsert(row, { onConflict: 'athlete_id,date' })
    .select()
    .single();
  if (error) throw error;
  return rowToCheckin(data);
}
