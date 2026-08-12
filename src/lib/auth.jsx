import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { isSupabaseConfigured, supabaseConfigFromEnv } from '../../shared/supabase/client.js';
import { EMAIL_RE, isAdminMobile } from './constants';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

/**
 * Read from the environment, never from the client, so this stays answerable without
 * constructing one. Touching `supabase` while this is false throws by design.
 */
const configured = isSupabaseConfigured(supabaseConfigFromEnv(import.meta.env));

/**
 * Supabase's messages are English and often technical. §14 requires the whole app in
 * Gujarati, including error text, and §1 forbids anything that reads as scolding.
 */
const GU_ERRORS = {
  'Invalid login credentials': 'મોબાઈલ નંબર/ઈમેલ કે પાસવર્ડ બરાબર નથી.',
  'User already registered': 'આ ઈમેલથી ખાતું પહેલેથી છે. લોગિન કરો.',
  'Email not confirmed': 'ઈમેલ હજુ ચકાસાયું નથી. તમારા ઈનબોક્સમાં આવેલી લિંક ખોલો.',
  'Password should be at least 6 characters': 'પાસવર્ડ ઓછામાં ઓછો ૬ અક્ષરનો રાખો.',
  'For security purposes, you can only request this after':
    'થોડી વાર પછી ફરી પ્રયત્ન કરો.',
  // Supabase's built-in mailer allows only a couple of messages an hour per project.
  // It is only reachable at all when "Confirm email" is on — see register() below.
  'email rate limit exceeded': 'નોંધણી હમણાં પૂરી થઈ શકતી નથી. સંચાલકને જણાવો.',
};

const PG_ERRORS = {
  // A UNIQUE violation. Which one it is decides what the yuvak has to change.
  profiles_smk_key: 'આ SMK પહેલેથી કોઈએ વાપર્યો છે. તમારો સાચો SMK ફરી તપાસો.',
  profiles_mobile_key: 'આ મોબાઈલ નંબરથી ખાતું પહેલેથી છે. લોગિન કરો.',
};

export function guError(e) {
  if (!e) return 'કંઈક ગડબડ થઈ. ફરી પ્રયત્ન કરો.';
  if (e.gu) return e.gu;

  const msg = String(e.message || '');
  for (const [needle, gu] of Object.entries(GU_ERRORS)) {
    if (msg.includes(needle)) return gu;
  }
  for (const [constraint, gu] of Object.entries(PG_ERRORS)) {
    if (msg.includes(constraint)) return gu;
  }
  if (e.code === '23505') return 'આ વિગત પહેલેથી વપરાયેલી છે.';
  if (msg.includes('Failed to fetch')) return 'નેટ બરાબર નથી. ફરી પ્રયત્ન કરો.';
  // Anything Supabase throttles arrives as a 429 whose body we may not recognise. Without
  // this it reads as "કંઈક ગડબડ થઈ", which sends the yuvak retrying into the same wall.
  if (e.status === 429) return 'ઘણી વાર પ્રયત્ન થયો. થોડી વાર પછી ફરી કરો.';
  return 'કંઈક ગડબડ થઈ. ફરી પ્રયત્ન કરો.';
}

/**
 * Where a registration's details wait when the account was created but nobody could be
 * signed in (§14 — the નોંધણી → લોગિન fallback).
 *
 * `sessionStorage` and not `localStorage`, on purpose. This is a hand-off across one
 * navigation — નોંધણી → લોગિન, seconds apart, in the same tab — and it holds a યુવક's
 * name, mobile and SMK. Session storage dies with the tab, which is exactly the lifetime
 * the hand-off has; localStorage would leave those details on a shared phone forever.
 *
 * It exists because of what the fallback would otherwise leave behind: `signUp` succeeded,
 * so the auth account is real, but the `profiles` insert could not run (with no session,
 * `auth.uid()` is NULL and the "own profile insertable" policy refuses it). Without this,
 * logging in afterwards produces a યુવક with no profile row — no name, no SMK, no zone,
 * invisible to the સંચાલક — and no screen anywhere that would let him supply them again.
 */
const PENDING_PROFILE_KEY = 'varni:pending-profile';

const rememberPendingProfile = (fields) => {
  try {
    sessionStorage.setItem(PENDING_PROFILE_KEY, JSON.stringify(fields));
  } catch {
    // Private mode. The fallback message still appears and the account still exists;
    // only the automatic completion is lost.
  }
};

const readPendingProfile = () => {
  try {
    const raw = sessionStorage.getItem(PENDING_PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const clearPendingProfile = () => {
  try {
    sessionStorage.removeItem(PENDING_PROFILE_KEY);
  } catch {
    /* nothing to clear */
  }
};

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  /**
   * Did the last profile read FAIL, as opposed to finding nothing?
   *
   * The two are indistinguishable from `profile == null`, and they mean opposite things
   * to the router: no row is a brand-new યુવક who belongs at લેવલ ૧, while a failed read
   * is very often a yuvak with years of સાધના behind him and a bad signal. Sending the
   * second one to લેવલ ૧ would look exactly like his progress had been reset (§23), so
   * resolveEntryState() is told which of the two this is.
   */
  const [profileError, setProfileError] = useState(false);
  /**
   * True for the duration of register(), and read by PublicOnly.
   *
   * Registration signs the યુવક in BEFORE the profile row is written — it has to, because
   * the row's own RLS policy requires the session. That leaves a window of a few hundred
   * milliseconds in which he is authenticated with no profile, and without this flag the
   * public-only guard would notice the new session and redirect the નોંધણી page out from
   * under the insert that is still in flight — taking its error handling with it, so a
   * duplicate SMK would strand him on લેવલ ૧ with no account instead of putting the
   * message beside the field he has to correct.
   */
  const [registering, setRegistering] = useState(false);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) return null;
    // maybeSingle: a signed-in user with no row is a real state — it happens between
    // creating the account and writing the profile — and is not an error.
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }, []);

  /**
   * Read the profile into state, and say which of the two null cases happened.
   *
   * Returns `{ row, failed }` rather than just the row, so a caller that needs to act on
   * "there is genuinely no profile" — completePendingProfile() below — cannot mistake a
   * network failure for an empty table and write a duplicate row over a good one.
   */
  const syncProfile = useCallback(
    async (userId) => {
      if (!userId) {
        setProfile(null);
        setProfileError(false);
        return { row: null, failed: false };
      }
      try {
        const row = await loadProfile(userId);
        setProfile(row);
        setProfileError(false);
        return { row, failed: false };
      } catch {
        setProfile(null);
        setProfileError(true);
        return { row: null, failed: true };
      }
    },
    [loadProfile]
  );

  useEffect(() => {
    // Nothing may touch `supabase` here — App renders the ગોઠવણ notice instead, and
    // reaching for the client would throw before it could.
    if (!configured) {
      setLoading(false);
      return;
    }

    let alive = true;

    /*
      §12/§13 — `loading` stays true until BOTH the session and the profile are settled.

      That ordering is the whole of the "no flicker, no redirect loop" requirement. The
      route decision needs the profile as much as the session — NEW_USER and IN_PROGRESS
      are told apart by `gate_passed_at` — so clearing `loading` after the session but
      before the profile would make the router answer once with a half-known યુવક and
      again a moment later with the whole one. On a refresh of /level/4 that reads as
      level 4 → લેવલ ૧ → level 4, which is precisely the flicker §13 forbids.
    */
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      if (data.session) await syncProfile(data.session.user.id);
      if (!alive) return;
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!alive) return;
      setSession(next);
      await syncProfile(next?.user?.id ?? null);
      if (!alive) return;
      setLoading(false);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [syncProfile]);

  const user = session?.user ?? null;

  /**
   * Finish a registration whose profile insert never ran (§14).
   *
   * Called after a successful login, and only when the profile read succeeded and came
   * back empty — never when it merely failed, which would write a second row over a good
   * one. The email is checked against the session's own, so a pending hand-off left by a
   * different registration in the same tab cannot be attached to this યુવક.
   *
   * A failure here is deliberately swallowed: he IS signed in, the pages tolerate a null
   * profile, and blocking the login on a best-effort repair would be a worse outcome than
   * the missing row it is trying to fix. The details stay in sessionStorage for the next
   * attempt.
   */
  const completePendingProfile = useCallback(
    async (userId, email) => {
      const pending = readPendingProfile();
      if (!pending?.email || !userId) return null;
      if (email && pending.email !== String(email).toLowerCase()) return null;

      const { error } = await supabase.from('profiles').insert({ id: userId, ...pending });
      if (error) return null;

      clearPendingProfile();
      const { row } = await syncProfile(userId);
      return row;
    },
    [syncProfile]
  );

  const value = useMemo(
    () => ({
      user,
      session,
      profile,
      profileError,
      loading,
      registering,
      unconfigured: !configured,
      isAdmin: isAdminMobile(profile?.mobile),

      /**
       * Registration (§4).
       *
       * Two steps, and they cannot be one transaction: the auth account has to exist
       * before a profile row can reference it. If the profile insert fails — almost
       * always a duplicate SMK or mobile — the account is left without a profile, which
       * would strand the yuvak. `signOut` plus a clear Gujarati message lets him simply
       * try again with a corrected value; the orphaned auth row is harmless and is
       * reused on the next attempt with the same email.
       *
       * SMK uniqueness needs no application logic at all here: `profiles.smk` is UNIQUE,
       * so Postgres rejects the second claim outright. (Firestore needed a companion
       * index document written in a batch to achieve the same thing.)
       *
       * This depends on "Confirm email" being OFF in the Supabase dashboard
       * (Authentication → Sign In / Providers → Email). With it on, signUp() sends a
       * confirmation mail and returns a user but no session, and both halves break: the
       * built-in mailer allows ~2 messages an hour, so the third registration of the hour
       * gets 429 on /auth/v1/signup; and with nobody signed in, auth.uid() is NULL, so the
       * insert below is refused by the "own profile insertable" policy. There is no
       * confirmation screen anywhere in the app — registration is meant to end signed in,
       * on /welcome.
       */
      async register({ smk, name, email, password, mobile, zoneId, subZoneId }) {
        const cleanEmail = email.trim().toLowerCase();
        const fields = {
          smk: smk.trim().toUpperCase(),
          name: name.trim(),
          email: cleanEmail,
          mobile: mobile.trim(),
          zone_id: zoneId,
          sub_zone_id: subZoneId,
        };

        setRegistering(true);
        try {
          const { data, error } = await supabase.auth.signUp({
            email: cleanEmail,
            password,
          });
          if (error) throw error;

          const userId = data.user?.id;
          if (!userId) throw new Error('signup returned no user');

          /*
            §14 — the one case where "REGISTER → AUTO LOGIN → LEVEL ૧" is technically
            impossible, and what the yuvak is owed when it happens.

            signUp() returns a user but no session when "Confirm email" is on in the
            Supabase dashboard. The account is real and his password works, so the honest
            answer is not an error — it is "your account is made, now sign in", which is
            exactly what the fallback offers him. This used to throw, which put a
            સંચાલકને જણાવો banner in front of a યુવક whose account had in fact just been
            created successfully.

            The profile insert is not even attempted: with no session `auth.uid()` is NULL
            and the "own profile insertable" policy refuses it, so trying would only turn
            a clear outcome into an RLS error pointing at the wrong table. The details go
            to sessionStorage instead and completePendingProfile() writes the row the
            moment he signs in.
          */
          if (!data.session) {
            rememberPendingProfile(fields);
            return { user: data.user, profile: null, autoLoggedIn: false };
          }

          /*
            Adopt the session HERE rather than waiting for onAuthStateChange.

            The listener will fire too, and would set the same thing — but it is an
            asynchronous callback, and "register, then navigate to લેવલ ૧" is a promise
            that resolves in this function. Without this line the નોંધણી page can call
            navigate() while the context still reports nobody signed in, and the /welcome
            guard bounces him straight back to /login: register → login, the precise loop
            §5 exists to remove.
          */
          setSession(data.session);

          const { error: insertError } = await supabase.from('profiles').insert({
            id: userId,
            ...fields,
          });

          if (insertError) {
            // Almost always a duplicate SMK or mobile. The auth account is left behind
            // and is harmlessly reused on the next attempt with the same email; signing
            // out is what lets him correct the value and resubmit rather than being
            // carried into the app half-registered.
            await supabase.auth.signOut().catch(() => {});
            setSession(null);
            setProfile(null);
            setProfileError(false);
            throw insertError;
          }

          clearPendingProfile();
          const { row } = await syncProfile(userId);
          return { user: data.user, profile: row, autoLoggedIn: true };
        } finally {
          setRegistering(false);
        }
      },

      /**
       * Login by email OR mobile.
       *
       * Email signs in directly. Mobile cannot: Supabase authenticates on email (or on
       * phone via SMS, which we are not using), so a mobile number has to be resolved to
       * an email first. That resolution deliberately does NOT happen in the browser — a
       * lookup readable before sign-in would let anyone walk the range of Indian mobile
       * numbers and harvest ~2,000 yuvaks' email addresses.
       *
       * netlify/functions/login-mobile.js does it with the secret key and returns a
       * session, which is adopted here. No email ever reaches the client.
       */
      async login(identifier, password) {
        const id = identifier.trim();
        let next = null;

        if (EMAIL_RE.test(id)) {
          const { data, error } = await supabase.auth.signInWithPassword({
            email: id.toLowerCase(),
            password,
          });
          if (error) throw error;
          next = data.session;
        } else {
          const res = await fetch('/api/login-mobile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mobile: id, password }),
          });

          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw Object.assign(new Error(body.message || 'login failed'), {
              gu: body.gu,
              code: body.code,
            });
          }

          const { data, error } = await supabase.auth.setSession({
            access_token: body.access_token,
            refresh_token: body.refresh_token,
          });
          if (error) throw error;
          next = data.session;
        }

        /*
          §15 — resolve the destination ONCE, which means loading what the destination
          depends on before returning.

          This used to return the moment Supabase accepted the password, leaving the
          લોગિન page to navigate to '/' with a context that did not yet know whether the
          યુવક had passed the પ્રવેશદ્વાર. The મુખપૃષ્ઠ then loaded, the profile arrived, and
          a new યુવક was bounced onward to /welcome — login → home → redirect, the exact
          sequence §15 asks to avoid. Adopting the session and reading the profile here
          means the page that calls login() already has everything the route decision
          needs by the time it navigates.
        */
        setSession(next);
        const userId = next?.user?.id ?? null;
        const { row, failed } = await syncProfile(userId);

        // §14's fallback, completed. Only when the read genuinely found nothing.
        const finalRow =
          !row && !failed ? await completePendingProfile(userId, next?.user?.email) : row;

        return { user: next?.user ?? null, profile: finalRow };
      },

      /**
       * Records the two entry-gate answers (§5).
       *
       * `gate_passed_at` is stamped once and never again. It is the moment the yuvak
       * first got in, and the સંચાલક reads it as exactly that — so a yuvak who comes
       * back to the વિડિયો later and corrects an answer must not re-stamp it. That
       * would silently rewrite his entry date to today, and with it every "when did
       * he join" figure on the dashboard.
       *
       * The answers themselves stay editable for as long as he can reach the page.
       * The honour system (§5) only works if changing your mind is possible: a yuvak
       * who ticked હા to get in, then actually went and liked the video, has nothing
       * to correct — but the one who ticked હા and never did should be able to put it
       * right without asking anyone.
       */
      async saveGateAnswers({ liked, commented }) {
        if (!user) return;
        const patch = {
          like_answer: !!liked,
          comment_answer: !!commented,
        };
        if (!profile?.gate_passed_at) patch.gate_passed_at = new Date().toISOString();

        const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
        if (error) throw error;
        setProfile((p) => ({ ...p, ...patch }));
      },

      /** The only recovery route — there is no OTP fallback. */
      async resetPassword(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(
          email.trim().toLowerCase(),
          { redirectTo: `${location.origin}/login` }
        );
        if (error) throw error;
      },

      async logout() {
        await supabase.auth.signOut();
      },

      refreshProfile: async () => {
        if (user) await syncProfile(user.id);
      },
    }),
    [user, session, profile, profileError, loading, registering, syncProfile, completePendingProfile]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
