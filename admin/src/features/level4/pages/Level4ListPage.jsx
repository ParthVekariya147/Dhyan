import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { useAdminAuth } from '../../../lib/adminAuth';
import { AsyncBlock, CardSkeleton, Empty, TableSkeleton } from '../../../components/StateBlocks';
import StatCard, { PageHeader, StatusBadge } from '../../../components/StatCard';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { dateTimeGu, gu } from '../../../lib/format';
import { saveError } from '../../../lib/errors';
import { listDarshan } from '../../darshan/services/darshanService';
// See the note in Level4EditorPage: the gate is settings['levels'].level4Gate (0014), and
// the two lines below that report it read it from there and not from the configuration.
import { getLevelsConfig } from '../../settings/services/settingsService';
import {
  archiveConfig,
  cloneConfig,
  createConfig,
  getConfig,
  listConfigs,
  publishConfig,
  updateActivity,
} from '../services/level4Service';
import { L4_CONFIG_STATUS } from '../../../../../shared/domain/level4.js';
import { summarise, validateAssignment } from '../../../../../shared/domain/level4-selection.js';
import ValidationNotice from '../components/ValidationNotice';
import '../level4.css';

/**
 * §35 — લેવલ ૪, as something the સંચાલક arranges rather than something the code decides.
 *
 * Level 4 is a container now: it holds sub-levels (૪.૧, ૪.૨, …), each one a set of દર્શન a
 * યુવક must recall. Which sets exist, and what is in them, is a *configuration* — and there
 * are several, versioned, of which exactly one is live. This page is where a version is
 * chosen, read, published and retired.
 *
 * **§22 — the sub-levels are drawn as a hierarchy, not as a grid of equal cards.** That is
 * the one thing this screen has to get right: ૪.૧ … ૪.૭ are *parts of one level*, met in
 * order, and a flat run of tiles makes them read as seven unrelated levels a યુવક can pick
 * between. So there is a trunk, and each sub-level hangs off it, numbered, in the order it
 * is met — and each one states the five facts a સંચાલક actually asks of it: what it covers,
 * how many questions that is, what passing it takes, whether it is switched on, and whether
 * anybody has worked on it yet.
 *
 * There is deliberately **no attempt-policy line**, however much the shape of the card
 * invites one. `level4_activities` carries code, title, description, position, active and
 * required_count and nothing else (see level4Service.js), so "Attempts: unlimited" would be
 * a sentence this page invented about a rule it cannot see. A configuration screen that
 * states a setting nobody stored is worse than one that stays quiet about it.
 *
 * The count of દર્શન on this page comes from `listDarshan()`, the same effective collection
 * the યુવક app renders. It is not 109 and it is not any other literal (§62): the sheet
 * decides what the collection is, and a version that covered "all of them" against a number
 * typed into source would quietly stop covering all of them the day one was added.
 *
 * **Permissions.** The route is gated on `settings.read`, so a VIEWER may look at what is
 * configured; every control that writes is disabled without `settings.update`. Both are UI
 * only — visibility, not a boundary. The real refusal is the RLS policy on
 * `level4_configs` / `_activities` / `_activity_items` and the `has_permission('settings.update')`
 * check inside `level4_publish()` and `level4_clone_config()`, which is the convention
 * shared/domain/permissions.js sets out and which this page adds nothing to. No new
 * permission was introduced for લેવલ ૪.
 */
export default function Level4ListPage() {
  const navigate = useNavigate();
  const { can } = useAdminAuth();
  const mayEdit = can('settings.update');

  /*
    Three reads, awaited together — the versions, the collection, and the gate.

    The gate joins them rather than being fetched separately because both places this page
    reports it are rendered from `state.data`: a second, independently-resolving request
    would let the page paint "Unlock gate: …" a moment after the version it sits beside,
    which reads as the number having just changed.
  */
  const state = useAsync(
    () =>
      Promise.all([listConfigs(), listDarshan(), getLevelsConfig()]).then(
        ([configs, collection, levelsConfig]) => ({ configs, collection, gate: levelsConfig.gate })
      ),
    []
  );

  const [configId, setConfigId] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null); // { kind, ...payload }
  const [previewId, setPreviewId] = useState('');

  /**
   * Which version this page opens on: the live one, because that is the one a question is
   * usually about. With nothing published yet it falls to the newest, which after a first
   * `createConfig()` is the draft just made.
   */
  const configs = state.data?.configs || [];
  const collection = state.data?.collection || [];
  /** What opens લેવલ ૪ — the setting, never `config.gateThreshold` (0014). */
  const gate = state.data?.gate || null;
  useEffect(() => {
    if (!configs.length || configId) return;
    const live = configs.find((c) => c.status === L4_CONFIG_STATUS.PUBLISHED);
    setConfigId((live || configs[0]).id);
  }, [configs, configId]);

  const detail = useAsync(() => getConfig(configId), [configId], { skip: !configId });
  const config = detail.data;
  const activities = config?.activities || [];

  const byId = useMemo(() => new Map(collection.map((c) => [c.id, c])), [collection]);

  /**
   * Full coverage is the સંચાલક's decision, not a stored one: §2.1 gives the configuration a
   * gate and a threshold and no column for this, and inventing one would be changing a frozen
   * schema from a page. Default on, because a container that leaves દર્શન in no sub-level at
   * all is nearly always an unfinished draft rather than an intention.
   */
  const [requireFullCoverage, setRequireFullCoverage] = useState(true);

  const check = useMemo(() => {
    if (!config || !collection.length) return null;
    // Only active sub-levels are validated: an archived one is history (§28), and holding a
    // દ્રશ્ય in it must not be reported as a duplicate against the sub-level that took over.
    const assignments = activities
      .filter((a) => a.active)
      .map((a) => ({ activityKey: a.code, sceneIds: a.sceneIds || [] }));
    return validateAssignment({ assignments, collection, requireFullCoverage });
  }, [config, activities, collection, requireFullCoverage]);

  const covered = useMemo(() => {
    const s = new Set();
    for (const a of activities) if (a.active) for (const id of a.sceneIds || []) s.add(id);
    return s;
  }, [activities]);

  const isPublished = config?.status === L4_CONFIG_STATUS.PUBLISHED;
  const isArchived = config?.status === L4_CONFIG_STATUS.ARCHIVED;
  const editable = !!config && !isPublished && !isArchived;
  const live = configs.find((c) => c.status === L4_CONFIG_STATUS.PUBLISHED);
  const blocking = check?.errors?.length || 0;
  const activeCount = activities.filter((a) => a.active).length;

  const reload = () => {
    state.retry();
    detail.retry();
  };

  async function run(fn, ok) {
    setBusy(true);
    setMsg(null);
    try {
      const result = await fn();
      if (ok) setMsg({ tone: 'ok', text: ok });
      setDialog(null);
      reload();
      return result;
    } catch (e) {
      setMsg({ tone: 'danger', text: saveError(e) });
      setDialog(null);
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** Making the first version succeeds by *leaving*, so it is not run through `run()`:
      there is no list left here to reload and no message left to show. */
  async function startNewVersion() {
    setBusy(true);
    setMsg(null);
    try {
      navigate(`/levels/4/config/${await createConfig({})}`);
    } catch (e) {
      setMsg({ tone: 'danger', text: saveError(e) });
      setBusy(false);
    }
  }

  /**
   * §10 — a live version is edited by copying it.
   *
   * Stated before it happens, never after. A સંચાલક who presses Edit on the version yુવકો are
   * working through has every right to expect that his next keystroke does not reach them, and
   * a clone that happened silently would leave him unsure which of the two he was looking at.
   */
  const openEditor = (cfg) => {
    if (cfg.status === L4_CONFIG_STATUS.PUBLISHED) setDialog({ kind: 'clone', cfg });
    else navigate(`/levels/4/config/${cfg.id}`);
  };

  return (
    <>
      <PageHeader
        title="Level 4"
        sub="Sub-levels, and which Darshan each one asks a user to recall"
        crumbs={[{ to: '/levels', label: 'Levels' }, { label: 'Level 4' }]}
        actions={
          mayEdit && (
            <button
              className={`btn btn-quiet ${busy ? 'is-busy' : ''}`}
              type="button"
              disabled={busy}
              onClick={startNewVersion}
            >
              New Version
            </button>
          )
        }
      />

      {msg && <div className={`notice notice-${msg.tone}`} role="status">{msg.text}</div>}

      <AsyncBlock state={state} onRetry={state.retry} skeleton={<CardSkeleton count={4} />}>
        <>
          {!configs.length ? (
            /* §35 — the first-run state is an offer with a button in it, not a paragraph
               explaining that there is nothing here. */
            <Empty
              icon="🗂"
              title="No version yet"
              message="Level 4 has no sub-levels configured. Create a version, divide the collection into sub-levels, and publish it - until a version is published, Level 4 shows nothing to users."
              action={
                mayEdit ? (
                  <button
                    className={`btn ${busy ? 'is-busy' : ''}`}
                    type="button"
                    disabled={busy}
                    onClick={startNewVersion}
                  >
                    Create the first version
                  </button>
                ) : null
              }
            />
          ) : (
            <>
              <div className="card">
                <h2>Configuration</h2>
                <div className="l4-versions">
                  <div className="field">
                    <label htmlFor="l4-config">Version</label>
                    <select id="l4-config" value={configId} onChange={(e) => { setConfigId(e.target.value); setPreviewId(''); }}>
                      {configs.map((c) => (
                        <option key={c.id} value={c.id}>
                          Version {gu(c.version)} - {STATUS_LABEL[c.status] || c.status}
                          {c.title ? ` - ${c.title}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  {/* Colour is never the only signal — the word is there too (§56). */}
                  {config && (
                    <StatusBadge tone={STATUS_TONE[config.status] || 'warn'}>
                      {STATUS_LABEL[config.status] || config.status}
                    </StatusBadge>
                  )}
                </div>

                {config && (
                  <p className="l4-meta">
                    <span>Created {dateTimeGu(config.createdAt)}</span>
                    {config.publishedAt && (
                      <span>
                        Published {dateTimeGu(config.publishedAt)}
                        {configs.find((c) => c.id === config.id)?.publishedByName
                          ? ` by ${configs.find((c) => c.id === config.id).publishedByName}`
                          : ''}
                      </span>
                    )}
                    {gate && (
                      <span>
                        Unlock gate:{' '}
                        {gate.require ? `on, at ${gu(gate.threshold)} in a day` : 'off'} - set on
                        the Levels page
                      </span>
                    )}
                  </p>
                )}

                {isPublished && (
                  <p className="card-note">
                    This version is live. Editing it will not change it - a copy is made as a new
                    draft, and users keep working through this one until the copy is published.
                  </p>
                )}
                {isArchived && (
                  <p className="card-note">
                    This version has been retired. It is kept because users who finished its
                    sub-levels still point at them.
                  </p>
                )}
              </div>

              <div className="grid-stats">
                <StatCard label="Darshan in collection" value={gu(collection.length)} loading={state.loading} />
                <StatCard label="Sub-levels" value={gu(activeCount)} loading={detail.loading} />
                <StatCard label="Darshan covered" value={gu(covered.size)} tone="ok" loading={detail.loading} />
                <StatCard
                  label="Not in any sub-level"
                  value={gu(collection.length - covered.size)}
                  tone={collection.length - covered.size ? 'warn' : 'plain'}
                  loading={detail.loading}
                />
              </div>

              <AsyncBlock state={detail} onRetry={detail.retry} skeleton={<TableSkeleton rows={4} cols={3} />}>
                <>
                  <div className="card">
                    <h2>Before publishing</h2>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={requireFullCoverage}
                        onChange={(e) => setRequireFullCoverage(e.target.checked)}
                      />
                      Every Darshan must belong to a sub-level
                    </label>
                    <p className="hint l4-help">
                      Turn this off while a version is deliberately partial. The check itself is
                      the same one the app applies to users.
                    </p>

                    <ValidationNotice result={check} collection={byId} />

                    <div className="toolbar">
                      <button
                        className="btn"
                        type="button"
                        disabled={!mayEdit || busy || !editable || !!blocking || !activities.some((a) => a.active)}
                        onClick={() => setDialog({ kind: 'publish' })}
                      >
                        Publish
                      </button>
                      <button
                        className="btn btn-quiet"
                        type="button"
                        disabled={!mayEdit || busy || !config}
                        onClick={() => openEditor(config)}
                      >
                        Edit this version
                      </button>
                      {mayEdit && editable && (
                        <button
                          className="btn btn-quiet"
                          type="button"
                          disabled={busy}
                          onClick={() => setDialog({ kind: 'archive-config' })}
                        >
                          Archive version
                        </button>
                      )}
                    </div>

                    {/* Why the button is off, rather than a button that is off. */}
                    {!!blocking && (
                      <p className="card-note">
                        Publishing is blocked until the {gu(blocking)} problem
                        {blocking === 1 ? '' : 's'} above {blocking === 1 ? 'is' : 'are'} fixed.
                      </p>
                    )}
                    {!blocking && isPublished && <p className="card-note">This version is already live.</p>}
                    {!blocking && isArchived && <p className="card-note">A retired version cannot be published again - copy it into a new draft instead.</p>}
                  </div>

                  {/* ---------------------------------------------------- the hierarchy */}

                  <section className="l4-tree" aria-labelledby="l4-tree-root">
                    <div className="l4-tree-head">
                      <h2 className="l4-tree-root" id="l4-tree-root">Level 4</h2>
                      <p className="l4-tree-sub">
                        {activities.length
                          ? `${gu(activeCount)} sub-level${activeCount === 1 ? '' : 's'} in use${
                              activities.length - activeCount
                                ? `, ${gu(activities.length - activeCount)} archived`
                                : ''
                            } - in the order users meet them`
                          : 'No sub-levels yet'}
                      </p>
                    </div>

                    {!activities.length ? (
                      <Empty
                        icon="➗"
                        title="This version is empty"
                        message="Open the editor to divide the collection into sub-levels - Auto Divide makes a first cut you can then correct."
                        action={
                          mayEdit ? (
                            <button
                              className="btn"
                              type="button"
                              disabled={busy || !config}
                              onClick={() => openEditor(config)}
                            >
                              Divide the collection
                            </button>
                          ) : null
                        }
                      />
                    ) : (
                      <ol className="l4-nodes">
                        {activities.map((a) => {
                          const s = summarise(a.sceneIds || [], collection);
                          // The pass mark (0016). null means every દ્રશ્ય in the sub-level,
                          // which is what every sub-level meant before the column existed —
                          // so it is spelled out rather than left blank. A mark larger than
                          // the sub-level is clamped by the database at submit time; saying
                          // so here is the only place the સંચાલક would ever find out.
                          const req = a.requiredCount;
                          const over = req != null && req > s.count;
                          return (
                            <li className={`l4-node ${a.active ? '' : 'is-off'}`} key={a.id}>
                              <div className="l4-node-head">
                                <span className="l4-node-code">{a.code}</span>
                                <h3 className={`l4-node-title ${a.title ? '' : 'is-untitled'}`}>
                                  {a.title || 'Untitled sub-level'}
                                </h3>
                                <StatusBadge tone={a.active ? 'ok' : 'off'}>
                                  {a.active ? 'Active' : 'Archived'}
                                </StatusBadge>
                              </div>

                              {a.description && <p className="l4-node-desc">{a.description}</p>}

                              <dl className="l4-facts">
                                {/* Display numbering, the same ૧…N a user counts through
                                    (ORDERING.md decision #1), so this line and his card
                                    read alike. */}
                                <div>
                                  <dt>Content</dt>
                                  <dd title="Numbered as users see them">
                                    {s.count
                                      ? `Darshan ${gu(s.fromIndex)} – ${gu(s.toIndex)}${s.contiguous ? '' : ' (with gaps)'}`
                                      : 'Nothing selected'}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Questions</dt>
                                  <dd>{gu(s.count)}</dd>
                                </div>
                                <div>
                                  <dt>To pass</dt>
                                  <dd>
                                    {req == null ? `All ${gu(s.count)}` : `${gu(req)} of ${gu(s.count)}`}
                                    {over && (
                                      <span className="hint">
                                        More than this sub-level holds - it counts as {gu(s.count)}.
                                      </span>
                                    )}
                                  </dd>
                                </div>
                                {/* Shown only when it is non-zero. `progressCount` is
                                    advisory: a CONTENT_MANAGER cannot read
                                    level4_activity_progress at all and sees 0 for a
                                    sub-level with plenty (level4Service.js), so a line
                                    reading "0 users" would be a claim this page is not
                                    entitled to make. */}
                                {a.progressCount > 0 && (
                                  <div>
                                    <dt>Worked on by</dt>
                                    <dd>{gu(a.progressCount)} user{a.progressCount === 1 ? '' : 's'}</dd>
                                  </div>
                                )}
                              </dl>

                              {previewId === a.id && (
                                /* The preview is the numbers a યુવક will be asked for, exactly as
                                   he will see them, in the order he will meet them — and nothing
                                   else, the same restraint §12 puts on the test screen itself. A
                                   Darshan withheld since this version was written has no such
                                   number left, so its chip falls back to the sheet's, marked `#`.
                                   Capped: a sub-level holding the whole collection is a card, not
                                   a wall. */
                                <div className="l4-chips">
                                  {(a.sceneIds || []).slice(0, PREVIEW).map((id) => (
                                    <span className="l4-chip" key={id}>{chipNumber(byId.get(id), id)}</span>
                                  ))}
                                  {s.count > PREVIEW && <span className="hint">+{gu(s.count - PREVIEW)} more</span>}
                                  {!s.count && <span className="hint">Nothing to preview.</span>}
                                </div>
                              )}

                              <div className="l4-node-actions">
                                <button
                                  className="btn btn-quiet"
                                  type="button"
                                  disabled={!mayEdit || busy || !config}
                                  onClick={() => openEditor(config)}
                                >
                                  Edit
                                </button>
                                <button
                                  className="btn btn-quiet"
                                  type="button"
                                  aria-expanded={previewId === a.id}
                                  onClick={() => setPreviewId(previewId === a.id ? '' : a.id)}
                                >
                                  {previewId === a.id ? 'Hide numbers' : 'Preview numbers'}
                                </button>
                                {a.active ? (
                                  <button
                                    className="btn btn-quiet"
                                    type="button"
                                    disabled={!mayEdit || busy || isArchived}
                                    onClick={() => setDialog({ kind: 'archive-activity', activity: a })}
                                  >
                                    Archive
                                  </button>
                                ) : (
                                  <button
                                    className="btn btn-quiet"
                                    type="button"
                                    disabled={!mayEdit || busy || isArchived}
                                    onClick={() => run(() => updateActivity(a.id, { active: true }), `${a.code} is active again.`)}
                                  >
                                    Restore
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </section>
                </>
              </AsyncBlock>
            </>
          )}

          {/* ------------------------------------------------------------ dialogs */}

          <ConfirmDialog
            open={dialog?.kind === 'clone'}
            title="Make an editable copy?"
            body={
              <>
                <p>
                  Version {gu(dialog?.cfg?.version ?? 0)} is live. It is not edited directly - a
                  copy is made as a new draft, and users go on with the live version until you
                  publish the copy.
                </p>
                <p style={{ marginTop: 8 }}>The copy carries every sub-level and every Darshan in them.</p>
              </>
            }
            confirmLabel="Copy and edit"
            busy={busy}
            onCancel={() => setDialog(null)}
            onConfirm={() =>
              run(async () => {
                const id = await cloneConfig(dialog.cfg.id);
                navigate(`/levels/4/config/${id}`);
              })
            }
          />

          <ConfirmDialog
            open={dialog?.kind === 'archive-activity'}
            title={`Archive ${dialog?.activity?.code || ''}?`}
            body={
              <>
                <p>
                  It stops being offered to users. It is not deleted: anyone who has already
                  finished it keeps that, and the Darshan in it still count towards later
                  sub-levels.
                </p>
                {!!dialog?.activity?.progressCount && (
                  <p style={{ marginTop: 8 }}>
                    {gu(dialog.activity.progressCount)} user
                    {dialog.activity.progressCount === 1 ? ' has' : 's have'} worked on this sub-level.
                  </p>
                )}
              </>
            }
            confirmLabel="Archive"
            busy={busy}
            onCancel={() => setDialog(null)}
            onConfirm={() => run(() => updateActivity(dialog.activity.id, { active: false }), `${dialog.activity.code} archived.`)}
          />

          <ConfirmDialog
            open={dialog?.kind === 'archive-config'}
            title={`Retire version ${gu(config?.version ?? 0)}?`}
            body="This draft is put away. Nothing about the live version changes, and no user is affected."
            confirmLabel="Retire it"
            busy={busy}
            onCancel={() => setDialog(null)}
            onConfirm={() => run(() => archiveConfig(config.id), 'Version retired.')}
          />

          {/*
            §57 — publishing is the one action on this page a user notices, so the dialog says
            exactly what is about to go live rather than "are you sure". Every number in it is
            counted from the version in front of the સંચાલક, never assumed.
          */}
          <ConfirmDialog
            open={dialog?.kind === 'publish'}
            title={`Publish version ${gu(config?.version ?? 0)}?`}
            danger={!!check?.warnings?.length}
            confirmLabel={check?.warnings?.length ? 'Publish anyway' : 'Publish'}
            busy={busy}
            onCancel={() => setDialog(null)}
            onConfirm={() => run(() => publishConfig(config.id), `Version ${gu(config.version)} is live.`)}
            body={
              <>
                <p>This is what users will get:</p>
                <ul style={{ margin: '8px 0 0 18px' }}>
                  <li>{gu(activeCount)} sub-levels</li>
                  <li>
                    {gu(covered.size)} of {gu(collection.length)} Darshan in the collection
                  </li>
                  {gate && (
                    <li>
                      Unlock:{' '}
                      {gate.require
                        ? `after ${gu(gate.threshold)} remembered in a single day`
                        : 'open to everyone'}{' '}
                      (set on the Levels page - publishing does not change it)
                    </li>
                  )}
                  {live && live.id !== config?.id && <li>Version {gu(live.version)} is retired at the same moment</li>}
                </ul>

                {/* "1 – 30" means two different things in this product — the numbers users
                    count through, and the numbers printed on the artwork — and the moment of
                    publishing is the wrong moment to be unsure which is being quoted. */}
                <p style={{ marginTop: 10 }}>
                  Each sub-level, numbered exactly as users see it - <strong>not</strong> the
                  numbers printed on the artwork:
                </p>
                <ul style={{ margin: '6px 0 0 18px' }}>
                  {activities
                    .filter((a) => a.active)
                    .slice(0, DIALOG_LIST)
                    .map((a) => {
                      const s = summarise(a.sceneIds || [], collection);
                      return (
                        <li key={a.id}>
                          {a.code}: {s.count
                            ? `Darshan ${gu(s.fromIndex)} – ${gu(s.toIndex)}${s.contiguous ? '' : ' (with gaps)'} · ${gu(s.count)} in all`
                            : 'nothing selected'}
                        </li>
                      );
                    })}
                  {activities.filter((a) => a.active).length > DIALOG_LIST && (
                    <li className="hint">
                      +{gu(activities.filter((a) => a.active).length - DIALOG_LIST)} more
                    </li>
                  )}
                </ul>
                {!!check?.warnings?.length && (
                  <p style={{ marginTop: 10 }}>
                    {gu(check.warnings.length)} warning
                    {check.warnings.length === 1 ? '' : 's'} was reported above and has not been
                    fixed. You can publish past it.
                  </p>
                )}
                <p style={{ marginTop: 10 }}>
                  Users who have already finished a sub-level keep it - nothing that has been
                  done is taken away.
                </p>
              </>
            }
          />
        </>
      </AsyncBlock>
    </>
  );
}

/** How many numbers a preview shows before it says "+N more" (see the card). */
const PREVIEW = 60;

/** How many sub-levels the publish dialog spells out before it says "+N more". */
const DIALOG_LIST = 12;

/**
 * The number to print on a preview chip: the one a user sees, or — for a Darshan withheld
 * since this version was written, which has none — the one printed on the artwork, marked
 * `#`. An id the collection has never heard of is shown as itself; `findInvalid` is already
 * saying so above, and inventing a number for it would hide that.
 */
function chipNumber(item, id) {
  if (!item) return id;
  if (Number.isInteger(item.displayIndex)) return gu(item.displayIndex);
  const source = Number.isInteger(item.sourceIndex) ? item.sourceIndex : item.index;
  return Number.isInteger(source) ? `#${gu(source)}` : id;
}

const STATUS_LABEL = {
  DRAFT: 'Draft',
  VALIDATED: 'Checked',
  PUBLISHED: 'Live',
  ARCHIVED: 'Retired',
};

/** Tone repeats what the label already says; it never carries the meaning alone (§56). */
const STATUS_TONE = {
  DRAFT: 'warn',
  VALIDATED: 'info',
  PUBLISHED: 'ok',
  ARCHIVED: 'off',
};
