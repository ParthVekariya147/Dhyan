import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, guError } from '../lib/auth';
import { EMAIL_RE, MOBILE_RE, normaliseMobile } from '../lib/constants';
import { PasswordField, TextField } from '../components/Field';
import { ENTRY_ROUTE } from '../lib/entryRoute';
import '../styles/forms.css';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * PAGE CONTRACT — લોગિન (/login)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Purpose        Let a યુવક who already has an account back into his સાધના.
 * Visible        Two fields, one primary button, the password-reset button, and one quiet
 *                sentence pointing at નોંધણી (§19).
 * Actions        Sign in. Ask for a reset mail. Go to નોંધણી.
 * Persisted      Nothing this page writes. The session is Supabase's.
 * Next           / — the મુખપૃષ્ઠ, every time. It used to be "put him down where he left
 *                off (§7, §25)"; that resume is gone, and he chooses from the tiles.
 * Excluded       Any level content, any progress figure, anything that scolds.
 *
 * This page and નોંધણી are ONE design (§2). Every size, height and gap comes from
 * styles/tokens.css through styles/forms.css, and both pages build their fields with the
 * same components/Field.jsx — so neither can drift into having larger type or shorter
 * inputs than the other.
 */
export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errs, setErrs] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  /*
    `resetPassword`, `sent` and `looksLikeEmail` were pulled with the handler below them.
    All three existed only to send a recovery mail from this form, and leaving any of them
    behind would leave a second, unused path to a flow that now has one entrance - which is
    how two copies of one rule start.
  */

  /*
    `from` — the page a guard bounced him off, read from loc.state and checked against
    PUBLIC_ROUTES — stood here and decided where he went after signing in. It is gone with
    the resume: the destination is the મુખપૃષ્ઠ in every case now, so there is nothing left
    to read the state with. The guards still SET `state.from` on their redirects, which
    costs nothing and leaves the deep-link destination recoverable if it is ever wanted.
  */

  /** Clearing as he types is what keeps the message slot honest — see components/Field. */
  const clear = (k) => {
    if (errs[k]) setErrs((s) => ({ ...s, [k]: undefined }));
    if (formError) setFormError('');
  };

  async function submit(ev) {
    ev.preventDefault();
    setFormError('');

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
        Signing in lands on the મુખપૃષ્ઠ. Always, and with nothing to work out first.

        This was two rules deep: a `from` set by whichever guard bounced him here won if he
        was now allowed it, and otherwise he was resumed at the last front door recorded on
        the device. Both are gone. What that fixed is worth stating, because the resume was
        not obviously misbehaving — /welcome was a resumable route, so a યુવક who had opened
        the વિડિયો once was returned to it on every login afterwards, which from the outside
        looks exactly like the app ignoring where he asked to be.

        `login()` is still awaited before navigating, and that part is unchanged and still
        load-bearing (§15): it adopts the session and reads the profile, so the મુખપૃષ્ઠ
        mounts already knowing who he is instead of rendering against a context that does
        not yet, and the guard behind '/' has its answer on the first frame.
      */
      await login(id, password);

      // `replace`, so the browser's back gesture leaves the app rather than returning to
      // a લોગિન page that would immediately redirect forward again (§16).
      nav(ENTRY_ROUTE.HOME, { replace: true });
    } catch (err) {
      // The Netlify Function returns its own Gujarati message; Supabase errors get mapped.
      // This one genuinely belongs in a banner: "મોબાઈલ નંબર/ઈમેલ કે પાસવર્ડ બરાબર નથી" is
      // about the pair, and the server will not say which half was wrong (nor should it).
      setFormError(err.gu || guError(err));
    } finally {
      setBusy(false);
    }
  }

  /*
    ────────────────────────────────────────────────────────────────────────────
    પાસવર્ડ ભૂલી ગયા? is now a page, not a button on this one
    ────────────────────────────────────────────────────────────────────────────

    A `forgot()` handler stood here and sent the mail in place, reusing whatever was in the
    identifier field. Three things were wrong with that, and all three are requirements
    rather than taste:

      * **It could only work for half the યુવકો who need it.** The field accepts a mobile
        number or an email, and most sign in with the number - so the commonest way to
        arrive at "I have forgotten my password" was to be told, at the moment of asking,
        to go and find something else to type. The dedicated page asks for the one thing
        recovery needs and says so before he types anything.
      * **It leaked, quietly.** The success line said "લિંક તમારા ઈમેલ પર મોકલી છે" - a
        claim about that address - while an unknown address took the same path and produced
        the same sentence only by accident of Supabase's API. §3 wants that to be a decided
        property, and it now is: shared/domain/recovery.js returns one outcome and
        scripts/test-recovery.mjs holds it.
      * **It had no cooldown**, so the button could be tapped into Supabase's own per-address
        limit, after which he was locked out of recovery for far longer than any screen had
        warned him.

    What stays is the position and the wording: same place under the primary button, same
    `btn-quiet`, same Gujarati. From here it is a navigation, so it is a <Link> - and being
    a link rather than a `type="button"` also settles the phone keyboard question the old
    comment below worried about.
  */

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">લોગિન</h1>
        <p className="auth-sub">જય સ્વામિનારાયણ - ધ્યાન શરૂ કરવા લોગિન કરો</p>

        <form onSubmit={submit} noValidate>
          <TextField
            id="identifier"
            label="મોબાઈલ નંબર અથવા ઈમેલ"
            hint="મોબાઈલ નંબરથી પણ લોગિન થઈ શકશે."
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

          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'લોગિન થાય છે…' : 'લોગિન કરો'}
          </button>

          {/*
            Kept INSIDE the form, closed up under the primary button.

            Outside it, this control sat after </form> with a 24px .btn margin above it,
            which is what made the foot of this page read as two unrelated buttons floating
            apart. Inside, it is the secondary action of the same form.

            It is a <Link> now rather than a `type="button"`, which also retires the hazard
            the old comment here described: a control inside a form that is not a link has to
            declare `type` or the phone keyboard's "go" key fires it instead of the login. A
            link cannot be submitted, so there is nothing left to get wrong.
          */}
          <Link className="btn btn-quiet" to="/forgot-password">
            પાસવર્ડ ભૂલી ગયા?
          </Link>
        </form>

        {/* §19 — obvious, but never louder than લોગિન કરો above it. */}
        <p className="auth-alt">
          નવું એકાઉન્ટ બનાવવું છે? <Link to="/register">નોંધણી કરો</Link>
        </p>
      </div>
    </div>
  );
}
