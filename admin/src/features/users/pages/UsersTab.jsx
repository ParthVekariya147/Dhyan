import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { useAdminAuth } from '../../../lib/adminAuth';
import {
  fetchAllUsers,
  listUsers,
  searchUsers,
  setTestAccount,
  testWriteError,
} from '../services/userService';
import DataTable, { Pager } from '../../../components/DataTable';
import { AsyncBlock, TableSkeleton } from '../../../components/StateBlocks';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { StatusBadge } from '../../../components/StatCard';
import { dateGu } from '../../../lib/format';
import { dataError } from '../../../lib/errors';
import { exportCsv, istDate, istRange, reportFilename } from '../../../lib/export';
import { SUBZONES, todayIST } from '../../../../../shared/domain/constants.js';
import { SUB_ZONE_LABEL_EN, subZoneNameEn } from '../../../lib/labels';
import '../users.css';

/**
 * §14, §16, §17, §18 — the યુવક list. §11 — its date-range filter and its Excel export.
 *
 * This was UsersPage in full until 0038 split administrators out of `profiles` and gave the
 * section a second population to show, and 0040 added a third. It is now the first of three
 * tabs and UsersPage is the shell that chooses between them; nothing else about it changed at
 * either point, which is the point. The only line that left
 * with the move is its <PageHeader>, which the shell now renders above the tab strip — a
 * page title *underneath* the tabs that switch it would be describing the wrong thing.
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
 * Layout: search and filters, then the export row, then the table. Below 900px the table
 * stays a table: it scrolls sideways with the Name column pinned, and two bookkeeping
 * columns are hidden by users.css so there is less to swipe past. Every column still
 * carries a real `label` — the header is the only thing that says what a value is, and the
 * hide rules and the responsive audit both select on it. The name is additionally a link,
 * because tapping the row is a mouse affordance and a keyboard has no row to tap (§56).
 *
 * Who is in it changed twice and this file did not have to either time: userService reads
 * `public.yuvaks`, which since 0038 is profiles minus anyone holding a `public.admins` row and
 * since 0040 is that minus every account marked `is_test` as well. The count, the list and the
 * export mean the people learning rather than everyone with a login, and the one thing this
 * file did gain from 0040 is the button that moves somebody out of that set — see the Actions
 * column, which is also the only write on a screen §19 otherwise keeps read-only.
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
 * યુવક. The tone only repeats what the word says, which is what keeps the badge readable
 * to someone who cannot separate the tints (§43).
 */
const ACCOUNT_STATUS = {
  ACTIVE: { label: 'Active', tone: 'ok' },
  SUSPENDED: { label: 'Suspended', tone: 'warn' },
  DISABLED: { label: 'Disabled', tone: 'off' },
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
/*
  `withSmk` is a second opt-out alongside `withMobile`, and it is not the same kind of thing.

  The mobile column is a choice the person makes on the screen each time. This one is a
  permission — `users.smk.read` (0046) — because an export is the one place a hidden column
  would otherwise come straight back: the file leaves the panel and is not governed after that,
  so a table with no SMK column beside a spreadsheet full of them would be a control that only
  looks like one.
*/
const exportColumns = (withMobile, withSmk) =>
  [
    withSmk ? { label: 'SMK', value: (u) => u.smk } : null,
    { label: 'Name / નામ', value: (u) => u.name },
    withMobile ? { label: 'Mobile / મોબાઈલ', value: (u) => u.mobile } : null,
    { label: 'Subzone / સબઝોન', value: (u) => subZoneNameEn(u.subZoneId) },
    { label: 'Registered', value: (u) => istDate(u.createdAt) },
    { label: 'Account', value: (u) => u.status },
    // "Pending" and never "Not done": a step not yet taken is not a failure (§10, §14).
    { label: 'Entry gate', value: (u) => (u.gatePassedAt ? istDate(u.gatePassedAt) : 'Pending') },
    { label: 'Liked', value: (u) => (u.likeAnswer ? 'Yes' : 'No') },
    { label: 'Commented', value: (u) => (u.commentAnswer ? 'Yes' : 'No') },
    { label: 'Level 4', value: (u) => (u.level4GateOpen ? 'Open' : 'Not yet') },
  ].filter(Boolean);

export default function UsersTab() {
  const nav = useNavigate();
  const { can } = useAdminAuth();
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

  /*
    0040 — the one write this read-only list performs, and its three pieces of state.

    `marking` is the row the dialog is about, or null. `markNote` is kept apart from
    `exportNote` deliberately: they are answers to two different presses, and one variable
    would mean marking somebody quietly wiped the line saying how many rows the export wrote.
  */
  const [marking, setMarking] = useState(null);
  const [markBusy, setMarkBusy] = useState(false);
  const [markFailure, setMarkFailure] = useState('');
  const [markNote, setMarkNote] = useState(null); // { tone, text }

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
        columns: exportColumns(withMobile, can('users.smk.read')),
        rows: res.rows,
      });
      setExportNote(
        res.truncated
          ? {
              tone: 'notice-warn',
              text: `Exported the first ${written} users. More match this filter than one file holds (limit ${res.cap}) - narrow the subzone or the date range and export again.`,
            }
          : { tone: 'notice-ok', text: `Exported ${written} users.` }
      );
    } catch (e) {
      setExportNote({ tone: 'notice-warn', text: dataError(e) });
    } finally {
      setExporting(false);
    }
  };

  /**
   * 0040 — take this account out of every figure the panel reports.
   *
   * The row is re-read by the service rather than assumed: `profiles_guard_test_flag()` is a
   * BEFORE UPDATE trigger that *holds* `is_test` when the caller does not hold `users.test`
   * instead of raising, so a refused write answers `200, no error`. setTestAccount() compares
   * what came back and throws when it did not move, and testWriteError() words that as the
   * refusal it is rather than as "please try again" (§62).
   *
   * The list is re-read on success, without resetting the page. He is gone from it either way -
   * `yuvaks` excludes test accounts - so this is the page catching up with a row that has left
   * the population, not a correction of anything the table got wrong.
   */
  const markAsTest = async (user) => {
    setMarkBusy(true);
    setMarkFailure('');
    try {
      await setTestAccount(user.id, true);
      setMarking(null);
      setMarkNote({
        tone: 'notice-ok',
        text: `${user.name || 'This account'} is now a test account and has left this list, along with the counts, the leaderboard, the reports and the exports. The account still works and its points are untouched. You will find it under Test accounts.`,
      });
      state.retry();
    } catch (e) {
      setMarkFailure(testWriteError(e));
    } finally {
      setMarkBusy(false);
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

  // Whether anything at all is narrowing the list. Drives the empty state's offer: a page
  // that says "nothing here" and hands back no way out of the filter that emptied it makes
  // the સંચાલક hunt for which of four controls did it (§35).
  const filtered = searching || !!subZoneId || !!from || !!to;

  const clearAll = () => {
    reset();
    setTerm('');
    setApplied('');
    setSubZoneId('');
    setFrom('');
    setTo('');
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
    { key: 'smk', label: 'SMK', render: (u) => <span className="mono">{u.smk || '-'}</span> },
    {
      key: 'name',
      label: 'Name',
      /*
        The column that does not move when the table is swiped on a phone.

        DataTable pins the first column unless a page names another one, and here the first
        column is SMK — which a large share of યુવકો simply do not have. Pinning it would
        hold a stack of dashes on screen while the names, the one thing that says whose row
        this is, scrolled away under the thumb: the exact failure the pin exists to prevent.
        The name is what a સંચાલક reads the row by, so the name is what stays.

        It also earns the position twice over, because it is the link to the profile: the
        column that is always reachable is the column you tap to go somewhere.
      */
      pin: true,
      /*
        The row is clickable for a mouse; this is the same destination for a keyboard and
        for a screen reader, which have no row to click. stopPropagation only so the two
        do not both fire — they navigate to the same place, but one press should be one
        navigation.

        `cellLink` is what makes the anchor as tall as the row it sits in. admin.css gives
        every `tbody td` the --tap floor on a phone, but a bare `a` is only as tall as its
        one line of text, so the tap target was 20px inside a 44px row and the twenty-four
        pixels around the name did nothing.

        The inner span is not decoration. `.is-pin` caps this column at 46vw and ellipsizes
        what does not fit, and `text-overflow` only works on a block container — a flex
        anchor is not one, so making the link fill the cell would have turned "Bhaveshkumar
        …" into a hard cut with nothing saying the name continued. The span puts a block
        container back inside the flex link and the ellipsis lands where it always did.
      */
      render: (u) => (
        <Link to={`/users/${u.id}`} style={cellLink} onClick={(e) => e.stopPropagation()}>
          <span style={cellLinkText}>{u.name || '-'}</span>
        </Link>
      ),
    },
    { key: 'mobile', label: 'Mobile', render: (u) => <span className="mono">{u.mobile || '-'}</span> },
    // `ut-c-email` and `ut-c-registered` are hidden below 900px by users.css, and only
    // there — the class is on the `th` as well as the `td`, so the header goes with its
    // cells. Both stay in this array because it is also the array the export is built
    // from; see the comment on that block in users.css.
    { key: 'email', label: 'Email', className: 'ut-c-email' },
    { key: 'subZoneId', label: 'Subzone', render: (u) => subZoneNameEn(u.subZoneId) },
    { key: 'createdAt', label: 'Registered', className: 'ut-c-registered', render: (u) => dateGu(u.createdAt) },
    {
      key: 'status',
      label: 'Status',
      // Two facts, two badges. The account's lifecycle came from the column that records
      // it; "Entry gate pending" is §5's honour-system answer and is shown beside it
      // rather than instead of it, which is what made a SUSPENDED yuvak look Active.
      // Pending is a step not yet taken, never a mark against him.
      render: (u) => {
        const s = ACCOUNT_STATUS[u.status] || { label: u.status || '-', tone: 'off' };
        return (
          // Two pills need a wrapper that can wrap: in a narrow column the second badge
          // drops under the first instead of widening the page (§36). On a phone the cell
          // is `white-space: nowrap` so the pair sits on one line and the swipe pays for
          // the width, which is the trade the whole table now makes.
          <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
            <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
            {!u.gatePassedAt && <StatusBadge tone="warn">Entry gate pending</StatusBadge>}
          </span>
        );
      },
    },
    {
      key: 'level4GateOpen',
      label: 'Level 4',
      /*
        The gate the published configuration defines, not 0008's fixed 80 (0011). "Open"
        rather than "Unlocked" because that is now what it means: with the gate switched
        off it is open to everyone without anybody having earned anything, and a column
        reading "Unlocked" for all 2,000 would be describing the wrong thing.
      */
      render: (u) =>
        u.level4GateOpen ? <StatusBadge tone="ok">Open</StatusBadge> : <StatusBadge tone="off">Not yet</StatusBadge>,
    },
  ];

  /*
    0040 — the only action on a યુવક row, and the only column that is not always built.

    Behind `users.test`, which 0004's matrix as amended by 0040 gives to SUPER_ADMIN alone. For
    everyone else the column does not exist rather than standing there full of nothing: this
    table scrolls sideways below 900px, so an empty last column is a column an ADMIN would swipe
    the whole width of the row to reach and find nothing in - the same reasoning the
    administrator list applies to its own Actions column.

    Visibility only. `profiles_guard_test_flag()` refuses the write again with no regard for
    what this file rendered, and it refuses it *silently* by holding the old value - which is
    exactly why setTestAccount() reads the row back instead of trusting the absence of an error.

    There is no "unmark" here and there cannot be: the moment an account is marked it leaves
    `yuvaks` and therefore this list. Returning it to normal is done on the Test accounts tab,
    which is the only screen that can still see it.
  */
  if (can('users.test')) {
    columns.push({
      key: 'actions',
      label: 'Actions',
      render: (u) => (
        <button
          className="btn btn-quiet btn-sm"
          type="button"
          // The row itself navigates to the user page (see onRowClick below), and a button
          // inside it inherits that click. Without this, marking somebody would open his
          // profile at the same moment the dialog asking whether to mark him appeared.
          onClick={(e) => {
            e.stopPropagation();
            setMarkFailure('');
            // The previous outcome goes when the next dialog opens - a line saying somebody
            // has been marked, left above a dialog about somebody else, reads as a statement
            // about the person in front of you.
            setMarkNote(null);
            setMarking(u);
          }}
        >
          Mark as test
        </button>
      ),
    });
  }

  return (
    <>
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
            // The panel is English and these are identifiers: an autocapitalised "Pgv"
            // would not match an SMK, and a phone that offers to correct a name is
            // offering to break the search.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby="q-hint"
          />
          <span className="hint" id="q-hint">Full mobile/email/SMK, or the beginning of a name</span>
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
            aria-describedby="rt-hint"
          />
          {/* Says what the reader would otherwise have to guess: the last day is inside
              the range, and the day is the Indian one (§9). */}
          <span className="hint" id="rt-hint">Both days included, counted in India (IST)</span>
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
        pressing Enter in the search box cannot download a file. A toolbar rather than a
        second `.filters` bar: the checkbox is not a filter on the table, it only decides
        what the file carries, and putting it in a filter row said otherwise.
      */}
      <div className="toolbar">
        <div className="grow">
          <label className="check" htmlFor="wm">
            <input
              id="wm"
              type="checkbox"
              checked={withMobile}
              onChange={(e) => setWithMobile(e.target.checked)}
              aria-describedby="wm-hint"
            />
            Include mobile numbers
          </label>
          {/* §13, stated where the decision is made rather than in a policy nobody reads.
              Off by default; SMK already identifies a યુવક uniquely (§4). */}
          <span className="hint" id="wm-hint">
            Off by default - some yuvaks are minors and the file leaves the panel. Email addresses
            are never included.
          </span>
        </div>

        <button
          className={`btn${exporting ? ' is-busy' : ''}`}
          type="button"
          onClick={runExport}
          disabled={exporting}
        >
          {exporting ? 'Preparing…' : 'Export to Excel (CSV)'}
        </button>
      </div>

      {/* One line, after the fact, saying what was written. Never a guess — the number is
          the length of the file (§62).
          role="status" so a screen reader hears the result of a press that produced no
          visible change on the page itself — the file went to Downloads (§56). */}
      {exportNote && (
        <div className={`notice ${exportNote.tone}`} role="status">{exportNote.text}</div>
      )}

      {/* The result of a marking, on the page rather than in the dialog that has closed by the
          time it is read. role="status" because the visible consequence is a row *leaving* the
          table, which announces nothing on its own. */}
      {markNote && (
        <div className={`notice ${markNote.tone}`} role="status">{markNote.text}</div>
      )}

      <AsyncBlock
        state={{ ...state, isEmpty: !state.loading && !state.error && rows.length === 0 }}
        emptyTitle={filtered ? 'Nothing matches these filters' : 'No users yet'}
        emptyIcon="👤"
        empty={emptyMessage}
        // The way out of the filter that emptied the list, offered where the emptiness is
        // reported. Absent when nothing is filtered, because then there is nothing to undo.
        emptyAction={
          filtered ? (
            <button className="btn btn-quiet" type="button" onClick={clearAll}>
              Clear all filters
            </button>
          ) : null
        }
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
          {/* The export covers the whole filtered set; this note is what stops the page
              being read as "the file is what I can see". */}
          <p className="card-note">
            {searching
              ? `Showing ${rows.length} search results - search is not paginated, so narrow the term if you expected more. The export covers every user matching the search, subzone and dates above.`
              : 'The export covers every user matching the search, subzone and dates above - not just this page. It opens in Excel.'}
          </p>
        </>
      </AsyncBlock>

      {/*
        §57 — marking somebody is not a single click.

        The body says the disappearance out loud, and that sentence is the reason this dialog
        is worth its length: the row vanishing from the table immediately afterwards is the
        feature working exactly as designed, and somebody who was not told to expect it has
        every reason to read it as the panel having deleted a person.
      */}
      <ConfirmDialog
        open={!!marking}
        title={marking ? `Mark ${marking.name || 'this account'} as a test account?` : ''}
        busy={markBusy}
        confirmLabel="Yes, mark as test"
        onCancel={() => {
          if (markBusy) return;
          setMarking(null);
          setMarkFailure('');
        }}
        onConfirm={() => marking && markAsTest(marking)}
        body={
          marking && (
            <>
              <p>
                A test account exists to try the app. It keeps working exactly as it does now -
                it can sign in, earn points and record progress - and it stops being counted:
                it will not appear in the leaderboard, the dashboard totals, any report or any
                Excel export.
              </p>
              <p>
                Nothing is deleted. The account and every point it has already earned stay
                exactly as they are, and it can be returned to normal at any time.
              </p>
              <p>
                It will disappear from this list as soon as the list reloads - this list is the
                people who are counted. You will find it under the Test accounts tab, which is
                also where it is returned to normal.
              </p>

              {markFailure && (
                <div
                  className="notice notice-danger"
                  role="alert"
                  style={{ marginTop: 'var(--sp-4)', marginBottom: 0 }}
                >
                  {markFailure}
                </div>
              )}
            </>
          )
        }
      />
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Layout constants — module scope, so paging or typing a search term does not allocate a
 * fresh style object per row.
 * ------------------------------------------------------------------------- */

/**
 * A link that is as tall as the row it sits in.
 *
 * admin.css gives every `tbody td` a height of --tap below 900px, precisely so a row is a
 * thumb-sized target on the way to a detail page. An `a` inside it is an inline box the
 * height of its text — measured at 20px — so the row was tall enough and the only part of
 * it that navigated was not. Filling the cell makes the whole row's height live, and
 * `align-items: center` keeps the name optically where it was rather than riding the top
 * of a 44px box.
 *
 * `height: 100%` and not `min-height`, because the cell already carries the floor and the
 * link only has to match whatever the cell settled on — including on a desk, where there
 * is no floor and this resolves to the natural line height.
 *
 * `min-width: 0` because a flex item refuses to shrink below its content by default, and
 * this link sits in the pinned column, which is the one column with a width it may not
 * exceed.
 */
const cellLink = { display: 'flex', alignItems: 'center', height: '100%', minWidth: 0 };

/**
 * The name inside that link, and the reason it is wrapped at all.
 *
 * `.is-pin` in admin.css caps the pinned column at 46vw and ellipsizes the overflow, but
 * `text-overflow` needs a block container to act on and a flex container is not one. Left
 * bare, a long name in a flex link would be cut off mid-glyph with nothing to say it
 * continued, which reads as a shorter name rather than as a clipped one. This span is that
 * block container, restored inside the link.
 */
const cellLinkText = { overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 };
