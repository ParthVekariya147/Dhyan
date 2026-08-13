import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { useAdminAuth } from '../../../lib/adminAuth';
import { getLevelsConfig, updateLevelsConfig } from '../../settings/services/settingsService';
import { AsyncBlock, FormSkeleton } from '../../../components/StateBlocks';
import { PageHeader, StatusBadge } from '../../../components/StatCard';
import ConfirmDialog from '../../../components/ConfirmDialog';
/*
  Points and the leaderboard are written into the same `settings['levels']` row this page
  reads, and they are NOT configured here. They are on the Settings page, which is where a
  સંચાલક looks for them — the row a setting lives in is a fact about the database and not a
  reason to hide a control from the person who has to find it. `getLevelsConfig()` still
  returns both keys; that page makes its own call.
*/
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
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this page shows, and what it refuses to show
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A level has exactly four stored properties — `levelId`, `name`, `order`, `enabled` — and
 * this page has exactly four controls for them. The paragraph under each level's heading is
 * *not* a fifth: it is fixed copy about what the code does at that stage, rendered as prose
 * and editable by nobody, because there is no column behind it and inventing one to make the
 * screen look richer would be a settings field that no reader honours (§62).
 *
 * The hierarchy is not flattened either. Level 4 contains sub-levels — ૪.૧, ૪.૨, … — and
 * each one is a set of દર્શન a યુવક must recall. That is a section's worth of work with its
 * own versioning, publishing and validation, and it lives at /levels/4. This page links to
 * it and shows none of it: two screens that both edited the sub-levels would be two answers
 * to one question, which is the exact fault 0011 and 0014 were written to remove.
 */

/**
 * What each level *is*, in one line — fixed by the code, not by settings.
 *
 * Keyed on levelId rather than on the name, because the name is the one part of a level a
 * સંચાલક may rename: keying on it would leave the caption behind the moment he did. A level
 * with no entry here simply renders no caption, so a level added later cannot break this
 * page while it waits for a sentence.
 */
const LEVEL_NOTES = {
  1: 'Video darshan - the yuvak watches, there is nothing to answer.',
  2: 'The Darshan feed itself: the master images, with their વર્ણન and number. The only level with content today, which is why it cannot be turned off.',
  3: 'The વર્ણન list - he reads the descriptions and finds the દ્રશ્ય they belong to.',
  4: 'Memory recall. The index number alone is shown - no image, no વર્ણન - and that is fixed in the app, not here (§37).',
};

export default function LevelsPage() {
  const state = useAsync(() => getLevelsConfig(), []);
  const { can } = useAdminAuth();

  /**
   * `settings.read` opens this page and `settings.update` saves it — the same split every
   * other settings screen makes, and the same one AdminShell's NAV table documents. The
   * controls are disabled rather than removed: which levels are offered and what opens
   * Level 4 are facts a VIEWER is entitled to read, and a page that hid them would answer
   * "which levels are live?" with silence.
   */
  const mayEdit = can('settings.update');

  const [levels, setLevels] = useState([]);
  const [gate, setGate] = useState(DEFAULT_LEVEL4_GATE);
  // { kind: 'list' | 'gate', text } — which half of the form the refusal belongs to. One
  // flat string put a gate message under the level list and a list message under the gate
  // field, which is worse than no message: it points at the wrong control.
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  // Nothing is marked wrong until something has been changed. A form that opens red is
  // complaining about the stored configuration, which the સંચાલક did not just do (§31).
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!state.data) return;
    setLevels(state.data.levels.map((l) => ({ ...l })));
    setGate({ ...state.data.gate });
    setTouched(false);
    setErr(null);
  }, [state.data]);

  const patch = (levelId, key, value) => {
    setMsg(null);
    setErr(null);
    setTouched(true);
    setLevels((ls) => ls.map((l) => (l.levelId === levelId ? { ...l, [key]: value } : l)));
  };

  const patchGate = (next) => {
    setMsg(null);
    setErr(null);
    setTouched(true);
    setGate(next);
  };

  /*
    The same two shared rules save() runs, evaluated as he types.

    Display only — save() below is the authority and calls them again. Running a second,
    looser check here would be the two-answers-to-one-question fault shared/domain/settings.js
    is written to prevent; running *these* means the message he sees while typing is word for
    word the one that would refuse the save.
  */
  const listCheck = levels.length ? validateLevels(levels) : { ok: true };
  const gateCheck = validateLevel4Gate(gate);
  const listError = (touched && !listCheck.ok ? listCheck.gu : '') || (err?.kind === 'list' ? err.text : '');
  const gateError = (touched && !gateCheck.ok ? gateCheck.gu : '') || (err?.kind === 'gate' ? err.text : '');

  /** The home page's order, read back to him before he saves it. Disabled levels are left
   *  out because they are not on that page at all. */
  const homeOrder = [...levels]
    .filter((l) => l.enabled)
    .sort((a, b) => a.order - b.order || a.levelId - b.levelId)
    .map((l) => l.name)
    .join(' → ');

  async function save() {
    /*
      Both halves validated before either is written. They go into one jsonb row, so a save
      that passed the list and failed the gate would either write half a change or need a
      second round trip to undo one — and `updateLevelsConfig` is one upsert precisely so
      that cannot happen.
    */
    const v = validateLevels(levels);
    if (!v.ok) {
      setErr({ kind: 'list', text: v.gu });
      setTouched(true);
      setConfirm(false);
      return;
    }
    const g = validateLevel4Gate(gate);
    if (!g.ok) {
      setErr({ kind: 'gate', text: g.gu });
      setTouched(true);
      setConfirm(false);
      return;
    }
    setErr(null);
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
      setMsg({ tone: 'ok', text: 'Saved - this is what the home page shows now.' });
      state.retry();
    } catch (e) {
      // §31 — the edits stay on screen and the Try again beside this message re-runs the
      // same save. Nothing is retried on its own: this is a write 2,000 people feel.
      setMsg({ tone: 'danger', text: saveError(e) });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Levels"
        sub="Which levels are offered, what they are called, in what order - and what opens Level 4"
        actions={
          // The way into the container, from the header as well as from the Level 4 row.
          // A સંચાલક who came here looking for the sub-levels should not have to scroll to
          // the fourth block to find out he is on the wrong page.
          <Link className="btn btn-quiet" to="/levels/4">
            Level 4 sub-levels
          </Link>
        }
      />

      <AsyncBlock state={state} onRetry={state.retry} skeleton={<FormSkeleton fields={4} />}>
        <>
          {!mayEdit && (
            <div className="notice notice-warn" role="status">
              You can read the level configuration, but changing it needs the{' '}
              <strong>settings.update</strong> permission.
            </div>
          )}

          <div className="card">
            <div style={cardHead}>
              <h2 style={{ marginBottom: 0 }}>The four levels</h2>
              <StatusBadge tone="info">
                {levels.filter((l) => l.enabled).length} of {levels.length} shown
              </StatusBadge>
            </div>
            <p className="card-note" style={{ marginTop: 0, marginBottom: 'var(--sp-4)' }}>
              A level that is turned off disappears from the users' home page. What each level{' '}
              <strong>does</strong> is decided by the app and cannot be changed here.
            </p>

            {levels.map((l) => (
              <section
                key={l.levelId}
                aria-label={`Level ${gu(l.levelId)}`}
                style={levelBlock}
              >
                <div style={cardHead}>
                  <h3 style={levelTitle}>Level {gu(l.levelId)}</h3>
                  {/* Status as a word first, colour second (§43). "Shown"/"Hidden" is what
                      it means on the home page — "enabled" is what the column is called. */}
                  <StatusBadge tone={l.enabled ? 'ok' : 'off'}>
                    {l.enabled ? 'Shown to users' : 'Hidden'}
                  </StatusBadge>
                  <span className="chip">Position {gu(l.order)}</span>
                </div>

                {LEVEL_NOTES[l.levelId] && (
                  <p className="hint" style={{ marginBottom: 'var(--sp-3)' }}>
                    {LEVEL_NOTES[l.levelId]}
                  </p>
                )}

                {/* Flex-wrap rather than a fixed three-column grid: the old
                    `minmax(0,1fr) 90px 130px` held its three columns all the way down to a
                    320px phone, which squeezed the name box to a few characters and clipped
                    the Gujarati inside it. Here the name takes the row on its own as soon as
                    there is not room for three. No media query is needed for that, which is
                    the point — the layout answers the width it actually has. */}
                <div style={controlRow}>
                  <div className="field" style={{ marginBottom: 0, flex: '1 1 240px' }}>
                    <label htmlFor={`n${l.levelId}`}>Name users see</label>
                    <input
                      id={`n${l.levelId}`}
                      type="text"
                      value={l.name}
                      onChange={(e) => patch(l.levelId, 'name', e.target.value)}
                      disabled={!mayEdit || busy}
                      aria-describedby={`nh${l.levelId}`}
                    />
                    <span className="hint" id={`nh${l.levelId}`}>
                      Written in Gujarati - it is the button on his home page.
                    </span>
                  </div>

                  <div className="field" style={{ marginBottom: 0, flex: '0 1 130px' }}>
                    <label htmlFor={`o${l.levelId}`}>Order</label>
                    <input
                      id={`o${l.levelId}`}
                      type="number"
                      min="1"
                      value={l.order}
                      onChange={(e) => patch(l.levelId, 'order', Number(e.target.value))}
                      disabled={!mayEdit || busy}
                      aria-describedby={`oh${l.levelId}`}
                    />
                    <span className="hint" id={`oh${l.levelId}`}>
                      Low first.
                    </span>
                  </div>

                  <div className="field" style={{ marginBottom: 0, flex: '0 0 auto' }}>
                    <label className="check" htmlFor={`e${l.levelId}`}>
                      <input
                        id={`e${l.levelId}`}
                        type="checkbox"
                        checked={l.enabled}
                        onChange={(e) => patch(l.levelId, 'enabled', e.target.checked)}
                        disabled={!mayEdit || busy}
                      />
                      Show this level
                    </label>
                    {/* The one rule that is not obvious from the control, said next to it
                        rather than only after a refused save. */}
                    {l.levelId === 2 && <span className="hint">Level 2 cannot be turned off.</span>}
                  </div>
                </div>

                {/*
                  The gate, under the level it opens.

                  Placed here rather than in a card of its own because that is where it was
                  looked for and not found: a સંચાલક reading down this list asks "what about
                  Level 4?" at exactly this row. Indented and spanning the full width so it
                  reads as a property of Level 4 rather than as a fifth level.
                */}
                {l.levelId === 4 && (
                  <div style={gateBlock}>
                    <h4 style={gateTitle}>What opens Level 4</h4>

                    <div style={controlRow}>
                      <div className="field" style={{ marginBottom: 0, flex: '0 0 auto' }}>
                        <label className="check" htmlFor="l4-gate-on">
                          <input
                            id="l4-gate-on"
                            type="checkbox"
                            checked={gate.require}
                            onChange={(e) => patchGate({ ...gate, require: e.target.checked })}
                            disabled={!mayEdit || busy}
                          />
                          Must be earned
                        </label>
                      </div>
                      <div
                        className={`field${gateError ? ' is-invalid' : ''}`}
                        style={{ marginBottom: 0, flex: '0 1 240px' }}
                      >
                        <label htmlFor="l4-gate-n">Remembered in a single day</label>
                        {/*
                          Converted here, on the way into state — not on the way out to the
                          database, which was the bug.

                          `e.target.value` is a string even on type="number": '60', never 60.
                          validateLevel4Gate() tests `typeof` on purpose (shared/domain/
                          settings.js), because the SQL side reads `jsonb_typeof(...) =
                          'number'` and quietly falls back to the default for anything else —
                          so a '60' that passed here would show as 60 in this panel and gate
                          at 80 in Postgres. The consequence was that every save following a
                          keystroke in this field was refused with 'enter a number' over a
                          field plainly showing one, and the only threshold that ever
                          validated was the one loaded from the row and left untouched. The
                          Number() at the upsert could not help: validation runs first.

                          An emptied field stays '' rather than becoming 0. `Number('')` is 0,
                          and 0 is a real, honoured threshold — "any day he opens લેવલ ૩ at
                          all" — so coercing here would turn a half-typed field into a gate
                          every યુવક passes, saved without a word about it.
                        */}
                        <input
                          id="l4-gate-n"
                          type="number"
                          min="0"
                          step="1"
                          value={gate.threshold}
                          onChange={(e) =>
                            patchGate({
                              ...gate,
                              threshold: e.target.value === '' ? '' : Number(e.target.value),
                            })
                          }
                          disabled={!mayEdit || busy || !gate.require}
                          aria-describedby="l4-gate-help"
                          aria-invalid={gateError ? 'true' : undefined}
                        />
                        <span className="hint" id="l4-gate-help">
                          Darshan remembered on one day at Level 3 - not a running total.
                        </span>
                      </div>
                    </div>

                    {gateError && (
                      <p className="field-error" role="alert" style={{ marginTop: 'var(--sp-2)' }}>
                        <span aria-hidden="true">⚠</span> {gateError}
                      </p>
                    )}

                    <p className="card-note">
                      {gate.require
                        ? `A user reaches Level 4 after remembering ${gu(gate.threshold || 0)} Darshan in one day at Level 3 - one day, not a running total. Once reached it stays open.`
                        : 'Level 4 is open to every user straight away, with no Level 3 requirement.'}
                    </p>

                    {/*
                      §21 — the hierarchy stays where it belongs. Level 4 holds ૪.૧, ૪.૨ …,
                      and each of those is a set of દર્શન with its own versioning, publishing
                      and validation. None of that is duplicated here; this is the door to it.
                    */}
                    <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                      <Link className="btn btn-quiet btn-sm" to="/levels/4">
                        Open Level 4 sub-levels
                      </Link>
                      <span className="hint">
                        4.1, 4.2 … and which Darshan each one asks for. Level 4 stays empty
                        until a version is published there.
                      </span>
                    </div>
                  </div>
                )}
              </section>
            ))}

            {homeOrder && (
              <p className="card-note" style={{ marginTop: 'var(--sp-4)' }}>
                Home page order after saving: <strong>{homeOrder}</strong>
              </p>
            )}

            {/* The list-level rule — a duplicate id, an empty name, Level 2 turned off —
                cannot be pinned to one field, so it is stated once above the button that
                would be refused by it. */}
            {listError && (
              <div className="notice notice-danger" role="alert" style={{ marginTop: 'var(--sp-4)' }}>
                {listError}
              </div>
            )}

            <div className="form-actions">
              <button
                className={`btn${busy ? ' is-busy' : ''}`}
                type="button"
                onClick={() => setConfirm(true)}
                disabled={busy || !mayEdit}
              >
                {busy ? 'Saving…' : 'Save configuration'}
              </button>
              {msg && (
                <span
                  className={`save-state ${msg.tone === 'ok' ? 'is-ok' : 'is-error'}`}
                  role={msg.tone === 'ok' ? 'status' : 'alert'}
                >
                  {msg.text}
                </span>
              )}
              {msg?.tone === 'danger' && (
                <button className="btn btn-quiet btn-sm" type="button" onClick={save} disabled={busy}>
                  Try again
                </button>
              )}
            </div>

            <p className="card-note">
              What is decided here: whether a level is shown, what it is called, in what order,
              and what opens Level 4. Nothing here unlocks Level 4 for anyone - the number is a
              requirement each user meets through his own days at Level 3, and Level 4 stays
              empty until a version is published on the <Link to="/levels/4">Level 4</Link> page.
            </p>

            {/*
              Said on the page rather than only in a comment, because this is exactly the thing
              somebody came here looking for and did not find. Points are written into the same
              settings row as everything above, so "it is not on this page" is a surprising
              answer without a sentence explaining where it is instead.
            */}
            <p className="card-note">
              How many points each level is worth, and the leaderboard, are set on the{' '}
              <Link to="/settings">Settings</Link> page.
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
            confirmLabel="Save configuration"
            busy={busy}
            onConfirm={save}
            onCancel={() => setConfirm(false)}
          />
        </>
      </AsyncBlock>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Layout constants — module scope, so a keystroke in a name box does not allocate four
 * fresh style objects. Every value is a token: admin.css owns the palette, the scale and
 * the radii, and nothing here may invent one.
 * ------------------------------------------------------------------------- */

const cardHead = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  flexWrap: 'wrap',
  marginBottom: 'var(--sp-2)',
};

/** One level, separated by a rule rather than by a nested card — four cards inside a card
 *  is a box-in-a-box that adds a border for every level and says nothing extra. */
const levelBlock = {
  borderTop: '1px solid var(--border)',
  paddingTop: 'var(--sp-5)',
  marginTop: 'var(--sp-5)',
};

const levelTitle = {
  fontSize: 'var(--fs-body)',
  fontWeight: 'var(--fw-semi)',
  color: 'var(--text-strong)',
};

/** The row of controls. `flex-wrap` with per-field flex bases is what makes this survive
 *  320px without a media query: fields drop to their own line in the order they are in. */
const controlRow = {
  display: 'flex',
  gap: 'var(--sp-4)',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
};

/** The gate reads as a property of Level 4, not as a fifth level: inset, on the sunken
 *  surface, with the same brand rule the sidebar uses to mark "this belongs to that". */
const gateBlock = {
  marginTop: 'var(--sp-4)',
  padding: 'var(--sp-4)',
  background: 'var(--surface-sunken)',
  borderInlineStart: '3px solid var(--brand-200)',
  borderRadius: 'var(--r-md)',
};

const gateTitle = {
  fontSize: 'var(--fs-label)',
  fontWeight: 'var(--fw-semi)',
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 'var(--sp-3)',
};
