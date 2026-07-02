import { supabase } from '../supabase';

// Data-access layer for practitioner→athlete invitations (M5, brief §M5 + Option A
// in docs/schema.md). The practitioner creates an invitation by the athlete's
// email; the athlete accepts on login, which creates the real athlete_user_links
// row via the accept_invitation RPC. Rows are kept as an audit trail.

// DB row → UI invitation (the inviter's own "sent" list).
export function rowToInvitation(row) {
  if (!row) return null;
  return {
    id: row.id,
    inviterUserId: row.inviter_user_id,
    invitedEmail: row.invited_email,
    role: row.role,
    permissions: row.permissions || {},
    athleteName: row.athlete_name || null,
    athleteId: row.athlete_id || null,
    direction: row.direction || 'practitioner_to_athlete',
    message: row.message || null,
    status: row.status,
    expiresAt: row.expires_at || null,
    acceptedAt: row.accepted_at || null,
    createdAt: row.created_at,
  };
}

// Create an invitation. inviterUserId must be the caller (auth.uid()).
// direction defaults to practitioner→athlete (M5); athlete→practitioner (M5.5)
// passes direction:'athlete_to_practitioner' + athleteId (the athlete's own id).
export async function createInvitation(input, inviterUserId) {
  const row = {
    inviter_user_id: inviterUserId,
    invited_email: (input.email || '').trim().toLowerCase(),
    role: input.role,
    permissions: input.permissions || {},
    athlete_name: input.athleteName?.trim() || null,
    message: input.message?.trim() || null,
    expires_at: input.expiresAt || null,
    direction: input.direction || 'practitioner_to_athlete',
    athlete_id: input.athleteId || null,
  };
  const { data, error } = await supabase
    .from('invitations')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return rowToInvitation(data);
}

// The practitioner's own pending invitations (for the "Pending invitations" list).
export async function listSentInvitations(inviterUserId) {
  if (!inviterUserId) return [];
  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('inviter_user_id', inviterUserId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToInvitation);
}

// Practitioner cancels a pending invitation (kept as a revoked audit row).
export async function revokeInvitation(id) {
  const { error } = await supabase
    .from('invitations')
    .update({ status: 'revoked' })
    .eq('id', id);
  if (error) throw error;
}

// The invited athlete's pending invitations, with inviter name/title joined
// (via the SECURITY DEFINER RPC — profiles are unreadable pre-accept).
export async function listMyInvitations() {
  const { data, error } = await supabase.rpc('list_my_invitations');
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.invitation_id,
    inviterUserId: r.inviter_user_id,
    inviterName: r.inviter_name || 'Someone',
    inviterTitle: r.inviter_title || '',
    role: r.role,
    permissions: r.permissions || {},
    athleteName: r.athlete_name || null,
    message: r.message || null,
    createdAt: r.created_at,
    expiresAt: r.expires_at || null,
    direction: r.direction || 'practitioner_to_athlete',
  }));
}

// Accept an invitation. p2a (M5): call with just the id. a2p (M5.5): the accepting
// practitioner passes their chosen role + permissions (client-computed from
// PERM_TEMPLATES). Returns the athlete_id the link was created on.
export async function acceptInvitation(invitationId, role = null, permissions = null) {
  const { data, error } = await supabase.rpc('accept_invitation', {
    p_invitation_id: invitationId,
    p_role: role,
    p_permissions: permissions,
  });
  if (error) throw error;
  return data; // uuid (athlete_id)
}
