import { supabase } from '../supabase';

// Data-access layer for workouts (brief §6.2). The DB stores snake_case columns;
// the UI (App.jsx) works in camelCase with `duration` (minutes) and velocity in
// m/s. These mappers are the single translation point between the two shapes so
// the existing UI + calc module keep working unchanged against real data.
//
// Unit note: the UI holds max velocity in m/s (`maxVelocityMps`); the DB column
// is `max_velocity_kmh`. We convert on the boundary (×3.6 out, ÷3.6 in).

const MPS_TO_KMH = 3.6;

// DB row → UI workout. Nulls become `undefined` so optional UI fields stay unset.
export function rowToWorkout(row) {
  if (!row) return null;
  const und = (v) => (v === null || v === undefined ? undefined : v);
  return {
    id: row.id,
    athleteId: row.athlete_id,
    date: row.date, // Postgres `date` comes back as 'YYYY-MM-DD' — the shape calc/UI expect
    type: row.type,
    duration: und(row.duration_min),
    rpe: und(row.rpe),
    note: row.note || '',
    source: row.source || 'manual',
    editedAt: und(row.edited_at),
    // Optional GPS / external load
    distanceM: und(row.distance_m),
    highSpeedDistanceM: und(row.high_speed_distance_m),
    sprintDistanceM: und(row.sprint_distance_m),
    sprintEfforts: und(row.sprint_efforts),
    maxVelocityMps: row.max_velocity_kmh != null ? row.max_velocity_kmh / MPS_TO_KMH : undefined,
    accelerations: und(row.accelerations),
    decelerations: und(row.decelerations),
    playerLoad: und(row.player_load),
    // Optional HR
    avgHr: und(row.hr_avg),
    maxHr: und(row.hr_max),
    hrZones: und(row.hr_zones),
  };
}

// UI workout (or a partial patch) → DB row. Only keys actually present on the
// input are emitted, so a partial edit never clobbers columns it didn't touch
// (e.g. editing RPE on a GPS-imported session leaves the GPS fields intact).
// `athlete_id`, `created_by`, `edited_at` and generated `session_load` are
// handled by the callers below, not here.
export function workoutToRow(input) {
  const row = {};
  const set = (key, val) => { if (val !== undefined) row[key] = val; };
  const num = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));

  set('date', input.date);
  set('type', input.type);
  set('duration_min', num(input.duration));
  set('rpe', num(input.rpe));
  if (input.note !== undefined) row.note = input.note ?? null;
  set('source', input.source);
  // Optional GPS / external load
  set('distance_m', num(input.distanceM));
  set('high_speed_distance_m', num(input.highSpeedDistanceM));
  set('sprint_distance_m', num(input.sprintDistanceM));
  set('sprint_efforts', num(input.sprintEfforts));
  set('max_velocity_kmh', input.maxVelocityMps != null ? Number(input.maxVelocityMps) * MPS_TO_KMH : undefined);
  set('accelerations', num(input.accelerations));
  set('decelerations', num(input.decelerations));
  set('player_load', num(input.playerLoad));
  // Optional HR
  set('hr_avg', num(input.avgHr));
  set('hr_max', num(input.maxHr));
  set('hr_zones', input.hrZones);
  set('external_id', input.externalId);
  return row;
}

// All workouts for an athlete, newest first. RLS enforces access.
export async function listWorkouts(athleteId) {
  if (!athleteId) return [];
  const { data, error } = await supabase
    .from('workouts')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('date', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToWorkout);
}

// Workouts for several athletes at once (practitioner roster summaries). RLS
// filters to those the caller may view; athletes without view_workouts drop out.
export async function listWorkoutsForAthletes(athleteIds) {
  if (!athleteIds || !athleteIds.length) return [];
  const { data, error } = await supabase
    .from('workouts')
    .select('*')
    .in('athlete_id', athleteIds)
    .order('date', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToWorkout);
}

// Insert a new session. `createdBy` is the acting user's id (auth.uid()).
export async function createWorkout(athleteId, input, createdBy) {
  const row = {
    ...workoutToRow(input),
    athlete_id: athleteId,
    created_by: createdBy ?? null,
  };
  const { data, error } = await supabase
    .from('workouts')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return rowToWorkout(data);
}

// Update an existing session. Stamps edited_at; never moves the row's athlete.
export async function updateWorkout(id, patch) {
  const row = {
    ...workoutToRow(patch),
    edited_at: new Date().toISOString(),
  };
  delete row.athlete_id;
  const { data, error } = await supabase
    .from('workouts')
    .update(row)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return rowToWorkout(data);
}

// Delete a session.
export async function deleteWorkout(id) {
  const { error } = await supabase.from('workouts').delete().eq('id', id);
  if (error) throw error;
}
