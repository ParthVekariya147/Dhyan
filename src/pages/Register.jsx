import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, guError } from '../lib/auth';
import {
  EMAIL_RE,
  gu,
  MIN_PASSWORD,
  MOBILE_RE,
  normaliseMobile,
  normaliseSmk,
  SMK_RE,
  SUBZONES,
  ZONES,
} from '../lib/constants';
import { PasswordField, SelectField, TextField } from '../components/Field';
import { ENTRY_ROUTE } from '../lib/entryRoute';
import '../styles/forms.css';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * PAGE CONTRACT — નોંધણી (/register)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Purpose        The application's front door (§4). A visitor who opens the URL with no
 *                session lands HERE, not on લોગિન and not on the મુખપૃષ્ઠ — asking someone
 *                who has never been here to find the registration link under a login form
 *                is getting the first minute exactly backwards.
 * Visible        Seven fields, the privacy sentence §13 requires, one primary button, and
 *                one quiet sentence pointing at લોગિન (§19).
 * Actions        Register. Go to લોગિન.
 * Persisted      auth.users (the account) and profiles (SMK, name, email, mobile, zone).
 * Completion     The account exists AND he is signed in.
 * Next           / — the મુખપૃષ્ઠ. REGISTER → AUTO LOGIN → મુખપૃષ્ઠ, with no return trip
 *                through લોગિન. He picks લેવલ ૧ from there himself; it is the first tile.
 * Excluded       Any level content. Any progress. Anything that scolds (§1, §18).
 *
 * This page and લોગિન are ONE design (§2) — same tokens, same Field components, same
 * heights. See src/styles/tokens.css.
 */

const EMPTY = {
  smk: '',
  name: '',
  email: '',
  password: '',
  mobile: '',
  zoneId: ZONES[0].id,
  subZoneId: '',
};

/**
 * §4 — every field is ફરજિયાત. §18 — each message says what is wrong AND how to fix it,
 * in one short line that fits the reserved slot under the field, and never scolds.
 */
function validate(v) {
  const e = {};
  if (!v.smk.trim()) e.smk = 'SMK લખો.';
  else if (!SMK_RE.test(v.smk.trim())) e.smk = '૩ અંગ્રેજી અક્ષર પછી ૩ અંક લખો - દા.ત. PGV881';
  if (!v.name.trim()) e.name = 'નામ લખો.';
  if (!EMAIL_RE.test(v.email.trim())) e.email = 'આખું ઈમેલ સરનામું લખો - દા.ત. naam@gmail.com';
  if (v.password.length < MIN_PASSWORD) e.password = `ઓછામાં ઓછા ${gu(MIN_PASSWORD)} અક્ષર લખો.`;
  if (!MOBILE_RE.test(v.mobile.trim())) e.mobile = 'મોબાઈલ નંબર ૧૦ અંકનો લખો.';
  if (!v.subZoneId) e.subZoneId = 'સબઝોન પસંદ કરો.';
  return e;
}

export default function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [v, setV] = useState(EMPTY);
  const [errs, setErrs] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * §14 — the account was created but nobody could be signed in.
   *
   * Held as its own state and not as a `formError`, because it is not an error: it is a
   * successful registration with one step left, and the screen it produces carries a way
   * forward rather than a red banner. Setting it also retires the form.
   */
  const [needsLogin, setNeedsLogin] = useState(false);

  const set = (k) => (ev) => {
    let val = ev.target.value;
    // normaliseMobile, not `replace(/\D/g,'').slice(0,10)`: the latter kept the *first*
    // ten digits, so a pasted '+919601269715' was stored as '9196012697' — a valid-looking
    // number belonging to nobody, in a UNIQUE column, which then made mobile login
    // impossible for that yuvak forever. See shared/domain/constants.js.
    if (k === 'mobile') val = normaliseMobile(val);
    if (k === 'smk') val = normaliseSmk(val);
    setV((s) => ({ ...s, [k]: val }));
    if (errs[k]) setErrs((s) => ({ ...s, [k]: undefined }));
    if (formError) setFormError('');
  };

  async function submit(ev) {
    ev.preventDefault();
    setFormError('');
    const e = validate(v);
    setErrs(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    try {
      /*
        §5 — REGISTER → AUTO LOGIN → મુખપૃષ્ઠ, and the navigation is the last line of it.

        register() signs him in, writes the profile and reads it back before it resolves,
        so by the time this runs the app knows who he is and that he has not passed the
        પ્રવેશદ્વાર. He is sent straight to લેવલ ૧: not back to લોગિન to type the password
        he chose thirty seconds ago, and not to a મુખપૃષ્ઠ where he would have to work out
        which of four levels he is supposed to start with.

        The destination is ENTRY_ROUTE.HOME rather than a literal '/', so this page and
        the router cannot come to different conclusions about where the મુખપૃષ્ઠ is.

        It used to be ENTRY_ROUTE.LEVEL1 — નોંધણી dropped him on the વિડિયો and the guard
        held him there until he answered the two questions. He now lands on the મુખપૃષ્ઠ
        and goes on from there himself; લેવલ ૧ is the first tile on it.

        `replace`: the નોંધણી page must not be behind લેવલ ૧ in the history (§16). Pressing
        back from there would land on a form for an account that now exists, which the
        public-only guard would immediately redirect forward again — a loop with no exit
        except closing the tab.
      */
      const { autoLoggedIn } = await register(v);

      if (!autoLoggedIn) {
        // §14 — do not silently fail, and do not pretend it worked. The account is real;
        // say so, and give him the one button that finishes the job.
        setNeedsLogin(true);
        return;
      }

      nav(ENTRY_ROUTE.HOME, { replace: true });
    } catch (err) {
      // A duplicate SMK or mobile belongs beside that field, not in a general banner — it
      // is the one value the yuvak has to change and resubmit, and a banner at the foot of
      // a seven-field form does not say which.
      const msg = guError(err);
      const constraint = String(err?.message || '');
      if (constraint.includes('profiles_smk_key')) setErrs({ smk: msg });
      else if (constraint.includes('profiles_mobile_key')) setErrs({ mobile: msg });
      else setFormError(msg);
    } finally {
      setBusy(false);
    }
  }

  /*
    §14's fallback screen.

    Deliberately replaces the form rather than sitting under it: the seven fields have
    already done their job, the account exists, and leaving them on screen invites him to
    submit them a second time — which would fail as a duplicate and read as the app losing
    his registration. His details are held for the moment he signs in (see auth.jsx), so
    nothing he typed is lost.
  */
  if (needsLogin) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1 className="auth-title">નોંધણી થઈ ગઈ</h1>
          <p className="auth-sub">હવે એક જ પગલું બાકી છે.</p>

          <div className="notice">
            તમારું ખાતું બની ગયું છે. હમણાં આપોઆપ લોગિન થઈ શક્યું નથી, એટલે એક વાર જાતે લોગિન
            કરી લો - એ જ ઈમેલ અને એ જ પાસવર્ડથી.
          </div>

          <Link className="btn" to="/login">લોગિન કરો</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">નોંધણી</h1>
        <p className="auth-sub">વર્ણી ધ્યાનમાં જોડાવા માટે નીચેની વિગત ભરો</p>

        <form onSubmit={submit} noValidate>
          <TextField
            id="smk"
            label="SMK"
            hint="નામના ૩ અંગ્રેજી અક્ષર પછી ૩ અંક"
            error={errs.smk}
            value={v.smk}
            onChange={set('smk')}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            maxLength={6}
            placeholder="PGV881"
            disabled={busy}
          />

          <TextField
            id="name"
            label="નામ"
            error={errs.name}
            value={v.name}
            onChange={set('name')}
            autoComplete="name"
            disabled={busy}
          />

          <TextField
            id="mobile"
            label="મોબાઈલ નંબર"
            hint="આ નંબરથી પણ લોગિન થઈ શકશે."
            error={errs.mobile}
            value={v.mobile}
            onChange={set('mobile')}
            inputMode="numeric"
            autoComplete="tel"
            placeholder="૧૦ અંક"
            disabled={busy}
          />

          <TextField
            id="email"
            label="ઈમેલ"
            hint="પાસવર્ડ ભૂલી જાવ તો આ ઈમેલ પર જ નવો મળશે."
            error={errs.email}
            value={v.email}
            onChange={set('email')}
            /*
              type="email" here and not on લોગિન's field, because this one only ever holds
              an email — so the '@' key on the phone keyboard is worth having, and the
              browser's own autofill can recognise it.
            */
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            disabled={busy}
          />

          <PasswordField
            id="password"
            label="પાસવર્ડ"
            hint={`ઓછામાં ઓછા ${gu(MIN_PASSWORD)} અક્ષર`}
            error={errs.password}
            value={v.password}
            onChange={set('password')}
            autoComplete="new-password"
            disabled={busy}
          />

          <SelectField
            id="zoneId"
            label="ઝોન"
            value={v.zoneId}
            onChange={set('zoneId')}
            disabled={busy}
          >
            {ZONES.map((z) => (
              <option key={z.id} value={z.id}>{z.name}</option>
            ))}
          </SelectField>

          <SelectField
            id="subZoneId"
            label="સબઝોન"
            error={errs.subZoneId}
            value={v.subZoneId}
            onChange={set('subZoneId')}
            disabled={busy}
          >
            <option value="">- પસંદ કરો -</option>
            {SUBZONES.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </SelectField>

          {formError && <div className="notice warn">{formError}</div>}

          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'નોંધણી થાય છે…' : 'નોંધણી કરો'}
          </button>
        </form>

        {/* §13 — required wording, shown plainly on this page.
            The hard <br/> is gone: at 320px it forced a break that left the second line
            almost empty while the first still wrapped on its own. The sentence now wraps
            where the width says it should. */}
        <p className="privacy">
          આ માહિતી ફક્ત તમારી ધ્યાનની પ્રગતિ સાચવવા માટે છે, બીજે ક્યાંય વપરાશે નહીં.
        </p>

        <p className="auth-alt">
          પહેલેથી એકાઉન્ટ છે? <Link to="/login">લોગિન કરો</Link>
        </p>
      </div>
    </div>
  );
}
