import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { PasswordField } from '../components/Field';
import {
  RECOVERY_MESSAGE,
  classifyRecoveryError,
  readRecoveryUrl,
  validateNewPassword,
} from '../../shared/domain/recovery.js';
import '../styles/forms.css';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * PAGE CONTRACT — નવો પાસવર્ડ સેટ કરો (/reset-password)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Purpose        Change the password of the યુવક whose recovery link Supabase has just
 *                verified. Nobody else's, under any circumstances.
 * Visible        Two password fields and one button - but only once a recovery session
 *                exists. Before that, a wait; instead of that, a refusal.
 * Actions        Set the password. Ask for a fresh link. Go to લોગિન.
 * Persisted      `auth.users` only, through Supabase Auth (§12). This page writes nothing
 *                to `profiles` and stores no token anywhere.
 * Next           લોગિન, by his own tap, after the session this page arrived on has been
 *                ended (§13).
 * Excluded       The old password, the address, the token, and any statement of which
 *                account this is. He knows; the screen does not need to confirm it, and
 *                printing it would put an address on a screen anyone holding the phone
 *                can read.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What makes this safe, in one paragraph
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `updatePassword()` takes a password and nothing else. It calls `supabase.auth.updateUser`,
 * which acts on the session Supabase itself opened when it verified the link - so identity
 * comes from Supabase's verification, never from this page. That is why none of the URL
 * reading below is a permission check: `readRecoveryUrl()` picks which of three screens to
 * draw, and if it were wrong in the most generous possible direction - claiming a recovery
 * that is not there - the form would still submit into a session that does not exist and
 * Supabase would refuse it. §10: URL parameters are not proof of identity, and here they
 * are not proof of anything.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why the wait is bounded
 * ────────────────────────────────────────────────────────────────────────────
 *
 * §19 forbids an infinite spinner, and this is the one screen in the app with a real way to
 * produce one. `detectSessionInUrl` may have to exchange a PKCE code over the network before
 * a session exists, so "no session yet" is genuinely ambiguous for a moment - and the
 * ambiguity resolves either into a working form or into nothing at all, for ever, if the
 * link was already used. GRACE_MS is what turns "for ever" into a screen with two ways off
 * it.
 */

/**
 * How long "waiting for Supabase" may last before this page decides the link is not going
 * to work.
 *
 * Long enough for a code exchange on a bad connection, short enough that a યુવક holding a
 * dead link is not left watching dots. It is a display decision and nothing hangs on the
 * exact value: if the session turns up at 7 seconds the effect below still opens the form,
 * because the timer only decides what to draw while nothing has happened yet.
 */
const GRACE_MS = 6000;

export default function ResetPassword() {
  const {
    recovery,
    user,
    loading,
    unconfigured,
    updatePassword,
    verifyRecoveryToken,
    clearRecovery,
    logout,
  } = useAuth();
  const nav = useNavigate();

  /*
    The URL, read once, synchronously, on the very first render.

    A `useState` initialiser rather than an effect: effects run after paint, and
    `detectSessionInUrl` strips the recovery fragment from the address bar as soon as it has
    consumed it. Reading in an effect is therefore a race against the very thing whose
    outcome we are trying to describe, and the half we would lose is the error case - the
    expired-link fragment is exactly what gets cleaned away.
  */
  const [url] = useState(() =>
    typeof window === 'undefined'
      ? { maybeRecovery: false, failed: false, reason: '' }
      : readRecoveryUrl(window.location.hash, window.location.search)
  );

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errs, setErrs] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [waited, setWaited] = useState(false);
  /* Supabase was asked about the hash in the link and said no. Same screen as url.failed. */
  const [rejected, setRejected] = useState(false);

  const inFlight = useRef(false);

  /* The bound on the wait. Runs once; the states below read its result. */
  useEffect(() => {
    if (url.failed) return undefined;
    const id = setTimeout(() => setWaited(true), GRACE_MS);
    return () => clearTimeout(id);
  }, [url.failed]);

  /*
    ────────────────────────────────────────────────────────────────────────────
    The `token_hash` link, verified here and nowhere earlier
    ────────────────────────────────────────────────────────────────────────────

    The whole point of this shape is that the token is still unspent when the page loads, so
    this is the first and only thing that spends it. It runs once, guarded by a ref rather
    than by state: React 18's development StrictMode mounts every effect twice, and a second
    verify would present a hash the first one has already consumed — a self-inflicted
    "expired link" on every dev reload, and the kind of bug that only appears in the
    environment it is hardest to see in.

    `hasRecoverySession` is checked too, and it is the reload case: the spent hash stays in
    the address bar, so a refresh would re-enter here with a token Supabase will now refuse,
    and would replace a working form with a refusal. If a session is already open there is
    nothing to verify, and the guard says exactly that.

    The rejection is not classified beyond DEV logging. §11/§20 - expired, already spent,
    hash from another mail and hash somebody typed all reach the યુવક as the same sentence,
    and the difference between them is a statement about an account.
  */
  const verifying = useRef(false);
  useEffect(() => {
    if (unconfigured || !url.tokenHash || verifying.current) return;
    if (recovery || user) return;
    verifying.current = true;

    let alive = true;
    verifyRecoveryToken(url.tokenHash).catch((err) => {
      if (import.meta.env.DEV) console.warn('recovery token rejected:', classifyRecoveryError(err));
      if (alive) setRejected(true);
    });
    return () => {
      alive = false;
    };
  }, [unconfigured, url.tokenHash, recovery, user, verifyRecoveryToken]);

  /*
    Is there a recovery session?

    Two ways to know, and both are needed:

      * `recovery` - the latch AuthProvider sets on the PASSWORD_RECOVERY event. This is the
        normal path.
      * `url.maybeRecovery && user` - the link carried recovery markers AND a session now
        exists. This covers the case where the event fired before anything subscribed, which
        onAuthStateChange does not replay.

    The second is deliberately an AND. `url.maybeRecovery` alone would let a crafted fragment
    open the form against an ordinary signed-in session - i.e. a યુવક already logged in could
    be walked to a URL that changes his password with no mail involved. `user` alone would
    open it for every signed-in visitor who typed the path. Together they mean "he arrived
    here on a link, and that link produced a session", which is the situation this page is for.
  */
  const hasRecoverySession = recovery || (url.maybeRecovery && Boolean(user));

  async function submit(ev) {
    ev.preventDefault();
    setFormError('');

    const check = validateNewPassword(password, confirm);
    setErrs(check.errors);
    if (!check.ok) return;

    // Synchronous, for the same reason the request page keeps one: two taps inside a single
    // React batch both read `saving` as false. Two password updates would both succeed here,
    // which is harmless, but the second lands after `logout()` and reports a failure on a
    // password that was in fact changed - the worst message this screen could show.
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);

    try {
      await updatePassword(password);

      /*
        §12, steps 6 and 7, in this order.

        The password is changed first, and only then is the session it was changed on taken
        away. Reversing these would sign him out of the recovery session before it had been
        used, which is a link consumed and a password unchanged - the one outcome he cannot
        recover from without asking for another mail.

        `logout()` is deliberate and not merely tidy: he arrived here holding a live session
        Supabase opened from a link that may have been forwarded, sat in a mail app, or been
        opened on a borrowed phone. §13 sends him to લોગિન to type the password he has just
        chosen, which is also the only proof that it is the one he thinks it is.
      */
      setDone(true);
      clearRecovery();
      await logout().catch(() => {
        /* Already changed. A failed sign-out must not turn success into an error screen. */
      });
    } catch (err) {
      const kind = classifyRecoveryError(err);
      const msg = String(err?.message || '').toLowerCase();

      // Mapped, never shown raw (§11, §20). The session-shaped failures all mean the same
      // thing to him - the link is spent - and none of them may print what Supabase said.
      if (msg.includes('session') || msg.includes('jwt') || msg.includes('token') || msg.includes('expired')) {
        setFormError(RECOVERY_MESSAGE.expired);
      } else if (msg.includes('password') && (msg.includes('weak') || msg.includes('short') || msg.includes('characters'))) {
        setFormError(RECOVERY_MESSAGE.weak);
      } else if (kind === 'network') {
        setFormError(RECOVERY_MESSAGE.network);
      } else if (kind === 'throttled') {
        setFormError(RECOVERY_MESSAGE.throttled);
      } else {
        setFormError(RECOVERY_MESSAGE.generic);
      }

      // §27 - a category, never the error and never the password.
      if (import.meta.env.DEV) console.warn('password update failed:', kind);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  if (unconfigured) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="notice warn">
            એપ્લિકેશન હજુ પૂરી ગોઠવાઈ નથી. થોડી વાર પછી ફરી ખોલો, અથવા સંચાલકને જણાવો.
          </div>
        </div>
      </div>
    );
  }

  /* §13 - done. No automatic navigation: he taps, and he lands on લોગિન signed out. */
  if (done) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1 className="auth-title">પાસવર્ડ સફળતાપૂર્વક બદલાઈ ગયો છે.</h1>
          <p className="auth-sub">હવે તમે નવા પાસવર્ડથી લોગિન કરી શકો છો.</p>
          <button className="btn" type="button" onClick={() => nav('/login', { replace: true })}>
            લોગિન કરો
          </button>
        </div>
      </div>
    );
  }

  /*
    §11 - the refusal.

    One screen for every reason a link does not work: expired, already used, malformed, or
    simply never a recovery link at all. They are not told apart on purpose - the difference
    is of no use to him, and "this link was already used" is a statement about an account.
    Both ways off it are real, which is what §1 asks of a dead end.
  */
  if (url.failed || rejected || (waited && !hasRecoverySession)) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1 className="auth-title">{RECOVERY_MESSAGE.expired}</h1>
          <p className="auth-sub">
            રીસેટ લિંક થોડા સમય પછી કામ કરતી નથી, અને એક વાર વપરાયા પછી ફરી વપરાતી નથી. નવી લિંક
            મંગાવીને ફરી પ્રયાસ કરો.
          </p>
          <Link className="btn" to="/forgot-password">
            નવી રીસેટ લિંક મેળવો
          </Link>
          <Link className="btn btn-quiet" to="/login">
            લોગિન પર પાછા જાઓ
          </Link>
        </div>
      </div>
    );
  }

  /* Still resolving. Bounded by GRACE_MS above, so this cannot be the last word. */
  if (loading || !hasRecoverySession) {
    return (
      <div className="spinner-page is-auth" role="status" aria-live="polite">
        <span className="spinner-dots" aria-hidden="true">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </span>
        <span>લિંક તપાસાય છે…</span>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">નવો પાસવર્ડ સેટ કરો</h1>
        <p className="auth-sub">નવો પાસવર્ડ બે વાર લખો, જેથી ખાતરી થાય કે બંને સરખા છે.</p>

        <form onSubmit={submit} noValidate>
          <PasswordField
            id="new-password"
            label="નવો પાસવર્ડ"
            hint="ઓછામાં ઓછા ૬ અક્ષર."
            error={errs.password}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (errs.password) setErrs((s) => ({ ...s, password: undefined }));
              if (formError) setFormError('');
            }}
            autoComplete="new-password"
            disabled={saving}
          />

          <PasswordField
            id="confirm-password"
            label="પાસવર્ડ ફરીથી લખો"
            error={errs.confirm}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (errs.confirm) setErrs((s) => ({ ...s, confirm: undefined }));
              if (formError) setFormError('');
            }}
            autoComplete="new-password"
            disabled={saving}
          />

          {formError && <div className="notice warn">{formError}</div>}

          <button className="btn" type="submit" disabled={saving}>
            {saving ? 'અપડેટ થાય છે…' : 'પાસવર્ડ અપડેટ કરો'}
          </button>
        </form>
      </div>
    </div>
  );
}
