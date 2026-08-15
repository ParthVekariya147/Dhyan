import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { useAdminAuth } from '../../../lib/adminAuth';
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
 * ────────────────────────────────────────────────────────────────────────────
 * This screen reads a retired table, and says so on the screen itself
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Everything above describes a flow that no longer runs. `learning_sessions` belongs to the
 * 0001 system reached through the `/learn` route; nothing links to that route any more,
 * nothing writes the table, and in production it holds **zero rows** — it has held zero rows
 * for as long as levels ૧–૪ have existed. Every query on this page is correct and every one
 * of them returns nothing.
 *
 * The page is deliberately not rewritten onto another table. What replaced these rounds is
 * `activity_attempts` and `level4_attempts`, and both are already surfaced properly:
 * /users/:userId/activity for one યુવક's history and /progress for the organisation-wide
 * report with its own filters and export. A third view of the same rows, wearing this
 * page's vocabulary of "rounds" and "sessions", would be a fourth place for the same facts
 * to disagree.
 *
 * What is not acceptable is a screen that looks broken. So the page keeps working — the
 * filters, the pager and the export all still do exactly what they say — and states at the
 * top which table it is reading and where the live data is. The alternative, an "No round
 * yet" empty state over a busy database, is a statement rather than the absence of one
 * (§35, §62).
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
/*
  A function of the permission rather than a constant, for the same reason the યુવક list's is:
  a file leaves the panel and is not governed after that, so a screen with no SMK column beside
  a spreadsheet full of them would be a control that only looks like one. See 0046.
*/
const exportColumns = (withSmk) => [
  withSmk ? { label: 'SMK', value: (r) => r.user?.smk || '' } : null,
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
].filter(Boolean);

export default function SessionsPage() {
  // Only for the export's SMK column - the table's own is dropped by DataTable (0046).
  const { can } = useAdminAuth();
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
        columns: exportColumns(can('users.smk.read')),
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

  // Every label reads on its own. Nine columns do not fit a phone, so most of them are
  // reached by swiping the table sideways and arrive at the edge of the screen with only
  // their own header for context — a heading that only made sense while its neighbours were
  // visible ("Session", "Memory Darshan") becomes a question there.
  const columns = [
    {
      key: 'user',
      label: 'User',
      /*
        The column that does not move when the table is swiped on a phone.

        It is the first column as well, so this changes nothing today — but DataTable's
        fallback is "whichever column happens to be first", which is a fact about the order
        somebody typed them in rather than about what identifies a round. Here the identity
        is emphatically the યુવક and emphatically not the alternative candidate: `sessionId`
        is a uid glued to a round number, unique but unreadable, and a pinned column of
        those would anchor the table to the one value nobody can recognise. Naming the
        column also means a column inserted in front of User later cannot quietly take the
        pin.
      */
      pin: true,
      render: (r) =>
        r.user ? (
          // `cellLink` for the same reason UsersTab gives it to the name: admin.css puts the
          // --tap floor on every `tbody td` below 900px, and a bare `a` is a 20px line
          // inside a 44px row, so most of the row a thumb aims at was not the link. The
          // inner span keeps the pinned column's ellipsis working - `text-overflow` acts on
          // a block container and a flex link is not one, so without it a long name would
          // be cut off with nothing saying it continued.
          <Link to={`/users/${r.uid}`} style={cellLink}>
            <span style={cellLinkText}>{r.user.name}</span>
          </Link>
        ) : (
          <span className="mono">-</span>
        ),
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
        // Not "nobody has done anything": with no filter on, this is the retired table being
        // empty, which is the one thing the notice above has already explained.
        : 'This table holds no rounds. See the note above for where the current progress is.';

  return (
    <>
      {/* The export is the page's one action, so it belongs in the header rather than at
          the end of the filter bar, where it sat between a date field and the table and
          looked like a third filter. It still exports exactly what the filters describe —
          runExport reads the same `completedOnly` and IST bounds the table does. */}
      <PageHeader
        title="Sessions"
        sub="Rounds submitted through the retired learning flow - see the note below"
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

      {/*
        Said once, at the top, before any control that would otherwise look like it had
        simply found nothing. Not role="alert" and not notice-danger: nothing is wrong here
        and no one needs to act - this is a retired screen describing itself, and shouting
        about it would send a સંચાલક looking for a fault that does not exist. See this
        file's header for the full reasoning.
      */}
      <div className="notice notice-warn">
        This screen reads <span className="mono">learning_sessions</span>, the table behind
        the older learning flow. It has held no rows since levels 1-4 replaced that flow, so
        the list below will be empty and the export will produce an empty file. Nothing has
        been lost - the progress yuvaks are making now is on the{' '}
        <Link to="/progress">Progress report</Link>, and one yuvak's own attempts are under
        Activity &amp; points on his profile.
      </div>

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

/* ---------------------------------------------------------------------------
 * Layout constants — module scope, so paging does not allocate a fresh style object per row.
 * ------------------------------------------------------------------------- */

/**
 * A link that is as tall as the row it sits in.
 *
 * admin.css gives every `tbody td` a height of --tap below 900px so a row is a thumb-sized
 * target. An `a` inside one is an inline box the height of its text — measured at 20px — so
 * the row was tall enough and the part of it that navigated was not. `height: 100%` rather
 * than a floor of its own, so the link matches whatever the cell settled on and adds nothing
 * on a desk, where the cell has no floor. `min-width: 0` because this link sits in the
 * pinned column, which is the one column with a width it may not exceed, and a flex item
 * refuses to shrink below its content unless it is told it may.
 */
const cellLink = { display: 'flex', alignItems: 'center', height: '100%', minWidth: 0 };

/**
 * The name inside that link.
 *
 * `.is-pin` caps the pinned column at 46vw and ellipsizes what does not fit, but
 * `text-overflow` needs a block container and a flex container is not one. This span puts
 * one back inside the link, so a long name is still cut with an ellipsis rather than cut
 * silently.
 */
const cellLinkText = { overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 };
