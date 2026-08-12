import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { getAppSettings, updateAppSettings } from '../services/settingsService';
import { AsyncBlock } from '../../../components/StateBlocks';
import { PageHeader } from '../../../components/StatCard';
import ConfirmDialog from '../../../components/ConfirmDialog';
import DhunCard from '../components/DhunCard';
import DriveFolderCard from '../components/DriveFolderCard';
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
  const [form, setForm] = useState({ appName: '', maintenance: false, maintenanceMessage: '' });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (!state.data) return;
    setForm({
      appName: state.data.appName || '',
      maintenance: !!state.data.maintenance,
      maintenanceMessage: state.data.maintenanceMessage || '',
    });
  }, [state.data]);

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function save() {
    setBusy(true);
    try {
      await updateAppSettings({
        appName: form.appName.trim(),
        maintenance: form.maintenance,
        maintenanceMessage: form.maintenanceMessage.trim(),
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
