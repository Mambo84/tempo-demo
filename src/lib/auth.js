import { supabase } from './supabase';

// Thin wrappers around Supabase Auth. Email + password only for M1 —
// no password reset, email verification, or social login (out of scope).

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

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// Subscribe to auth changes. Returns the Supabase subscription handle so the
// caller can unsubscribe. Callback receives the session (or null).
export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => callback(session));
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
