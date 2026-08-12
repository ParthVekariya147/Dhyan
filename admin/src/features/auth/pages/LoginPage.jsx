import { useState } from 'react';
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
 */
export default function LoginPage() {
  const { login, resetPassword, logout, status, user, unconfigured } = useAdminAuth();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState(false);

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
   */
  const pending = busy || (status === 'loading' && Boolean(user));

  async function submit(ev) {
    ev.preventDefault();
    setError('');
    setSent('');
    if (!email.trim() || !password) {
      setError('Enter both email and password.');
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
      setError('Enter your email address above to reset your password.');
      return;
    }
    try {
      await resetPassword(email);
      setSent('A link to create a new password has been sent to your email.');
    } catch (e) {
      setError(loginError(e));
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit} noValidate>
        <h1>Admin Panel</h1>
        <p className="gate-sub">Varni Dhyan — Management</p>

        {unconfigured && (
          <div className="notice notice-warn">
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

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending || unconfigured}
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending || unconfigured}
          />
        </div>

        {error && <div className="notice notice-danger" role="alert">{error}</div>}
        {sent && <div className="notice notice-ok">{sent}</div>}

        <button className="btn" type="submit" disabled={pending || unconfigured}>
          {pending ? 'Logging in…' : 'Log in'}
        </button>

        <p className="gate-foot">
          <button className="linklike" type="button" onClick={forgot} disabled={pending}>
            Forgot your password?
          </button>
        </p>
        <p className="gate-foot">This page is for Admins only.</p>
      </form>
    </div>
  );
}
