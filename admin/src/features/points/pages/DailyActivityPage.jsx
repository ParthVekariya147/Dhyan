import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { useAdminAuth } from '../../../lib/adminAuth';
import {
  DAILY_LIMIT,
  awardKind,
  dailyActivity,
  filterOptions,
  levelLabel,
  timelineKey,
  userTimeline,
} from '../services/ledgerService';
import DataTable, { Pager } from '../../../components/DataTable';
import { AsyncBlock, CardSkeleton, TableSkeleton } from '../../../components/StateBlocks';
import StatCard, { PageHeader, StatusBadge, guCount } from '../../../components/StatCard';
import { dateGu, dateTimeGu, gu } from '../../../lib/format';
import { dataError } from '../../../lib/errors';
import { exportCsv, reportFilename } from '../../../lib/export';
import { exportXlsx, xlsxFilename } from '../../../lib/xlsx';
import { subZoneNameEn, zoneNameEn } from '../../../lib/labels';
import { todayIST } from '../../../../../shared/domain/constants.js';
import { ACTIVITY_KEY, ATTEMPT_STATUS } from '../../../../../shared/domain/points.js';
import '../ledger.css';

/**
 * §23 — one day, across everybody.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The question this page answers
 * ────────────────────────────────────────────────────────────────────────────
 *
 * "What did the project do today" and, one press further in, "what did this yuvak do today" -
 * in the order it happened. `admin_daily_activity()` answers the first as one jsonb document
 * holding the totals and a capped per-person list together, because they are one question:
 * "47 active, and here they are". Two round trips would let the heading disagree with the
 * table under it.
 *
 * The second is `admin_user_timeline()`, opened under the row rather than on a route of its
 * own - it is that row expanded, and a page change would throw away the date, the city and the
 * મંડળ already chosen.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Who counts as active, and who is simply not here
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The server lists a યુવક only if he submitted something on the day. A યુવક who did not is
 * **absent from the list**, and that is the whole of what this page says about him: there is no
 * "did not appear" row, no zero beside his name, no count of who was missing. An empty day is
 * an empty list, not a report about two thousand people (§10, §14).
 *
 * A day whose only ledger entry is a manual adjustment shows nobody, deliberately: an
 * adjustment is a સંચાલક's act and not the યુવક's, so it belongs in the ledger and not in the
 * day's activity. The ledger page is one click away and says so.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The word this page does not use
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `admin_daily_activity()` returns `examFailed`. The number is real and useful - it is the
 * tests that ended with દર્શન still to revise - but the noun is not this panel's: a
 * `REVISION_REQUIRED` attempt is "Revision remaining" on every screen here and never "failed"
 * (§10, §14, and the header of UserActivityPage). The service maps the key to `examRevision`
 * at the boundary so the word cannot leak into a column heading by accident.
 */

/** Levels 1-3 have exactly one activity each; Level 4 rows carry their own title. */
const ACTIVITY_EN = {
  [ACTIVITY_KEY.VIDEO]: 'Video',
  [ACTIVITY_KEY.DARSHAN]: 'Darshan',
  [ACTIVITY_KEY.REVISION]: 'Revision',
};

/**
 * What a timeline row *is*, as against what it was paid.
 *
 * The event vocabulary and the award vocabulary are kept apart on purpose: a row can carry
 * both - a test sat again (EXAM) paid as a REPEAT - and one column holding either would be
 * unreadable. These three are `admin_user_timeline()`'s `kind`.
 */
const EVENT_EN = {
  ATTEMPT: { label: 'Submission', tone: 'info' },
  EXAM: { label: 'Test', tone: 'info' },
  MANUAL: { label: 'Adjustment', tone: 'warn' },
};

/**
 * The two outcomes an attempt can have, in the panel's own words and its quietest tones.
 *
 * `off` - plain grey - for one with દર્શન still to revise. Not `warn`, and certainly not
 * `danger`: an amber pill beside "Revision remaining" would turn a position in the journey into
 * a warning about the person.
 */
const RESULT_EN = {
  [ATTEMPT_STATUS.COMPLETED]: { label: 'Complete', tone: 'ok' },
  [ATTEMPT_STATUS.REVISION_REQUIRED]: { label: 'Revision remaining', tone: 'off' },
};

/**
 * How many યુવકો one read may list.
 *
 * The server clamps `p_limit` to 2,000 and defaults to 500, and these are shares of that rather
 * than numbers of their own. A cap that is reached is stated by the server in `truncated` and
 * repeated on screen, because a day list silently holding the top 500 of 900 is a report
 * claiming a completeness it does not have (§32).
 */
const LIMITS = [100, DAILY_LIMIT, 1000, 2000];

const EXPORT_HINT =
  'Everybody on this day matching the city and zone above, with the columns shown here. No mobile numbers and no email addresses.';

export default function DailyActivityPage() {
  // Only for the export's SMK column - the table's own is dropped by DataTable (0046).
  const { can } = useAdminAuth();
  // The day the panel opens on is today in India, which is the day the server would have
  // chosen for a null `p_date` anyway - stated here so the date field is never empty.
  const [date, setDate] = useState(() => todayIST());
  const [city, setCity] = useState('');
  const [zone, setZone] = useState('');
  const [limit, setLimit] = useState(DAILY_LIMIT);

  /** Whose day is open underneath the list. Null until a row is pressed. */
  const [openUser, setOpenUser] = useState(null); // { uid, name }
  const [tlPage, setTlPage] = useState(0);
  const [tlSize, setTlSize] = useState(20);

  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState(null); // { tone, text }

  /** What the City and મંડળ lists may offer, read from the rows that exist. */
  const optionsQ = useAsync(() => filterOptions(), []);
  const options = optionsQ.data;

  const dayQ = useAsync(() => dailyActivity({ date, city, zone, limit }), [date, city, zone, limit]);
  const day = dayQ.data;
  const rows = day?.rows || [];
  const totals = day?.totals;

  /*
    The timeline is the same day, for one person: `from` and `to` are both this date, so the
    panel underneath can never show a morning from a different day than the row above it.
    Skipped entirely until a row is pressed - this page must cost one read, not one plus a
    speculative second.
  */
  const timelineQ = useAsync(
    () => userTimeline(openUser?.uid, { from: date, to: date, page: tlPage, pageSize: tlSize }),
    [openUser?.uid, date, tlPage, tlSize],
    { skip: !openUser }
  );
  /*
    A key per timeline row, attached to the row itself.

    The three streams `admin_user_timeline()` unions are numbered independently, so there is no
    id to key on and one has to be built from the instant plus what happened at it. DataTable
    calls `rowKey(row)` with the row alone, so the position has to be folded in here rather than
    read from an index that never arrives - and without the position, two attempts recorded in
    the same second would collide and React would drop one of them.
  */
  const tlRows = useMemo(
    () => (timelineQ.data?.rows || []).map((r, i) => ({ ...r, key: timelineKey(r, i) })),
    [timelineQ.data]
  );

  /** The મંડળ list narrows to the chosen city; with no city it offers all of them. */
  const zoneOptions = useMemo(
    () => (options?.zones || []).filter((z) => !city || z.cityId === city),
    [options, city]
  );

  /**
   * Choosing a city can strand the મંડળ underneath it - "Surat + Navsari" would ask a question
   * with no answer and read as a day nobody was active on. The zone is cleared when it no
   * longer belongs and kept when it does, so narrowing a city the સંચાલક was already inside
   * does not throw away the finer filter he set first.
   */
  const pickCity = (next) => {
    closeTimeline();
    setCity(next);
    if (next && zone) {
      const still = (options?.zones || []).some((z) => z.id === zone && z.cityId === next);
      if (!still) setZone('');
    }
  };

  /** Changing the day or the filter invalidates whose morning is open underneath. */
  const closeTimeline = () => {
    setOpenUser(null);
    setTlPage(0);
  };

  const onFilter = (set) => (value) => {
    closeTimeline();
    set(value);
  };

  const openDay = (r) => {
    setTlPage(0);
    // Pressing the same row again closes it. The alternative is a panel that can only ever be
    // opened and a સંચાલક hunting for the control that puts it away (§35).
    setOpenUser((cur) => (cur?.uid === r.uid ? null : { uid: r.uid, name: r.name }));
  };

  // ---- the columns, one definition serving the table and both files -------

  /**
   * §11 — one registry, three consumers: the table, the CSV and the Excel file.
   *
   * No column chooser here, unlike the ledger. Twelve columns is a table that fits, and every
   * one of them answers the page's own question - hiding "Ticks" on a page about what happened
   * today would be hiding the answer. The picker exists on the ledger because seventeen
   * bookkeeping columns genuinely need one.
   *
   * Every label reads on its own, and it has three readers rather than one: it is the column
   * heading, it is the `data-label` DataTable writes onto the `th` and the `td` alike - which is
   * what the mobile hide rules in ledger.css select on - and it is the header cell of the CSV and
   * the Excel file, where there is no table around it at all. "Tests sat" and not "Sat" is that
   * last reader being served.
   */
  const columns = useMemo(
    () => [
      {
        key: 'date',
        label: 'Date',
        // Constant down the column, and it is here for the file rather than the screen: a day's
        // export that lands in a folder beside four others must still say which day it is.
        render: () => dateGu(day?.date || date),
        value: () => day?.date || date,
        type: 'date',
      },
      {
        key: 'name',
        className: 'pl-c-user',
        label: 'Yuvak',
        /*
          The name identifies the row, so it is the column that stays put when the table is swiped
          below 900px. Emphatically not the Date, which is the first column and would be pinned by
          default: this whole list is one day, so that column holds the same value on every single
          row - it is there for the exported file rather than for the screen, and pinning it would
          hold a constant on a phone while the twelve columns that differ scroll away underneath.
        */
        pin: true,
        render: (r) => (
          <Link to={`/progress/${r.uid}`} title={r.name || undefined}>
            {r.name || r.uid.slice(0, 8)}
          </Link>
        ),
        value: (r) => r.name,
      },
      {
        key: 'smk',
        className: 'pl-c-smk',
        label: 'SMK',
        render: (r) => <span className="mono">{r.smk || '-'}</span>,
        value: (r) => r.smk,
      },
      // profiles.zone_id. The business calls it the city; zoneNameEn() is its label helper.
      { key: 'city', className: 'pl-c-city', label: 'City', render: (r) => zoneNameEn(r.cityId), value: (r) => zoneNameEn(r.cityId) },
      // profiles.sub_zone_id — the મંડળ. Yes, the two names are inverted; see the service.
      { key: 'zone', className: 'pl-c-zone', label: 'Zone', render: (r) => subZoneNameEn(r.zoneId), value: (r) => subZoneNameEn(r.zoneId) },
      {
        key: 'darshanSessions',
        label: 'Darshan sessions',
        align: 'right',
        render: (r) => <span className="mono">{gu(r.darshanSessions)}</span>,
        value: (r) => r.darshanSessions,
        type: 'number',
      },
      {
        key: 'revisionSessions',
        label: 'Revision sessions',
        align: 'right',
        render: (r) => <span className="mono">{gu(r.revisionSessions)}</span>,
        value: (r) => r.revisionSessions,
        type: 'number',
      },
      {
        key: 'videoSessions',
        label: 'Video sessions',
        align: 'right',
        render: (r) => <span className="mono">{gu(r.videoSessions)}</span>,
        value: (r) => r.videoSessions,
        type: 'number',
      },
      {
        key: 'ticks',
        label: 'Darshan brought to mind',
        align: 'right',
        /*
          The distinct union across the day's revision submissions, not the sum of their counts:
          a યુવક who ticks the same 40 દ્રશ્યો twice has brought 40 to mind, not 80. The server
          computes it the same way `activity_submit()` does, so the two cannot disagree.

          It is **not** the figure the day's Level 3 points follow, and since 0035 that gap can
          be wide. A repeated પુનરાવર્તન accumulates - 50 then 40 then 30 is 120 ticks of સાધના
          and is paid for 120 - while this column still reads 50 or fewer, because it answers how
          much of the collection he brought to mind rather than how much work he did. Both are
          true. The additive figure is on the Progress page as "Level 3 ticks (total)", and every
          revision behind it is itemised on a yuvak's own progress record.
        */
        render: (r) => (
          <span
            className="mono"
            title="Distinct darshan for the day, counted once each however many times they were revised"
          >
            {gu(r.ticks)}
          </span>
        ),
        value: (r) => r.ticks,
        type: 'number',
      },
      {
        key: 'examAttempts',
        label: 'Tests sat',
        align: 'right',
        render: (r) => <span className="mono">{gu(r.examAttempts)}</span>,
        value: (r) => r.examAttempts,
        type: 'number',
      },
      {
        key: 'examPassed',
        label: 'Tests complete',
        align: 'right',
        render: (r) => <span className="mono">{gu(r.examPassed)}</span>,
        value: (r) => r.examPassed,
        type: 'number',
      },
      {
        key: 'examRevision',
        label: 'Revision remaining',
        align: 'right',
        // The server's `examFailed`, renamed at the service boundary. See the page header.
        render: (r) => <span className="mono">{gu(r.examRevision)}</span>,
        value: (r) => r.examRevision,
        type: 'number',
      },
      {
        key: 'points',
        className: 'pl-c-points',
        label: 'Points on the day',
        align: 'right',
        render: (r) => <span className="mono">{gu(r.points)}</span>,
        value: (r) => r.points,
        type: 'number',
      },
      {
        key: 'open',
        label: 'His day',
        // A button and not a row click: the name in the first column is already a link to his
        // record, and two different destinations on one row is a row nobody presses confidently.
        render: (r) => (
          <button
            className="btn btn-quiet btn-sm"
            type="button"
            aria-expanded={openUser?.uid === r.uid}
            onClick={() => openDay(r)}
          >
            {openUser?.uid === r.uid ? 'Hide' : 'In order'}
          </button>
        ),
        // Nothing to write: a button is not a value, and a column of the word "In order" in a
        // spreadsheet is a column somebody has to delete before sending it on.
        value: () => '',
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [day?.date, date, openUser?.uid]
  );

  const fileColumns = useMemo(
    () =>
      columns
        // The action column has no value, and a blank column in a report is noise a reader has
        // to account for before trusting the rest of the sheet.
        .filter((c) => c.key !== 'open')
        // The SMK column, dropped from the file for the same reason DataTable drops it from
        // the table: without users.smk.read the numbers are not shown in bulk, and an export
        // is the one place a hidden column would otherwise come straight back (0046).
        .filter((c) => c.key !== 'smk' || can('users.smk.read'))
        .map((c) => ({ label: c.label, value: c.value, type: c.type || 'text' })),
    [columns, can]
  );

  /**
   * §11 — the file, and it needs no second fetch.
   *
   * Unlike the ledger, this page already holds every row the server will give it: the read is
   * capped at `limit` and the table shows all of it. So the export writes exactly what is on
   * screen, and when the server said the list was capped the page says so on the file too -
   * a day's report that quietly holds the busiest 500 of 900 people is worse than none (§62).
   */
  const runExport = (format) => {
    setExporting(true);
    setExportNote(null);
    try {
      const csvName = reportFilename('daily-activity', { stamp: day?.date || date });
      const written =
        format === 'xlsx'
          ? exportXlsx({
              filename: xlsxFilename(csvName),
              sheetName: 'Daily activity',
              columns: fileColumns,
              rows,
            })
          : exportCsv({ filename: csvName, columns: fileColumns, rows });

      const what = format === 'xlsx' ? 'Excel file' : 'CSV file';
      setExportNote(
        day?.truncated
          ? {
              tone: 'notice-warn',
              text: `The ${what} holds the ${gu(written)} busiest yuvaks of this day (one read lists ${gu(day.cap)}) - raise "How many to list" and export again.`,
            }
          : {
              tone: 'notice-ok',
              text: `Exported ${gu(written)} yuvak${written === 1 ? '' : 's'} to the ${what}.`,
            }
      );
    } catch (e) {
      setExportNote({ tone: 'notice-warn', text: dataError(e) });
    } finally {
      setExporting(false);
    }
  };

  const filtered = Boolean(city || zone);
  const shownDate = day?.date || date;

  return (
    <>
      <PageHeader
        title="Daily activity"
        sub="What the whole project did on one day - and, one press further in, what each yuvak did, in the order he did it."
      />

      {/* One row of controls: this page has four, so admin.css's own flex `.filters` is right
          and the ledger's grid would be over-building it. */}
      <div className="filters" role="group" aria-label="Choose the day">
        <div className="field">
          <label htmlFor="da-date">Day</label>
          <input
            id="da-date"
            type="date"
            value={date}
            // No `max`: a panel that refuses tomorrow would also refuse it to a સંચાલક whose
            // laptop clock is a day ahead, and an empty day is a perfectly honest answer.
            onChange={(e) => onFilter(setDate)(e.target.value)}
          />
          <span className="hint">Counted in India (IST), midnight to midnight</span>
        </div>

        <div className="field">
          <label htmlFor="da-city">City</label>
          <select id="da-city" value={city} onChange={(e) => pickCity(e.target.value)}>
            <option value="">All cities</option>
            {(options?.cities || []).map((c) => (
              <option key={c.id} value={c.id}>{`${zoneNameEn(c.id)} (${c.count})`}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="da-zone">Zone</label>
          <select id="da-zone" value={zone} onChange={(e) => onFilter(setZone)(e.target.value)}>
            <option value="">{city ? 'All zones in this city' : 'All zones'}</option>
            {zoneOptions.map((z) => (
              <option key={z.id} value={z.id}>{`${subZoneNameEn(z.id)} (${z.count})`}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="da-limit">How many to list</label>
          <select id="da-limit" value={limit} onChange={(e) => onFilter(setLimit)(Number(e.target.value))}>
            {LIMITS.map((n) => (
              <option key={n} value={n}>{gu(n)}</option>
            ))}
          </select>
          <span className="hint">The totals above are the whole day whatever this says</span>
        </div>

        {filtered && (
          <button
            className="btn btn-quiet"
            type="button"
            onClick={() => {
              closeTimeline();
              setCity('');
              setZone('');
            }}
          >
            Clear city and zone
          </button>
        )}
      </div>

      {/* A failed options read is not allowed to look like an organisation with one city in it:
          the lists degrade to "All" and say why, rather than quietly offering fewer choices than
          exist (§34). */}
      {optionsQ.error && (
        <div className="notice notice-warn" role="status">
          The City and Zone lists could not be loaded, so they are showing "All" only. Everything
          else on this page is unaffected.{' '}
          <button className="linklike" type="button" onClick={optionsQ.retry}>Try again</button>
        </div>
      )}

      {/* The totals and the list are one read and share one AsyncBlock: every figure is cut on
          the same day and the same city, and a layout where half of it loaded would invite the
          two halves to be compared. */}
      <AsyncBlock
        state={{ ...dayQ, isEmpty: false }}
        onRetry={dayQ.retry}
        skeleton={<CardSkeleton count={6} />}
      >
        <>
          <div className="grid-stats">
            <StatCard
              label="Yuvaks active"
              value={guCount(totals?.activeUsers)}
              sub={`On ${dateGu(shownDate)}`}
              tone="ok"
            />
            <StatCard
              label="Darshan sessions"
              value={guCount(totals?.darshanSessions)}
              sub="Level 2, one per session carried through"
            />
            <StatCard
              label="Revision submissions"
              value={guCount(totals?.revisionSessions)}
              sub={`${guCount(totals?.ticks)} darshan brought to mind between them`}
            />
            <StatCard
              label="Tests sat"
              value={guCount(totals?.examAttempts)}
              sub={`${guCount(totals?.examPassed)} complete · ${guCount(totals?.examRevision)} with revision remaining`}
            />
            <StatCard
              label="Points awarded"
              value={guCount(totals?.points)}
              sub="Everything the ledger recorded for this day"
            />
          </div>

          {/* Said once, on the page, rather than left to be discovered: this list is who did
              something, and nobody is counted for not appearing. */}
          <p className="card-note">
            Only yuvaks who submitted something on this day are listed - nobody is counted for
            not appearing, and an empty day is simply an empty list. A manual adjustment is a
            sanchalak's act rather than the yuvak's, so it shows in the Point ledger and not
            here.
          </p>

          {day?.truncated && (
            <div className="notice notice-warn" role="status">
              More than {gu(day.cap)} yuvaks were active on this day, so the list below holds the
              busiest {gu(day.cap)}. The totals above are the whole day. Raise "How many to list"
              to see further down.
            </div>
          )}

          <div className="toolbar">
            <span className="grow" />
            <button
              className={`btn btn-quiet${exporting ? ' is-busy' : ''}`}
              type="button"
              title={EXPORT_HINT}
              onClick={() => runExport('csv')}
              disabled={exporting || dayQ.loading || rows.length === 0}
            >
              Export CSV
            </button>
            <button
              className={`btn${exporting ? ' is-busy' : ''}`}
              type="button"
              title={EXPORT_HINT}
              onClick={() => runExport('xlsx')}
              disabled={exporting || dayQ.loading || rows.length === 0}
            >
              Export Excel
            </button>
          </div>

          {exportNote && <div className={`notice ${exportNote.tone}`} role="status">{exportNote.text}</div>}

          {/* The list is its own block inside the day's: the totals above have already loaded
              and an empty list is a fact about the day rather than a failure of the read. */}
          <AsyncBlock
            state={{ loading: false, error: null, isEmpty: rows.length === 0 }}
            emptyIcon="◔"
            emptyTitle="Nobody submitted anything on this day"
            empty={
              filtered
                ? 'No yuvak in this city or zone submitted anything on this day. Try another day, or widen the filter.'
                : 'No yuvak submitted anything on this day. That is all this says - a quiet day is a quiet day.'
            }
            skeleton={<TableSkeleton cols={12} />}
          >
            <>
              <DataTable
                caption="Yuvaks active on this day, most points first"
                columns={columns}
                rows={rows}
                wrapClassName="is-tall"
                rowKey={(r) => r.uid}
              />
              <p className="card-note">
                {gu(rows.length)} yuvak{rows.length === 1 ? '' : 's'}, most points first.
              </p>
            </>
          </AsyncBlock>

          {/* ---------------------------------------------------------------- one yuvak's day */}

          {openUser && (
            <section className="pl-timeline">
              <div className="pl-timeline-head">
                <h2 className="section-title">
                  {openUser.name || 'This yuvak'} - {dateGu(shownDate)}
                </h2>
                <button className="linklike" type="button" onClick={closeTimeline}>Close</button>
              </div>

              {/*
                The second sentence is precise about *why* a blank appears, and it has two
                reasons rather than one. The ordinary one is a rule the સંચાલક chose - the level
                is set to pay once a day, so the second act of the day carries no award of its
                own. That is a **setting** (`earn.levelN`) and not a property of the ledger, and
                since 0035 it is emphatically not true of an accumulating લેવલ ૩, where every
                પુનરાવર્તન has its own row. The other reason is historical: the timeline joins an
                award to its attempt through `point_transactions.attempt_id`, which 0031 added and
                which is null on every row written before it - so an award from before the engine
                is real, is in the ledger, and simply cannot be attached to the act that earned
                it. Saying only the first reason would make an old day read as a day nobody was
                paid for; saying it as a law rather than as a setting would make an accumulating
                લેવલ ૩ read as a fault.
              */}
              <p className="card-note">
                Everything he did on this day, in the order it happened, with what each act was
                paid attached to the act itself rather than listed beside it. A blank in Points
                means no award is attached to that act. Usually that is a rule doing its work: a
                level set to pay once a day gives the second attempt no award of its own, which is
                not a mark against anybody. It is not a law - a Level 3 revision counted per tick
                or per revision is paid every time it is submitted, so each revision on this day
                carries its own figure. On older days a blank means the award was written before
                the rules engine and does not record which attempt paid for it. The Point ledger
                has every award either way.
              </p>

              <AsyncBlock
                state={{
                  ...timelineQ,
                  isEmpty: !timelineQ.loading && !timelineQ.error && tlRows.length === 0 && tlPage === 0,
                }}
                emptyIcon="◷"
                emptyTitle="Nothing recorded for this day"
                empty="No submission of his was recorded on this day."
                onRetry={timelineQ.retry}
                skeleton={<TableSkeleton cols={7} />}
              >
                <>
                  <DataTable
                    caption="One yuvak's day, newest first"
                    columns={[
                      {
                        key: 'at',
                        className: 'pl-c-when',
                        label: 'At',
                        // Every row here is the same yuvak on the same day, so the one thing that
                        // tells two of them apart is the moment - which makes the time the row's
                        // identity and the column that stays put when this is swiped. It is
                        // already first, and saying so anyway is the point: a column reordered
                        // later must not silently move the pin onto whatever ends up leftmost.
                        pin: true,
                        render: (r) => dateTimeGu(r.at),
                      },
                      {
                        key: 'kind',
                        label: 'What happened',
                        render: (r) => {
                          const k = EVENT_EN[r.kind];
                          return k ? (
                            <StatusBadge tone={k.tone}>{k.label}</StatusBadge>
                          ) : (
                            // A kind this bundle does not know about can only come from a later
                            // migration: shown raw rather than as a blank or as the wrong word.
                            <StatusBadge tone="off">{r.kind || '-'}</StatusBadge>
                          );
                        },
                      },
                      {
                        key: 'activity',
                        className: 'pl-c-activity',
                        label: 'Activity',
                        // The level travels in the same cell as the name. Below ~900px this row
                        // is a card with no neighbouring column to borrow context from, so
                        // "Revision" alone would not say which rung it came from.
                        render: (r) => (
                          <>
                            {r.title || ACTIVITY_EN[r.activityKey] || r.activityKey || '-'}
                            <span className="hint pl-sub">{levelLabel(r.levelId)}</span>
                          </>
                        ),
                      },
                      {
                        key: 'attemptNumber',
                        label: 'Attempt that day',
                        align: 'right',
                        // 0 means the row attaches to no attempt at all - a manual adjustment.
                        render: (r) => <span className="mono">{r.attemptNumber > 0 ? gu(r.attemptNumber) : '-'}</span>,
                      },
                      {
                        key: 'items',
                        label: 'Darshan in it',
                        align: 'right',
                        // Levels 1 and 2 have nothing to count but the doing, so they carry no
                        // items and get a dash rather than a misleading 0 of 0.
                        render: (r) =>
                          r.totalItems > 0 ? (
                            <span className="mono">{gu(r.completedItems)} / {gu(r.totalItems)}</span>
                          ) : (
                            <span className="mono">-</span>
                          ),
                      },
                      {
                        key: 'status',
                        label: 'Result',
                        render: (r) => {
                          if (!r.status) return <span className="mono">-</span>;
                          const s = RESULT_EN[r.status];
                          return s ? (
                            <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                          ) : (
                            <StatusBadge tone="off">{r.status}</StatusBadge>
                          );
                        },
                      },
                      {
                        key: 'points',
                        className: 'pl-c-points',
                        label: 'Points',
                        align: 'right',
                        render: (r) => {
                          if (r.points === 0) return <span className="mono">-</span>;
                          const k = awardKind(r);
                          return (
                            <span className="pl-cell">
                              <span className={`mono pl-num${r.points < 0 ? ' pl-neg' : ''}`}>
                                {r.awardKind === 'MANUAL' && r.points > 0 ? '+' : ''}
                                {gu(r.points)}
                              </span>
                              {r.awardKind ? <StatusBadge tone={k.tone}>{k.label}</StatusBadge> : null}
                            </span>
                          );
                        },
                      },
                      {
                        key: 'reason',
                        className: 'pl-c-reason',
                        label: 'Reason and who',
                        // Only an adjustment has either. Both in one cell because they are one
                        // fact: somebody changed the ledger, and this is why and who.
                        render: (r) =>
                          r.reason || r.actorName ? (
                            <>
                              {r.reason || '-'}
                              {r.actorName ? <span className="hint pl-sub">{r.actorName}</span> : null}
                            </>
                          ) : (
                            <span className="mono">-</span>
                          ),
                      },
                    ]}
                    rows={tlRows}
                    rowKey={(r) => r.key}
                  />
                  <Pager
                    page={tlPage}
                    hasNext={!!timelineQ.data?.hasNext}
                    onPrev={() => setTlPage((p) => Math.max(0, p - 1))}
                    onNext={() => setTlPage((p) => p + 1)}
                    pageSize={tlSize}
                    onPageSize={(n) => {
                      setTlPage(0);
                      setTlSize(n);
                    }}
                    busy={timelineQ.loading}
                  />
                </>
              </AsyncBlock>
            </section>
          )}
        </>
      </AsyncBlock>
    </>
  );
}
