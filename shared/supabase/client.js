import { createClient } from '@supabase/supabase-js';

/**
 * The Supabase client, shared by the યુવક app (src/) and the સંચાલક panel (admin/).
 *
 * The publishable key ships to every browser — that is what it is for. Nothing is
 * protected by keeping it quiet; Row Level Security is. Every table in
 * supabase/migrations/0001_init.sql has policies, and an anonymous request reads
 * nothing, which is verified rather than assumed (scripts/verify-rls.mjs).
 */
export function supabaseConfigFromEnv(env = import.meta.env) {
  return {
    url: env.VITE_SUPABASE_URL,
    key: env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
}

export const isSupabaseConfigured = (c) => Boolean(c?.url && c?.key);

let client;

export function getSupabase(env) {
  if (client) return client;
  const { url, key } = supabaseConfigFromEnv(env);
  if (!isSupabaseConfigured({ url, key })) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env.local and fill in ' +
        'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'
    );
  }
  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The session lives in localStorage so a yuvak stays signed in between visits —
      // §9 expects him to open the app daily without logging in again.
      storageKey: 'varni.auth',
      detectSessionInUrl: true,
    },
  });
  return client;
}

/**
 * The same client, but built on first *use* instead of on import.
 *
 * Both apps export their client from a module their auth provider imports at the top of
 * the file. Calling getSupabase() there ran it during module evaluation — before React
 * mounts, and before any error boundary exists — so one missing env var threw where
 * nothing could catch it and the browser showed a blank white page. Both apps already
 * have a written-out Gujarati "ગોઠવણ થઈ નથી" notice for exactly this case, and neither
 * could ever reach it.
 *
 * Deferring construction lets the app boot far enough to say what is wrong, and leaves
 * every call site (`supabase.from(…)`) untouched.
 *
 * Accessing any property still throws when the keys are missing — that is deliberate.
 * The providers check isSupabaseConfigured() first and skip the client entirely, so a
 * throw here means real code reached for the database in a state it should have guarded.
 */
export function lazySupabase(env) {
  const resolve = () => getSupabase(env);
  return new Proxy(
    {},
    {
      get(_target, prop) {
        const value = resolve()[prop];
        // Bound to the real client: an unbound method would receive the proxy as `this`,
        // and supabase-js reads private fields off `this` internally.
        return typeof value === 'function' ? value.bind(resolve()) : value;
      },
      has: (_target, prop) => prop in resolve(),
    }
  );
}
