import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

// Publishable keys are intended for browsers. Never accept a secret/service-role key.
let client = null;
try {
  if (url && key?.startsWith('sb_publishable_') && new URL(url).protocol === 'https:') {
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
} catch {
  // Invalid configuration leaves the application locked on the login screen.
}
export const supabase = client;
export const configurationError = client ? '' : 'Sign-in is unavailable. Ask your administrator to configure the Supabase URL and publishable key, then redeploy.';
