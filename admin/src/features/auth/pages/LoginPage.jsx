import { useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAdminAuth } from '../../../lib/adminAuth';
import { loginError, NOT_ADMIN } from '../../../lib/errors';

/**
 * §12 — the સંચાલક login.
 *
 * A page of its own, not the યુવક login imported. The two look different on purpose, and
 * importing src/pages/Login.jsx would tie the panel's build to the app's routing and
 * auth context — exactly the coupling this separation exists to prevent.
 *
 * Email only, deliberately. The yuvak login also accepts a mobile number, which works by
 * asking /api/login-mobile to resolve it to an email server-side. There is no reason to
 * put a handful of admins through an endpoint whose whole purpose is not leaking the
 * email addresses of 2,000 yuvaks (§48).
 *
 * Nothing here decides who is an admin. A successful sign-in only produces an identity;
 * RequireAdmin then asks the server via effective_role(), and the RLS policies in
 * supabase/migrations/0004_rbac.sql have the final say.
 *
 * `unconfigured` comes from AdminAuthProvider and means exactly one thing: VITE_SUPABASE_URL
 * or VITE_SUPABASE_PUBLISHABLE_KEY was missing from the build. RequireAdmin words the same
 * condition the same way, deliberately — it is the same fix.
 *
 * Every state this form can be in ends somewhere a person can act: a field error under the
 * field that caused it, a sentence for a refusal, a spinner *on the button* that resolves,
 * and never a full-page loader with nothing to press (§33, §34).
 */

/**
 * Enough of an address to be worth a round trip, and no more.
 *
 * Deliberately not an RFC-shaped pattern. The only thing worth catching here is the typo a
 * person can fix without leaving the field — a missing @, a space pasted in from a chat
 * message. Anything stricter starts refusing addresses that GoTrue would have accepted, and
 * the real verdict on an address is always the server's.
 */
const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+$/.test(v.trim());

export default function LoginPage() {
  const { login, resetPassword, logout, status, user, unconfigured } = useAdminAuth();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [reveal, setReveal] = useState(false);
  // Per-field, so the message sits under the field it is about rather than in one banner
  // that says "check the details" and leaves the person to work out which (§31).
  const [invalid, setInvalid] = useState({});

  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  // Already signed in and authorised — no reason to show a login form.
  if (status === 'ok') return <Navigate to={loc.state?.from || '/dashboard'} replace />;

  /**
   * §11, §12 — a correct password is not an answer to "may this person open the panel".
   *
   * signInWithPassword() succeeds for every registered યુવક, so a yuvak who found this URL,
   * and a સંચાલક whose role was withdrawn, both type the truth and land on 'denied'. Only
   * 'ok' navigates away, so until this was rendered the sequence was: press Log in, `busy`
   * clears in the `finally`, the form comes back exactly as it was, and nothing is said.
   * The button looked broken, and the one fact the person needed — the credentials were
   * right, the permission is not — was the one fact never on the screen.
   *
   * The session is deliberately left standing rather than signed out from under him: the
   * refusal names the account it applies to, which is meaningless if that account has
   * already been forgotten by the time it is read.
   */
  const refused = status === 'denied';

  /**
   * The identity exists and effective_role() has not answered yet. Held in the pending
   * state on purpose: between login() resolving and the provider deciding there is an RPC's
   * worth of time in which an idle, re-enabled form is the same silence as above.
   *
   * It cannot hang: adminAuth's evaluate() commits a state on both branches of its own
   * try/catch, so the RPC either answers or lands on 'denied' with a sentence — which is
   * why this can be a button spinner rather than a page-covering loader.
   */
  const pending = busy || (status === 'loading' && Boolean(user));

  /** Clears a field's error the moment it is being corrected, not on the next submit. */
  const edit = (setter, key) => (ev) => {
    setter(ev.target.value);
    setInvalid((v) => (v[key] ? { ...v, [key]: undefined } : v));
  };

  async function submit(ev) {
    ev.preventDefault();
    setError('');
    setSent('');

    // Checked here rather than left to `required`, because the browser's own bubble is not
    // styled by this design system, disappears on the next click, and is not announced the
    // way an inline message tied to the input with aria-describedby is (§56).
    const next = {};
    if (!email.trim()) next.email = 'Enter your email address.';
    else if (!looksLikeEmail(email)) next.email = 'That does not look like an email address.';
    if (!password) next.password = 'Enter your password.';

    setInvalid(next);
    if (next.email || next.password) {
      // Focus lands on the first thing to fix, so a keyboard user is not left to hunt for
      // a message that appeared somewhere below the fold.
      (next.email ? emailRef : passwordRef).current?.focus();
      return;
    }

    setBusy(true);
    try {
      await login(email, password);
      // No navigate() here: onAuthStateChanged fires, RequireAdmin re-evaluates, and
      // the redirect above takes over. One source of truth for "am I in".
    } catch (e) {
      setError(loginError(e));
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    setError('');
    setSent('');
    if (!email.trim()) {
      setInvalid({ email: 'Enter your email address above, then press this again.' });
      emailRef.current?.focus();
      return;
    }
    // The reset call crosses the network like the login does, so it says so while it is in
    // flight. A button that does nothing visible for two seconds gets pressed twice.
    setSending(true);
    try {
      await resetPassword(email);
      setSent('A link to create a new password has been sent to your email.');
    } catch (e) {
      setError(loginError(e));
    } finally {
      setSending(false);
    }
  }

  const locked = pending || unconfigured;

  return (
    <main className="gate">
      <form className="gate-card" onSubmit={submit} noValidate>
        <h1>Admin Panel</h1>
        <p className="gate-sub">Varni Dhyan - Management</p>

        {unconfigured && (
          <div className="notice notice-warn" role="alert">
            Supabase is not configured. Add VITE_SUPABASE_URL and
            VITE_SUPABASE_PUBLISHABLE_KEY to <code>.env.local</code> and build again.
          </div>
        )}

        {refused && (
          <div className="notice notice-danger" role="alert">
            <p>{NOT_ADMIN}</p>
            <p className="gate-foot">
              <button className="linklike" type="button" onClick={logout}>
                Log out {user?.email} and use a different account
              </button>
            </p>
          </div>
        )}

        <div className={`field${invalid.email ? ' is-invalid' : ''}`}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            ref={emailRef}
            type="email"
            autoComplete="username"
            // A phone that capitalises or autocorrects the first letter of an address is
            // offering to break the login.
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={edit(setEmail, 'email')}
            disabled={locked}
            aria-invalid={invalid.email ? 'true' : undefined}
            aria-describedby={invalid.email ? 'email-err' : undefined}
          />
          {/* Border *and* message, never colour alone (§31, §43). */}
          {invalid.email && <span className="field-error" id="email-err">{invalid.email}</span>}
        </div>

        <div className={`field${invalid.password ? ' is-invalid' : ''}`}>
          {/*
            The reveal toggle sits on the label row rather than inside the input, which
            would need absolute positioning and a padding reservation this stylesheet does
            not define. Typing a password blind on a phone keyboard is the single most
            common reason a correct password is reported as wrong.
          */}
          <span className="toolbar" style={{ marginBottom: 0, gap: 'var(--sp-2)' }}>
            <label className="grow" htmlFor="password">Password</label>
            <button
              className="linklike"
              type="button"
              onClick={() => setReveal((r) => !r)}
              disabled={locked}
              aria-pressed={reveal}
              aria-controls="password"
              // `all: unset` leaves .linklike with no box of its own; a finger needs one.
              style={{ display: 'inline-flex', alignItems: 'center', minHeight: 'var(--tap)' }}
            >
              {reveal ? 'Hide' : 'Show'}
            </button>
          </span>
          <input
            id="password"
            ref={passwordRef}
            type={reveal ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={edit(setPassword, 'password')}
            disabled={locked}
            aria-invalid={invalid.password ? 'true' : undefined}
            aria-describedby={invalid.password ? 'password-err' : undefined}
          />
          {invalid.password && <span className="field-error" id="password-err">{invalid.password}</span>}
        </div>

        {error && <div className="notice notice-danger" role="alert">{error}</div>}
        {sent && <div className="notice notice-ok" role="status">{sent}</div>}

        {/* §31 — the button says it is working and cannot be pressed twice. `.is-busy` also
            sets pointer-events: none, so the disabled state and the look agree. */}
        <button className={`btn${pending ? ' is-busy' : ''}`} type="submit" disabled={locked}>
          {pending ? 'Logging in…' : 'Log in'}
        </button>

        <p className="gate-foot">
          <button className="linklike" type="button" onClick={forgot} disabled={locked || sending}>
            {sending ? 'Sending the link…' : 'Forgot your password?'}
          </button>
        </p>
        <p className="gate-foot">This page is for Admins only.</p>
      </form>
    </main>
  );
}
