import { useEffect, useState } from 'react';
import { useAsync } from '../../../lib/useAsync';
import { getLevels, updateLevels } from '../../settings/services/settingsService';
import { AsyncBlock } from '../../../components/StateBlocks';
import { PageHeader } from '../../../components/StatCard';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { validateLevels } from '../../../../../shared/domain/settings.js';
import { gu } from '../../../lib/format';
import { saveError } from '../../../lib/errors';

/**
 * §36, §37 — level availability, in one place instead of scattered through components.
 *
 * What this page can change: whether a level is offered, its name, its order.
 *
 * What it deliberately cannot change: what a level *does*. Level 4 is the memory-recall
 * stage and its final form is the index number alone (§37) — that behaviour belongs to
 * the યુવક app, not to a settings document, and no field here can reach it. Level 4's
 * unlock is likewise earned, at 80 remembered in a single day: it is written on the
 * yuvak's own profile, and the profiles RLS policy keeps it out of reach of this panel.
 *
 * validateLevels() also refuses to disable Level 2, because it is the only level with
 * content today and turning it off would leave every yuvak with an app that opens onto
 * nothing (§36 — never put users into an impossible state).
 */
export default function LevelsPage() {
  const state = useAsync(() => getLevels(), []);
  const [levels, setLevels] = useState([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.data) setLevels(state.data.map((l) => ({ ...l })));
  }, [state.data]);

  const patch = (levelId, key, value) =>
    setLevels((ls) => ls.map((l) => (l.levelId === levelId ? { ...l, [key]: value } : l)));

  async function save() {
    const v = validateLevels(levels);
    if (!v.ok) {
      setErr(v.gu);
      setConfirm(false);
      return;
    }
    setBusy(true);
    try {
      const sorted = [...levels].sort((a, b) => a.order - b.order);
      await updateLevels(sorted);
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
      <PageHeader title="Levels" sub="Which level is active and in what order it appears" />

      <AsyncBlock state={state} onRetry={state.retry}>
        <>
          {msg && <div className={`notice notice-${msg.tone}`} role="status">{msg.text}</div>}
          {err && <div className="notice notice-danger" role="alert">{err}</div>}

          <div className="card">
            <h2>Configuration</h2>
            {levels.map((l) => (
              <div
                key={l.levelId}
                style={{
                  display: 'grid',
                  gap: 12,
                  gridTemplateColumns: 'minmax(0,1fr) 90px 130px',
                  alignItems: 'end',
                  paddingBottom: 12,
                  marginBottom: 12,
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`n${l.levelId}`}>Level {gu(l.levelId)} — Name</label>
                  <input
                    id={`n${l.levelId}`}
                    type="text"
                    value={l.name}
                    onChange={(e) => patch(l.levelId, 'name', e.target.value)}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`o${l.levelId}`}>Order</label>
                  <input
                    id={`o${l.levelId}`}
                    type="number"
                    min="1"
                    value={l.order}
                    onChange={(e) => patch(l.levelId, 'order', Number(e.target.value))}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`e${l.levelId}`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      id={`e${l.levelId}`}
                      type="checkbox"
                      checked={l.enabled}
                      onChange={(e) => patch(l.levelId, 'enabled', e.target.checked)}
                      style={{ width: 'auto' }}
                    />
                    Active
                  </label>
                </div>
              </div>
            ))}

            <button className="btn" type="button" onClick={() => setConfirm(true)} disabled={busy}>
              Save
            </button>

            <p className="card-note">
              Level 4 cannot be unlocked from here — each user earns it by remembering 80 in a
              single day, and that rule lives in the database. All that is decided here is whether
              a level is shown or not.
            </p>
          </div>

          <ConfirmDialog
            open={confirm}
            title="Save the level configuration?"
            body="A level that is turned off will be removed from the users' home page."
            busy={busy}
            onConfirm={save}
            onCancel={() => setConfirm(false)}
          />
        </>
      </AsyncBlock>
    </>
  );
}
