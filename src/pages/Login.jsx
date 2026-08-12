import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, guError } from '../lib/auth';
import { EMAIL_RE, MOBILE_RE, normaliseMobile } from '../lib/constants';
import { PasswordField, TextField } from '../components/Field';
import {
  PUBLIC_ROUTES,
  guardRoute,
  readLastRoute,
  resolveEntryRoute,
} from '../lib/entryRoute';
import '../styles/forms.css';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * PAGE CONTRACT — લોગિન (/login)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Purpose        Let a યુવક who already has an account back into his સાધના, and put him
 *                down where he left off (§7, §25) — never at the beginning.
 * Visible        Two fields, one primary button, the password-reset button, and one quiet
 *                sentence pointing at નોંધણી (§19).
 * Actions        Sign in. Ask for a reset mail. Go to નોંધણી.
 * Persisted      Nothing this page writes. The session is Supabase's.
 * Next           resolveEntryRoute() decides, once, after the profile has loaded.
 * Excluded       Any level content, any progress figure, anything that scolds.
 *
 * This page and નોંધણી are ONE design (§2). Every size, height and gap comes from
 * styles/tokens.css through styles/forms.css, and both pages build their fields with the
 * same components/Field.jsx — so neither can drift into having larger type or shorter
 * inputs than the other.
 */
export default function Login() {
  const { login, resetPassword } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errs, setErrs] = useState({});
  const [formError, setFormError] = useState('');
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState(false);

  const looksLikeEmail = EMAIL_RE.test(identifier.trim());

  /**
   * The page he was actually trying to reach, if a guard sent him here (§12).
   *
   * Checked against PUBLIC_ROUTES so that a bounce off /login or /register — which should
   * not happen, but is one router change away from happening — can never become a
   * destination that bounces him straight back here.
   */
  const from =
    typeof loc.state?.from === 'string' && !PUBLIC_ROUTES.has(loc.state.from)
      ? loc.state.from
      : null;

  /** Clearing as he types is what keeps the message slot honest — see components/Field. */
  const clear = (k) => {
    if (errs[k]) setErrs((s) => ({ ...s, [k]: undefined }));
    if (formError) setFormError('');
  };

  async function submit(ev) {
    ev.preventDefault();
    setFormError('');
    setSent('');

    // An email is passed through untouched; anything else is read as a number and put into
    // the one spelling `profiles.mobile` stores. Without this, the yuvak whose phone
    // autofills '+91 96012 69715' is told his own number is not a number — the field
    // rejected it before it ever reached the server.
    const raw = identifier.trim();
    const id = EMAIL_RE.test(raw) ? raw : normaliseMobile(raw);

    /*
      §18 — the message goes beside the field it is about, not in a banner under the form.
      A general banner made him scan two fields to find which one it meant, and on a phone
      the banner was often below the fold of the keyboard.
    */
    const e = {};
    if (!raw) e.identifier = 'મોબાઈલ નંબર અથવા ઈમેલ લખો.';
    else if (!MOBILE_RE.test(id) && !EMAIL_RE.test(id))
      e.identifier = 'મોબાઈલ નંબર ૧૦ અંકનો, અથવા આખું ઈમેલ સરનામું લખો.';
    if (!password) e.password = 'પાસવર્ડ લખો.';
    setErrs(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    try {
      /*
        §15 — one decision, after the state it depends on has loaded.

        login() now returns the profile it has already read, so the destination is worked
        out here and navigated to once. It used to navigate to '/' unconditionally and let
        the મુખપૃષ્ઠ's own guard sort it out, which showed a યુવક who had not passed the
        પ્રવેશદ્વાર a page he was not entitled to on the way past.

        Two rules, in order: if a guard sent him here from somewhere, that somewhere wins —
        provided he is now allowed it, which guardRoute() answers. Otherwise he resumes
        where he last was (§7), falling back to the મુખપૃષ્ઠ when nothing is recorded.
      */
      const { user, profile } = await login(id, password);

      const dest = from
        ? guardRoute({ path: from, user, profile }).to
        : resolveEntryRoute({ user, profile, lastRoute: readLastRoute(user?.id) });

      // `replace`, so the browser's back gesture leaves the app rather than returning to
      // a લોગિન page that would immediately redirect forward again (§16).
      nav(dest, { replace: true });
    } catch (err) {
      // The Netlify Function returns its own Gujarati message; Supabase errors get mapped.
      // This one genuinely belongs in a banner: "મોબાઈલ નંબર/ઈમેલ કે પાસવર્ડ બરાબર નથી" is
      // about the pair, and the server will not say which half was wrong (nor should it).
      setFormError(err.gu || guError(err));
    } finally {
      setBusy(false);
    }
  }

  /** Reset mail can only go to the email address — there is no OTP fallback. */
  async function forgot() {
    setFormError('');
    setSent('');
    const id = identifier.trim();
    if (!looksLikeEmail) {
      // Beside the field he has to change. It used to say "ઉપર … લખો", which is a banner
      // at the bottom of the form pointing back up at a field it could not indicate.
      setErrs((s) => ({
        ...s,
        identifier: 'નવો પાસવર્ડ મેળવવા માટે અહીં તમારું ઈમેલ સરનામું લખો.',
      }));
      return;
    }
    setBusy(true);
    try {
      await resetPassword(id);
      setSent('નવો પાસવર્ડ બનાવવાની લિંક તમારા ઈમેલ પર મોકલી છે. ઈનબોક્સ અને સ્પામ બંને જુઓ.');
    } catch (err) {
      setFormError(guError(err));
    } finally {
      // Missing before, so a failed reset left the whole form disabled with no way back.
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">લોગિન</h1>
        <p className="auth-sub">જય સ્વામિનારાયણ — ધ્યાન શરૂ કરવા લોગિન કરો</p>

        <form onSubmit={submit} noValidate>
          <TextField
            id="identifier"
            label="મોબાઈલ નંબર "
            hint="મોબાઈલ નંબર લોગિન થઈ શકે છે."
            error={errs.identifier}
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value);
              clear('identifier');
            }}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            /*
              §17 — the right keyboard for what he is typing, chosen from what he has typed
              so far. All digits means a mobile number, so the numeric pad opens; the moment
              an '@' or a letter appears it is an email and the full keyboard is needed.
              `inputMode` rather than type="tel"/type="email", because the field accepts
              both and a fixed type would validate the wrong one.
            */
            inputMode={/^\d*$/.test(identifier) ? 'numeric' : 'text'}
            disabled={busy}
          />

          <PasswordField
            id="password"
            label="પાસવર્ડ"
            error={errs.password}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clear('password');
            }}
            autoComplete="current-password"
            disabled={busy}
          />

          {formError && <div className="notice warn">{formError}</div>}
          {sent && <div className="notice">{sent}</div>}

          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'લોગિન થાય છે…' : 'લોગિન કરો'}
          </button>

          {/*
            Moved INSIDE the form, and typed `button` rather than `submit`.

            Outside it, this control sat after </form> with a 24px .btn margin above it,
            which is what made the foot of this page read as two unrelated buttons floating
            apart. Inside, it is the secondary action of the same form, closed up under the
            primary one — and the explicit type is what stops the phone keyboard's "go" key
            firing a password reset instead of a login.
          */}
          <button className="btn btn-quiet" type="button" onClick={forgot} disabled={busy}>
            પાસવર્ડ ભૂલી ગયા?
          </button>
        </form>

        {/* §19 — obvious, but never louder than લોગિન કરો above it. */}
        <p className="auth-alt">
          નવું એકાઉન્ટ બનાવવું છે? <Link to="/register">નોંધણી કરો</Link>
        </p>
      </div>
    </div>
  );
}
