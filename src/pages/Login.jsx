import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, guError } from '../lib/auth';
import { EMAIL_RE, MOBILE_RE } from '../lib/constants';
import '../styles/forms.css';

export default function Login() {
  const { login, resetPassword } = useAuth();
  const nav = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState(false);

  const looksLikeEmail = EMAIL_RE.test(identifier.trim());

  async function submit(ev) {
    ev.preventDefault();
    setError('');
    setSent('');

    const id = identifier.trim();
    if (!MOBILE_RE.test(id) && !EMAIL_RE.test(id)) {
      setError('મોબાઈલ નંબર (૧૦ અંક) અથવા ઈમેલ લખો.');
      return;
    }
    if (!password) {
      setError('પાસવર્ડ લખો.');
      return;
    }

    setBusy(true);
    try {
      await login(id, password);
      nav('/', { replace: true });
    } catch (err) {
      // The Netlify Function returns its own Gujarati message; Firebase errors get mapped.
      setError(err.gu || guError(err));
    } finally {
      setBusy(false);
    }
  }

  /** Reset mail can only go to the email address — there is no OTP fallback. */
  async function forgot() {
    setError('');
    setSent('');
    const id = identifier.trim();
    if (!looksLikeEmail) {
      setError('પાસવર્ડ નવો મેળવવા માટે ઉપર તમારું ઈમેલ સરનામું લખો.');
      return;
    }
    try {
      await resetPassword(id);
      setSent('નવો પાસવર્ડ બનાવવાની લિંક તમારા ઈમેલ પર મોકલી છે. ઈનબોક્સ અને સ્પામ બંને જુઓ.');
    } catch (err) {
      setError(guError(err));
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">લોગિન</h1>
        <p className="auth-sub">જય સ્વામિનારાયણ — ધ્યાન શરૂ કરવા લોગિન કરો</p>

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="identifier">મોબાઈલ નંબર અથવા ઈમેલ</label>
            <input
              id="identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              inputMode={/^\d*$/.test(identifier) ? 'numeric' : 'text'}
              disabled={busy}
            />
            <div className="hint">બંનેમાંથી કોઈપણ એકથી લોગિન થઈ શકે છે.</div>
          </div>

          <div className="field">
            <label htmlFor="password">પાસવર્ડ</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={busy}
            />
          </div>

          {error && <div className="notice warn">{error}</div>}
          {sent && <div className="notice">{sent}</div>}

          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'લોગિન થાય છે…' : 'લોગિન કરો'}
          </button>
        </form>

        <button className="btn btn-quiet" type="button" onClick={forgot} disabled={busy}>
          પાસવર્ડ ભૂલી ગયા?
        </button>

        <p className="auth-alt">
          નવા છો? <Link to="/register">નોંધણી કરો</Link>
        </p>
      </div>
    </div>
  );
}
