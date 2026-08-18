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
      /*
        ────────────────────────────────────────────────────────────────────────
        Implicit, and it is the password-reset flow that decides this
        ────────────────────────────────────────────────────────────────────────

        supabase-js defaults to PKCE, and PKCE binds a mailed link to the browser profile
        that ASKED for it: `resetPasswordForEmail` sends a code challenge and keeps the
        verifier in this origin's localStorage, so only that profile can exchange the
        `?code=` the mail comes back with. A યુવક who asks for the link in Chrome and then
        taps it inside the Gmail app is in a different webview with no verifier - the
        exchange throws `pkce_code_verifier_not_found`, no session is ever created, and
        /reset-password waits out its grace period and calls a perfectly good link dead.
        That is not an edge case here; tapping the link straight from the mail app is how
        nearly everyone will open it.

        It is also what makes the `token_hash` mail work. GoTrue stores a recovery token
        requested WITH a code challenge under a `pkce_` prefix, and verifying that hash
        hands back an auth code to be exchanged - the same verifier problem again, one step
        later. Without the challenge the hash verifies straight into a session, which is
        what shared/domain/recovery.js and the reset page are built on.

        What is given up: PKCE's protection against a code being intercepted in transit.
        This app has no OAuth provider and no magic link - email and password only - so the
        flow this changes is the mailed link itself, whose token is single-use, short-lived
        and already in the URL either way. §2: nothing about identity moves into the client;
        Supabase still verifies the token and issues the session.
      */
      flowType: 'implicit',
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
