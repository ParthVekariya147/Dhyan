import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { fetchAllUsers, listUsers, searchUsers } from '../services/userService';
import DataTable, { Pager } from '../../../components/DataTable';
import { AsyncBlock, TableSkeleton } from '../../../components/StateBlocks';
import { PageHeader } from '../../../components/StatCard';
import { dateGu } from '../../../lib/format';
import { dataError } from '../../../lib/errors';
import { exportCsv, istDate, istRange, reportFilename } from '../../../lib/export';
import { SUBZONES, todayIST } from '../../../../../shared/domain/constants.js';
import { SUB_ZONE_LABEL_EN, subZoneNameEn } from '../../../lib/labels';

/**
 * §16, §17, §18 — the યુવક list. §11 — its date-range filter and its Excel export.
 *
 * Paginated with a bounded `range()`, filtered and searched in the database. There is no
 * point at which this page holds more than one page of rows, which is the whole
 * requirement: at 2,000 users, "load everything and slice(0, 20)" is not a shortcut, it
 * is a page that gets slower every month and bills for it.
 *
 * The cursor stays an opaque forward-only token, so "back" is a stack of the cursors
 * already used. Postgres could offer numbered pages; keeping the panel's cursor contract
 * unchanged across the migration was worth more than the feature (§43).
 *
 * The export is the one place that deliberately breaks the "never more than one page"
 * rule, and it breaks it on purpose: §11 asks for a file the સંચાલક can act on, and a file
 * holding only the twenty rows that happened to be on screen would be a report that lies.
 * fetchAllUsers() pages through the same predicate this table uses, capped, and says so
 * when the cap is reached.
 *
 * What is deliberately absent
 * ---------------------------
 * §11 also asks this list for આજનો સ્કોર, સૌથી સારો સ્કોર and કુલ દિવસ. They are not
 * columns here and not in the export, because the table that would hold them —
 * `public.progress` (0001_init.sql:46-60), one row per yuvak per day, the table §9's
 * midnight-IST reset is built around — is not written by anything in this codebase yet.
 * The Progress page states that in full. A column of zeroes would be worse than a missing
 * column: someone would act on it.
 */

/**
 * profiles.status (0004_rbac.sql:175) — whether the account still works. §7 suspends and
 * never deletes, so SUSPENDED and DISABLED are rows a સંચાલક will meet in this list and
 * they must not read as ACTIVE.
 *
 * DISABLED is grey rather than red: it is an administrative state, not a verdict on the
 * યુવક.
 */
const ACCOUNT_STATUS = {
  ACTIVE: { label: 'Active', tone: 'pill-ok' },
  SUSPENDED: { label: 'Suspended', tone: 'pill-warn' },
  DISABLED: { label: 'Disabled', tone: 'pill-off' },
};

/**
 * What leaves the building (§13).
 *
 * §13 is unusually blunt: 2,000 mobile numbers, and some યુવકો are minors. An exported
 * file is no longer inside the panel's RLS — it lands in Downloads, goes into WhatsApp,
 * gets forwarded. So the default file carries what a report needs to be useful and
 * nothing else:
 *
 *   included   SMK (the unique member id — enough to identify anyone, §4), name, subzone,
 *              registration date, account state, and the §5 entry-gate answers, which are
 *              the whole reason those answers are recorded.
 *   opt-in     mobile. Off unless the સંચાલક ticks the box for this one export.
 *   never      email. It is the only password-recovery route (§2.1) and it answers no
 *              question a report asks, so there is no checkbox for it at all.
 *
 * Dates are `istDate`, not `dateGu` — the same instant and the same IST day the table
 * shows, in the shape Excel sorts as a date rather than as the text "11 Aug 2026".
 *
 * Headers name the Gujarati term beside the English one for the columns §11 names in
 * Gujarati, because the file is read outside the panel. The values stay exactly as the
 * screen shows them, so the file and the table can never be read as disagreeing.
 */
const exportColumns = (withMobile) =>
  [
    { label: 'SMK', value: (u) => u.smk },
    { label: 'Name / નામ', value: (u) => u.name },
    withMobile ? { label: 'Mobile / મોબાઈલ', value: (u) => u.mobile } : null,
    { label: 'Subzone / સબઝોન', value: (u) => subZoneNameEn(u.subZoneId) },
    { label: 'Registered', value: (u) => istDate(u.createdAt) },
    { label: 'Account', value: (u) => u.status },
    // "Pending" and never "Not done": a step not yet taken is not a failure (§10, §14).
    { label: 'Entry gate', value: (u) => (u.gatePassedAt ? istDate(u.gatePassedAt) : 'Pending') },
    { label: 'Liked', value: (u) => (u.likeAnswer ? 'Yes' : 'No') },
    { label: 'Commented', value: (u) => (u.commentAnswer ? 'Yes' : 'No') },
    { label: 'Level 4', value: (u) => (u.level4Unlocked ? 'Unlocked' : 'Not yet') },
  ].filter(Boolean);

export default function UsersPage() {
  const nav = useNavigate();
  const [pageSize, setPageSize] = useState(20);
  const [subZoneId, setSubZoneId] = useState('');
  const [term, setTerm] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(0);
  const cursors = useRef([null]); // cursors[i] starts page i

  // §11 — તારીખવાર અહેવાલ. Both ends optional: one alone means "since" or "up to", and a
  // service that invented the other bound would answer a question nobody asked.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [withMobile, setWithMobile] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState(null); // { tone, text }

  const searching = !!applied;

  // The IST bounds, derived once and used by both the table and the export, so the file
  // can never cover a different range from the one on screen.
  const { fromIso, toIsoExclusive } = istRange(from, to);

  // The સબઝોન filter applies to both modes. It used to be passed only to listUsers() and
  // the select merely disabled while a search was applied — never cleared — so the panel
  // showed "Varachha" above results drawn from all three. Now the search is narrowed by
  // it, the select stays live, and changing it re-runs whichever query is in effect. The
  // date range is passed the same way and for the same reason.
  const state = useAsync(
    () =>
      searching
        ? searchUsers(applied, { pageSize, subZoneId, fromIso, toIsoExclusive })
        : listUsers({ pageSize, cursor: cursors.current[page], subZoneId, fromIso, toIsoExclusive }),
    [page, pageSize, subZoneId, applied, fromIso, toIsoExclusive]
  );

  const rows = state.data?.rows || [];

  /**
   * §11 — Excel export of the set the સંચાલક is actually looking at.
   *
   * Every filter on screen goes into the fetch, and the count reported afterwards is the
   * length of what was written rather than a number this component assumed (§62). A cap
   * that was hit is stated, not hidden: silent truncation of a report someone acts on is
   * worse than no export.
   */
  const runExport = async () => {
    setExporting(true);
    setExportNote(null);
    try {
      const res = await fetchAllUsers({ subZoneId, term: applied, fromIso, toIsoExclusive });
      const written = exportCsv({
        filename: reportFilename('yuvako', { from, to, stamp: todayIST() }),
        columns: exportColumns(withMobile),
        rows: res.rows,
      });
      setExportNote(
        res.truncated
          ? {
              tone: 'notice-warn',
              text: `Exported the first ${written} users. More match this filter than one file holds (limit ${res.cap}) — narrow the subzone or the date range and export again.`,
            }
          : { tone: 'notice-ok', text: `Exported ${written} users.` }
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

  // The empty message names the સબઝોન filter when one is set, so nothing found is not read
  // as "nobody registered" when it means "nobody in Varachha matches". The date range is
  // named for exactly the same reason — an empty July must not read as an empty database.
  const inSubZone = subZoneId ? ` in ${SUB_ZONE_LABEL_EN[subZoneId] || subZoneId}` : '';
  const inRange = from || to ? ` registered ${from ? `from ${from}` : ''}${from && to ? ' ' : ''}${to ? `up to ${to}` : ''}` : '';
  const emptyMessage = searching
    ? `No user found for this search${inSubZone}${inRange}.`
    : inRange
      ? `No user${inSubZone}${inRange}.`
      : `No user registered${inSubZone} yet.`;

  const columns = [
    { key: 'smk', label: 'SMK', render: (u) => <span className="mono">{u.smk || '—'}</span> },
    { key: 'name', label: 'Name' },
    { key: 'mobile', label: 'Mobile', render: (u) => <span className="mono">{u.mobile || '—'}</span> },
    { key: 'email', label: 'Email' },
    { key: 'subZoneId', label: 'Subzone', render: (u) => subZoneNameEn(u.subZoneId) },
    { key: 'createdAt', label: 'Registered', render: (u) => dateGu(u.createdAt) },
    {
      key: 'status',
      label: 'Status',
      // Two facts, two pills. The account's lifecycle came from the column that records
      // it; "Entry gate pending" is §5's honour-system answer and is shown beside it
      // rather than instead of it, which is what made a SUSPENDED yuvak look Active.
      // Pending is a step not yet taken, never a mark against him.
      render: (u) => {
        const s = ACCOUNT_STATUS[u.status] || { label: u.status || '—', tone: 'pill-off' };
        return (
          <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            <span className={`pill ${s.tone}`}>{s.label}</span>
            {!u.gatePassedAt && <span className="pill pill-warn">Entry gate pending</span>}
          </span>
        );
      },
    },
    {
      key: 'level4Unlocked',
      label: 'Level 4',
      render: (u) => (u.level4Unlocked ? <span className="pill pill-ok">Unlocked</span> : <span className="pill pill-off">Off</span>),
    },
  ];

  return (
    <>
      <PageHeader title="Users" sub="Search, filtering and pagination — all from database queries" />

      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          reset();
          setApplied(term.trim());
        }}
      >
        <div className="field">
          <label htmlFor="q">Search</label>
          <input
            id="q"
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Mobile, email, SMK or name"
          />
          <span className="hint">Full mobile/email/SMK, or the beginning of a name</span>
        </div>

        <div className="field">
          <label htmlFor="sz">Subzone</label>
          <select
            id="sz"
            value={subZoneId}
            onChange={(e) => {
              reset();
              setSubZoneId(e.target.value);
            }}
          >
            <option value="">All</option>
            {/* SUBZONES supplies the ids; the panel reads their English names. */}
            {SUBZONES.map((s) => (
              <option key={s.id} value={s.id}>{SUB_ZONE_LABEL_EN[s.id] || s.id}</option>
            ))}
          </select>
        </div>

        {/*
          §11 — તારીખવાર અહેવાલ. This is `profiles.created_at`, when the યુવક registered:
          the one date this table genuinely records. It is deliberately not labelled
          "activity" or "dhyan" — those live in the day's score, which nothing writes yet
          (see the note at the top of this file, and the Progress page).

          Applied on change rather than on Submit, like the સબઝોન select beside it: a
          half-typed date is '' from <input type="date">, so nothing runs until a whole
          day has been picked.
        */}
        <div className="field">
          <label htmlFor="rf">Registered from</label>
          <input
            id="rf"
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
          <label htmlFor="rt">Registered up to</label>
          <input
            id="rt"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              reset();
              setTo(e.target.value);
            }}
          />
          {/* Says what the reader would otherwise have to guess: the last day is inside
              the range, and the day is the Indian one (§9). */}
          <span className="hint">Both days included, counted in India (IST)</span>
        </div>

        <button className="btn" type="submit">Search</button>
        {searching && (
          <button
            className="btn btn-quiet"
            type="button"
            onClick={() => {
              setTerm('');
              setApplied('');
              reset();
            }}
          >
            Clear search
          </button>
        )}
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
      </form>

      {/*
        §11 — Excel export. Its own row rather than a control inside the search form, so
        pressing Enter in the search box cannot download a file.
      */}
      <div className="filters">
        <div className="field">
          <label htmlFor="wm" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              id="wm"
              type="checkbox"
              checked={withMobile}
              onChange={(e) => setWithMobile(e.target.checked)}
              style={{ width: 'auto' }}
            />
            Include mobile numbers
          </label>
          {/* §13, stated where the decision is made rather than in a policy nobody reads.
              Off by default; SMK already identifies a યુવક uniquely (§4). */}
          <span className="hint">Off by default — some yuvaks are minors and the file leaves the panel</span>
        </div>

        <button className="btn" type="button" onClick={runExport} disabled={exporting}>
          {exporting ? 'Preparing…' : 'Export to Excel (CSV)'}
        </button>
      </div>

      {/* One line, after the fact, saying what was written. Never a guess — the number is
          the length of the file (§62). */}
      {/* role="status" so a screen reader hears the result of a press that produced no
          visible change on the page itself — the file went to Downloads (§56). */}
      {exportNote && (
        <div className={`notice ${exportNote.tone}`} role="status">{exportNote.text}</div>
      )}

      <p className="card-note">
        The export covers every user matching the search, subzone and dates above — not
        just this page. It opens in Excel. Email addresses are never included.
      </p>

      <AsyncBlock
        state={{ ...state, isEmpty: !state.loading && !state.error && rows.length === 0 }}
        empty={emptyMessage}
        onRetry={state.retry}
        skeleton={<TableSkeleton cols={columns.length} />}
      >
        <>
          <DataTable
            caption="User list"
            columns={columns}
            rows={rows}
            rowKey={(u) => u.id}
            onRowClick={(u) => nav(`/users/${u.id}`)}
          />
          {!searching && (
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
          )}
          {searching && <p className="card-note">Search results are not paginated — try a more specific search.</p>}
        </>
      </AsyncBlock>
    </>
  );
}
