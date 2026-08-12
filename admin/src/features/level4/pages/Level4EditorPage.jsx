import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { useAdminAuth } from '../../../lib/adminAuth';
import { AsyncBlock } from '../../../components/StateBlocks';
import { PageHeader } from '../../../components/StatCard';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { gu } from '../../../lib/format';
import { saveError } from '../../../lib/errors';
import { listDarshan } from '../../darshan/services/darshanService';
// The gate lives in settings['levels'] since 0014, so this page asks the settings service
// for it rather than reading level4_configs.gate_threshold, which nothing consults.
import { getLevelsConfig } from '../../settings/services/settingsService';
import {
  cloneConfig,
  createActivity,
  deleteActivity,
  getConfig,
  publishConfig,
  reorderActivities,
  setActivityItems,
  updateActivity,
  updateConfig,
} from '../services/level4Service';
import { L4_CONFIG_STATUS, nextActivityCode } from '../../../../../shared/domain/level4.js';
import { autoDivide, findInvalid, summarise, validateAssignment } from '../../../../../shared/domain/level4-selection.js';
import SceneSelector from '../components/SceneSelector';
import ValidationNotice from '../components/ValidationNotice';
import '../level4.css';

/**
 * §36 — where a version is actually built.
 *
 * The whole version is edited here, not one sub-level at a time: the list on the left is the
 * order a યુવક will meet them in, and the form on the right is whichever one is open. They
 * belong on one screen because the decisions are one decision — moving twenty દર્શન out of
 * ૪.૨ is only sensible while you can see what ૪.૩ already holds.
 *
 * **Nothing is written until Save Draft.** Auto Divide, adding a range, removing a sub-level:
 * all of it happens to a working copy in this component, and the engine re-checks the working
 * copy on every keystroke. That is what makes Auto Divide a *starting point* the સંચાલક can
 * modify (§6) rather than a decision taken on his behalf.
 *
 * **The numbering on this page is the user's** (ORDERING.md decision #2). `listDarshan()`
 * hands back the collection already sequenced, so every range typed here, every preview line
 * and every group Auto Divide makes is in the continuous ૧…N a user counts through. The
 * number printed on the artwork travels alongside, in grey, for tracing a Darshan back to
 * the sheet — and selects nothing.
 *
 * **Permissions.** `settings.read` opens the page; every control that writes is disabled
 * without `settings.update`. UI only, as everywhere else in this panel — the boundary is the
 * RLS policy on the three tables plus `has_permission('settings.update')` inside
 * `level4_publish()` and `level4_clone_config()` (shared/domain/permissions.js sets out the
 * convention). No permission was added for લેવલ ૪.
 */
export default function Level4EditorPage() {
  const { configId } = useParams();
  const navigate = useNavigate();
  const { can } = useAdminAuth();
  const mayEdit = can('settings.update');

  const state = useAsync(
    () => Promise.all([getConfig(configId), listDarshan()]).then(([config, collection]) => ({ config, collection })),
    [configId]
  );

  const config = state.data?.config || null;
  const collection = useMemo(() => state.data?.collection || [], [state.data]);

  // The working copy, and the copy it was loaded from. Everything the સંચાલક does happens to
  // the first; the second is what Save Draft diffs against, so an untouched sub-level is not
  // rewritten (and does not appear in the audit log as if it had been).
  const [acts, setActs] = useState([]);
  const origin = useRef(new Map());
  const [openId, setOpenId] = useState('');
  const [title, setTitle] = useState('');
  /*
    The gate is read, never written, and never from the configuration (0014).

    It belongs to settings['levels'] now, so this page fetches it only to *say* what it is in
    the publish summary — a version about to go live is exactly when someone wants to be
    reminded what opens the level. Reading it off `config.gateThreshold` instead would print
    a column nothing consults, which is a worse kind of wrong than printing nothing.
  */
  const gateState = useAsync(() => getLevelsConfig(), []);
  const gate = gateState.data?.gate ?? null;

  const [requireFullCoverage, setRequireFullCoverage] = useState(true);
  const [parts, setParts] = useState(2);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [dialog, setDialog] = useState(null);
  const tmp = useRef(0);

  useEffect(() => {
    if (!config) return;
    const loaded = (config.activities || []).map((a) => ({ ...a, sceneIds: [...(a.sceneIds || [])] }));
    origin.current = new Map(loaded.map((a) => [a.id, JSON.stringify(fields(a))]));
    setActs(loaded);
    setOpenId(loaded[0]?.id || '');
    setTitle(config.title || '');
  }, [config]);

  const readOnly =
    !mayEdit || !config || config.status === L4_CONFIG_STATUS.PUBLISHED || config.status === L4_CONFIG_STATUS.ARCHIVED;

  const open = acts.find((a) => a.id === openId) || null;

  /**
   * Which other sub-level already holds a દ્રશ્ય, shown on its row. Not a prohibition — moving
   * one across is an ordinary edit, and the engine is what reports the duplicate if it is left
   * in both (§7 A).
   */
  const takenBy = useMemo(() => {
    const m = new Map();
    for (const a of acts) {
      if (!a.active || a.id === openId) continue;
      for (const id of a.sceneIds) if (!m.has(id)) m.set(id, a.code);
    }
    return m;
  }, [acts, openId]);

  const byId = useMemo(() => new Map(collection.map((c) => [c.id, c])), [collection]);

  /**
   * Which દર્શન a યુવક could not be asked about — no picture, no વર્ણન, or hidden.
   *
   * Asked of the engine rather than read off `item.active`, and asked once for the whole
   * collection. `findInvalid` is the definition §7 D and E are validated by; a page that
   * decided the same thing for itself would eventually disagree with the check that blocks
   * its own publish button.
   */
  const withheld = useMemo(
    () => new Set(findInvalid([{ activityKey: '', sceneIds: collection.map((c) => c.id) }], collection)),
    [collection]
  );
  const readyCount = collection.length - withheld.size;

  const check = useMemo(() => {
    if (!collection.length) return null;
    const assignments = acts.filter((a) => a.active).map((a) => ({ activityKey: a.code, sceneIds: a.sceneIds }));
    return validateAssignment({ assignments, collection, requireFullCoverage });
  }, [acts, collection, requireFullCoverage]);

  const removed = useMemo(() => {
    const here = new Set(acts.map((a) => a.id));
    return (config?.activities || []).filter((a) => !here.has(a.id));
  }, [acts, config]);

  const dirty =
    !!config &&
    (acts.some((a) => a.isNew || origin.current.get(a.id) !== JSON.stringify(fields(a))) ||
      removed.length > 0 ||
      acts.map((a) => a.id).join() !== (config.activities || []).map((a) => a.id).join() ||
      title !== (config.title || ''));

  const patch = (id, key, v) => setActs((list) => list.map((a) => (a.id === id ? { ...a, [key]: v } : a)));

  /** Deterministic move: the array *is* the order, and `position` is written from it on save. */
  const move = (from, to) =>
    setActs((list) => {
      if (to < 0 || to >= list.length) return list;
      const next = [...list];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });

  const addActivity = () => {
    const id = `new-${++tmp.current}`;
    // The code is suggested from the ones already here and stays editable — §62 forbids
    // deciding anything by matching a code, so nothing downstream cares what it says.
    setActs((list) => [
      ...list,
      { id, isNew: true, code: nextActivityCode(list), title: '', description: '', active: true, sceneIds: [], progressCount: 0 },
    ]);
    setOpenId(id);
  };

  /**
   * §6 — a first cut the સંચાલક then corrects.
   *
   * Divided over the દર્શન that are ready to learn rather than over every row: a દ્રશ્ય with no
   * image or no વર્ણન cannot be recalled, and putting one into a sub-level would build a test
   * nobody can pass. Whatever is left out is reported by the engine below, where he can see it
   * and decide.
   *
   * The list handed to `autoDivide` is the **sequenced** one — `listDarshan()` has already
   * canonically ordered it — so the filter preserves that order and each group comes out as an
   * unbroken run of the numbers a user sees: ૧–૨૭, ૨૮–૫૪, and so on. Nothing here re-sorts,
   * which is the whole of ORDERING.md rule 4.
   *
   * Local only. Nothing is written until Save Draft, so this is a suggestion on screen.
   */
  const runAutoDivide = () => {
    const learnable = collection.filter((c) => !withheld.has(c.id)).map((c) => c.id);
    const groups = autoDivide(learnable, Number(parts));
    const built = [];
    for (const group of groups) {
      built.push({
        id: `new-${++tmp.current}`,
        isNew: true,
        code: nextActivityCode(built),
        title: '',
        description: '',
        active: true,
        sceneIds: [...group],
        progressCount: 0,
      });
    }
    setActs(built);
    setOpenId(built[0]?.id || '');
    setDialog(null);
  };

  /**
   * Save Draft — the only thing on this page that writes.
   *
   * Order matters. Removals go first so a code they were holding is free for a sub-level that
   * wants it, and §28 decides *how* they go: one a યુવક has already worked on is deactivated,
   * never deleted, because his COMPLETED row has to keep pointing at something real. It is
   * therefore still in the version, and so is still named in the reordering below — a
   * `unique (config_id, position)` that is deferred still has to hold at commit.
   */
  async function saveDraft() {
    setBusy(true);
    setMsg(null);
    try {
      const keptRemoved = [];
      for (const a of removed) {
        if (a.progressCount > 0) {
          await updateActivity(a.id, { active: false });
          keptRemoved.push(a.id);
        } else {
          await deleteActivity(a.id);
        }
      }

      const ids = [];
      for (const [i, a] of acts.entries()) {
        if (a.isNew) {
          const id = await createActivity(configId, {
            code: a.code,
            title: a.title,
            description: a.description,
            position: i + 1,
          });
          if (!a.active) await updateActivity(id, { active: false });
          await setActivityItems(id, a.sceneIds);
          ids.push(id);
          continue;
        }
        ids.push(a.id);
        const before = origin.current.get(a.id);
        const now = JSON.stringify(fields(a));
        if (before === now) continue;
        const was = JSON.parse(before);
        await updateActivity(a.id, {
          code: a.code,
          title: a.title,
          description: a.description,
          active: a.active,
          // `?? null` and not `|| null`: 0 is refused by the column's check constraint, and
          // an empty box arrives here as null already — but a `||` would also turn a
          // deliberate 0 into null and hide the refusal instead of surfacing it.
          requiredCount: a.requiredCount ?? null,
        });
        if (was.sceneIds.join() !== a.sceneIds.join()) await setActivityItems(a.id, a.sceneIds);
      }

      await reorderActivities(configId, [...ids, ...keptRemoved]);

      // Only the name. The gate is not this version's to carry any more (0014), and writing
      // `gate_threshold` here would put a number in a column nothing reads — a value that
      // looks authoritative to the next person who opens the table.
      if (title !== (config.title || '')) {
        await updateConfig(configId, { title });
      }

      setMsg({ tone: 'ok', text: 'Draft saved.' });
      state.retry();
    } catch (e) {
      // Reloaded on failure too: some of the statements above may have landed, and a screen
      // that went on showing the working copy would be showing something that is no longer
      // what the database holds.
      setMsg({ tone: 'danger', text: saveError(e) });
      state.retry();
    } finally {
      setBusy(false);
      setDialog(null);
    }
  }

  async function publish() {
    setBusy(true);
    setMsg(null);
    try {
      await publishConfig(configId);
      navigate('/levels/4');
    } catch (e) {
      setMsg({ tone: 'danger', text: saveError(e) });
      setBusy(false);
      setDialog(null);
    }
  }

  const blocking = check?.errors?.length || 0;

  return (
    <>
      <PageHeader
        title={config ? `Level 4 — version ${gu(config.version)}` : 'Level 4'}
        sub="Sub-levels, and which Darshan each one asks a user to recall"
        actions={<Link className="btn btn-quiet" to="/levels/4">Back to Level 4</Link>}
      />

      {msg && <div className={`notice notice-${msg.tone}`} role="status">{msg.text}</div>}

      <AsyncBlock
        state={{ ...state, isEmpty: !state.loading && !state.error && !config }}
        empty="That version was not found."
        onRetry={state.retry}
      >
        <>
          {/* Typing the URL of a live version reaches here, so the rule is enforced on the
              page and not only on the button that leads to it (§10). */}
          {config?.status === L4_CONFIG_STATUS.PUBLISHED && (
            <div className="notice notice-warn">
              This version is live, so it cannot be changed. Make an editable copy — users stay on
              this version until the copy is published.{' '}
              {mayEdit && (
                <button
                  className="linklike"
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      navigate(`/levels/4/config/${await cloneConfig(configId)}`);
                    } catch (e) {
                      setMsg({ tone: 'danger', text: saveError(e) });
                      setBusy(false);
                    }
                  }}
                >
                  Copy it now
                </button>
              )}
            </div>
          )}
          {config?.status === L4_CONFIG_STATUS.ARCHIVED && (
            <div className="notice">This version has been retired and is kept for the users who finished it.</div>
          )}
          {!mayEdit && <div className="notice">You can look at this configuration but not change it.</div>}

          <div className="card">
            <h2>Version</h2>
            <div className="field">
              <label htmlFor="cfg-title">Name (for your own reference)</label>
              <input id="cfg-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} />
            </div>
            {/*
              The gate used to be two inputs here, and it is deliberately not any more (0014).

              It moved to the Levels page because it could not be answered from here at all
              until a version existed — a સંચાલક setting the project up had nowhere to say
              what opens Level 4. Now that the setting is the single answer, leaving editable
              copies on this page would be worse than the original problem: two fields, one
              number, and a saved edit here that changes nothing anywhere.

              So this is a sentence and a link, not a disabled input. A greyed-out field
              still reads as "the place where this is set, currently unavailable", which is
              the wrong thing to tell someone looking for it.
            */}
            <p className="card-note">
              What opens Level 4 is set once for the whole app, on the{' '}
              <Link to="/levels">Levels</Link> page — it is no longer part of a version, so it
              is the same whichever version is published.
            </p>
            <p className="card-note">
              With the gate off, every user sees Level 4 straight away. With it on, a user reaches
              it after remembering that many Darshan in one day — which is how it already works.
            </p>
          </div>

          <div className="card">
            <h2>Divide the collection</h2>
            <div className="l4-tools">
              <div className="field">
                <label htmlFor="l4-parts">Number of sub-levels</label>
                <input
                  id="l4-parts"
                  type="number"
                  min="1"
                  value={parts}
                  onChange={(e) => setParts(e.target.value)}
                  disabled={readOnly}
                />
              </div>
              <button
                className="btn btn-quiet"
                type="button"
                disabled={readOnly || busy || Number(parts) < 1}
                onClick={() => setDialog({ kind: 'divide' })}
              >
                Auto Divide
              </button>
              <button className="btn btn-quiet" type="button" disabled={readOnly || busy} onClick={addActivity}>
                + Create Sub-Level
              </button>
            </div>
            <p className="card-note">
              Auto Divide splits the {gu(readyCount)} Darshan that are
              ready to learn into equal groups, in the order users meet them — so each group is a
              consecutive run of the numbers they see. It is a starting point — change any of them
              afterwards, and nothing is saved until you press Save Draft.
            </p>
          </div>

          <div className="l4-cols">
            <div className="card">
              <h2>Order</h2>
              {!acts.length ? (
                <p className="hint">No sub-levels yet.</p>
              ) : (
                <ul className="l4-nav">
                  {acts.map((a, i) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        className={`l4-nav-btn ${a.id === openId ? 'is-active' : ''}`}
                        onClick={() => setOpenId(a.id)}
                      >
                        {a.code} {a.title ? `— ${a.title}` : ''}{' '}
                        <span className="l4-nav-n">
                          {gu(a.sceneIds.length)}{a.active ? '' : ' · off'}
                        </span>
                      </button>
                      <button
                        className="l4-move"
                        type="button"
                        aria-label={`Move ${a.code} up`}
                        disabled={readOnly || i === 0}
                        onClick={() => move(i, i - 1)}
                      >
                        ▲
                      </button>
                      <button
                        className="l4-move"
                        type="button"
                        aria-label={`Move ${a.code} down`}
                        disabled={readOnly || i === acts.length - 1}
                        onClick={() => move(i, i + 1)}
                      >
                        ▼
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="card-note">
                The order here is the order a user meets them in. It is written as ૧, ૨, ૩… when you
                save, so it never depends on when a sub-level was created.
              </p>
            </div>

            <div className="card">
              {!open ? (
                <p className="hint">Choose a sub-level on the left, or create one.</p>
              ) : (
                <>
                  <h2>{open.code}</h2>

                  <div className="filters">
                    <div className="field">
                      <label htmlFor="a-code">Code</label>
                      <input
                        id="a-code"
                        type="text"
                        value={open.code}
                        onChange={(e) => patch(open.id, 'code', e.target.value)}
                        disabled={readOnly}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="a-order">Order</label>
                      <input
                        id="a-order"
                        type="number"
                        min="1"
                        value={acts.indexOf(open) + 1}
                        onChange={(e) => {
                          const to = Number(e.target.value) - 1;
                          if (Number.isInteger(to)) move(acts.indexOf(open), to);
                        }}
                        disabled={readOnly}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="a-active" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          id="a-active"
                          type="checkbox"
                          checked={open.active}
                          onChange={(e) => patch(open.id, 'active', e.target.checked)}
                          disabled={readOnly}
                          style={{ width: 'auto' }}
                        />
                        Active
                      </label>
                    </div>
                  </div>

                  <div className="field">
                    <label htmlFor="a-title">Title</label>
                    <input
                      id="a-title"
                      type="text"
                      value={open.title}
                      onChange={(e) => patch(open.id, 'title', e.target.value)}
                      disabled={readOnly}
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="a-desc">Description</label>
                    <textarea
                      id="a-desc"
                      rows={2}
                      value={open.description}
                      onChange={(e) => patch(open.id, 'description', e.target.value)}
                      disabled={readOnly}
                    />
                  </div>

                  {/*
                    The pass mark for this one sub-level (0016).

                    Empty means every Darshan in it, which is what every sub-level meant
                    before the column existed — so leaving this alone changes nothing. A
                    number means that many out of however many it holds.

                    Deliberately not a percentage: the સંચાલક composes a sub-level by picking
                    items, so he is already counting in items, and a percentage would have to
                    resolve against a total that moves the day one is withheld.

                    A mark larger than the sub-level is not refused here — the database
                    clamps it down at submit time, so it can never make a sub-level
                    impossible — but it is called out below, because it almost always means
                    the items were changed afterwards and the number was forgotten.
                  */}
                  <div className="field">
                    <label htmlFor="a-req">
                      Must remember (leave empty for all {gu(open.sceneIds.length)})
                    </label>
                    <input
                      id="a-req"
                      type="number"
                      min="1"
                      step="1"
                      style={{ maxWidth: 200 }}
                      value={open.requiredCount ?? ''}
                      onChange={(e) =>
                        patch(
                          open.id,
                          'requiredCount',
                          e.target.value === '' ? null : Number(e.target.value)
                        )
                      }
                      disabled={readOnly}
                    />
                    <p className="card-note">
                      {open.requiredCount == null
                        ? `A user passes ${open.code} by remembering all ${gu(open.sceneIds.length)} of these.`
                        : open.requiredCount > open.sceneIds.length
                          ? `This sub-level holds only ${gu(open.sceneIds.length)} Darshan, so ${gu(open.requiredCount)} will be treated as ${gu(open.sceneIds.length)}. Set it to ${gu(open.sceneIds.length)} or lower.`
                          : `A user passes ${open.code} by remembering ${gu(open.requiredCount)} of these ${gu(open.sceneIds.length)}.`}
                    </p>
                  </div>

                  <SceneSelector
                    collection={collection}
                    value={open.sceneIds}
                    onChange={(ids) => patch(open.id, 'sceneIds', ids)}
                    takenBy={takenBy}
                    withheld={withheld}
                    disabled={readOnly}
                  />

                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-quiet"
                      type="button"
                      disabled={readOnly || busy}
                      onClick={() => setDialog({ kind: 'remove', activity: open })}
                    >
                      Remove this sub-level
                    </button>
                    {open.progressCount > 0 && (
                      <span className="hint" style={{ alignSelf: 'center' }}>
                        {gu(open.progressCount)} user{open.progressCount === 1 ? '' : 's'} have worked on
                        it — it will be archived, not deleted.
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="card">
            <h2>Check</h2>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={requireFullCoverage}
                onChange={(e) => setRequireFullCoverage(e.target.checked)}
                style={{ width: 'auto' }}
              />
              Every Darshan must belong to a sub-level
            </label>
            <p className="hint" style={{ marginBottom: 12 }}>
              Turn this off while a version is deliberately partial. The check itself is the same one
              the app applies to users.
            </p>

            <ValidationNotice result={check} collection={byId} />

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" type="button" disabled={readOnly || busy || !dirty} onClick={saveDraft}>
                {busy ? 'Saving…' : 'Save Draft'}
              </button>
              <button
                className="btn btn-quiet"
                type="button"
                disabled={readOnly || busy || dirty || !!blocking || !acts.some((a) => a.active)}
                onClick={() => setDialog({ kind: 'publish' })}
              >
                Publish
              </button>
            </div>

            {!!blocking && (
              <p className="card-note">
                Publishing is blocked until the {gu(blocking)} problem{blocking === 1 ? '' : 's'} above{' '}
                {blocking === 1 ? 'is' : 'are'} fixed.
              </p>
            )}
            {!blocking && dirty && <p className="card-note">Save the draft before publishing it.</p>}
          </div>

          {/* ------------------------------------------------------------ dialogs */}

          <ConfirmDialog
            open={dialog?.kind === 'divide'}
            title={`Divide into ${gu(parts)} sub-levels?`}
            body={
              <>
                <p>
                  The {gu(acts.length)} sub-level{acts.length === 1 ? '' : 's'} shown now
                  {acts.length ? ' are replaced by' : ' become'} {gu(parts)} equal groups covering the{' '}
                  {gu(readyCount)} Darshan that are ready to learn — split in the order users meet
                  them, so each group is a consecutive run of the numbers they see.
                </p>
                <p style={{ marginTop: 8 }}>
                  Nothing is written yet — change the result as you like, and press Save Draft when it
                  is right. A sub-level users have already worked on is archived rather than deleted.
                </p>
              </>
            }
            confirmLabel="Divide"
            onCancel={() => setDialog(null)}
            onConfirm={runAutoDivide}
          />

          <ConfirmDialog
            open={dialog?.kind === 'remove'}
            title={`Remove ${dialog?.activity?.code || ''}?`}
            body={
              dialog?.activity?.progressCount > 0
                ? 'Users have already worked on this sub-level, so it is archived instead of deleted — what they finished stays theirs. It takes effect when you save the draft.'
                : 'Nobody has worked on this sub-level, so it is deleted when you save the draft.'
            }
            confirmLabel="Remove"
            onCancel={() => setDialog(null)}
            onConfirm={() => {
              setActs((list) => list.filter((a) => a.id !== dialog.activity.id));
              setOpenId('');
              setDialog(null);
            }}
          />

          <ConfirmDialog
            open={dialog?.kind === 'publish'}
            title={`Publish version ${gu(config?.version ?? 0)}?`}
            danger={!!check?.warnings?.length}
            confirmLabel={check?.warnings?.length ? 'Publish anyway' : 'Publish'}
            busy={busy}
            onCancel={() => setDialog(null)}
            onConfirm={publish}
            body={
              <>
                <p>This is what users will get:</p>
                <ul style={{ margin: '8px 0 0 18px' }}>
                  <li>{gu(acts.filter((a) => a.active).length)} sub-levels</li>
                  <li>
                    {gu(new Set(acts.filter((a) => a.active).flatMap((a) => a.sceneIds)).size)} of{' '}
                    {gu(readyCount)} Darshan that are ready to learn
                  </li>
                  {/* Read from the setting, and simply absent while it is in flight — a
                      publish summary that guessed at the gate would be worse than one that
                      does not mention it. */}
                  {gate && (
                    <li>
                      Unlock:{' '}
                      {gate.require
                        ? `after ${gu(gate.threshold)} remembered in a single day`
                        : 'open to everyone'}{' '}
                      (set on the Levels page, not by this version)
                    </li>
                  )}
                </ul>

                {/* Ranges, spelled out, because "1 – 30" means two different things in this
                    product and the moment of publishing is the wrong moment to be unsure which.
                    Every number below is the one the user's own card will print. Capped for the
                    same reason the preview is: a version may hold any number of sub-levels. */}
                <p style={{ marginTop: 10 }}>
                  Each sub-level, numbered exactly as users see it — <strong>not</strong> the
                  numbers printed on the artwork:
                </p>
                <ul style={{ margin: '6px 0 0 18px' }}>
                  {acts
                    .filter((a) => a.active)
                    .slice(0, DIALOG_LIST)
                    .map((a) => {
                      const s = summarise(a.sceneIds, collection);
                      return (
                        <li key={a.id}>
                          {a.code}: {s.count
                            ? `Darshan ${gu(s.fromIndex)} – ${gu(s.toIndex)}${s.contiguous ? '' : ' (with gaps)'} · ${gu(s.count)} in all`
                            : 'nothing selected'}
                        </li>
                      );
                    })}
                  {acts.filter((a) => a.active).length > DIALOG_LIST && (
                    <li className="hint">+{gu(acts.filter((a) => a.active).length - DIALOG_LIST)} more</li>
                  )}
                </ul>

                {!!check?.warnings?.length && (
                  <p style={{ marginTop: 10 }}>
                    {gu(check.warnings.length)} warning{check.warnings.length === 1 ? '' : 's'} above has
                    not been fixed. You can publish past it.
                  </p>
                )}
              </>
            }
          />
        </>
      </AsyncBlock>
    </>
  );
}

/** How many sub-levels the publish dialog spells out before it says "+N more". */
const DIALOG_LIST = 12;

/** The fields a save compares. `position` is deliberately absent — the array is the order. */
const fields = (a) => ({
  code: a.code,
  title: a.title,
  description: a.description,
  active: a.active,
  sceneIds: a.sceneIds,
  // The pass mark (0016). Present here or an edit to it is not "dirty" — Save would stay
  // disabled and the number would be silently discarded on the next load, which is the
  // quietest way for a field to look like it works and not.
  requiredCount: a.requiredCount ?? null,
});
