import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { isSupabaseConfigured, supabaseConfigFromEnv } from '../../../shared/supabase/client.js';
import { can as holds, isReadOnly as setIsReadOnly, roleLabel } from '../../../shared/domain/permissions.js';
import { resetRedirectTo } from '../../../shared/domain/recovery-routes.js';
import { dataError } from './errors';

const Ctx = createContext(null);
export const useAdminAuth = () => useContext(Ctx);

const configured = isSupabaseConfigured(supabaseConfigFromEnv(import.meta.env));

/**
 * The settled "holds nothing" state, in one place.
 *
 * It is written on four different paths — signed out, authorisation refused, the session
 * unreadable, and Supabase not configured — and each used to spell it out. Every field added
 * since (permissions, rank, isBootstrap) then had to be remembered in all four, and a field
 * left out of one of them is a stale permission list surviving a sign-out, which is the exact
 * failure this provider's ticket mechanism exists to prevent elsewhere.
 */
const ANON = {
  status: 'anon',
  user: null,
  profile: null,
  role: null,
  roleLabel: '-',
  permissions: [],
  rank: 0,
  isBootstrap: false,
  via: null,
  error: null,
};

/**
 * સંચાલક authorisation.
 *
 * Under Firebase this had three paths — a custom claim, a server call to mint one, and a
 * fallback that read the profile's mobile number. All of that existed because Firestore
 * rules cannot run a query, so "is this person an admin" had to be smuggled into the
 * token or re-derived on the client.
 *
 * Postgres just answers the question: `public.admin_session()` is a SECURITY DEFINER
 * function built on the same `has_permission()` every RLS policy calls. One RPC call, and
 * it is the *same* check the database enforces on every row — so the panel can never
 * believe it has access the database will refuse, or vice versa.
 *
 * It returns the role rather than a boolean, which is the whole point of 0004_rbac.sql: a
 * COORDINATOR and a SUPER_ADMIN are both "an admin" and must not see the same panel. What
 * `can()` decides here is only what renders. Every one of those permissions is checked
 * again inside the policy on the table being read or written, so a yuvak who edits this
 * file out of his own bundle changes what he sees and nothing about what he gets.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this asks for the permissions and not just the role
 * ────────────────────────────────────────────────────────────────────────────
 *
 * It used to call `effective_role()` and answer `can()` from a copy of the matrix compiled
 * into the bundle (shared/domain/permissions.js). 0043 makes the matrix editable from the
 * panel and adds per-person exceptions, so that copy cannot survive: a bundle carrying last
 * week's version would offer a section that is refused on arrival, or hide one the person
 * has just been given.
 *
 * `admin_session()` returns role, label, rank, the resolved permission list and whether the
 * caller is standing on 0024's bootstrap fallback — in the one round trip that was already
 * being made. 0004 justified duplicating the matrix by wanting to avoid a startup round
 * trip; there is no extra round trip, so there is nothing left to justify.
 *
 * status: 'loading' | 'anon' | 'denied' | 'ok'
 *
 * `error` is set only on the second kind of 'denied'. A role of null is a settled answer —
 * the person is an ordinary yuvak — and carries no error. A check that could not be
 * *completed* is not an answer at all: it still fails closed, because a panel that opened
 * whenever the network hiccuped would be no gate (§65), but it says so honestly and offers
 * recheck() rather than telling a real સંચાલક he has lost his access.
 */
export function AdminAuthProvider({ children }) {
  // `permissions` is never null, at any point in the lifecycle: an empty array is "holds
  // nothing", which is a settled answer, and can() would read `undefined.includes` otherwise
  // during the frame before the RPC lands.
  const [state, setState] = useState({ ...ANON, status: 'loading' });

  // Bumped by recheck(): re-running the effect re-subscribes, which replays the initial
  // session and so retries the whole evaluation down the same path the first attempt took.
  // A dedicated "retry" function would be a second code path for the one thing that must
  // not have two.
  const [attempt, setAttempt] = useState(0);
  const recheck = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!configured) {
      setState({ ...ANON, unconfigured: true });
      return;
    }

    let alive = true;

    // One `alive` for the whole effect was not enough. evaluate() is re-entrant — signing
    // out while the mount-time RPC is still in flight starts a second run before the first
    // has resolved — and `alive` only says "the provider is still mounted", never "this is
    // still the newest answer". The older run then committed {status:'ok'} over a session
    // that no longer exists, and the panel stayed on screen for a signed-out user until
    // some later event happened to correct it. A ticket per invocation makes every earlier
    // run silent the moment a later one starts, so only the newest result may commit.
    let ticket = 0;

    const evaluate = async (session) => {
      if (!alive) return;
      const mine = ++ticket;
      const current = () => alive && mine === ticket;
      const user = session?.user ?? null;
      if (!user) {
        setState({ ...ANON, status: 'anon' });
        return;
      }
      setState((s) => ({ ...s, status: 'loading', user, error: null }));
      try {
        const [{ data, error }, profile] = await Promise.all([
          supabase.rpc('admin_session'),
          readProfile(user.id),
        ]);
        if (error) throw error;
        if (!current()) return;

        /*
          admin_session() is a `returns table`, so PostgREST hands back an array. It returns
          no row at all for an ordinary યુવક — the same answer effective_role() gave as NULL,
          and the reason this reads `[0]` rather than treating an empty result as a failure.
        */
        const s = Array.isArray(data) ? data[0] : data;
        const role = s?.role || null;

        setState({
          status: role ? 'ok' : 'denied',
          user,
          profile: role ? profile : null,
          role,
          // The label as the database has it, so a role created last Tuesday reads as its
          // own name rather than as a bare key. roleLabel() only fills in for a key that
          // arrived without one.
          roleLabel: roleLabel(role, s?.role_label ? { [role]: s.role_label } : null),
          permissions: Array.isArray(s?.permissions) ? s.permissions : [],
          rank: s?.rank ?? 0,
          isBootstrap: Boolean(s?.is_bootstrap),
          via: 'rls',
          error: null,
        });
      } catch (e) {
        console.error('[admin] authorization failed', e);
        // Closed, and named. dataError() maps the SQLSTATE to a sentence and logs the code
        // and Postgres's own hint, which is what the person fixing this actually needs.
        if (current()) {
          setState({ ...ANON, status: 'denied', user, error: dataError(e) });
        }
      }
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => evaluate(session));

    /**
     * §11 — the panel must always reach a decision.
     *
     * `getSession().then(evaluate)` used to stand here, and it was a *second* evaluation of
     * the same session: supabase-js ^2.112 emits a synthetic INITIAL_SESSION to a
     * subscriber the moment it registers (GoTrueClient._emitInitialSession), so every page
     * load ran effective_role() twice and read the profile twice — and the two overlapping
     * runs are what turned the race above from theoretical into routine. The subscription
     * already covers the initial session; it is now the single source.
     *
     * The call is kept for its *rejection* alone, which is why nothing here evaluates.
     * _emitInitialSession() swallows its own errors and emits a null session, but the
     * promise it lives inside can still reject before reaching it — a storage lock held by
     * another tab that times out — and then no event ever arrives, no state transition
     * happens, and RequireAdmin spins on 'loading' forever with nothing to press. This
     * notices, and stays quiet unless the subscription has not already answered.
     */
    supabase.auth.getSession().catch((e) => {
      console.error('[admin] could not read the session', e);
      if (!alive || ticket > 0) return;
      setState({ ...ANON, status: 'denied', error: dataError(e) });
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [attempt]);

  const value = useMemo(
    () => ({
      ...state,
      isAdmin: state.status === 'ok',

      /**
       * What may this administrator do? Visibility only — never the security boundary.
       *
       * Read by AdminShell to filter the sidebar and by RequirePermission to guard the
       * route behind it, so a section the person holds no permission for is neither
       * offered nor reachable by typing its URL. Both of those are usability: the same
       * permission is checked again by `has_permission()` inside the policy on every row
       * read or written (§65).
       *
       * Since 0043 this tests membership of the list the *server* resolved — role, plus
       * every unexpired ALLOW grant, minus every DENY — rather than looking a role up in a
       * matrix the bundle carries. The panel no longer has an opinion about what a role
       * means; it asks.
       */
      can: (permission) => holds(state.permissions, permission),
      isReadOnly: setIsReadOnly(state.permissions),

      /** Retry an authorisation check that failed to complete. See `error` above. */
      recheck,

      login: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({
          email: String(email).trim().toLowerCase(),
          password,
        });
        if (error) throw error;
      },

      /**
       * Mail a recovery link to a સંચાલક who cannot get in.
       *
       * The destination is /reset-password — the યુવક app's recovery screen — and NOT
       * /admin/, which is what this used to send. That was not a cosmetic difference. Supabase
       * opens a live recovery session the moment it verifies the link, so the old redirect
       * landed a સંચાલક on the dashboard *already signed in*, with nothing on screen asking
       * for a new password: the link was spent, the password was unchanged, and the only
       * visible outcome was that he was mysteriously logged in. Every further attempt did the
       * same thing, so an admin who had genuinely forgotten his password could never recover it.
       *
       * It points at the other app rather than at a screen of the panel's own because there is
       * exactly one thing that screen may do, and src/pages/ResetPassword.jsx already does it
       * correctly: open the form only for a recovery session, call updateUser() with a password
       * and nothing else, then end the session so the new password is typed once before it is
       * relied on. A second copy here would be a second place for that to be got wrong, in the
       * one flow where getting it wrong means an arbitrary password update. Both apps are served
       * from this origin (netlify.toml), so the same host serves both halves of the journey.
       *
       * He finishes on the યુવક લોગિન screen and opens /admin/ again from there — one extra
       * navigation, in exchange for a reset that actually resets.
       *
       * Password storage is Supabase Auth's throughout. This function mails a link; it never
       * sees, sets or transports a password, and no administrator sees another person's.
       */
      resetPassword: async (email) => {
        const { error } = await supabase.auth.resetPasswordForEmail(
          String(email).trim().toLowerCase(),
          { redirectTo: resetRedirectTo(import.meta.env.VITE_SITE_URL || location.origin) }
        );
        if (error) throw error;
      },

      /**
       * §68 — clear auth state and return to the login screen.
       *
       * The panel stores nothing of its own in localStorage (§69). The only thing it
       * keeps is a sessionStorage marker recording that this session's ADMIN_LOGIN was
       * already logged, and that goes too, so the next sign-in is recorded as new.
       */
      logout: async () => {
        for (const k of Object.keys(sessionStorage)) {
          if (k.startsWith('admin:')) sessionStorage.removeItem(k);
        }
        await supabase.auth.signOut();
      },
    }),
    [state, recheck]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

async function readProfile(userId) {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    smk: data.smk,
    name: data.name,
    email: data.email,
    mobile: data.mobile,
    zoneId: data.zone_id,
    subZoneId: data.sub_zone_id,
  };
}
