import { createClient } from '@supabase/supabase-js';

// The frontend only ever uses the public publishable key. Service-role
// operations (e.g. creating invitations in later milestones) go through
// Supabase Edge Functions, never the browser.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  // Fail loudly in the console rather than silently constructing a broken client.
  console.error(
    'Supabase env vars missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY ' +
    'in .env.local (local) or Vercel project settings (deploy).'
  );
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,     // keeps the session in localStorage across reloads
    autoRefreshToken: true,
    detectSessionInUrl: false, // no magic links / OAuth in M1 (email + password only)
  },
});
