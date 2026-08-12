import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { AsyncBlock } from '../../../components/StateBlocks';
import StatCard, { PageHeader } from '../../../components/StatCard';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { useAdminAuth } from '../../../lib/adminAuth';
import { gu } from '../../../lib/format';
import { applyImportPlan, configuredDriveFolderId, listDriveFolder, loadCollection, planFromText } from '../services/importService';
import { COLUMN_ROLES } from '../../../../../shared/domain/sheet-import.js';

/**
 * §12 — the bulk દર્શન importer. The સંચાલક pastes his spreadsheet and every દ્રશ્ય's image
 * and વર્ણન is set in one go.
 *
 * The gap this closes
 * -------------------
 * The વર્ણન for all 109 દ્રશ્યો already exist — in a Google Sheet, written by the સંચાલક,
 * updated by him whenever he changes his mind about a scene. Until now the only two routes
 * from that sheet to a યુવક's screen were `npm run content && npm run optimize` (a
 * fifty-minute re-encode and a deploy, which needs a developer) and the detail page's
 * વર્ણન box, one દ્રશ્ય at a time, 109 times. So in practice the sheet and the app drifted
 * apart and only a developer could reconcile them. This is the third route, and it is the
 * only one the સંચાલક can walk himself.
 *
 * Why the screen is shaped like this
 * ----------------------------------
 * One decision governs the whole layout: **preview before write, always** (§57). This
 * touches all 109 દ્રશ્યો at once. A mis-mapped column, a stale Drive folder or a paste that
 * lost its last fifty rows would each produce a mass overwrite that looks, in the audit log,
 * exactly like 109 deliberate edits. So the screen is three stages and the middle one is the
 * point of the feature:
 *
 *   paste / upload  →  a table of exactly what will change  →  apply, with progress
 *
 * Nothing is written until the confirm dialog is answered, and the table shows current vs
 * new for every row — including the rows where the answer is "no change", because a row
 * that changes nothing is information too: it is how the સંચાલક sees that his paste
 * actually reached દ્રશ્ય ૧૦૯ rather than stopping at ૫૦.
 *
 * The four rules the plan enforces live in shared/domain/sheet-import.js with their
 * reasoning — empty વર્ણન means "no change", an unknown ક્રમ is reported and never created,
 * an unmatched filename is reported and never skipped, and a no-op row is not written.
 */
export default function DarshanImportPage() {
  const { can } = useAdminAuth();
  const mayWrite = can('darshan.update');

  // The collection as it is right now. Every "current" value in the preview is read from
  // this, so it is deliberately re-read (state.retry) after an apply — a second preview
  // built against pre-import values would show every row as still needing the same change.
  const state = useAsync(() => loadCollection(), []);
  const items = state.data || [];

  const [text, setText] = useState('');
  const [stage, setStage] = useState('input'); // input → preview → done
  const [mapping, setMapping] = useState(null); // null = use what detection found
  const [headerRow, setHeaderRow] = useState(undefined); // undefined = use what detection found
  const [applyCaptions, setApplyCaptions] = useState(true);
  const [applyImages, setApplyImages] = useState(true);
  const [filter, setFilter] = useState('changes');

  const [drive, setDrive] = useState({ files: null, loading: false, error: null });
  const [msg, setMsg] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState(null); // {done,total} while writing
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  /**
   * The plan, rebuilt from scratch whenever anything it depends on moves.
   *
   * From scratch on purpose: a plan carried over from a previous mapping is precisely the
   * stale artefact the preview exists to rule out. It is 109 rows of string comparison —
   * there is nothing here worth caching against the risk of showing one paste's numbers
   * over another paste's data.
   */
  const plan = useMemo(() => {
    if (!text.trim()) return null;
    return planFromText(text, {
      items,
      driveFiles: drive.files,
      mapping,
      headerRow,
      applyCaptions,
      applyImages,
    });
  }, [text, items, drive.files, mapping, headerRow, applyCaptions, applyImages]);

  // Detection seeds the three selects; `mapping` only exists once the સંચાલક has overruled
  // it. Reading it back through the plan keeps one source of truth for what is in effect.
  const cols = plan?.columns || { index: null, file: null, caption: null };
  const header = plan?.sheet.header || [];
  const width = plan?.sheet.width || 0;
  const summary = plan?.summary;

  const needsMapping = plan && (cols.index === null || (cols.caption === null && cols.file === null));
  const needsDrive = applyImages && plan && plan.rows.some((r) => r.file) && !drive.files;

  const shown = useMemo(() => {
    const all = plan?.entries || [];
    if (filter === 'all') return all;
    if (filter === 'changes') return all.filter((e) => e.status === 'update');
    if (filter === 'problems') return all.filter((e) => e.status !== 'update' && e.status !== 'unchanged');
    return all.filter((e) => e.status === 'unchanged');
  }, [plan, filter]);

  async function loadDrive() {
    setDrive({ files: null, loading: true, error: null });
    try {
      // The folder from સેટિંગ્સ, not this function's own default — one place decides
      // where the artwork lives, and the સંચાલક can change it without a deploy.
      const files = await listDriveFolder(await configuredDriveFolderId());
      setDrive({ files, loading: false, error: null });
    } catch (e) {
      setDrive({ files: null, loading: false, error: e.message });
    }
  }

  async function apply() {
    setConfirm(false);
    setMsg(null);
    setProgress({ done: 0, total: summary.update });
    // One row's failure must not abandon the other hundred — applyImportPlan collects them
    // and this reports all of them together.
    const r = await applyImportPlan(plan.entries, setProgress);
    setProgress(null);
    setResult(r);
    setStage('done');
    state.retry();
  }

  return (
    <>
      <PageHeader
        title="Import from spreadsheet"
        sub="Paste the sheet — every Darshan's description and image is set in one go"
        actions={<Link className="btn btn-quiet" to="/darshan">← Darshan</Link>}
      />

      <AsyncBlock state={state} onRetry={state.retry}>
        {!mayWrite ? (
          <div className="card">
            <p>You can look at Darshan content, but changing it needs the “darshan.update” permission.</p>
          </div>
        ) : (
          <>
            {msg && <div className={`notice notice-${msg.tone}`} role="status">{msg.text}</div>}

            {/* ---------------------------------------------------------- 1. the paste */}
            <div className="card">
              <h2>1. The spreadsheet</h2>
              <div className="field">
                <label htmlFor="paste">Paste the rows (including the header row)</label>
                <textarea
                  id="paste"
                  rows={8}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    // A new paste invalidates the old mapping: the columns it named may not
                    // exist in this one, and a stale mapping is how the વર્ણન column ends up
                    // written into image_url.
                    setMapping(null);
                    setHeaderRow(undefined);
                    setStage('input');
                    setResult(null);
                  }}
                  placeholder={'ક્રમ\tફોટો ફાઈલ\tદ્રશ્ય-વર્ણન (વિગતવાર)\n1\tVarni(1)\tસમુદ્રના પ્રચંડ મોજાં…'}
                  style={{ fontFamily: 'inherit' }}
                />
                <span className="hint">
                  In Google Sheets: select the rows → Ctrl-C → paste here. Tabs and commas are both
                  understood, and a description spread over several lines stays one description.
                </span>
              </div>

              <div className="field">
                <label htmlFor="csv">…or choose a downloaded file</label>
                <input
                  id="csv"
                  type="file"
                  ref={fileRef}
                  accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      const content = await f.text();
                      setText(content);
                      setMapping(null);
                      setHeaderRow(undefined);
                      setStage('input');
                      setResult(null);
                    } catch {
                      setMsg({ tone: 'danger', text: 'That file could not be read.' });
                    }
                  }}
                />
                <span className="hint">
                  From Excel, save as <strong>CSV UTF-8</strong>. A “Unicode Text” export is UTF-16 and
                  the Gujarati will arrive as nonsense.
                </span>
              </div>

              {plan && (
                <p className="card-note">
                  Read as {plan.sheet.delimiterLabel}: {gu(plan.sheet.rows.length)} lines,{' '}
                  {gu(plan.rows.length)} Darshan rows
                  {plan.headerRow >= 0 ? `, header on line ${plan.headerRow + 1}` : ', no header row found'}.
                </p>
              )}
            </div>

            {/* ---------------------------------------------------------- 2. columns */}
            {plan && (
              <div className="card">
                <h2>2. Which column is which</h2>

                {/*
                  §62 — the columns are found by their header text, never by position. When
                  that fails the સંચાલક is asked rather than guessed at: writing the વર્ણન
                  column into image_url on 109 દ્રશ્યો is not something a wrong guess should
                  be allowed to do quietly.
                */}
                {needsMapping ? (
                  <div className="notice notice-warn" role="status">
                    The headings were not recognised, so nothing has been assumed. Point at the columns
                    yourself below — the first data row is shown under each one so you can check.
                  </div>
                ) : (
                  <p className="hint" style={{ marginBottom: 12 }}>
                    Recognised from the headings. Change any of them if a column has been read wrongly.
                  </p>
                )}

                <div className="filters">
                  {COLUMN_ROLES.map((role) => (
                    <div className="field" key={role}>
                      <label htmlFor={`col-${role}`}>{ROLE_LABEL[role]}</label>
                      <select
                        id={`col-${role}`}
                        value={cols[role] === null ? '' : String(cols[role])}
                        onChange={(e) => {
                          const v = e.target.value === '' ? null : Number(e.target.value);
                          setMapping({ ...cols, [role]: v });
                          setStage('input');
                        }}
                      >
                        <option value="">— not in this sheet —</option>
                        {Array.from({ length: width }, (_, c) => (
                          <option value={String(c)} key={c}>
                            {c + 1}. {String(header[c] ?? '').trim() || '(no heading)'}
                          </option>
                        ))}
                      </select>
                      <span className="hint">
                        {cols[role] === null
                          ? ROLE_HINT[role]
                          : `First value: ${sample(plan.rows, role) || '(empty)'}`}
                      </span>
                    </div>
                  ))}
                </div>

                <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={plan.headerRow >= 0}
                    onChange={(e) => {
                      setHeaderRow(e.target.checked ? 0 : -1);
                      setStage('input');
                    }}
                  />
                  The first line is a heading, not a Darshan
                </label>
              </div>
            )}

            {/* ---------------------------------------------------------- 3. drive */}
            {plan && (
              <div className="card">
                <h2>3. The image files</h2>
                <p className="hint" style={{ marginBottom: 12 }}>
                  The sheet names files like <span className="mono">Varni(1)</span>, not links — so the
                  Drive folder has to be read to find each one. Your browser cannot read Drive directly;
                  the server does it.
                </p>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button className="btn btn-quiet" type="button" disabled={drive.loading} onClick={loadDrive}>
                    {drive.loading ? 'Reading the folder…' : drive.files ? 'Read the folder again' : 'Read the Drive folder'}
                  </button>
                  {drive.files && (
                    <span className="hint">{gu(drive.files.length)} image files found.</span>
                  )}
                </div>

                {drive.error && (
                  <div className="notice notice-danger" role="status" style={{ marginTop: 12 }}>
                    {drive.error}
                  </div>
                )}
              </div>
            )}

            {/* ---------------------------------------------------------- 4. what to change */}
            {plan && (
              <div className="card">
                <h2>4. What to change</h2>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={applyCaptions}
                    onChange={(e) => { setApplyCaptions(e.target.checked); setStage('input'); }}
                  />
                  Descriptions (વર્ણન)
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={applyImages}
                    onChange={(e) => { setApplyImages(e.target.checked); setStage('input'); }}
                  />
                  Images
                </label>

                {/*
                  No warning here any more, and its absence is the point.

                  This used to carry one: an imported image became a single Google-CDN URL and
                  so lost the responsive AVIF/WebP ladder the local encoder had built for it,
                  which was a real cost the સંચાલક deserved to meet before paying it. Every
                  દ્રશ્ય is now served that same way by design, so importing images changes
                  the URL and nothing else — there is no ladder left to lose.
                */}
              </div>
            )}

            {/* ---------------------------------------------------------- preview */}
            {plan && stage === 'input' && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button
                  className="btn"
                  type="button"
                  disabled={!plan.rows.length || needsDrive}
                  onClick={() => { setStage('preview'); setResult(null); }}
                >
                  Preview the changes
                </button>
                {needsDrive && (
                  <span className="hint" style={{ alignSelf: 'center' }}>
                    Read the Drive folder first, or turn images off.
                  </span>
                )}
              </div>
            )}

            {plan && stage !== 'input' && (
              <>
                <div className="grid-stats">
                  <StatCard label="Will change" value={gu(summary.update)} tone={summary.update ? 'ok' : 'plain'} />
                  <StatCard label="No change" value={gu(summary.unchanged)} />
                  <StatCard
                    label="Problems"
                    value={gu(summary.noScene + summary.invalid + summary.duplicate + summary.unmatchedFiles.length)}
                    tone={summary.noScene + summary.invalid + summary.duplicate + summary.unmatchedFiles.length ? 'warn' : 'plain'}
                  />
                  <StatCard
                    label="Not in the sheet"
                    value={gu(summary.untouched)}
                    sub={`of ${summary.collection} Darshan`}
                  />
                </div>

                {/* Every problem, named. A silent skip is the failure this report exists for. */}
                <Problems summary={summary} entries={plan.entries} />

                <div className="filters">
                  <div className="field">
                    <label htmlFor="pf">Show</label>
                    <select id="pf" value={filter} onChange={(e) => setFilter(e.target.value)}>
                      <option value="changes">Only what will change ({summary.update})</option>
                      <option value="problems">Only problems</option>
                      <option value="unchanged">Only unchanged</option>
                      <option value="all">Everything ({summary.rows})</option>
                    </select>
                  </div>
                </div>

                <div className="table-wrap">
                  <table className="dt">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Darshan</th>
                        <th>Description (વર્ણન)</th>
                        <th>Image</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((e) => (
                        <tr key={`${e.line}-${e.n}`}>
                          <td className="mono">{e.line}</td>
                          <td className="mono">{e.id || `#${e.line}`}<br /><span className="hint">{e.n ?? '—'}</span></td>
                          <td><Diff before={e.caption.from} after={e.caption.to} changed={e.caption.changed} /></td>
                          <td><Diff before={e.image.from} after={e.image.to} changed={e.image.changed} mono /></td>
                          <td>
                            <StatusPill status={e.status} />
                            {e.notes.map((n, i) => (
                              <div className="hint" key={i}>{n}</div>
                            ))}
                          </td>
                        </tr>
                      ))}
                      {!shown.length && (
                        <tr><td colSpan={5} className="hint">Nothing in this view.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* ------------------------------------------------- apply */}
                {progress && (
                  <div className="notice notice-ok" role="status" style={{ marginTop: 16 }}>
                    Saving {gu(progress.done)} of {gu(progress.total)}… Leave this page open until it finishes.
                    <div><progress value={progress.done} max={progress.total} style={{ width: '100%' }} /></div>
                  </div>
                )}

                {result && <Result result={result} />}

                {!progress && !result && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button className="btn" type="button" disabled={!summary.update} onClick={() => setConfirm(true)}>
                      {summary.update ? `Apply ${summary.update} changes` : 'Nothing to apply'}
                    </button>
                    <button className="btn btn-quiet" type="button" onClick={() => setStage('input')}>
                      Back
                    </button>
                  </div>
                )}

                {result && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button
                      className="btn btn-quiet"
                      type="button"
                      onClick={() => {
                        // Straight back to the preview, now rebuilt against the values that
                        // were just written — so a retry after failures shows only the rows
                        // that are still outstanding.
                        setResult(null);
                        setStage('preview');
                      }}
                    >
                      Preview again
                    </button>
                    <Link className="btn btn-quiet" to="/darshan">Back to Darshan</Link>
                  </div>
                )}
              </>
            )}

            <ConfirmDialog
              open={confirm}
              title={`Apply ${summary?.update || 0} changes?`}
              body={
                `${summary?.captionChanges || 0} descriptions and ${summary?.imageChanges || 0} images will be changed across ` +
                `${summary?.update || 0} Darshan. Each one is recorded in the audit log under your name and can be changed back. ` +
                `Nothing else in the collection is touched.`
              }
              confirmLabel="Yes, apply"
              onConfirm={apply}
              onCancel={() => setConfirm(false)}
            />
          </>
        )}
      </AsyncBlock>
    </>
  );
}

const ROLE_LABEL = {
  index: 'Number (ક્રમ)',
  file: 'Image file (ફોટો ફાઈલ)',
  caption: 'Description (વર્ણન)',
};

const ROLE_HINT = {
  index: 'Required — it says which Darshan each row is.',
  file: 'Optional. Without it, only descriptions are imported.',
  caption: 'Optional. Without it, only images are imported.',
};

/** The first non-empty value in a role's column, so a wrong mapping is visible immediately. */
const sample = (rows, role) => {
  const key = role === 'index' ? 'n' : role;
  const hit = rows.find((r) => r[key] !== null && r[key] !== '');
  const v = hit ? String(hit[key]) : '';
  return v.length > 60 ? `${v.slice(0, 60)}…` : v;
};

/**
 * Current vs new, in one cell.
 *
 * The old value is shown even when nothing changes, because "this row is already right" and
 * "this row was skipped" are different facts and only one of them is reassuring.
 */
function Diff({ before, after, changed, mono = false }) {
  const cls = mono ? 'mono' : '';
  if (!after) return <span className="hint">{before ? truncate(before) : '—'}</span>;
  if (!changed) return <span className="hint">{truncate(before)} <em>(already this)</em></span>;
  return (
    <>
      <div className="hint" style={{ textDecoration: 'line-through' }} title={before}>
        {before ? truncate(before) : '(empty)'}
      </div>
      <div className={cls} title={after}>{truncate(after)}</div>
    </>
  );
}

const truncate = (s, n = 90) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));

function StatusPill({ status }) {
  if (status === 'update') return <span className="pill pill-ok">Will change</span>;
  if (status === 'unchanged') return <span className="pill pill-off">No change</span>;
  if (status === 'no-scene') return <span className="pill pill-warn">No such Darshan</span>;
  if (status === 'duplicate') return <span className="pill pill-warn">Duplicate number</span>;
  return <span className="pill pill-danger">Unusable row</span>;
}

/**
 * §29 — the findings, counted from the plan and named individually.
 *
 * Every one of these is a case where the import will *not* do what the sheet asked, and the
 * only unacceptable outcome is that the સંચાલક does not find out. So they are listed above
 * the table rather than left to be discovered by scrolling.
 */
function Problems({ summary, entries }) {
  const noScene = entries.filter((e) => e.status === 'no-scene');
  const invalid = entries.filter((e) => e.status === 'invalid');
  const dupes = entries.filter((e) => e.status === 'duplicate');
  const unmatched = summary.unmatchedFiles;

  if (!noScene.length && !invalid.length && !dupes.length && !unmatched.length) return null;

  return (
    <div className="card">
      <h2>Rows that need your attention</h2>
      <ul className="issue-list">
        {unmatched.length > 0 && (
          <li className="issue issue-warn">
            <span>
              <strong>{unmatched.length} image {unmatched.length === 1 ? 'name is' : 'names are'} not in the Drive folder</strong> —
              those Darshan keep their current image. {unmatched.join(', ')}
            </span>
          </li>
        )}
        {noScene.length > 0 && (
          <li className="issue issue-warn">
            <span>
              <strong>{noScene.length} {noScene.length === 1 ? 'row names a Darshan' : 'rows name Darshan'} that do not exist</strong> —
              nothing is created by an import. Numbers: {noScene.map((e) => e.n).join(', ')}. Add them from the
              Darshan list first, then import again.
            </span>
          </li>
        )}
        {dupes.length > 0 && (
          <li className="issue issue-error">
            <span>
              <strong>{dupes.length} duplicate {dupes.length === 1 ? 'number' : 'numbers'}</strong> — the later row is
              ignored, because two rows for one Darshan disagree about what it should say.
              Rows: {dupes.map((e) => e.line).join(', ')}.
            </span>
          </li>
        )}
        {invalid.length > 0 && (
          <li className="issue issue-error">
            <span>
              <strong>{invalid.length} {invalid.length === 1 ? 'row has' : 'rows have'} no usable number</strong> —
              rows {invalid.map((e) => e.line).join(', ')}. Check that the number column is mapped correctly.
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

/** §53 — what actually happened, per row, including everything that failed. */
function Result({ result }) {
  const { ok, failed, total } = result;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Result</h2>
      <div className={`notice notice-${failed.length ? 'warn' : 'ok'}`} role="status">
        {gu(ok.length)} of {gu(total)} Darshan updated
        {failed.length ? `, ${gu(failed.length)} failed.` : '. Every change is in the audit log.'}
      </div>
      {failed.length > 0 && (
        <>
          <p className="hint" style={{ marginBottom: 8 }}>
            These were not saved. The rest were — nothing was rolled back, so importing again will
            retry only what is still outstanding.
          </p>
          <ul className="issue-list">
            {failed.map((f) => (
              <li className="issue issue-error" key={f.id}>
                <span className="mono">{f.id}</span>
                <span>{f.message}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
