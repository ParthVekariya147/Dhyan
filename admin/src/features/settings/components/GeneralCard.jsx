import { useEffect, useState } from 'react';
import { useAdminAuth } from '../../../lib/adminAuth';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { StatusBadge } from '../../../components/StatCard';
import { saveError } from '../../../lib/errors';
import { updateAppSettings } from '../services/settingsService';
import {
  DEFAULT_TICK_WORD,
  TICK_WORD_KEY,
  TICK_WORD_MAX,
  resolveTickWord,
  validateTickWord,
} from '../../../../../shared/domain/settings.js';

/**
 * §34, §35 — the app's name, the maintenance shutter, and the word a ticked row carries.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why these four fields are one card and one Save
 * ────────────────────────────────────────────────────────────────────────────
 *
 * They are plain fields of settings/app with no validation the database enforces and no
 * refusal path of their own, which is exactly what distinguishes them from the cards beside
 * them: GalleryCard has a bound a trigger rejects (0018), DhunCard uploads bytes, AppIconCard
 * measures a PNG. Splitting these four would put four SETTINGS_UPDATED entries in the audit
 * log for one visit and describe one edit as four (§41).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why it is a component and no longer inline in SettingsPage
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The page is a tab shell now. A shell that held one tab's form state - four `useState`s, a
 * validator and a save - while its five other tabs were components would be exactly the
 * asymmetry that decides where the *next* setting gets written, and it would have kept this
 * form's state alive while a સંચાલક was reading a different tab. Every panel owns its own
 * state, or the rule is not a rule.
 */
export default function GeneralCard({ settings, onSaved }) {
  const { can } = useAdminAuth();

  /**
   * The route is gated on `settings.read`, so a VIEWER reaches this page and should be able to
   * read what is configured. What he must not be offered is a Save the policy will refuse
   * after he has typed a paragraph into the maintenance box. So the controls are **disabled,
   * not hidden**: what is in force stays legible, and the reason the button will not move is
   * written next to it rather than left to be discovered.
   */
  const mayEdit = can('settings.update');

  const [form, setForm] = useState({
    appName: '',
    maintenance: false,
    maintenanceMessage: '',
    tickWordOn: DEFAULT_TICK_WORD.show,
    tickWordText: DEFAULT_TICK_WORD.text,
  });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState('');
  // Whether the word field has been touched, so its rule is shown as a helper before the
  // first edit and as an error only after one. A field that is red the moment the page
  // paints is telling the સંચાલક off for something he has not done yet (§31).
  const [wordTouched, setWordTouched] = useState(false);

  useEffect(() => {
    if (!settings) return;
    // Through the same resolver the users' app uses, never a looser read of this panel's
    // own — the field must show what is actually in force, including when the stored value
    // is one this panel would not have written.
    const word = resolveTickWord(settings[TICK_WORD_KEY]);
    setForm({
      appName: settings.appName || '',
      maintenance: !!settings.maintenance,
      maintenanceMessage: settings.maintenanceMessage || '',
      tickWordOn: word.show,
      tickWordText: word.text,
    });
    setWordTouched(false);
    setErr('');
  }, [settings]);

  const set = (k) => (e) => {
    // A "Saved." that survives the next keystroke is a lie about the form in front of him.
    // Clearing the result on edit is what keeps the save-state a statement about what is on
    // screen rather than about what was on screen a minute ago.
    setMsg(null);
    setErr('');
    if (k === 'tickWordText' || k === 'tickWordOn') setWordTouched(true);
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  };

  /*
    The same shared rule the save runs, evaluated as he types so the message arrives at the
    keystroke that caused it. It is *display only* — save() below validates again and is the
    authority, because a live check that drifted from the committing one would be a second
    answer to one question, which is precisely what shared/domain/settings.js exists to prevent.
  */
  const wordDraft = { show: form.tickWordOn, text: form.tickWordText.replace(/\s+/g, ' ').trim() };
  const wordCheck = validateTickWord(wordDraft);
  const wordError = err || (wordTouched && !wordCheck.ok ? wordCheck.gu : '');

  async function save() {
    const word = { show: form.tickWordOn, text: form.tickWordText.replace(/\s+/g, ' ').trim() };
    /*
      Validated before anything is written, and with the shared rule rather than a check of
      this card's own. A word this panel accepted and resolveTickWord() then replaced would
      leave the સંચાલક looking at his own word in this field while every યુવક read a
      different one — the two-answers-to-one-question fault the Level 4 gate note in
      shared/domain/settings.js exists to prevent.
    */
    const v = validateTickWord(word);
    if (!v.ok) {
      setErr(v.gu);
      setWordTouched(true);
      setConfirm(false);
      return;
    }
    setErr('');
    setBusy(true);
    try {
      await updateAppSettings({
        appName: form.appName.trim(),
        maintenance: form.maintenance,
        maintenanceMessage: form.maintenanceMessage.trim(),
        [TICK_WORD_KEY]: word,
      });
      // Audited by the `audit_settings` trigger (0004_rbac.sql), not from here.
      setMsg({ tone: 'ok', text: 'Saved - this is what users see now.' });
      onSaved?.();
    } catch (e) {
      // §31 — a failed save leaves the typing where it is and offers the same button again.
      // Nothing is reset and nothing is retried automatically: a settings write that 2,000
      // people feel is not something to repeat without being asked.
      setMsg({ tone: 'danger', text: saveError(e) });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <div className="card">
      <div style={cardHead}>
        <h2 style={{ marginBottom: 0 }}>General</h2>
        {/* Colour is never the only signal — the word in the badge says the same (§43). */}
        <StatusBadge tone={form.maintenance ? 'warn' : 'ok'}>
          {form.maintenance ? 'Maintenance on' : 'App open'}
        </StatusBadge>
      </div>
      <p className="card-note" style={{ marginTop: 0, marginBottom: 'var(--sp-4)' }}>
        These reach every yuvak on his next visit. Nothing here needs a deploy.
      </p>

      <div className="field">
        <label htmlFor="appName">App name</label>
        <input
          id="appName"
          type="text"
          value={form.appName}
          onChange={set('appName')}
          disabled={!mayEdit || busy}
          placeholder="નીલકંઠ વર્ણી ધ્યાન"
          aria-describedby="appName-help"
        />
        <span className="hint" id="appName-help">
          Shown in the app's own header. Leave it empty to keep the built-in name.
        </span>
      </div>

      <div className="field">
        {/* .check gives the row a --tap-tall hit area, so the label and the box are one
            target big enough for a thumb rather than a 16px square. */}
        <label className="check" htmlFor="maint">
          <input
            id="maint"
            type="checkbox"
            checked={form.maintenance}
            onChange={set('maintenance')}
            disabled={!mayEdit || busy}
            aria-describedby="maint-help"
          />
          Turn on Maintenance
        </label>
        <span className="hint" id="maint-help">
          While this is on, users see the message below instead of the app.
        </span>
      </div>

      <div className="field">
        <label htmlFor="mm">Maintenance message</label>
        <textarea
          id="mm"
          rows="2"
          value={form.maintenanceMessage}
          onChange={set('maintenanceMessage')}
          disabled={!mayEdit || busy}
          aria-describedby="mm-help"
        />
        <span className="hint" id="mm-help">
          Written in Gujarati, and read by someone who cannot get in - say when he should come
          back, not what broke.
        </span>
      </div>

      {/*
        The word a ticked row carries, in the General card and saved by its button.

        Not a card of its own, and not on the Levels page: it is a field of settings/app
        exactly as the app name is, and the `audit_settings` trigger records a write to that
        row as one SETTINGS_UPDATED — so a separate Save here would put two entries in the log
        for one visit and describe an edit that never happened as two.

        Where it appears is stated in the hint rather than left to be discovered. A setting
        whose effect a સંચાલક cannot find is a setting he will change twice and then leave
        alone.
      */}
      <div className="field" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-4)' }}>
        <label className="check" htmlFor="tw-on">
          <input
            id="tw-on"
            type="checkbox"
            checked={form.tickWordOn}
            onChange={set('tickWordOn')}
            disabled={!mayEdit || busy}
            aria-describedby="tw-on-help"
          />
          Show a word on a ticked row
        </label>
        <span className="hint" id="tw-on-help">
          Level 4 tests show a number and a box and nothing else, so the row is mostly empty.
          With this on, the word below appears inside a row the moment the user ticks it, and
          goes when he unticks it. Turn it off and the rows stay exactly as they are now.
        </span>
      </div>

      <div className={`field${wordError ? ' is-invalid' : ''}`}>
        <label htmlFor="tw">The word</label>
        <input
          id="tw"
          type="text"
          maxLength={TICK_WORD_MAX}
          value={form.tickWordText}
          onChange={set('tickWordText')}
          placeholder={DEFAULT_TICK_WORD.text}
          disabled={!mayEdit || busy || !form.tickWordOn}
          aria-describedby="tw-help"
          aria-invalid={wordError ? 'true' : undefined}
        />
        <span className="hint" id="tw-help">
          {/* The counter is the limit made visible rather than announced only on refusal —
              maxLength already stops the typing, and a stopped keyboard with no explanation
              reads as a broken field. */}
          <span className="mono">
            {form.tickWordText.trim().length}/{TICK_WORD_MAX}
          </span>{' '}
          characters - it has to fit inside a row on a phone. One word for every row: it is the
          same on all of them, and it never says anything about the Darshan behind the number.
        </span>
        {wordError && (
          <span className="field-error" role="alert">
            <span aria-hidden="true">⚠</span> {wordError}
          </span>
        )}
      </div>

      <div className="form-actions">
        <button
          className={`btn${busy ? ' is-busy' : ''}`}
          type="button"
          onClick={() => setConfirm(true)}
          disabled={busy || !mayEdit}
        >
          {busy ? 'Saving…' : 'Save settings'}
        </button>
        {msg && (
          <span
            className={`save-state ${msg.tone === 'ok' ? 'is-ok' : 'is-error'}`}
            role={msg.tone === 'ok' ? 'status' : 'alert'}
          >
            {msg.text}
          </span>
        )}
        {/* §31 — a failed save must offer the way out of it, on the spot. The second attempt
            skips the dialog: it was already confirmed, and asking twice for one decision
            teaches him to click through it. */}
        {msg?.tone === 'danger' && (
          <button className="btn btn-quiet btn-sm" type="button" onClick={save} disabled={busy}>
            Try again
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirm}
        title="Save settings?"
        body={
          form.maintenance
            ? 'Maintenance is on: users will see the maintenance message instead of the app, immediately.'
            : 'This change will apply immediately for all users.'
        }
        confirmLabel="Save settings"
        busy={busy}
        onConfirm={save}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}

/* Layout constant at module scope so React is not handed a fresh style object on every
 * keystroke. Tokens only; admin.css owns every value. */
const cardHead = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  flexWrap: 'wrap',
  marginBottom: 'var(--sp-2)',
};
