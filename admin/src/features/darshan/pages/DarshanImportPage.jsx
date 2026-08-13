import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { AsyncBlock, Empty, FormSkeleton } from '../../../components/StateBlocks';
import StatCard, { PageHeader } from '../../../components/StatCard';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { useAdminAuth } from '../../../lib/adminAuth';
import { gu } from '../../../lib/format';
import { applyImportPlan, configuredDriveFolderId, listDriveFolder, loadCollection, planFromSheet, readImportFile } from '../services/importService';
import {
  CONFLICT_CHOICES,
  CONFLICT_LABELS,
  DEFAULT_CONFLICT_CHOICE,
  SHEET_ROLES,
  conflictEntries,
  firstAllowedMode,
  importModeOptions,
} from '../../../../../shared/domain/sheet-import.js';
import '../darshan.css';

/**
 * §12 — the bulk દર્શન importer. The સંચાલક brings his spreadsheet and every દ્રશ્ય it names
 * is created or brought up to date in one go.
 *
 * The gap this closes
 * -------------------
 * The વર્ણન for all of the દ્રશ્યો already exist — in a Google Sheet, written by the સંચાલક,
 * updated by him whenever he changes his mind about a scene. Until now the only two routes
 * from that sheet to a યુવક's screen were `npm run content && npm run optimize` (a re-encode
 * and a deploy, which needs a developer) and the detail page's વર્ણન box, one દ્રશ્ય at a
 * time, a hundred times. So in practice the sheet and the app drifted apart and only a
 * developer could reconcile them. This is the third route, and it is the only one the
 * સંચાલક can walk himself.
 *
 * Why the screen is shaped like this
 * ----------------------------------
 * One decision governs the whole layout: **preview before write, always** (EXCEL_CONTRACT §5).
 * This touches the entire collection at once. A mis-mapped column, a stale Drive folder or a
 * file that lost its last fifty rows would each produce a mass overwrite that looks, in the
 * audit log, exactly like a hundred deliberate edits. So the screen is a procedure and its
 * middle is the point of the feature:
 *
 *   choose the file  →  a table of exactly what will change  →  apply, with progress
 *
 * §24 — that procedure is *drawn*, as six numbered steps with a rail across the top, and the
 * numbering is the only thing that was added. The stages underneath are the same three the
 * `stage` state machine always had (input → preview → done); `stepState` is a reading of it
 * and of `plan`, `drive` and `result`, and it decides nothing. What changed is that the
 * સંચાલક can now see, on the first screen, that there are six things ahead of him and that
 * only the sixth writes — where before he met a column of unnumbered cards and could not tell
 * which of them was the point of no return. Step 4 is shown as "not needed" rather than
 * removed when the file carries links instead of file names, because a step that disappears
 * renumbers every step after it.
 *
 * Nothing is written until the confirm dialog is answered, and the table shows current vs new
 * for every row — including the rows where the answer is "no change", because a row that
 * changes nothing is information too: it is how the સંચાલક sees that his file actually reached
 * the last દ્રશ્ય rather than stopping at the fiftieth.
 *
 * Three things this screen refuses to decide for him, each with its own control:
 *
 *   **which column is which**  found by heading, never by position, and shown as a select he
 *     can correct. A wrong guess writes the વર્ણન column into the image link on every row.
 *   **what a new row means**   CREATE_ONLY / UPDATE_ONLY / UPSERT (§4). The mode he lacks the
 *     permission for is offered disabled, with the permission named.
 *   **a duplicate number**     §7. Skip by default, never a silent overwrite.
 */
export default function DarshanImportPage() {
  const { can } = useAdminAuth();
  const modes = useMemo(() => importModeOptions(can), [can]);
  const mayImport = modes.some((m) => m.allowed);

  // The collection as it is right now. Every "current" value in the preview is read from
  // this, so it is deliberately re-read (state.retry) after an apply — a second preview
  // built against pre-import values would show every row as still needing the same change.
  const state = useAsync(() => loadCollection(), []);
  const items = state.data || [];

  const [text, setText] = useState('');
  const [rows, setRows] = useState(null); // cells, when the file was a workbook
  const [fileName, setFileName] = useState('');
  const [stage, setStage] = useState('input'); // input → preview → done
  const [mapping, setMapping] = useState(null); // null = use what detection found
  const [headerRow, setHeaderRow] = useState(undefined); // undefined = use what detection found
  const [mode, setMode] = useState(() => firstAllowedMode(can) || 'UPSERT');
  const [filter, setFilter] = useState('changes');

  // §7's answers. Per row, plus the "apply to all remaining" fallback.
  const [conflictChoices, setConflictChoices] = useState({});
  const [conflictFallback, setConflictFallback] = useState(DEFAULT_CONFLICT_CHOICE);

  const [drive, setDrive] = useState({ files: null, loading: false, error: null });
  const [msg, setMsg] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState(null); // {done,total} while writing
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  /**
   * The plan, rebuilt from scratch whenever anything it depends on moves.
   *
   * From scratch on purpose: a plan carried over from a previous mapping — or a previous
   * mode, or a previous answer to a duplicate — is precisely the stale artefact the preview
   * exists to rule out. It is a few hundred rows of string comparison; there is nothing here
   * worth caching against the risk of showing one file's numbers over another file's data.
   */
  const plan = useMemo(() => {
    if (!rows && !text.trim()) return null;
    return planFromSheet({
      text,
      rows,
      items,
      mapping,
      headerRow,
      mode,
      driveFiles: drive.files,
      conflictChoices,
      conflictFallback,
    });
  }, [text, rows, items, mapping, headerRow, mode, drive.files, conflictChoices, conflictFallback]);

  // Detection seeds the selects; `mapping` only exists once the સંચાલક has overruled it.
  // Reading it back through the plan keeps one source of truth for what is in effect.
  const cols = plan?.columns || {};
  const header = plan?.sheet.header || [];
  const width = plan?.sheet.width || 0;
  const counts = plan?.counts;
  const conflicts = plan ? conflictEntries(plan.entries) : [];

  // A file with neither an Item ID nor a ક્રમ column cannot say which દ્રશ્ય any row is about.
  const needsMapping = plan && cols.id === null && cols.index === null;
  const writable = (counts?.create || 0) + (counts?.update || 0);
  const noFileColumn = cols.file === null || cols.file === undefined;

  /**
   * How many rows have something to say about themselves — a number that already belongs to
   * another દ્રશ્ય, a row the planner refused, or a warning against one of its cells.
   *
   * It is the *exact* predicate the "problems" filter below already uses, lifted out so the
   * option can carry its own count and so the summary can name a figure that agrees with the
   * table underneath it. Nothing new is counted here and nothing is estimated: every number
   * on this screen comes from the plan the planner returned (§62, EXCEL_CONTRACT §5).
   */
  const flagged = useMemo(
    () => (plan?.entries || []).filter((e) => e.action === 'error' || e.conflict || (e.issues || []).length).length,
    [plan]
  );

  /**
   * §24 — where in the six steps the સંચાલક actually is, read straight off the state machine
   * that was already here. This decides nothing. `plan`, `needsMapping`, `stage`, `drive` and
   * `result` are the same values the cards below were already switching on; naming them lets
   * the rail at the top draw the shape of the journey before he has walked any of it, which is
   * the whole difference between a long form and a procedure.
   *
   * Step 4 is `skip` rather than absent when the file names images by link instead of by file
   * name. A step that vanishes renumbers the ones after it, and a numbered flow whose numbers
   * move is worse than one with a step in it that says "not needed".
   */
  const stepState = {
    1: plan ? 'done' : 'now',
    2: !plan ? 'wait' : needsMapping ? 'now' : 'done',
    3: !plan ? 'wait' : 'done',
    4: !plan ? 'wait' : noFileColumn ? 'skip' : drive.files ? 'done' : 'now',
    5: !plan ? 'wait' : stage === 'input' ? 'now' : 'done',
    6: result ? 'done' : !plan || stage === 'input' ? 'wait' : 'now',
  };

  /** Everything downstream of the file is invalidated when the file changes. */
  function reset() {
    setMapping(null);
    setHeaderRow(undefined);
    setConflictChoices({});
    setConflictFallback(DEFAULT_CONFLICT_CHOICE);
    setStage('input');
    setResult(null);
  }

  const shown = useMemo(() => {
    const all = plan?.entries || [];
    if (filter === 'all') return all;
    if (filter === 'changes') return all.filter((e) => e.action === 'create' || e.action === 'update');
    if (filter === 'problems') return all.filter((e) => e.action === 'error' || e.conflict || (e.issues || []).length);
    return all.filter((e) => e.action === 'skip');
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

  async function chooseFile(f) {
    if (!f) return;
    setMsg(null);
    try {
      const read = await readImportFile(f);
      // Exactly one of the two survives, so the plan cannot be built from a stale half of a
      // previous file when the સંચાલક swaps a workbook for a paste.
      setRows(read.rows);
      setText(read.text);
      setFileName(read.name);
      reset();
    } catch (e) {
      setMsg({ tone: 'danger', text: e.message || 'That file could not be read.' });
    }
  }

  async function apply() {
    setConfirm(false);
    setMsg(null);
    setProgress({ done: 0, total: writable });
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
        sub="Bring an Excel file, a CSV or a paste - every Darshan it names is set in one go"
        crumbs={[{ to: '/darshan', label: 'Darshan' }, { label: 'Import' }]}
        actions={<Link className="btn btn-quiet" to="/darshan">← All Darshan</Link>}
      />

      <AsyncBlock state={state} onRetry={state.retry} skeleton={<FormSkeleton fields={3} />}>
        {!mayImport ? (
          /* §10 — a refusal is a sentence naming what is missing, not a blank page. */
          <Empty
            icon="🔒"
            title="Importing is not open to your role"
            message="You can look at Darshan content, but importing needs the “darshan.update” permission to change existing items, or “darshan.create” to add new ones."
            action={<Link className="btn btn-quiet" to="/darshan">Back to all Darshan</Link>}
          />
        ) : (
          <>
            {msg && (
              <div className={`notice notice-${msg.tone}`} role={msg.tone === 'danger' ? 'alert' : 'status'}>
                {msg.text}
              </div>
            )}

            {/*
              The rail. Six steps, always all six, so the length of what he is agreeing to is
              visible from the first screen rather than discovered one card at a time. It is a
              reading of `stepState` and nothing else — pressing it does nothing, because every
              step is entered by finishing the one before it.
            */}
            <ol className="dsteps" aria-label="Import steps">
              {STEPS.map((s) => (
                <li
                  key={s.n}
                  className={`is-${stepState[s.n]}`}
                  aria-current={stepState[s.n] === 'now' ? 'step' : undefined}
                >
                  <span className="dstep-n" aria-hidden="true">
                    {stepState[s.n] === 'done' ? '✓' : s.n}
                  </span>
                  <span>{s.short}</span>
                  {/* The tick and the tint are repeated in words, because neither is available
                      to somebody listening to the page rather than looking at it (§43, §56). */}
                  <span className="sr-only">- {STEP_WORD[stepState[s.n]]}</span>
                </li>
              ))}
            </ol>

            {/* ---------------------------------------------------------- 1. the file */}
            <Step n={1} title="The spreadsheet" state={stepState[1]}>
              <div className="field">
                <label htmlFor="csv">Choose a file</label>
                <input
                  id="csv"
                  type="file"
                  ref={fileRef}
                  accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values,text/plain"
                  onChange={(e) => chooseFile(e.target.files?.[0])}
                />
                <span className="hint">
                  An Excel workbook (<strong>.xlsx</strong>) is read directly - there is no need to save
                  it as anything first. A <strong>.csv</strong> or <strong>.tsv</strong> works too. Only
                  the first worksheet of a workbook is read.
                </span>
              </div>

              <div className="field">
                <label htmlFor="paste">…or paste the rows (including the heading row)</label>
                <textarea
                  id="paste"
                  rows={8}
                  value={rows ? '' : text}
                  disabled={!!rows}
                  onChange={(e) => {
                    setText(e.target.value);
                    setRows(null);
                    setFileName('');
                    // A new paste invalidates the old mapping: the columns it named may not
                    // exist in this one, and a stale mapping is how the વર્ણન column ends up
                    // written into the image link.
                    reset();
                  }}
                  placeholder={'ક્રમ\tફોટો ફાઈલ\tદ્રશ્ય-વર્ણન (વિગતવાર)\n1\tVarni(1)\tસમુદ્રના પ્રચંડ મોજાં…'}
                  /* The panel's own family, not a monospace default: the placeholder and the
                     paste are both Gujarati, and a monospace stack has no Gujarati face in it. */
                  style={{ fontFamily: 'var(--font)' }}
                />
                <span className="hint">
                  In Google Sheets: select the rows → Ctrl-C → paste here. Tabs and commas are both
                  understood, and a description spread over several lines stays one description.
                </span>
              </div>

              {(rows || fileName) && (
                <p className="card-note d-actions">
                  <span className="grow">Reading <strong>{fileName}</strong>.</span>
                  <button
                    className="btn btn-quiet btn-sm"
                    type="button"
                    onClick={() => {
                      setRows(null);
                      setText('');
                      setFileName('');
                      if (fileRef.current) fileRef.current.value = '';
                      reset();
                    }}
                  >
                    Choose another
                  </button>
                </p>
              )}

              {/* What was actually read, counted by the reader rather than promised by the
                  screen — the first place a truncated file or a wrong delimiter shows up. */}
              {plan && (
                <p className="notice notice-ok" role="status">
                  Read as {plan.sheet.delimiterLabel}: {gu(plan.sheet.rows.length)} lines,{' '}
                  {gu(plan.records.length)} Darshan rows
                  {plan.headerRow >= 0 ? `, heading on line ${plan.headerRow + 1}` : ', no heading row found'}.
                </p>
              )}
            </Step>

            {/* ---------------------------------------------------------- 2. columns */}
            {plan && (
              <Step n={2} title="Which column is which" state={stepState[2]}>

                {/*
                  §62 — the columns are found by their heading text, never by position. When
                  that fails the સંચાલક is asked rather than guessed at: writing the વર્ણન
                  column into the image link on a hundred દ્રશ્યો is not something a wrong
                  guess should be allowed to do quietly.
                */}
                {needsMapping ? (
                  <div className="notice notice-warn" role="alert">
                    Nothing here says which Darshan each row is about. Point at the <strong>Item ID</strong>{' '}
                    column or the <strong>Index Number</strong> column below - the first value in each is
                    shown underneath so you can check.
                  </div>
                ) : (
                  <p className="hint d-note">
                    Recognised from the headings. Change any of them if a column has been read wrongly.
                    A column left as “not in this file” is not touched on any Darshan.
                  </p>
                )}

                <div className="filters">
                  {SHEET_ROLES.map((role) => (
                    <div className="field" key={role}>
                      <label htmlFor={`col-${role}`}>{ROLE_LABEL[role]}</label>
                      <select
                        id={`col-${role}`}
                        value={cols[role] === null || cols[role] === undefined ? '' : String(cols[role])}
                        onChange={(e) => {
                          const v = e.target.value === '' ? null : Number(e.target.value);
                          setMapping({ ...cols, [role]: v });
                          setStage('input');
                        }}
                      >
                        <option value="">- not in this file -</option>
                        {Array.from({ length: width }, (_, c) => (
                          <option value={String(c)} key={c}>
                            {c + 1}. {String(header[c] ?? '').trim() || '(no heading)'}
                          </option>
                        ))}
                      </select>
                      <span className="hint">
                        {cols[role] === null || cols[role] === undefined
                          ? ROLE_HINT[role]
                          : `First value: ${sample(plan.records, role) || '(empty)'}`}
                      </span>
                    </div>
                  ))}
                </div>

                <label className="check">
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
              </Step>
            )}

            {/* ---------------------------------------------------------- 3. mode */}
            {plan && (
              <Step n={3} title="What this import may do" state={stepState[3]}>
                <p className="hint d-note">
                  A row whose <strong>Item ID</strong> is filled in names a Darshan that already exists.
                  A row with it left blank is a new one.
                </p>

                {modes.map((m) => (
                  <label key={m.mode} className={`d-choice ${m.allowed ? '' : 'is-off'}`}>
                    <input
                      type="radio"
                      name="import-mode"
                      value={m.mode}
                      checked={mode === m.mode}
                      disabled={!m.allowed}
                      onChange={() => { setMode(m.mode); setStage('input'); }}
                    />
                    <span>
                      <strong>{m.label}</strong>
                      <div className="hint">{m.detail}</div>
                      {/* Disabled and explained, never hidden — a greyed choice with no reason
                          beside it is indistinguishable from a broken panel. */}
                      {!m.allowed && <div className="hint">{m.reason}</div>}
                    </span>
                  </label>
                ))}
              </Step>
            )}

            {/* ---------------------------------------------------------- 4. drive */}
            {plan && (
              <Step n={4} title="The image files" state={stepState[4]}>
                {noFileColumn ? (
                  /* Rendered rather than removed, so the numbering below it never shifts —
                     and so "no folder to read" is something he is told rather than something
                     he has to infer from a step that is not there. */
                  <p className="hint">
                    This file gives each image by Drive link or file ID, so there is no folder to
                    read. Nothing is needed at this step.
                  </p>
                ) : (
                  <>
                    <p className="hint d-note">
                      This file names images like <span className="mono">Varni(1)</span> rather than by link,
                      so the Drive folder has to be read to find each one. Your browser cannot read Drive
                      directly; the server does it. A row that gives a Drive file ID or link instead needs
                      none of this.
                    </p>

                    <div className="d-actions">
                      <button
                        className={`btn btn-quiet ${drive.loading ? 'is-busy' : ''}`}
                        type="button"
                        disabled={drive.loading}
                        onClick={loadDrive}
                      >
                        {drive.loading ? 'Reading the folder…' : drive.files ? 'Read the folder again' : 'Read the Drive folder'}
                      </button>
                      {drive.files && <span className="hint" role="status">{gu(drive.files.length)} image files found.</span>}
                    </div>

                    {drive.error && (
                      <div className="notice notice-danger" role="alert">{drive.error}</div>
                    )}
                  </>
                )}
              </Step>
            )}

            {/* ---------------------------------------------------------- 5. preview */}
            {plan && (
              <Step n={5} title="Preview every change" state={stepState[5]}>
                {stage === 'input' ? (
                  <>
                    <p className="hint d-note">
                      Nothing is written by this. It builds the table of exactly what would change,
                      row by row, and the import is confirmed from there.
                    </p>
                    <div className="d-actions">
                      <button
                        className="btn"
                        type="button"
                        disabled={!plan.records.length || needsMapping || plan.needsDriveFolder}
                        onClick={() => { setStage('preview'); setResult(null); }}
                      >
                        Preview the changes
                      </button>
                      {plan.needsDriveFolder && (
                        <span className="hint">
                          Read the Drive folder first, or unmap the image-file column.
                        </span>
                      )}
                      {needsMapping && (
                        <span className="hint">
                          Point step 2 at the Item ID or the Index Number column first.
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    {/* EXCEL_CONTRACT §5 — every one of these is counted over the rows the
                        planner produced. None of them is assumed, rounded or carried over
                        from a previous file. */}
                    <div className="grid-stats">
                      <StatCard label="Total rows" value={gu(counts.total)} />
                      <StatCard label="New" value={gu(counts.create)} tone={counts.create ? 'ok' : 'plain'} />
                      <StatCard label="Updated" value={gu(counts.update)} tone={counts.update ? 'ok' : 'plain'} />
                      <StatCard label="Skipped" value={gu(counts.skip)} />
                      <StatCard label="Errors" value={gu(counts.error)} tone={counts.error ? 'danger' : 'plain'} />
                      <StatCard
                        label="Duplicate numbers"
                        value={gu(conflicts.length)}
                        tone={conflicts.length ? 'warn' : 'plain'}
                        sub={conflicts.length ? 'Answer each one below' : undefined}
                      />
                    </div>

                    {/* §7 — never silently overwritten. */}
                    {conflicts.length > 0 && (
                      <Duplicates
                        entries={conflicts}
                        choices={conflictChoices}
                        fallback={conflictFallback}
                        noIdColumn={cols.id === null || cols.id === undefined}
                        onChoose={(row, choice) => setConflictChoices((c) => ({ ...c, [row]: choice }))}
                        onFallback={setConflictFallback}
                      />
                    )}

                    {plan.cancelled && (
                      <div className="notice notice-warn" role="alert">
                        The import is cancelled - nothing will be written. Choose a different answer above,
                        or go back and pick another file.
                      </div>
                    )}

                    <div className="filters">
                      <div className="field">
                        <label htmlFor="pf">Show</label>
                        <select id="pf" value={filter} onChange={(e) => setFilter(e.target.value)}>
                          <option value="changes">Only what will change ({writable})</option>
                          <option value="problems">Only rows with something to say ({flagged})</option>
                          <option value="unchanged">Only unchanged ({counts.skip})</option>
                          <option value="all">Everything ({counts.total})</option>
                        </select>
                      </div>
                    </div>

                    {/* Below 900px admin.css turns every row into a card and reads the column
                        name out of `data-label` — without them the phone view is four
                        unlabelled lines per row. */}
                    <div className="table-wrap">
                      <table className="dt">
                        <thead>
                          <tr>
                            <th>Row</th>
                            <th>Darshan</th>
                            <th>What changes</th>
                            <th>Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shown.map((e) => (
                            <tr key={e.rowNumber}>
                              <td className="mono" data-label="Row">{e.rowNumber}</td>
                              <td className="mono" data-label="Darshan">{e.id || '-'}</td>
                              <td data-label="What changes"><Changes entry={e} /></td>
                              <td data-label="Result">
                                <ActionPill action={e.action} />
                                {/* §5 — per-row detail naming the field at fault, not just the row. */}
                                {(e.issues || []).map((i, n) => (
                                  <div className="hint" key={n}>
                                    {FIELD_LABEL[i.field] ? `${FIELD_LABEL[i.field]}: ` : ''}{i.message}
                                  </div>
                                ))}
                              </td>
                            </tr>
                          ))}
                          {!shown.length && (
                            <tr>
                              <td colSpan={4} className="hint">
                                No rows in this view. Choose a different Show above.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </Step>
            )}

            {/* ---------------------------------------------------------- 6. apply */}
            {plan && stage !== 'input' && (
              <Step n={6} title="Import, and what it did" state={stepState[6]}>
                {progress && (
                  <div className="notice notice-ok" role="status">
                    Saving {gu(progress.done)} of {gu(progress.total)}… Leave this page open until it finishes.
                    <progress className="d-progress" value={progress.done} max={progress.total} />
                  </div>
                )}

                {result && <Result result={result} />}

                {!progress && !result && (
                  <>
                    <p className="hint d-note">
                      This is the only step that writes anything, and it asks once more before it
                      does. Every row it changes is recorded in the audit log under your name.
                    </p>
                    <div className="d-actions">
                      <button
                        className="btn"
                        type="button"
                        disabled={!writable || plan.cancelled}
                        onClick={() => setConfirm(true)}
                      >
                        {writable ? `Apply ${writable} changes` : 'Nothing to apply'}
                      </button>
                      <button className="btn btn-quiet" type="button" onClick={() => setStage('input')}>
                        Back to the file
                      </button>
                    </div>
                  </>
                )}

                {result && (
                  <div className="d-actions">
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
              </Step>
            )}

            <ConfirmDialog
              open={confirm}
              title={`Apply ${writable} changes?`}
              body={
                `${counts?.create || 0} Darshan will be added and ${counts?.update || 0} changed. ` +
                'Each one is recorded in the audit log under your name and can be changed back. ' +
                `The other ${counts?.skip || 0} rows in the file are left alone, and nothing else in the collection is touched.`
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

/**
 * §24 — the six steps, named once.
 *
 * The rail and the cards read from the same list, so a step cannot be called one thing at the
 * top of the page and another thing halfway down it. `short` is what the rail shows, because
 * six full titles do not fit on a phone and a rail that wraps to four lines is a rail nobody
 * reads.
 */
const STEPS = [
  { n: 1, short: 'File' },
  { n: 2, short: 'Columns' },
  { n: 3, short: 'Rules' },
  { n: 4, short: 'Images' },
  { n: 5, short: 'Preview' },
  { n: 6, short: 'Import' },
];

/** The tick and the tint said in words, for anyone who has neither (§43, §56). */
const STEP_WORD = { done: 'done', now: 'you are here', wait: 'not started', skip: 'not needed' };

const STEP_TONE = { done: 'ok', now: 'info', wait: 'off', skip: 'off' };

/**
 * One numbered step. A `.card` like every other section of the panel, with a number, a state
 * and its own heading — the number is what ties it to the rail above, and the state pill is
 * what stops the whole screen reading as one undifferentiated form.
 *
 * It renders whatever it is given and knows nothing about the import; every caller decides
 * for itself what belongs inside its own step.
 */
function Step({ n, title, state, children }) {
  return (
    <section className={`card dstep is-${state}`} aria-labelledby={`step-${n}-h`}>
      <div className="dstep-head">
        <span className="dstep-n" aria-hidden="true">{state === 'done' ? '✓' : n}</span>
        <h2 id={`step-${n}-h`}>{n}. {title}</h2>
        <span className={`pill pill-${STEP_TONE[state]} dstep-state`}>{STEP_WORD[state]}</span>
      </div>
      {children}
    </section>
  );
}

/** Both languages on every label: the file may be prepared by somebody who reads only one. */
const ROLE_LABEL = {
  id: 'Item ID (આઈડી)',
  index: 'Index Number (ક્રમ)',
  title: 'Title (શીર્ષક)',
  caption: 'Description (વર્ણન)',
  driveId: 'Google Drive file ID',
  driveUrl: 'Google Drive link',
  order: 'Display Order (ક્રમાંક)',
  status: 'Status (સ્થિતિ)',
  file: 'Image file name (ફોટો ફાઈલ)',
};

const ROLE_HINT = {
  id: 'Says which Darshan a row is about. Leave a row’s cell blank to add a new one.',
  index: 'The printed number. Required for a row that adds a new Darshan.',
  title: 'Optional. The short name shown above the description.',
  caption: 'Optional. The description a યુવક reads.',
  driveId: 'Optional. The file id on its own - this wins if the link disagrees with it.',
  driveUrl: 'Optional. A Drive “share” link; the file id is taken out of it.',
  order: 'Optional. Where the Darshan sits in the sequence - not the same as the number.',
  status: 'Optional. DRAFT, VALIDATED, PUBLISHED, ACTIVE or DISABLED.',
  file: 'Optional. A file name in the Drive folder, like Varni(1).',
};

const FIELD_LABEL = {
  id: 'Item ID',
  index: 'Index Number',
  title: 'Title',
  caption: 'Description',
  driveId: 'Drive file ID',
  driveUrl: 'Drive link',
  order: 'Display Order',
  status: 'Status',
  file: 'Image file',
};

/** Which key on a row record a column role reads. `index` is stored as `n` for the older planner. */
const RECORD_KEY = { index: 'n' };

/** The first non-empty value in a role's column, so a wrong mapping is visible immediately. */
const sample = (records, role) => {
  const key = RECORD_KEY[role] || role;
  const hit = records.find((r) => r[key] !== null && r[key] !== undefined && r[key] !== '');
  const v = hit ? String(hit[key]) : '';
  return v.length > 60 ? `${v.slice(0, 60)}…` : v;
};

const truncate = (s, n = 70) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));

/**
 * Every field this row would write, current vs new.
 *
 * The old value is shown alongside the new one and not instead of it. "This row is already
 * right" and "this row was skipped" are different facts and only one of them is reassuring,
 * so a row with nothing to change says so rather than showing an empty cell.
 */
function Changes({ entry }) {
  const patch = entry.patch || {};
  const keys = Object.keys(patch);
  if (!keys.length) return <span className="hint">-</span>;

  return (
    <>
      {keys.map((k) => {
        const before = entry.before?.[k];
        const after = k === 'imageUrl' ? entry.image?.to ?? patch[k] : patch[k];
        return (
          <div key={k} className="d-change">
            <span className="hint">{FIELD_LABEL[k] || k}: </span>
            {before !== undefined && before !== '' && (
              /* Struck through, not merely greyed: the strike survives a screen that cannot
                 tell the two greys apart, and it is what says "this goes away" (§43). */
              <span className="hint d-was" title={String(before)}>
                {truncate(before)}{' '}
              </span>
            )}
            <span className={k === 'imageUrl' || k === 'driveId' || k === 'sourceDriveUrl' ? 'mono' : ''} title={String(after)}>
              {truncate(after)}
            </span>
          </div>
        );
      })}
    </>
  );
}

function ActionPill({ action }) {
  if (action === 'create') return <span className="pill pill-ok">Will be added</span>;
  if (action === 'update') return <span className="pill pill-ok">Will change</span>;
  if (action === 'error') return <span className="pill pill-danger">Cannot be used</span>;
  return <span className="pill pill-off">Skipped</span>;
}

/**
 * EXCEL_CONTRACT §7 — an imported number that already belongs to a different દ્રશ્ય.
 *
 * Not an error and not a change to be made quietly: it is a question, because only the
 * સંચાલક knows whether he is renumbering the collection on purpose or has pasted the wrong
 * column. Skip is the default, so a question nobody answered writes nothing.
 *
 * "Cancel the import" is offered per row like the other two, and means the whole import —
 * it is the answer for "this is not the file I meant", where carrying on with the other rows
 * is not a lesser version of what was asked for.
 *
 * A file with no Item ID column puts *every* matching row here, and that is correct rather
 * than a fault: without the join key, "row 27 carries the number 27" and "row 27 is
 * darshan-027" are different claims, and only the સંચાલક can say which he meant. The
 * "apply to all remaining" control is what makes answering a hundred of them one action — so
 * it sits above the list, and the list is capped, because a hundred identical questions
 * rendered in full is a wall rather than a report.
 */
const CONFLICT_LIST_CAP = 25;

function Duplicates({ entries, choices, fallback, noIdColumn, onChoose, onFallback }) {
  const listed = entries.slice(0, CONFLICT_LIST_CAP);
  const hidden = entries.length - listed.length;

  return (
    /* A block inside step 5 rather than a card of its own: it is a question the preview
       raised, and a separately-framed card between two numbered steps reads as a seventh
       step that nobody numbered. */
    <div className="d-block">
      <h3>Numbers that already belong to something else</h3>
      <p className="hint d-note">
        {entries.length === 1 ? 'One row claims a number' : `${entries.length} rows claim numbers`} that another
        Darshan already holds. Nothing is written until you have answered and confirmed the whole plan.
      </p>
      {noIdColumn && (
        <p className="hint d-note">
          This file has no <strong>Item ID</strong> column, so nothing in it says whether a row means
          “change the Darshan that already has this number” or “add another one”. If it is your usual
          sheet and you are updating what is already there, choose{' '}
          <strong>{CONFLICT_LABELS.update}</strong> below and it applies to every row at once.
        </p>
      )}

      <div className="field" style={{ maxWidth: '360px' }}>
        <label htmlFor="conflict-all">Apply to all remaining</label>
        <select id="conflict-all" value={fallback} onChange={(e) => onFallback(e.target.value)}>
          {CONFLICT_CHOICES.map((c) => (
            <option value={c} key={c}>{CONFLICT_LABELS[c]}</option>
          ))}
        </select>
        <span className="hint">Used for every row you have not answered individually.</span>
      </div>

      <ul className="issue-list">
        {listed.map((e) => (
          <li className="issue issue-warn" key={e.rowNumber}>
            <span>
              <strong>Row {e.rowNumber}</strong> - {e.conflict.message}
              {e.conflict.existingTitle ? ` (“${truncate(e.conflict.existingTitle, 40)}”)` : ''}
              <div className="d-inline-choices">
                {CONFLICT_CHOICES.map((c) => (
                  <label className="hint" key={c}>
                    <input
                      type="radio"
                      name={`conflict-${e.rowNumber}`}
                      checked={(choices[e.rowNumber] || fallback) === c}
                      onChange={() => onChoose(e.rowNumber, c)}
                    />
                    {CONFLICT_LABELS[c]}
                  </label>
                ))}
              </div>
            </span>
          </li>
        ))}
        {hidden > 0 && (
          <li className="issue issue-warn">
            <span>
              …and {hidden} more, all answered by “{CONFLICT_LABELS[fallback]}” above. Every one of them
              is listed row by row in the table below.
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

/** §53 — what actually happened, per row, including everything that failed. */
function Result({ result }) {
  const { ok, failed, total, created, updated } = result;
  return (
    /* Inside step 6, not a card of its own — the result *is* the last step, and giving it a
       second frame put a card inside a card the moment the flow was numbered. */
    <div className="d-block">
      <h3>Result</h3>
      <div className={`notice notice-${failed.length ? 'warn' : 'ok'}`} role="status">
        {gu(ok.length)} of {gu(total)} rows written - {gu(created)} added, {gu(updated)} changed
        {failed.length ? `, ${gu(failed.length)} failed.` : '. Every change is in the audit log.'}
      </div>
      {failed.length > 0 && (
        <>
          <p className="hint d-note">
            These were not saved. The rest were - nothing was rolled back, so importing again will
            retry only what is still outstanding.
          </p>
          <ul className="issue-list">
            {failed.map((f) => (
              <li className="issue issue-error" key={`${f.id}-${f.row}`}>
                <span className="mono">{f.id} (row {f.row})</span>
                <span>{f.message}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
