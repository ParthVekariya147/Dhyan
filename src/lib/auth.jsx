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

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    // Nothing may touch `supabase` here — App renders the ગોઠવણ notice instead, and
    // reaching for the client would throw before it could.
    if (!configured) {
      setLoading(false);
      return;
    }

    let alive = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      if (data.session) setProfile(await loadProfile(data.session.user.id).catch(() => null));
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!alive) return;
      setSession(next);
      setProfile(next ? await loadProfile(next.user.id).catch(() => null) : null);
      setLoading(false);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const user = session?.user ?? null;

  const value = useMemo(
    () => ({
      user,
      session,
      profile,
      loading,
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

        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
        });
        if (error) throw error;

        const userId = data.user?.id;
        if (!userId) throw new Error('signup returned no user');

        // Named precisely, because the generic RLS failure it prevents ("new row violates
        // row-level security policy") points at the profiles table and hides the real cause.
        if (!data.session) {
          throw Object.assign(
            new Error('signup returned no session — "Confirm email" is enabled in Supabase'),
            { gu: 'નોંધણી હમણાં પૂરી થઈ શકતી નથી. સંચાલકને જણાવો.' }
          );
        }

        const { error: profileError } = await supabase.from('profiles').insert({
          id: userId,
          smk: smk.trim().toUpperCase(),
          name: name.trim(),
          email: cleanEmail,
          mobile: mobile.trim(),
          zone_id: zoneId,
          sub_zone_id: subZoneId,
        });

        if (profileError) {
          await supabase.auth.signOut().catch(() => {});
          throw profileError;
        }

        setProfile(await loadProfile(userId));
        return data.user;
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

        if (EMAIL_RE.test(id)) {
          const { error } = await supabase.auth.signInWithPassword({
            email: id.toLowerCase(),
            password,
          });
          if (error) throw error;
          return;
        }

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

        const { error } = await supabase.auth.setSession({
          access_token: body.access_token,
          refresh_token: body.refresh_token,
        });
        if (error) throw error;
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
        if (user) setProfile(await loadProfile(user.id));
      },
    }),
    [user, session, profile, loading, loadProfile]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
