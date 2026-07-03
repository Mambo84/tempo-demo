import { supabase } from '../supabase';

// Data-access layer for coordination / staff / clinical notes (brief §6.5, M6).
// The DB stores snake_case columns; the UI (App.jsx) works in camelCase and reads
// `n.author` / `n.role` / `n.date` (the denormalised display fields). These mappers
// are the single translation point so both note panels keep working unchanged
// against real data.
//
// RLS (0006) does all the visibility gating server-side:
//   - the athlete (self) sees ONLY visibility='athlete' notes about themselves;
//   - linked staff need view_notes; 'medical' additionally needs view_medical.
// So the client never re-filters by visibility — it trusts what RLS returns. The
// athlete home still filters `!archived` for display (an athlete choice), and the
// practitioner side applies the existing app-layer medical filter for its own UI.

// DB row → UI note. author_name/author_role map to the UI's `author`/`role`, and
// created_at is the note's display `date` (fmtDate/fmtShort accept an ISO string).
export function rowToNote(row) {
  if (!row) return null;
  return {
    id: row.id,
    athleteId: row.athlete_id,
    authorUserId: row.author_user_id,
    author: row.author_name || 'Unknown',
    role: row.author_role || 'Staff',
    type: row.type || 'Coordination',
    visibility: row.visibility,
    text: row.text,
    acknowledged: !!row.acknowledged,
    acknowledgedAt: row.acknowledged_at || undefined,
    archived: !!row.archived,
    date: row.created_at,
  };
}

// UI note (from the composer: { text, visibility, type }) → DB row. athlete_id,
// author_user_id and the denormalised author_name/author_role are set by the
// caller below, not here.
export function noteToRow(input) {
  const row = {};
  if (input.text !== undefined) row.text = input.text;
  if (input.visibility !== undefined) row.visibility = input.visibility;
  if (input.type !== undefined) row.type = input.type;
  return row;
}

// All notes for one athlete, newest first. For a real athlete (self) RLS returns
// only their athlete-visible notes; for a practitioner it returns what their link
// permissions allow. Used by the athlete home.
export async function listNotes(athleteId) {
  if (!athleteId) return [];
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToNote);
}

// Notes for several athletes at once (practitioner roster). RLS filters to those
// the caller may view; the note tab then filters per selected athlete.
export async function listNotesForAthletes(athleteIds) {
  if (!athleteIds || !athleteIds.length) return [];
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .in('athlete_id', athleteIds)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToNote);
}

// Create a note. `author` is the acting user ({ id, name, role }); author_user_id
// must be the caller (auth.uid()) and author_name/author_role are denormalised for
// display so readers don't need to fetch the author's profile.
export async function createNote(athleteId, input, author) {
  const row = {
    ...noteToRow(input),
    athlete_id: athleteId,
    author_user_id: author?.id ?? null,
    author_name: author?.name ?? null,
    author_role: author?.role ?? null,
  };
  const { data, error } = await supabase
    .from('notes')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return rowToNote(data);
}

// Athlete acknowledges a note. Self can update their own notes (RLS). Stamps time.
export async function acknowledgeNote(id) {
  const { data, error } = await supabase
    .from('notes')
    .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return rowToNote(data);
}

// Athlete archives a note (soft — the practitioner still sees it in their history).
export async function archiveNote(id) {
  const { data, error } = await supabase
    .from('notes')
    .update({ archived: true })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return rowToNote(data);
}
