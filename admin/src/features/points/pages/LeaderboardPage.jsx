import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { useAdminAuth } from '../../../lib/adminAuth';
import {
  BOARD_LIMIT,
  activityCounts,
  filterOptions,
  leaderboard,
} from '../services/ledgerService';
import DataTable from '../../../components/DataTable';
import { AsyncBlock, CardSkeleton, TableSkeleton } from '../../../components/StateBlocks';
import StatCard, { PageHeader, guCount } from '../../../components/StatCard';
import { dateGu, gu } from '../../../lib/format';
import { dataError } from '../../../lib/errors';
import { exportCsv, reportFilename } from '../../../lib/export';
import { exportXlsx, xlsxFilename } from '../../../lib/xlsx';
import { subZoneNameEn, zoneNameEn } from '../../../lib/labels';
import { getUsersByIds } from '../../users/services/userService';
import { dateIST, normaliseMobile, todayIST } from '../../../../../shared/domain/constants.js';
import '../ledger.css';

/**
 * A stored મોબાઈલ → the two links beside a name on this board.
 *
 * `normaliseMobile()` and not the raw column, though registration already normalises what it
 * stores: this board also lists યુવકો whose rows were imported from a spreadsheet or seeded, and
 * a '+91 96012 69715' that reached the table by one of those routes would build `wa.me/+91 960…`
 * and open WhatsApp on nothing. It strips a country code and any punctuation and answers ten
 * digits or fewer, so the guard below is a length test rather than a regex.
 *
 * The country code is added back for WhatsApp because wa.me requires one and has no default —
 * a bare ten digits opens a "phone number shared via url is invalid" page. `tel:` is the
 * opposite: the handset's own dialler knows where it is, so the plain number is what a person
 * would have typed and is what shows in the call log.
 *
 * Null when there is no usable number, and the caller draws nothing rather than a dead button.
 */
function contactLinks(mobile) {
  const ten = normaliseMobile(mobile);
  if (ten.length !== 10) return null;
  return { ten, wa: `https://wa.me/91${ten}`, tel: `tel:${ten}` };
}

/**
 * §16, §38 — the board, as a સંચાલક needs to see it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Not a second scoring system
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `admin_leaderboard()` is the same `sum(point_transactions.points)` that `leaderboard()`
 * (0023) computes for the યુવક. §16 is explicit that there must not be two, and there are not:
 * one ledger, one sum, one ranking rule. What the admin function adds is a free date window
 * instead of the four fixed periods, and the three fields the યુવક's board must never carry -
 * the user id, the city and the મંડળ - so a સંચાલક can find the person behind a number.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The privacy contract this page does not touch
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `leaderboard()` returns a name and a number and **never a user id**, deliberately. That is
 * the યુવક-facing contract, and nothing on this page can change it: there is no control here
 * that writes to `leaderboard_settings`, no toggle that widens what the app publishes, and no
 * read of the યુવક's function at all. This is a separate, permission-gated view of the same
 * arithmetic, and it stops at this screen.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why the rank does not renumber when the board is filtered
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The rank is computed over the whole project **before** the city and zone filter is applied,
 * so narrowing to સુરત shows each યુવક's place among everybody rather than his place among the
 * people left on screen. Two consequences the page states in words rather than leaving to be
 * discovered: the first row of a filtered board is usually not rank 1, and the ranks have gaps.
 * Both are the board agreeing with the one the યુવક himself sees, which is the point.
 *
 * Ties share a place - two યુવકો on 800 are both 3rd - because that is what `rank()` means and
 * what 0023 already does.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Tone (§10, §14)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A board is the one screen in this panel that is inherently a comparison, so it is kept to
 * exactly that: who earned what in a window. Nobody is marked as behind, nothing counts a day
 * anybody was away, and a યુવક who earned nothing is not on the board at all rather than being
 * printed last - the server excludes him (`having sum(points) > 0`), which is the right
 * answer: he has no standing to report, not a bad one.
 */

/** What the board may show at once. `admin_leaderboard()` clamps `p_limit` to 500. */
const TOP_N = [10, BOARD_LIMIT, 50, 100, 500];

const EXPORT_HINT =
  'The board exactly as shown - the same window, the same city and zone, the same number of places. No mobile numbers and no email addresses.';

export default function LeaderboardPage() {
  // Only for the export's SMK column - the table's own is dropped by DataTable (0046).
  const { can } = useAdminAuth();
  // The window opens on the last thirty days rather than on all time: a board over the whole
  // history is a list of whoever joined first, which is a fact about the calendar and not about
  // this month. -29 and not -30 because both ends are included.
  const [from, setFrom] = useState(() => dateIST(-29));
  const [to, setTo] = useState(() => todayIST());
  const [city, setCity] = useState('');
  const [zone, setZone] = useState('');
  const [limit, setLimit] = useState(BOARD_LIMIT);
  const [withCounts, setWithCounts] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState(null); // { tone, text }

  /** What the City and મંડળ lists may offer, read from the rows that exist. */
  const optionsQ = useAsync(() => filterOptions(), []);
  const options = optionsQ.data;

  const boardQ = useAsync(() => leaderboard({ from, to, city, zone, limit }), [from, to, city, zone, limit]);
  const board = boardQ.data;
  const rows = board?.rows || [];

  /*
    The ids on screen, as one string, so the counts read below re-runs when the board changes
    and not when React happens to hand back a new array of the same people.
  */
  const idsKey = rows.map((r) => r.uid).join(',');

  /**
   * What the people on the board actually did in the same window - on request.
   *
   * Opt-in rather than always: it is a second RPC that aggregates the attempt tables for up to
   * five hundred યુવકો, and the board answers its own question without it. Skipped entirely
   * while the toggle is off, so the ordinary visit is one read.
   *
   * **Only the window-respecting columns are used.** `admin_activity_counts()` also returns
   * `points_total` and `rank`, and both are computed with no date predicate at all - they are
   * lifetime figures whatever the dates say. Printing a lifetime total beside this board's
   * windowed points would put two different numbers for "his points" on one row, and the reader
   * would have no way to tell which of them was wrong. The service maps them under
   * `lifetimePoints` and `lifetimeRank` so the distinction cannot be lost by accident, and this
   * page uses neither.
   */
  const countsQ = useAsync(
    () => activityCounts(rows.map((r) => r.uid), { from, to }),
    [idsKey, from, to],
    { skip: !withCounts || rows.length === 0 }
  );
  const counts = countsQ.data;

  /**
   * The મોબાઈલ behind each row, for the WhatsApp and Call actions.
   *
   * A second read for the ids already on screen, exactly as `countsQ` above is, and for the
   * same reason: `admin_leaderboard()` does not return a phone number and must not start to.
   * That function is 0032's, it is shaped by what a *board* is, and widening its SELECT to
   * carry contact details would mean every caller of it — including the export path — began
   * carrying them whether it wanted them or not. `getUsersByIds()` already exists, already
   * batches at 200 ids, and reads the same `yuvaks` view the Users page reads, so the number
   * shown here is the number shown there and there is no second source for it.
   *
   * **Unconditional, unlike `countsQ`.** The activity columns are behind a toggle because they
   * are a report; a phone number is how a સંચાલક acts on what the board just told him, and
   * making him tick a box first would be putting the point of the page behind a preference.
   *
   * A failure here costs the two buttons and nothing else — see the notice by the table. RLS
   * decides what comes back: the `yuvaks` view is gated on `users.read`, which every admin role
   * that can open this page already holds, so a VIEWER sees the number too. That is deliberate:
   * he is on this page precisely to look, and a board he cannot act on is a board he has to
   * take to somebody else.
   */
  const contactsQ = useAsync(
    () => getUsersByIds(rows.map((r) => r.uid)),
    [idsKey],
    { skip: rows.length === 0 }
  );
  const contacts = contactsQ.data;

  /** The board's rows with their counts folded in, so one array builds the table and the file. */
  const tableRows = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        counts: counts?.get(r.uid) || null,
        mobile: contacts?.get(r.uid)?.mobile || '',
      })),
    [rows, counts, contacts]
  );

  /** The મંડળ list narrows to the chosen city; with no city it offers all of them. */
  const zoneOptions = useMemo(
    () => (options?.zones || []).filter((z) => !city || z.cityId === city),
    [options, city]
  );

  /**
   * Choosing a city can strand the મંડળ underneath it - "Surat + Navsari" would ask a question
   * with no answer and read as a board nobody is on.
   */
  const pickCity = (next) => {
    setCity(next);
    if (next && zone) {
      const still = (options?.zones || []).some((z) => z.id === zone && z.cityId === next);
      if (!still) setZone('');
    }
  };

  const quickRange = (f, t) => {
    setFrom(f);
    setTo(t);
  };

  // ---- the columns, one definition serving the table and both files -------

  /**
   * §11 — one registry, three consumers: the table, the CSV and the Excel file.
   *
   * The activity columns appear only when they have been asked for, and they are appended
   * rather than interleaved, so the board reads as a board first and a report second. Every
   * label reads on its own, and it has three readers rather than one: it is the column heading,
   * it is the `data-label` DataTable writes onto the `th` and the `td` alike - which is what the
   * mobile hide rules in ledger.css select on - and it is the header cell of the CSV and the
   * Excel file, where there is no table around it at all. "Points in this range" and not "Points"
   * is that last reader being served.
   */
  const columns = useMemo(() => {
    /** A count that has not arrived yet is absent, never 0: 0 is a claim about a યુવક. */
    const count = (get) => ({
      render: (r) => <span className="mono">{r.counts ? gu(get(r.counts)) : '-'}</span>,
      value: (r) => (r.counts ? get(r.counts) : ''),
      type: 'number',
    });

    const base = [
      {
        key: 'rank',
        label: 'Place',
        align: 'right',
        // The whole project's place, not the position in this list. See the page header for why
        // a filtered board starts at 7th and has gaps.
        render: (r) => <span className="mono">{r.rank == null ? '-' : gu(r.rank)}</span>,
        value: (r) => (r.rank == null ? '' : r.rank),
        type: 'number',
      },
      {
        key: 'name',
        className: 'pl-c-user',
        label: 'Yuvak',
        /*
          The name and not the Place, though the Place is first and this is a board.

          It was a genuine choice, and it turns on what a pinned column is for: it answers "whose
          row am I looking at" while everything else slides under the thumb. A place cannot answer
          that here. Ties share a place - two યુવકો on 800 are both 3rd - so the number is not even
          unique down the column, and on a board filtered to one city the ranks are the whole
          project's and have gaps, so "7th, 11th, 12th" pinned beside scrolling figures is a column
          of trivia. The name is what a સંચાલક is reading across to, and it is what he needs held
          still while he swipes out to the activity columns.
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
        key: 'points',
        className: 'pl-c-points',
        label: 'Points in this range',
        align: 'right',
        // The window's sum, which is what the board is ordered by. Named for the range so it
        // can never be read as a lifetime total.
        render: (r) => <span className="mono">{gu(r.points)}</span>,
        value: (r) => r.points,
        type: 'number',
      },
      {
        key: 'mobile',
        className: 'pl-c-mobile',
        label: 'Mobile',
        /*
          Latin digits, not gu(). Every other number on this board is a quantity and is read;
          this one is dialled, checked against a contact list and read aloud down a phone, and
          '૯૬૦૧૨૬૯૭૧૫' cannot be done any of those things with by somebody whose contacts are
          in Latin. format.js's gu() is for figures; an identifier is not a figure — the SMK
          column beside it makes the same call.
        */
        render: (r) => <span className="mono">{r.mobile || '-'}</span>,
        // Text, not number: a leading zero must survive the trip into Excel, and a mobile is
        // never summed or sorted arithmetically.
        value: (r) => r.mobile,
      },
      {
        key: 'contact',
        className: 'pl-c-contact',
        label: 'Contact',
        /*
          Two links, and deliberately links rather than buttons with onClick handlers: an <a>
          with an href is what a browser and a phone already know how to hand to another app.
          `wa.me` opens WhatsApp — the installed app on a phone, web.whatsapp.com on a laptop,
          Google's own choice either way — and `tel:` opens the dialler.

          `rel="noreferrer"` on the WhatsApp one and no `target` on the dialler: a `tel:` never
          navigates, so a `_blank` would leave an empty tab behind on desktop.

          Drawn only when there is a number to dial. A disabled-looking button beside a name
          with no મોબાઈલ would read as "the action failed", when the truth is that this યુવક has
          no number on file — the '-' in the column beside it already says so once.
        */
        render: (r) => {
          const c = contactLinks(r.mobile);
          if (!c) return <span className="hint">-</span>;
          return (
            <span className="pl-contact">
              <a
                className="btn btn-quiet btn-sm"
                href={c.wa}
                target="_blank"
                rel="noreferrer"
                // The name, so a screen reader hears whose WhatsApp this opens rather than the
                // same two words repeated down the whole column.
                aria-label={`WhatsApp ${r.name || c.ten}`}
                title={`WhatsApp ${c.ten}`}
              >
                WhatsApp
              </a>
              <a
                className="btn btn-quiet btn-sm"
                href={c.tel}
                aria-label={`Call ${r.name || c.ten}`}
                title={`Call ${c.ten}`}
              >
                Call
              </a>
            </span>
          );
        },
        /*
          No `value`, and that is what keeps it out of the CSV and the Excel file — see
          fileColumns below. A column of two links is a control, not a fact about a યુવક, and a
          spreadsheet cell reading "WhatsApp Call" would be neither.
        */
      },
    ];

    if (!withCounts) return base;

    return [
      ...base,
      { key: 'darshanSessions', label: 'Darshan sessions', align: 'right', ...count((c) => c.darshanSessions) },
      { key: 'revisionSessions', label: 'Revision sessions', align: 'right', ...count((c) => c.revisionSessions) },
      // The distinct union of દ્રશ્યો across the window's revision submissions, minus anything
      // withheld - not the sum of their counts, and never above the live collection. Since 0035
      // it is therefore **not** the figure the board's Level 3 points follow: a repeated
      // પુનરાવર્તન accumulates (50 then 40 then 30 is paid as 120) while this column still reads
      // 50, because it answers how much of the collection he holds rather than how much work he
      // did. Both are true, and the additive one lives on the Progress page.
      { key: 'ticks', label: 'Darshan brought to mind', align: 'right', ...count((c) => c.ticks) },
      { key: 'examAttempts', label: 'Tests sat', align: 'right', ...count((c) => c.examAttempts) },
      { key: 'examPassed', label: 'Tests complete', align: 'right', ...count((c) => c.examPassed) },
      { key: 'attemptsAll', label: 'All-level attempts', align: 'right', ...count((c) => c.attemptsAll) },
    ];
  }, [withCounts]);

  /*
    The export's shape, and the one column that is not in it.

    §11's rule is still one registry for three consumers, and this is not a second list — it is
    the same array with the columns that have no `value` dropped. A column without one is by
    definition not a fact that can be written to a cell: `contact` renders two links and holds
    nothing a spreadsheet could carry. Filtering on `value` rather than on the key means a
    future control column is excluded by being what it is, instead of by somebody remembering
    to add its name here.

    `mobile` HAS a value and so is exported, which is the right answer: a સંચાલક who exports
    the board to work through it later needs the numbers in the file, not only on the screen.
  */
  const fileColumns = useMemo(
    () =>
      columns
        .filter((c) => typeof c.value === 'function')
        // The SMK column, dropped from the file for the same reason DataTable drops it from
        // the table: without users.smk.read the numbers are not shown in bulk, and an export
        // is the one place a hidden column would otherwise come straight back (0046).
        .filter((c) => c.key !== 'smk' || can('users.smk.read'))
        .map((c) => ({ label: c.label, value: c.value, type: c.type || 'text' })),
    [columns, can]
  );

  /**
   * §11 — the file, and it needs no second fetch: the board is already the whole of what the
   * server will give for this window, so the export writes exactly what is on screen.
   */
  const runExport = (format) => {
    setExporting(true);
    setExportNote(null);
    try {
      const csvName = reportFilename('leaderboard', { from, to, stamp: todayIST() });
      const written =
        format === 'xlsx'
          ? exportXlsx({
              filename: xlsxFilename(csvName),
              sheetName: 'Leaderboard',
              columns: fileColumns,
              rows: tableRows,
            })
          : exportCsv({ filename: csvName, columns: fileColumns, rows: tableRows });

      const what = format === 'xlsx' ? 'Excel file' : 'CSV file';
      setExportNote({
        tone: 'notice-ok',
        text: `Exported ${gu(written)} place${written === 1 ? '' : 's'} to the ${what}, out of ${gu(board?.participants ?? 0)} yuvaks who earned anything in this range.`,
      });
    } catch (e) {
      setExportNote({ tone: 'notice-warn', text: dataError(e) });
    } finally {
      setExporting(false);
    }
  };

  const filtered = Boolean(city || zone);

  /**
   * The window in words, and each end said only as far as it is set.
   *
   * Either bound may be blank - a સંચાલક who fills in only "From" is asking for everything
   * since then - so this cannot be one sentence with two dates dropped into it. A blank date
   * rendered by dateGu() is "-", and "Between - and 14 Aug 2026" reads as a broken read.
   */
  const rangeText =
    from && to
      ? `Between ${dateGu(from)} and ${dateGu(to)}`
      : from
        ? `Since ${dateGu(from)}`
        : to
          ? `Up to ${dateGu(to)}`
          : 'Over the whole history';

  return (
    <>
      <PageHeader
        title="Leaderboard"
        sub="The same points the app already shows a yuvak, over any range you choose - with the city and zone the app deliberately never publishes."
      />

      <div className="filters" role="group" aria-label="Choose the range and the places to show">
        <div className="field">
          <label htmlFor="lb-from">From</label>
          <input
            id="lb-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="lb-to">Up to</label>
          <input
            id="lb-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
          <span className="hint">Both days included, counted in India (IST)</span>
        </div>

        <div className="field">
          <label htmlFor="lb-city">City</label>
          <select id="lb-city" value={city} onChange={(e) => pickCity(e.target.value)}>
            <option value="">All cities</option>
            {(options?.cities || []).map((c) => (
              <option key={c.id} value={c.id}>{`${zoneNameEn(c.id)} (${c.count})`}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="lb-zone">Zone</label>
          <select id="lb-zone" value={zone} onChange={(e) => setZone(e.target.value)}>
            <option value="">{city ? 'All zones in this city' : 'All zones'}</option>
            {zoneOptions.map((z) => (
              <option key={z.id} value={z.id}>{`${subZoneNameEn(z.id)} (${z.count})`}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="lb-top">Places to show</label>
          <select id="lb-top" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {TOP_N.map((n) => (
              <option key={n} value={n}>{`Top ${gu(n)}`}</option>
            ))}
          </select>
          <span className="hint">Counted after the city and zone filter, so a filtered board still fills</span>
        </div>

        <div className="field">
          <label className="check" htmlFor="lb-counts">
            <input
              id="lb-counts"
              type="checkbox"
              checked={withCounts}
              onChange={(e) => setWithCounts(e.target.checked)}
            />
            Show what they did
          </label>
          <span className="hint">
            Sessions, darshan brought to mind and tests over the same range - one extra read, so
            it is off unless asked for
          </span>
        </div>
      </div>

      <div className="pl-actions" role="group" aria-label="Date range presets">
        <button className="btn btn-quiet" type="button" onClick={() => quickRange(todayIST(), todayIST())}>
          Today
        </button>
        <button className="btn btn-quiet" type="button" onClick={() => quickRange(dateIST(-6), todayIST())}>
          Last 7 days
        </button>
        <button className="btn btn-quiet" type="button" onClick={() => quickRange(dateIST(-29), todayIST())}>
          Last 30 days
        </button>
        <button className="btn btn-quiet" type="button" onClick={() => quickRange('', '')}>
          All time
        </button>
        {filtered && (
          <button className="btn btn-quiet" type="button" onClick={() => { setCity(''); setZone(''); }}>
            Clear city and zone
          </button>
        )}
      </div>

      {optionsQ.error && (
        <div className="notice notice-warn" role="status">
          The City and Zone lists could not be loaded, so they are showing "All" only. Everything
          else on this page is unaffected.{' '}
          <button className="linklike" type="button" onClick={optionsQ.retry}>Try again</button>
        </div>
      )}

      <AsyncBlock
        // isEmpty is never true here: a board of nobody is still an answer, and the table's own
        // empty state below says it in the right words.
        state={{ ...boardQ, isEmpty: false }}
        onRetry={boardQ.retry}
        skeleton={<CardSkeleton count={3} />}
      >
        <>
          <div className="grid-stats">
            <StatCard
              label="Yuvaks who earned points"
              value={guCount(board?.participants)}
              // The denominator of the rank, and deliberately not the length of the list: the
              // list is the top N after filtering, and the rank is over everybody.
              sub={rangeText}
              tone="ok"
            />
            <StatCard
              label="Places shown"
              value={guCount(board?.shown)}
              sub={filtered ? 'After the city and zone filter' : 'The top of the whole project'}
            />
            <StatCard
              label="Points earned in total"
              value={guCount(board?.totalPoints)}
              sub="Everybody in this range, not only those shown"
            />
          </div>

          <p className="card-note">
            Places are the whole project's, worked out before the city and zone filter - so a
            filtered board may start at 7th and may skip numbers, and that is the point: it
            agrees with the board the yuvak himself sees. Yuvaks on the same total share a place.
            Anybody who earned nothing in this range is not on the board at all, which is the
            honest answer - there is no standing to report, rather than a poor one.
          </p>

          {/* The counts are a second read, and a failed one must not be allowed to look like a
              row of zeroes beside a person's name (§53). The board stays; the extra columns say
              they could not be read. */}
          {withCounts && countsQ.error && (
            <div className="notice notice-warn" role="status">
              The activity columns could not be read, so they are showing "-". The places and
              points beside them are unaffected.{' '}
              <button className="linklike" type="button" onClick={countsQ.retry}>Try again</button>
            </div>
          )}

          {/* Same rule as the counts notice above it (§53): a number that could not be read is
              not a યુવક with no phone, and the difference has to be on screen or every missing
              row reads as a person who never gave one. The board itself is untouched. */}
          {contactsQ.error && (
            <div className="notice notice-warn" role="status">
              The mobile numbers could not be read, so the Contact actions are not showing. The
              board itself is unaffected.{' '}
              <button className="linklike" type="button" onClick={contactsQ.retry}>Try again</button>
            </div>
          )}

          <div className="toolbar">
            <span className="grow" />
            <button
              className={`btn btn-quiet${exporting ? ' is-busy' : ''}`}
              type="button"
              title={EXPORT_HINT}
              onClick={() => runExport('csv')}
              disabled={exporting || boardQ.loading || rows.length === 0}
            >
              Export CSV
            </button>
            <button
              className={`btn${exporting ? ' is-busy' : ''}`}
              type="button"
              title={EXPORT_HINT}
              onClick={() => runExport('xlsx')}
              disabled={exporting || boardQ.loading || rows.length === 0}
            >
              Export Excel
            </button>
          </div>

          {exportNote && <div className={`notice ${exportNote.tone}`} role="status">{exportNote.text}</div>}

          <AsyncBlock
            /*
              `loading: false` even while the counts are in flight, deliberately. The board is
              already here and hiding it behind a skeleton to fetch six extra columns would take
              away the answer to fetch the footnote. The count cells read "-" until they land,
              which is what they should say when the number is genuinely not known yet.
            */
            state={{ loading: false, error: null, isEmpty: rows.length === 0 }}
            emptyIcon="◇"
            emptyTitle="Nobody has earned points in this range"
            empty={
              filtered
                ? 'No yuvak in this city or zone earned points in this range. Try a wider range, or clear the filter.'
                : 'Nothing appears here until points are switched on in Settings and a yuvak finishes an activity. An empty board usually means points were off.'
            }
            skeleton={<TableSkeleton cols={Math.max(1, columns.length)} />}
          >
            <DataTable
              caption="Leaderboard, highest points first"
              columns={columns}
              rows={tableRows}
              wrapClassName="is-tall"
              rowKey={(r) => r.uid}
            />
          </AsyncBlock>
        </>
      </AsyncBlock>

      <p className="card-note">
        This board is the panel's own view. The app's leaderboard shows a yuvak names and
        numbers and never a user id, and nothing on this page changes what it publishes - what
        is switched on for yuvaks lives in Settings.
      </p>
    </>
  );
}
