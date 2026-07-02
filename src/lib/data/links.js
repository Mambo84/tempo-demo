import { supabase } from '../supabase';
import { rowToAthlete } from './athletes';

// Data-access layer for active athlete_user_links (M5). Invitations (the pending
// intent) live in invitations.js; this module handles established links: the
// practitioner's roster, the athlete's "who has access" view, and revocation.

const unexpired = (l) => !l.expiresAt || new Date(l.expiresAt) > new Date();

// DB link row → the camelCase shape App.jsx's canAccess/accessibleAthleteIds
// helpers already consume. Optional embedded `profiles` row supplies the display
// name/title/email of the linked user (for the athlete's Privacy view).
export function rowToLink(row) {
  if (!row) return null;
  const p = row.profiles || null;
  return {
    id: row.id,
    athleteId: row.athlete_id,
    userId: row.user_id,
    role: row.role,
    permissions: row.permissions || {},
    status: row.status,
    acceptedAt: row.accepted_at || null,
    expiresAt: row.expires_at || null,
    revokedAt: row.revoked_at || null,
    createdAt: row.created_at,
    invitedEmail: row.invited_email || null,
    // resolved display fields (from the joined profile, when present)
    resolvedName: p?.display_name || null,
    resolvedTitle: p?.title || null,
  };
}

// Practitioner roster: the athletes this user has an active, unexpired link to.
// Returns [{ athlete (UI shape), link (with permissions) }].
export async function listMyAthletes(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('athlete_user_links')
    .select('*, athletes(*)')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (error) throw error;
  return (data || [])
    .map((row) => ({ athlete: rowToAthlete(row.athletes), link: rowToLink(row) }))
    .filter((r) => r.athlete && unexpired(r.link));
}

// Athlete's "who has access" (Privacy view): all links on their athlete, with the
// linked user's name/title joined. RLS admits the athlete-owner (has_athlete_admin).
export async function listAthleteLinks(athleteId) {
  if (!athleteId) return [];
  const { data, error } = await supabase
    .from('athlete_user_links')
    .select('*, profiles:user_id(display_name, title)')
    .eq('athlete_id', athleteId);
  if (error) throw error;
  return (data || []).map(rowToLink);
}

// Revoke a link (athlete removing a practitioner, or a practitioner leaving).
export async function revokeLink(linkId) {
  const { error } = await supabase
    .from('athlete_user_links')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('id', linkId);
  if (error) throw error;
}
