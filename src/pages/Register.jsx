import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, guError } from '../lib/auth';
import {
  EMAIL_RE,
  gu,
  MIN_PASSWORD,
  MOBILE_RE,
  normaliseSmk,
  SMK_RE,
  SUBZONES,
  ZONES,
} from '../lib/constants';
import '../styles/forms.css';

const EMPTY = {
  smk: '',
  name: '',
  email: '',
  password: '',
  mobile: '',
  zoneId: ZONES[0].id,
  subZoneId: '',
};

/** §4 — every field is ફરજિયાત. Messages stay plain and never scold (§1, §14). */
function validate(v) {
  const e = {};
  if (!v.smk.trim()) e.smk = 'SMK લખો.';
  else if (!SMK_RE.test(v.smk.trim())) e.smk = 'SMK આ રીતે લખો — ૩ અંગ્રેજી અક્ષર પછી ૩ અંક. દા.ત. PGV881';
  if (!v.name.trim()) e.name = 'નામ લખો.';
  if (!EMAIL_RE.test(v.email.trim())) e.email = 'ઈમેલ સરનામું બરાબર લખો.';
  if (v.password.length < MIN_PASSWORD) e.password = `પાસવર્ડ ઓછામાં ઓછો ${gu(MIN_PASSWORD)} અક્ષરનો રાખો.`;
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

  const set = (k) => (ev) => {
    let val = ev.target.value;
    if (k === 'mobile') val = val.replace(/\D/g, '').slice(0, 10);
    if (k === 'smk') val = normaliseSmk(val);
    setV((s) => ({ ...s, [k]: val }));
    if (errs[k]) setErrs((s) => ({ ...s, [k]: undefined }));
  };

  async function submit(ev) {
    ev.preventDefault();
    setFormError('');
    const e = validate(v);
    setErrs(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    try {
      await register(v);
      nav('/welcome', { replace: true });
    } catch (err) {
      // A duplicate SMK belongs beside that field, not in a general banner — it is the
      // one value the yuvak has to change and resubmit.
      const gu = guError(err);
      if (String(err?.message || '').includes('profiles_smk_key')) setErrs({ smk: gu });
      else setFormError(gu);
    } finally {
      setBusy(false);
    }
  }


  const field = (k, label, props = {}, hint) => (
    <div className="field">
      <label htmlFor={k}>{label}</label>
      <input
        id={k}
        value={v[k]}
        onChange={set(k)}
        className={errs[k] ? 'bad' : ''}
        disabled={busy}
        {...props}
      />
      {hint && !errs[k] && <div className="hint">{hint}</div>}
      {errs[k] && <div className="err">{errs[k]}</div>}
    </div>
  );

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">નોંધણી</h1>
        <p className="auth-sub">વર્ણી ધ્યાનમાં જોડાવા માટે નીચેની વિગત ભરો</p>

        <form onSubmit={submit} noValidate>
          {field('smk', 'SMK', {
            autoComplete: 'off',
            autoCapitalize: 'characters',
            spellCheck: false,
            inputMode: 'text',
            maxLength: 6,
            placeholder: 'PGV881',
          }, 'નામના ૩ અંગ્રેજી અક્ષર પછી ૩ અંક — દા.ત. PGV881')}
          {field('name', 'નામ', { autoComplete: 'name' })}
          {field('mobile', 'મોબાઈલ નંબર', {
            inputMode: 'numeric',
            autoComplete: 'tel',
            placeholder: '૧૦ અંક',
          }, 'આ નંબરથી પણ લોગિન થઈ શકશે.')}
          {field('email', 'ઈમેલ', { type: 'email', autoComplete: 'email' },
            'પાસવર્ડ ભૂલી જાવ તો આ ઈમેલ પર જ નવો મળશે.')}
          {field('password', 'પાસવર્ડ', {
            type: 'password',
            autoComplete: 'new-password',
          }, `ઓછામાં ઓછા ${gu(MIN_PASSWORD)} અક્ષર`)}

          <div className="field">
            <label htmlFor="zoneId">ઝોન</label>
            <select id="zoneId" value={v.zoneId} onChange={set('zoneId')} disabled={busy}>
              {ZONES.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="subZoneId">સબઝોન</label>
            <select
              id="subZoneId"
              value={v.subZoneId}
              onChange={set('subZoneId')}
              className={errs.subZoneId ? 'bad' : ''}
              disabled={busy}
            >
              <option value="">— પસંદ કરો —</option>
              {SUBZONES.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {errs.subZoneId && <div className="err">{errs.subZoneId}</div>}
          </div>

          {formError && <div className="notice warn">{formError}</div>}

          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'નોંધણી થાય છે…' : 'નોંધણી કરો'}
          </button>
        </form>

        {/* §13 — required wording, shown plainly on this page. */}
        <p className="privacy">
          આ માહિતી ફક્ત તમારી ધ્યાનની પ્રગતિ સાચવવા માટે છે,
          <br />
          બીજે ક્યાંય વપરાશે નહીં.
        </p>

        <p className="auth-alt">
          પહેલેથી ખાતું છે? <Link to="/login">લોગિન કરો</Link>
        </p>
      </div>
    </div>
  );
}
