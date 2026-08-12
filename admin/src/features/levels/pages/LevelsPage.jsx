import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { getLevelsConfig, updateLevelsConfig } from '../../settings/services/settingsService';
import { AsyncBlock } from '../../../components/StateBlocks';
import { PageHeader } from '../../../components/StatCard';
import ConfirmDialog from '../../../components/ConfirmDialog';
import {
  DEFAULT_LEVEL4_GATE,
  validateLevel4Gate,
  validateLevels,
} from '../../../../../shared/domain/settings.js';
import { gu } from '../../../lib/format';
import { saveError } from '../../../lib/errors';

/**
 * §36, §37 — level availability, in one place instead of scattered through components.
 *
 * What this page can change: whether a level is offered, its name, its order, and — since
 * 0014 — what opens Level 4.
 *
 * What it deliberately cannot change: what a level *does*. Level 4 is the memory-recall
 * stage and its final form is the index number alone (§37) — that behaviour belongs to
 * the યુવક app, not to a settings document, and no field here can reach it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The Level 4 gate, and why it is on this page
 * ────────────────────────────────────────────────────────────────────────────
 *
 * It used to live on the published Level 4 configuration (`gate_threshold`, LEVEL4.md
 * decision #3), which meant it could not be set until a configuration existed. A સંચાલક
 * setting the project up would come here — the page named Levels, where every other fact
 * about a level is decided — and find that the one question he wanted to answer was the one
 * question this page could not. That is what 0014 fixed, and this is the field it moved.
 *
 * Setting it is still not the same as opening Level 4: nothing opens until a Level 4
 * configuration is published, because until then there is no કસોટી behind the gate. This
 * decides *when* a યુવક reaches it, not *whether* there is anything there.
 *
 * **Nothing here can hand Level 4 to anybody.** The number is a requirement, and each યુવક
 * meets it or does not, by his own days at Level 3 — `level4_gate_open()` reads `progress`,
 * which this panel cannot write (§19: the panel is read-only over people).
 *
 * validateLevels() also refuses to disable Level 2, because it is the only level with
 * content today and turning it off would leave every yuvak with an app that opens onto
 * nothing (§36 — never put users into an impossible state).
 */
export default function LevelsPage() {
  const state = useAsync(() => getLevelsConfig(), []);
  const [levels, setLevels] = useState([]);
  const [gate, setGate] = useState(DEFAULT_LEVEL4_GATE);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!state.data) return;
    setLevels(state.data.levels.map((l) => ({ ...l })));
    setGate({ ...state.data.gate });
  }, [state.data]);

  const patch = (levelId, key, value) =>
    setLevels((ls) => ls.map((l) => (l.levelId === levelId ? { ...l, [key]: value } : l)));

  async function save() {
    /*
      Both halves validated before either is written. They go into one jsonb row, so a save
      that passed the list and failed the gate would either write half a change or need a
      second round trip to undo one — and `updateLevelsConfig` is one upsert precisely so
      that cannot happen.
    */
    const v = validateLevels(levels);
    if (!v.ok) {
      setErr(v.gu);
      setConfirm(false);
      return;
    }
    const g = validateLevel4Gate(gate);
    if (!g.ok) {
      setErr(g.gu);
      setConfirm(false);
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const sorted = [...levels].sort((a, b) => a.order - b.order);
      await updateLevelsConfig({
        levels: sorted,
        // Stored as a number, never as the string the input hands back: the SQL side
        // (`level4_gate_setting()`) tests `jsonb_typeof(...) = 'number'` and falls back to
        // the default for anything else, so a '75' saved here would silently become ૮૦.
        gate: { require: !!gate.require, threshold: Number(gate.threshold) },
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

                {/*
                  The gate, under the level it opens.

                  Placed here rather than in a card of its own because that is where it was
                  looked for and not found: a સંચાલક reading down this list asks "what about
                  Level 4?" at exactly this row. Indented and spanning the full width so it
                  reads as a property of Level 4 rather than as a fifth level.
                */}
                {l.levelId === 4 && (
                  <div style={{ gridColumn: '1 / -1', paddingLeft: 14, borderLeft: '2px solid var(--line)' }}>
                    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'end' }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label htmlFor="l4-gate-on" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input
                            id="l4-gate-on"
                            type="checkbox"
                            checked={gate.require}
                            onChange={(e) => setGate((g) => ({ ...g, require: e.target.checked }))}
                            style={{ width: 'auto' }}
                          />
                          Must be earned
                        </label>
                      </div>
                      <div className="field" style={{ marginBottom: 0, width: 200 }}>
                        <label htmlFor="l4-gate-n">Remembered in a single day</label>
                        <input
                          id="l4-gate-n"
                          type="number"
                          min="0"
                          step="1"
                          value={gate.threshold}
                          onChange={(e) => setGate((g) => ({ ...g, threshold: e.target.value }))}
                          disabled={!gate.require}
                        />
                      </div>
                    </div>
                    <p className="card-note" style={{ marginTop: 8 }}>
                      {gate.require
                        ? `A user reaches Level 4 after remembering ${gu(gate.threshold || 0)} Darshan in one day at Level 3 — one day, not a running total. Once reached it stays open.`
                        : 'Level 4 is open to every user straight away, with no Level 3 requirement.'}
                    </p>
                  </div>
                )}
              </div>
            ))}

            <button className="btn" type="button" onClick={() => setConfirm(true)} disabled={busy}>
              Save
            </button>

            <p className="card-note">
              What is decided here: whether a level is shown, what it is called, in what order,
              and what opens Level 4. Nothing here unlocks Level 4 for anyone — the number is a
              requirement each user meets through his own days at Level 3, and Level 4 stays
              empty until a version is published on the <Link to="/levels/4">Level 4</Link> page.
            </p>
          </div>

          <ConfirmDialog
            open={confirm}
            title="Save the level configuration?"
            body={
              gate.require
                ? `A level that is turned off will be removed from the users' home page. Level 4 will open for a user once he remembers ${gu(Number(gate.threshold) || 0)} Darshan in a single day.`
                : "A level that is turned off will be removed from the users' home page. Level 4 will be open to every user immediately, with no Level 3 requirement."
            }
            busy={busy}
            onConfirm={save}
            onCancel={() => setConfirm(false)}
          />
        </>
      </AsyncBlock>
    </>
  );
}
