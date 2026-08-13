import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { fetchAllSessions, listSessions } from '../../learning/services/learningService';
import DataTable, { Pager } from '../../../components/DataTable';
import { AsyncBlock, TableSkeleton } from '../../../components/StateBlocks';
import { PageHeader } from '../../../components/StatCard';
import { dateTimeGu, percent } from '../../../lib/format';
import { dataError } from '../../../lib/errors';
import { exportCsv, istDateTime, istRange, reportFilename } from '../../../lib/export';
import { todayIST } from '../../../../../shared/domain/constants.js';
import { subZoneNameEn } from '../../../lib/labels';

/**
 * §40 — submitted learning rounds. §11 — the તારીખવાર અહેવાલ over them, and its export.
 *
 * One document per round, written once at submit by src/lib/learning.jsx. Its id is
 * derived from the uid and the round number, so a retried submit overwrites itself
 * rather than creating a second session — which is also why this list can be trusted as
 * a count of real rounds.
 *
 * Read-only and paginated. Nothing internal is exposed: no document paths, no draft
 * state, no uid beyond a link target (§40).
 *
 * This page is where a date-range report is actually honest. `submitted_at` is written by
 * the યુવક app at the moment a round is submitted, so "how much happened between these two
 * dates" has real rows behind it. The day-by-day *score* history §9 describes lives in
 * `public.progress`, which nothing writes yet — the Progress page says so in full, and
 * this page does not quietly stand in for it.
 */

/**
 * The round's own lifecycle, straight from learning_sessions.status
 * (0004_rbac.sql:250-252). The panel labels the column; it does not re-derive it from
 * `completed_at`, which is a different fact — when Memory Darshan ended, not whether the
 * round was submitted.
 *
 * ABANDONED is worded and coloured neutrally on purpose. A round left unfinished is not a
 * failure and nothing in this panel marks it as one (§29) — it says what happened, in the
 * same grey as any other quiet state.
 */
const SESSION_STATUS = {
  COMPLETED: { label: 'Complete', tone: 'pill-ok' },
  STARTED: { label: 'Started', tone: 'pill-warn' },
  IN_PROGRESS: { label: 'In progress', tone: 'pill-warn' },
  ABANDONED: { label: 'Not finished', tone: 'pill-off' },
};

/**
 * The round report's columns (§11, §13).
 *
 * A round is a score, so the file carries the score and who earned it — SMK and name are
 * enough for that, and no mobile number is needed to read a round. There is no opt-in here
 * for the same reason: unlike the યુવક list, nothing about this report is a contact list.
 *
 * "Remaining" and never "missed" or "wrong" (§10, §14): the દ્રશ્યો a યુવક has not reached
 * yet are simply the ones still ahead of him.
 */
const exportColumns = [
  { label: 'SMK', value: (r) => r.user?.smk || '' },
  { label: 'Name / નામ', value: (r) => r.user?.name || '' },
  { label: 'Subzone / સબઝોન', value: (r) => (r.user ? subZoneNameEn(r.user.subZoneId) : '') },
  { label: 'Session', value: (r) => r.sessionId },
  { label: 'Submitted', value: (r) => istDateTime(r.submittedAt) },
  { label: 'Remembered', value: (r) => r.remembered },
  { label: 'Remaining', value: (r) => r.pending },
  { label: 'Total', value: (r) => r.total },
  // The completion figure is recomputed from the two counts rather than carried across —
  // a stored percentage is a second copy of a fact that can disagree with it (§62).
  { label: 'Completion %', value: (r) => (r.total ? Math.floor((r.remembered / r.total) * 1000) / 10 : '') },
  { label: 'Status', value: (r) => r.status },
  { label: 'Memory Darshan finished', value: (r) => istDateTime(r.completedAt) },
];

export default function SessionsPage() {
  const [pageSize, setPageSize] = useState(20);
  const [completedOnly, setCompletedOnly] = useState(false);
  const [page, setPage] = useState(0);
  const cursors = useRef([null]);

  // §11 — the date range, over `submitted_at`. Either end may be left blank.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState(null);

  // Derived once, so the table and the file are cut on exactly the same IST boundaries.
  const { fromIso, toIsoExclusive } = istRange(from, to);

  const state = useAsync(
    () => listSessions({ pageSize, cursor: cursors.current[page], completedOnly, fromIso, toIsoExclusive }),
    [page, pageSize, completedOnly, fromIso, toIsoExclusive]
  );

  const rows = state.data?.rows || [];

  const runExport = async () => {
    setExporting(true);
    setExportNote(null);
    try {
      const res = await fetchAllSessions({ completedOnly, fromIso, toIsoExclusive });
      const written = exportCsv({
        filename: reportFilename('rounds', { from, to, stamp: todayIST() }),
        columns: exportColumns,
        rows: res.rows,
      });
      setExportNote(
        res.truncated
          ? {
              tone: 'notice-warn',
              text: `Exported the first ${written} rounds. More match these dates than one file holds (limit ${res.cap}) - choose a shorter range and export again.`,
            }
          : { tone: 'notice-ok', text: `Exported ${written} rounds.` }
      );
    } catch (e) {
      setExportNote({ tone: 'notice-warn', text: dataError(e) });
    } finally {
      setExporting(false);
    }
  };

  const next = useCallback(() => {
    if (!state.data?.cursor) return;
    cursors.current[page + 1] = state.data.cursor;
    setPage((p) => p + 1);
  }, [state.data, page]);

  const reset = () => {
    cursors.current = [null];
    setPage(0);
  };

  // Every label reads on its own. Below 900px DataTable turns each row into a card and
  // prints these labels beside their values with no header row above them, so a heading
  // that only made sense in a column ("Session", "Memory Darshan") becomes a question.
  const columns = [
    {
      key: 'user',
      label: 'User',
      render: (r) => (r.user ? <Link to={`/users/${r.uid}`}>{r.user.name}</Link> : <span className="mono">-</span>),
    },
    { key: 'subZone', label: 'Subzone', render: (r) => subZoneNameEn(r.user?.subZoneId) },
    { key: 'sessionId', label: 'Session id', render: (r) => <span className="mono">{r.sessionId}</span> },
    { key: 'remembered', label: 'Remembered', align: 'right', render: (r) => <span className="mono">{r.remembered}</span> },
    { key: 'pending', label: 'Remaining', align: 'right', render: (r) => <span className="mono">{r.pending}</span> },
    { key: 'pct', label: 'Completion', align: 'right', render: (r) => (r.total ? percent(r.remembered, r.total) : '-') },
    { key: 'submittedAt', label: 'Submitted', render: (r) => dateTimeGu(r.submittedAt) },
    {
      key: 'status',
      label: 'Status',
      // A status the CHECK constraint does not know about can only come from a migration
      // this bundle predates: show the raw value rather than a blank cell or a wrong pill.
      render: (r) => {
        const s = SESSION_STATUS[r.status];
        return s ? (
          <span className={`pill ${s.tone}`}>{s.label}</span>
        ) : (
          <span className="pill pill-off">{r.status || '-'}</span>
        );
      },
    },
    {
      key: 'completedAt',
      label: 'Memory Darshan finished',
      // Kept as its own column now that the pill no longer stands in for it. Blank means
      // the recall stage is still open, which is a position in the journey, not a lapse.
      render: (r) => (r.completedAt ? dateTimeGu(r.completedAt) : <span className="pill pill-off">In progress</span>),
    },
  ];

  // Each sentence names the filter that produced the emptiness, so the way out of it is in
  // the message. "No learning session available yet" is only true when nothing is
  // narrowing the list — with a date range on, it would be a claim about the whole table
  // made from a query that only looked at three days of it.
  const emptyMessage =
    from || to
      ? `No round was submitted in these dates${completedOnly ? ' with status Complete' : ''}. Try a wider range.`
      : completedOnly
        ? 'No round has status Complete yet. Clear the tick to see rounds that are still going.'
        : 'No learning session available yet.';

  return (
    <>
      {/* The export is the page's one action, so it belongs in the header rather than at
          the end of the filter bar, where it sat between a date field and the table and
          looked like a third filter. It still exports exactly what the filters describe —
          runExport reads the same `completedOnly` and IST bounds the table does. */}
      <PageHeader
        title="Sessions"
        sub="Every submitted round - one session, one document"
        actions={
          <button
            className={`btn${exporting ? ' is-busy' : ''}`}
            type="button"
            onClick={runExport}
            disabled={exporting}
            aria-busy={exporting}
          >
            {exporting ? 'Preparing…' : 'Export to Excel (CSV)'}
          </button>
        }
      />

      <div className="filters" role="group" aria-label="Filter the rounds">
        <div className="field">
          {/* .check is the panel's checkbox row: it carries the --tap floor, so the label
              and the box together are a 44px target on a phone. The inline flex it
              replaces was 8px of hard-coded gap and a target the height of the text. */}
          <label className="check" htmlFor="c">
            <input
              id="c"
              type="checkbox"
              checked={completedOnly}
              onChange={(e) => {
                reset();
                setCompletedOnly(e.target.checked);
              }}
            />
            Completed only
          </label>
          {/* Says which column it reads, because "completed" has two candidates on this
              page and the checkbox used to read the other one. */}
          <span className="hint">Rounds whose status is Complete. Memory Darshan may still be open.</span>
        </div>

        {/* §11 — તારીખવાર અહેવાલ over `submitted_at`, the moment the round was submitted.
            Bounds are built in IST (admin/src/lib/export.js), so a round submitted at
            11 pm on the 11th belongs to the 11th and not to the 12th (§9). */}
        <div className="field">
          <label htmlFor="sf">Submitted from</label>
          <input
            id="sf"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              reset();
              setFrom(e.target.value);
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="st">Submitted up to</label>
          <input
            id="st"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              reset();
              setTo(e.target.value);
            }}
          />
          <span className="hint">Both days included, counted in India (IST)</span>
        </div>

        {/* Only rendered once a date is set, so the bar carries no dead control on a page
            that has just been opened. It is quiet, not primary: undoing a filter is not
            the thing this page is for. */}
        {(from || to) && (
          <button
            className="btn btn-quiet"
            type="button"
            onClick={() => {
              reset();
              setFrom('');
              setTo('');
            }}
          >
            Clear dates
          </button>
        )}
      </div>

      {/* role="status" so a screen reader hears the result of a press that produced no
          visible change on the page itself — the file went to Downloads (§56). */}
      {exportNote && (
        <div className={`notice ${exportNote.tone}`} role="status">{exportNote.text}</div>
      )}

      <AsyncBlock
        state={{ ...state, isEmpty: !state.loading && !state.error && !rows.length }}
        emptyIcon="◷"
        emptyTitle={from || to || completedOnly ? 'No round matches these filters' : 'No round yet'}
        empty={emptyMessage}
        onRetry={state.retry}
        skeleton={<TableSkeleton cols={columns.length} />}
      >
        <>
          <DataTable caption="Sessions" columns={columns} rows={rows} rowKey={(r) => r.id} />
          <Pager
            page={page}
            hasNext={!!state.data?.hasNext}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={next}
            pageSize={pageSize}
            onPageSize={(n) => {
              reset();
              setPageSize(n);
            }}
            busy={state.loading}
          />
        </>
      </AsyncBlock>
    </>
  );
}
