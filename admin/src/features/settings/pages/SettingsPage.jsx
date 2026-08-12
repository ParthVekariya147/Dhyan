import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { getAppSettings, updateAppSettings } from '../services/settingsService';
import { AsyncBlock } from '../../../components/StateBlocks';
import { PageHeader } from '../../../components/StatCard';
import ConfirmDialog from '../../../components/ConfirmDialog';
import DhunCard from '../components/DhunCard';
import DriveFolderCard from '../components/DriveFolderCard';
import {
  DEFAULT_TICK_WORD,
  TICK_WORD_KEY,
  TICK_WORD_MAX,
  resolveTickWord,
  validateTickWord,
} from '../../../../../shared/domain/settings.js';
import { saveError } from '../../../lib/errors';

/**
 * §34, §35 — application settings, in one controlled document.
 *
 * settings/app is read by every yuvak on every visit, so a careless write here is felt
 * immediately by 2,000 people. Hence: merge writes only, confirmation before saving, and
 * an audit entry after (§41) — written by the database, not from here.
 *
 * On roles (§35): saving this page needs `settings.update`, which SUPER_ADMIN and ADMIN
 * hold and CONTENT_MANAGER, COORDINATOR and VIEWER do not
 * (shared/domain/permissions.js). The check that matters is the one in the RLS policy on
 * the settings table; this page is only where it becomes visible.
 */
export default function SettingsPage() {
  const state = useAsync(() => getAppSettings(), []);
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

  useEffect(() => {
    if (!state.data) return;
    // Through the same resolver the users' app uses, never a looser read of this panel's
    // own — the field must show what is actually in force, including when the stored value
    // is one this panel would not have written.
    const word = resolveTickWord(state.data[TICK_WORD_KEY]);
    setForm({
      appName: state.data.appName || '',
      maintenance: !!state.data.maintenance,
      maintenanceMessage: state.data.maintenanceMessage || '',
      tickWordOn: word.show,
      tickWordText: word.text,
    });
  }, [state.data]);

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function save() {
    const word = { show: form.tickWordOn, text: form.tickWordText.replace(/\s+/g, ' ').trim() };
    /*
      Validated before anything is written, and with the shared rule rather than a check of
      this page's own. A word this panel accepted and resolveTickWord() then replaced would
      leave the સંચાલક looking at his own word in this field while every યુવક read a
      different one — the two-answers-to-one-question fault the Level 4 gate note in
      shared/domain/settings.js exists to prevent.
    */
    const v = validateTickWord(word);
    if (!v.ok) {
      setErr(v.gu);
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
      setMsg({ tone: 'ok', text: 'Saved.' });
      state.retry();
    } catch (e) {
      setMsg({ tone: 'danger', text: saveError(e) });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <>
      <PageHeader title="Settings" sub="All in one place — settings/app" />

      <AsyncBlock state={state} onRetry={state.retry}>
        <>
          {msg && <div className={`notice notice-${msg.tone}`} role="status">{msg.text}</div>}
          {err && <div className="notice notice-danger" role="alert">{err}</div>}

          <div className="card">
            <h2>General</h2>

            <div className="field">
              <label htmlFor="appName">App name</label>
              <input id="appName" type="text" value={form.appName} onChange={set('appName')} placeholder="નીલકંઠ વર્ણી ધ્યાન" />
            </div>

            <div className="field">
              <label htmlFor="maint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input id="maint" type="checkbox" checked={form.maintenance} onChange={set('maintenance')} style={{ width: 'auto' }} />
                Turn on Maintenance
              </label>
              <span className="hint">If you turn this on, users will see the message below.</span>
            </div>

            <div className="field">
              <label htmlFor="mm">Maintenance message</label>
              <textarea id="mm" rows="2" value={form.maintenanceMessage} onChange={set('maintenanceMessage')} />
            </div>

            {/*
              The word a ticked row carries, in the General card and saved by its button.

              Not a card of its own, and not on the Levels page: it is a field of
              settings/app exactly as the app name is, and the `audit_settings` trigger
              records a write to that row as one SETTINGS_UPDATED — so a separate Save here
              would put two entries in the log for one visit and describe an edit that never
              happened as two.

              Where it appears is stated in the hint rather than left to be discovered. A
              setting whose effect a સંચાલક cannot find is a setting he will change twice and
              then leave alone.
            */}
            <div className="field" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
              <label htmlFor="tw-on" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  id="tw-on"
                  type="checkbox"
                  checked={form.tickWordOn}
                  onChange={set('tickWordOn')}
                  style={{ width: 'auto' }}
                />
                Show a word on a ticked row
              </label>
              <span className="hint">
                Level 4 tests show a number and a box and nothing else, so the row is mostly
                empty. With this on, the word below appears inside a row the moment the user
                ticks it, and goes when he unticks it. Turn it off and the rows stay exactly
                as they are now.
              </span>
            </div>

            <div className="field">
              <label htmlFor="tw">The word</label>
              <input
                id="tw"
                type="text"
                maxLength={TICK_WORD_MAX}
                value={form.tickWordText}
                onChange={set('tickWordText')}
                placeholder={DEFAULT_TICK_WORD.text}
                disabled={!form.tickWordOn}
              />
              <span className="hint">
                {TICK_WORD_MAX} characters or fewer — it has to fit inside a row on a phone.
                One word for every row: it is the same on all of them, and it never says
                anything about the Darshan behind the number.
              </span>
            </div>

            <button className="btn" type="button" onClick={() => setConfirm(true)} disabled={busy}>
              Save
            </button>
          </div>

          {/*
            §8 — the two ધૂન. Same row, same permission, so it belongs on this page rather
            than on a route of its own: `dhun` is a field of settings/app exactly as
            `youtubeUrl` is, and the audit trail records both as one SETTINGS_UPDATED.
            It reads and writes through its own service (dhunService.js), because uploading
            an MP3 to Storage is nothing like saving a text field and merging the two would
            make this page harder to read, not smaller.
          */}
          <DhunCard dhun={state.data?.dhun} onSaved={state.retry} />

          {/*
            The Drive folder every દ્રશ્ય's image comes from. Same row, same permission, and
            like DhunCard it saves through its own path — it validates a folder link and can
            read the folder back, neither of which the general form above knows how to do.
          */}
          <DriveFolderCard folderId={state.data?.driveFolderId} onSaved={state.retry} />

          <div className="card">
            <h2>Elsewhere</h2>
            <p className="card-note">
              The video link is changed from the <Link to="/video">Video</Link> page, and the level
              configuration from the <Link to="/levels">Levels</Link> page. All three are saved in
              the same settings collection, but each has its own validation.
            </p>
          </div>

          <ConfirmDialog
            open={confirm}
            title="Save settings?"
            body="This change will apply immediately for all users."
            busy={busy}
            onConfirm={save}
            onCancel={() => setConfirm(false)}
          />
        </>
      </AsyncBlock>
    </>
  );
}
