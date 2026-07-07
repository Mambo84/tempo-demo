import { supabase } from './supabase';

// Thin wrappers around Supabase Auth. Email + password, plus password reset
// (pulled forward from M11). No email verification or social login.

// display_name, default_role and title are stored in the auth user's metadata.
// The handle_new_user() trigger (migration 0001) copies them into `profiles`.
export async function signUp({ email, password, displayName, defaultRole, title }) {
  return supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName || '',
        default_role: defaultRole === 'athlete' ? 'athlete' : 'practitioner',
        title: title || '',
      },
    },
  });
}

export async function signInWithPassword({ email, password }) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

// Send a password-reset email. `redirectTo` must be an allowed Redirect URL in
// Supabase (Auth → URL Configuration). When the user clicks the link, supabase-js
// (detectSessionInUrl) parses the token and fires a PASSWORD_RECOVERY event.
// Note: succeeds regardless of whether the email exists (no account enumeration).
export async function resetPasswordForEmail(email, redirectTo) {
  return supabase.auth.resetPasswordForEmail(email, { redirectTo });
}

// Set a new password for the user in the current (recovery) session.
export async function updatePassword(newPassword) {
  return supabase.auth.updateUser({ password: newPassword });
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// Subscribe to auth changes. Returns the Supabase subscription handle so the
// caller can unsubscribe. Callback receives (session, event) — the event lets the
// caller detect 'PASSWORD_RECOVERY' (reset link clicked) vs. a normal sign-in.
export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => callback(session, event));
}

// Fetch the signed-in user's profile row. Used from M3 onward; M1 routing reads
// default_role straight off the session metadata so it never blocks on this.
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) return null;
  return data;
}
