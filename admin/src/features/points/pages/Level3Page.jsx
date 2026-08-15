import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import DataTable, { Pager } from '../../../components/DataTable';
import { AsyncBlock, TableSkeleton } from '../../../components/StateBlocks';
import { PageHeader } from '../../../components/StatCard';
import { dateTimeGu, gu } from '../../../lib/format';
import { dataError } from '../../../lib/errors';
import { exportCsv, istDate, reportFilename } from '../../../lib/export';
import { exportXlsx, xlsxFilename } from '../../../lib/xlsx';
import { subZoneNameEn, zoneNameEn } from '../../../lib/labels';
import { dateIST, todayIST } from '../../../../../shared/domain/constants.js';
import {
  DAY_ACTIVITY,
  DEFAULT_DIR,
  DEFAULT_SORT,
  EXPORT_CAP,
  buildLevel3Report,
  dayActivityLabel,
  filterOptions,
  level3Error,
  level3Users,
} from '../services/level3Service';
import '../ledger.css';

/**
 * §29 - the Level 3 report: who has done how much પુનરાવર્તન, and who did none.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this is a page of its own, beside a Progress page that already has the columns
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Progress shows Level 3 revisions, ticks and points, and they are the same figures this page
 * shows. What Progress cannot do is *filter* on them, and the reason is structural rather than
 * an omission somebody can patch: those columns arrive from a second call
 * (`admin_level3_report()`) that is handed the page of user ids the progress report has already
 * chosen. The paging, the sorting and the count all happen before the Level 3 figures exist.
 *
 * So "show the yuvaks with 50 or more Level 3 points" asked there could only ever mean "of the
 * twenty rows this page happens to be showing". The count under the table would still say 2,000,
 * the pager would still offer page 4 of 100, and the answer would be a filter of one page wearing
 * the clothes of a report. That is a wrong answer that looks like a right one, which is the
 * failure this whole reporting layer is built to avoid (§62) - so §29's questions get a reader of
 * their own, `admin_level3_users()`, where every threshold is a predicate in Postgres and the
 * count beneath the table is the whole filtered set.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * "Did not do Level 3" is asked for as an absence, never as a minimum of zero
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The three numeric filters on this page are all "at least" bounds, and every one of the panel's
 * other reports is built the same way. An absence cannot be expressed with one: "at least 0
 * ticks" matches everybody, because every count is zero or more, and there is no maximum
 * parameter to say the opposite with. So the day control is a **three-valued** select - Any, Did
 * Level 3, Did not - and the third option sends `p_active = false`, which 0035 reads as
 * `today_revisions = 0` over a set that starts at `profiles` rather than at the attempts table.
 * A yuvak who has never opened Level 3 is therefore *in* that answer instead of missing from it,
 * which is the entire point of asking.
 *
 * A checkbox would have been the smaller control and the wrong one: two states cannot carry three
 * answers, and folding "do not ask" into one of the two would silently narrow or silently widen
 * the report depending on which way it was folded.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Two honest counts of the same ticks, side by side
 * ────────────────────────────────────────────────────────────────────────────
 *
 * "Ticks (total)" is additive across revisions: 50 then 40 then 30 is 120, and it is the figure
 * the points follow since 0035 made a repeated revision earn again. "Distinct darshan" is the
 * de-duplicated set behind those same ticks: 50. Both are true of the same yuvak at the same
 * instant and they answer different questions - how much revision he did, and how much of the
 * collection he brought to mind. Both columns are here, each says which it is in its own title,
 * and neither is ever printed under the other's heading.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Tone (§10, §14)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * "Did not" is a fact about a day. It is not "inactive", not "missed", not "pending", and the
 * rows it produces carry no red anything: a yuvak who did no revision today is a row of zeroes in
 * plain type. The list exists so a sanchalak can go and ask after somebody, which is a reason to
 * keep the words neutral rather than a reason to score him.
 */

/**
 * profiles.status in words, for the filter and for the chip that says it is on.
 *
 * The same three the Progress page carries, spelled the same way: §7 suspends and never deletes,
 * so SUSPENDED is a value a સંચાલક will meet in this list and it must not read as ACTIVE. Only
 * the words are needed here - status is a filter on this page and not a column, so there is no
 * badge and no tone to choose. Declared rather than imported because the Progress page keeps its
 * copy private, and a page reaching into another page's constants is a coupling between two
 * screens that have no other business with each other.
 *
 * An unrecognised token from a later migration is shown raw rather than as a blank, which would
 * read as an option with no name.
 */
const ACCOUNT_STATUS = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  DISABLED: 'Disabled',
};

const accountStatus = (id) => ACCOUNT_STATUS[id] || id || '-';

/**
 * §29's own thresholds, offered as presets beside a free number field.
 *
 * "50 or more Level 3 points" and "more than 100 ticks" are the two the requirement asks for by
 * name, so they are one press rather than something to type. They are presets and not the only
 * choices: the field takes any number, because the next question will be a different figure.
 */
const POINT_PRESETS = [50, 100, 250, 500];
const TICK_PRESETS = [50, 100, 250, 500];
const REVISION_PRESETS = [1, 5, 10, 25];

/** What both export buttons do, said on the buttons rather than in a line of page prose. */
const EXPORT_HINT =
  'Every yuvak matching the filters above - not just this page - with the columns shown here. No mobile numbers and no email addresses.';

/** Said once, beside the two columns it separates, so neither has to carry the whole sentence. */
const TICKS_HINT =
  'Every tick of every revision added together, so the same darshan revised twice counts twice. This is the figure the points follow.';
const SCENES_HINT =
  'Distinct darshan across all his revisions, counted once each however many times they were revised. Withheld darshan are not counted.';

export default function Level3Page() {
  // ---- the filters, all of them server-side -------------------------------
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [city, setCity] = useState('');
  const [zone, setZone] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  /*
    The day the three "today" columns describe, and the day the Did / Did not question is asked
    of. It opens on today in India, which is the day the server would have chosen for a null
    `p_day` anyway - stated here so the field is never empty and the columns can name the day they
    are about. Cleared, it hands the choice back to the server, which is where the boundary of the
    business day belongs.
  */
  const [onDay, setOnDay] = useState(() => todayIST());
  const [active, setActive] = useState('ANY');

  const [minPoints, setMinPoints] = useState('');
  const [minTicks, setMinTicks] = useState('');
  const [minRevisions, setMinRevisions] = useState('');

  const [sortField, setSortField] = useState(DEFAULT_SORT);
  const [sortDir, setSortDir] = useState(DEFAULT_DIR);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState(null); // { tone, text }

  /**
   * §84 - the search box is debounced, and that is a cost decision as much as a UX one.
   *
   * `admin_level3_users()` aggregates every Level 3 attempt in the window and joins it onto the
   * whole of `profiles`. Firing that on every keystroke of "prakash" is seven of those passes to
   * answer one question, and six of them are already stale when they land. The page returns to
   * one, because "page 3 of the old term" is not a page of the new one.
   */
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(term.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(id);
  }, [term]);

  /** Every filter change starts the list again, for the same reason. */
  const onFilter = (set) => (value) => {
    setPage(0);
    set(value);
  };

  /** What the City, મંડળ and Status lists may offer, read from the rows that exist. */
  const optionsQ = useAsync(() => filterOptions(), []);
  const options = optionsQ.data;

  const filters = useMemo(
    () => ({
      search,
      city,
      zone,
      status,
      from,
      to,
      day: onDay,
      active,
      minPoints,
      minTicks,
      minRevisions,
      sort: sortField,
      dir: sortDir,
    }),
    [search, city, zone, status, from, to, onDay, active, minPoints, minTicks, minRevisions, sortField, sortDir]
  );

  const report = useAsync(() => level3Users(filters, { page, pageSize }), [filters, page, pageSize]);

  const missing = report.data?.missing === true;
  const forbidden = report.data?.forbidden === true;
  const rows = report.data?.rows || [];
  const total = report.data?.total ?? 0;
  const pageCount = report.data?.pageCount ?? 0;

  /** The મંડળ list narrows to the chosen city; with no city it offers all of them. */
  const zoneOptions = useMemo(
    () => (options?.zones || []).filter((z) => !city || z.cityId === city),
    [options, city]
  );

  /**
   * Choosing a city can strand the મંડળ underneath it - "Surat + Navsari" would ask a question
   * with no answer and read as a city where nobody has done any પુનરાવર્તન. The zone is cleared
   * when it no longer belongs and kept when it does, so narrowing a city the સંચાલક was already
   * inside does not throw away the finer filter he set first.
   */
  const pickCity = (next) => {
    setPage(0);
    setCity(next);
    if (next && zone) {
      const still = (options?.zones || []).some((z) => z.id === zone && z.cityId === next);
      if (!still) setZone('');
    }
  };

  const quickRange = (f, t) => {
    setPage(0);
    setFrom(f);
    setTo(t);
  };

  const clearAll = () => {
    setPage(0);
    setTerm('');
    setSearch('');
    setCity('');
    setZone('');
    setStatus('');
    setFrom('');
    setTo('');
    setActive('ANY');
    setMinPoints('');
    setMinTicks('');
    setMinRevisions('');
    // The day itself is not cleared. It is not a filter - it decides which day three of the
    // columns describe - and resetting it to blank would leave those headings unable to say
    // which day they mean.
    setOnDay(todayIST());
  };

  /*
    Which day the three "today" columns are about, and whether it is genuinely today.

    A blank field means the server chose, and the server chooses today in IST - so this browser's
    idea of today is used for the *label* only, never sent as a parameter. The two can disagree by
    a day for a સંચાલક sitting in another timezone at midnight, and the wording below is what
    keeps that from becoming a false claim: when the day is not today the heading names the date
    instead of saying "today".
  */
  const shownDay = onDay || todayIST();
  const isToday = shownDay === todayIST();
  // The plain YYYY-MM-DD and not dateGu(), because this string becomes a column heading and a
  // column heading becomes a header cell in the CSV and the Excel file. A date rendered for the
  // eye is a heading a spreadsheet cannot be sorted or filtered by, and the chips above already
  // state the range the same way.
  const dayWord = isToday ? 'today' : `on ${shownDay}`;

  /**
   * Every filter currently narrowing the report, as one list.
   *
   * One list and not two: the chips and the count are the same fact, and deriving both from here
   * means a filter cannot be active and invisible - which is the failure that matters, because a
   * report narrowed by something the સંચાલક cannot see is a report read as the whole.
   */
  const activeFilters = [
    search.trim() && {
      key: 'search',
      label: `Search: ${search.trim()}`,
      clear: () => {
        setTerm('');
        setSearch('');
      },
    },
    city && { key: 'city', label: `City: ${zoneNameEn(city)}`, clear: () => setCity('') },
    zone && { key: 'zone', label: `Zone: ${subZoneNameEn(zone)}`, clear: () => setZone('') },
    status && { key: 'status', label: `Status: ${accountStatus(status)}`, clear: () => setStatus('') },
    from && { key: 'from', label: `From ${from}`, clear: () => setFrom('') },
    to && { key: 'to', label: `To ${to}`, clear: () => setTo('') },
    // The day travels inside this chip rather than as one of its own: on its own the day narrows
    // nothing, and a chip for it would claim a filter that is not there.
    active !== 'ANY' && {
      key: 'active',
      label: `${dayActivityLabel(active)} ${dayWord}`,
      clear: () => setActive('ANY'),
    },
    minPoints !== '' && {
      key: 'minPoints',
      label: `At least ${gu(minPoints)} Level 3 points`,
      clear: () => setMinPoints(''),
    },
    minTicks !== '' && {
      key: 'minTicks',
      label: `At least ${gu(minTicks)} ticks`,
      clear: () => setMinTicks(''),
    },
    minRevisions !== '' && {
      key: 'minRevisions',
      label: `At least ${gu(minRevisions)} revisions`,
      clear: () => setMinRevisions(''),
    },
  ].filter(Boolean);

  const activeCount = activeFilters.length;
  const filtered = activeCount > 0;

  /** Dropping one condition is still a new query, so it goes back to the first page. */
  const dropFilter = (f) => {
    setPage(0);
    f.clear();
  };

  const applySort = (field, dir) => {
    setPage(0);
    setSortField(field);
    setSortDir(dir);
  };

  // ---- the columns, one definition serving the table and both files -------

  /**
   * §11 - one registry, three consumers: the table, the CSV and the Excel file.
   *
   * No column chooser here, unlike the ledger and the daily records. Thirteen columns is a table
   * that fits, and every one of them answers this page's own question - hiding "Ticks (total)" on
   * a report about પુનરાવર્તન would be hiding the answer. The picker exists on those two pages
   * because seventeen and twenty-two bookkeeping columns genuinely need one.
   *
   * `sortKey` doubles as the column's key so `DataTable`'s `onSort` hands back a token `p_sort`
   * accepts with no lookup table in between - naming a sort twice is how a header comes to sort by
   * something other than the column it sits over. A column with no `sortKey` is not a button:
   * 0035 whitelists nine sorts and "Revisions <day>" is not among them, and a header that appeared
   * to sort and did not would be worse than a header that plainly does not.
   *
   * Every label reads on its own, and it has three readers rather than one: it is the column
   * heading, it is the `data-label` DataTable writes onto the `th` and the `td` alike - which is
   * what the mobile hide rules in ledger.css select on - and it is the header cell of the CSV and
   * the Excel file, where there is no table around it at all. "Ticks (total)" and not "Ticks" is
   * that last reader being served, and it is why the day columns name their day.
   */
  const columns = useMemo(
    () => [
      {
        key: 'name',
        sortKey: 'name',
        className: 'pl-c-user',
        label: 'Yuvak',
        /*
          The name identifies the row, so it is the column that stays put when the table is swiped
          below 900px. It happens to be first as well, and it is still declared: the pin belongs to
          the yuvak rather than to whatever position the columns end up in, and the alternative
          candidate - SMK, beside it - is a code a large share of યુવકો simply do not have, so
          pinning it would hold a column of dashes on screen while the names scrolled away. Eleven
          of the thirteen columns here are counts, and a count with nobody's name against it is the
          one thing this report must never leave on a phone screen.
        */
        pin: true,
        // `title` because the cell may ellipsize a long name (see .pl-c-user in ledger.css), and
        // an ellipsis with no way to read the rest is a value the સંચાલક cannot act on.
        render: (r) => (
          <Link to={`/progress/${r.uid}`} title={r.name || undefined}>
            {r.name || r.uid.slice(0, 8)}
          </Link>
        ),
        value: (r) => r.name,
      },
      {
        key: 'smk',
        sortKey: 'smk',
        className: 'pl-c-smk',
        label: 'SMK',
        render: (r) => <span className="mono">{r.smk || '-'}</span>,
        value: (r) => r.smk,
      },
      // profiles.zone_id. The business calls it the city; zoneNameEn() is its label helper.
      {
        key: 'city',
        className: 'pl-c-city',
        label: 'City',
        render: (r) => zoneNameEn(r.cityId),
        value: (r) => zoneNameEn(r.cityId),
      },
      // profiles.sub_zone_id - the મંડળ. Yes, the two names are inverted; see the service.
      {
        key: 'zone',
        className: 'pl-c-zone',
        label: 'Zone',
        render: (r) => subZoneNameEn(r.zoneId),
        value: (r) => subZoneNameEn(r.zoneId),
      },
      {
        key: 'revisions',
        sortKey: 'revisions',
        className: 'dr-c-count',
        label: 'Revisions',
        align: 'right',
        // How many times he pressed submit in the window. Since 0035 each one is paid on its own
        // terms, so this is a count of awards as much as of acts.
        render: (r) => <span className="mono">{gu(r.revisions)}</span>,
        value: (r) => r.revisions,
        type: 'number',
      },
      {
        key: 'ticks',
        sortKey: 'ticks',
        className: 'dr-c-count',
        label: 'Ticks (total)',
        align: 'right',
        /*
          The additive sum across every revision: 50 then 40 then 30 is 120.

          Deliberately the opposite reading from "Distinct darshan" beside it, and both are true of
          the same yuvak at the same moment. This is the figure the points follow, so a સંચાલક
          checking an award against a count wants this one. It has no ceiling and may exceed the
          size of the collection many times over, which is not an error.
        */
        render: (r) => (
          <span className="mono" title={TICKS_HINT}>
            {gu(r.ticks)}
          </span>
        ),
        value: (r) => r.ticks,
        type: 'number',
      },
      {
        key: 'scenes',
        sortKey: 'scenes',
        className: 'dr-c-count',
        label: 'Distinct darshan',
        align: 'right',
        // The de-duplicated set behind those same ticks. Never labelled "ticks": one column
        // headed with the other's word is how a reader concludes the ledger disagrees with itself.
        render: (r) => (
          <span className="mono" title={SCENES_HINT}>
            {gu(r.scenesDistinct)}
          </span>
        ),
        value: (r) => r.scenesDistinct,
        type: 'number',
      },
      {
        key: 'points',
        sortKey: 'points',
        className: 'pl-c-points',
        label: 'Level 3 points',
        align: 'right',
        // The ledger's Level 3 rows for this window and only those - never a share of a total
        // divided out. A bare number in the file, so Excel sums the column; the sign is part of
        // the number, because a manual correction can pull a total downward.
        render: (r) => (
          <span className={`mono pl-num${r.points < 0 ? ' pl-neg' : ''}`}>{gu(r.points)}</span>
        ),
        value: (r) => r.points,
        type: 'number',
      },
      {
        key: 'days',
        sortKey: 'days',
        className: 'dr-c-count',
        label: 'Days with a revision',
        align: 'right',
        // Distinct activity dates, not a streak. Nothing on this page counts consecutive days:
        // a gap is not a fault and the panel does not keep score of one (§10).
        render: (r) => <span className="mono">{gu(r.days)}</span>,
        value: (r) => r.days,
        type: 'number',
      },
      {
        key: 'last',
        sortKey: 'last',
        className: 'pl-c-when',
        label: 'Last revision',
        // Null is "he has submitted no revision in this window", which is an absence and not a
        // date - so the cell is a dash and the file's cell is empty. istDate() decides which
        // calendar day an instant belongs to, so Excel sorts it as a date rather than as text.
        render: (r) => (r.lastAt ? dateTimeGu(r.lastAt) : <span className="mono">-</span>),
        value: (r) => (r.lastAt ? istDate(r.lastAt) : ''),
        type: 'date',
      },
      {
        key: 'todayRevisions',
        className: 'dr-c-count',
        // Named after the day rather than after the word "today", because the day is a control on
        // this page: with a date chosen, a column headed "today" would be a false heading.
        label: `Revisions ${dayWord}`,
        align: 'right',
        // Not sortable: 0035 whitelists today_ticks and today_points and not this one. See the
        // note on the registry above.
        render: (r) => <span className="mono">{gu(r.todayRevisions)}</span>,
        value: (r) => r.todayRevisions,
        type: 'number',
      },
      {
        key: 'todayTicks',
        sortKey: 'today_ticks',
        className: 'dr-c-count',
        label: `Ticks ${dayWord}`,
        align: 'right',
        // Additive on the day as well, for the same reason the window figure is.
        render: (r) => (
          <span className="mono" title={TICKS_HINT}>
            {gu(r.todayTicks)}
          </span>
        ),
        value: (r) => r.todayTicks,
        type: 'number',
      },
      {
        key: 'todayPoints',
        sortKey: 'today_points',
        className: 'pl-c-points',
        label: `Level 3 points ${dayWord}`,
        align: 'right',
        render: (r) => (
          <span className={`mono pl-num${r.todayPoints < 0 ? ' pl-neg' : ''}`}>{gu(r.todayPoints)}</span>
        ),
        value: (r) => r.todayPoints,
        type: 'number',
      },
    ],
    [dayWord]
  );

  /**
   * The projection DataTable is given. `key` becomes the sort token so `onSort` needs no lookup
   * table, and `className` and `pin` are carried through deliberately: this rebuilds each column
   * as a fresh object, so anything not named here is silently dropped - `className` is what the
   * column width block in ledger.css matches on, and `pin` is what keeps the yuvak's name on
   * screen while the counts scroll under it. Dropping either is a silent loss rather than an
   * error, which is why they are named with a note rather than left to be noticed.
   */
  const tableColumns = useMemo(
    () =>
      columns.map((c) => ({
        key: c.sortKey || c.key,
        label: c.label,
        align: c.align,
        sortable: !!c.sortKey,
        render: c.render,
        className: c.className,
        pin: c.pin,
      })),
    [columns]
  );

  /** The same array both files are built from - see buildLevel3Report() in the service. */
  const fileColumns = useMemo(
    () => columns.map((c) => ({ label: c.label, value: c.value, type: c.type || 'text' })),
    [columns]
  );

  /**
   * §11 - the file, over the whole filtered set rather than the page on screen, and fetched once
   * for either format.
   *
   * `buildLevel3Report()` is the only fetch; CSV and Excel differ in the last two lines of this
   * function and nowhere else, so the two files can never hold different rows. It walks the same
   * sort the table is showing, so the file opens in the order the સંચાલક was reading. The count
   * reported afterwards is what the exporter actually wrote, and a cap that was reached is stated
   * with the figure it fell short of (§62).
   */
  const runExport = async (format) => {
    setExporting(true);
    setExportNote(null);
    try {
      const res = await buildLevel3Report(filters);
      if (res.missing || res.forbidden) {
        setExportNote({
          tone: 'notice-warn',
          text: res.forbidden
            ? 'The Level 3 report refused the read, so there is nothing to write to a file.'
            : 'This database has no Level 3 report yet, so there is nothing to write to a file.',
        });
        return;
      }

      // The range in the filename, so two exports of two different months sort next to each other
      // in a folder and neither has to be opened to find out which is which.
      const csvName = reportFilename('level3', { from, to, stamp: todayIST() });
      const written =
        format === 'xlsx'
          ? exportXlsx({
              filename: xlsxFilename(csvName),
              sheetName: 'Level 3',
              columns: fileColumns,
              rows: res.rows,
            })
          : exportCsv({ filename: csvName, columns: fileColumns, rows: res.rows });

      const what = format === 'xlsx' ? 'Excel file' : 'CSV file';
      setExportNote(
        res.truncated
          ? {
              tone: 'notice-warn',
              text: `The ${what} holds the first ${gu(written)} of ${gu(res.total)} yuvaks matching these filters (one file holds ${gu(res.cap)}) - narrow the filters and export again.`,
            }
          : {
              tone: 'notice-ok',
              text: `Exported ${gu(written)} yuvak${written === 1 ? '' : 's'} to the ${what}, with the ${gu(fileColumns.length)} columns shown here.`,
            }
      );
    } catch (e) {
      setExportNote({ tone: 'notice-warn', text: level3Error(e) || dataError(e) });
    } finally {
      setExporting(false);
    }
  };

  const showingFrom = total === 0 ? 0 : page * pageSize + 1;
  const showingTo = Math.min(total, page * pageSize + rows.length);

  /** The chosen option, so the empty state can say what was asked rather than "nothing matched". */
  const askedForAbsence = active === 'NOT';

  return (
    <>
      <PageHeader
        title="Level 3 report"
        sub="Who has done how much revision - and, on a day of your choosing, who did some and who did none."
      />

      {/* Said on the page rather than left to be discovered. The Progress page shows the same
          three figures, and a સંચાલક who has seen them there deserves to know why he is being
          sent somewhere else to filter on them. */}
      <p className="card-note">
        The <Link to="/progress">Progress</Link> report shows these figures too, one yuvak per row,
        but it cannot filter or sort by them: it works out its page of yuvaks first and adds the
        Level 3 columns afterwards, so a threshold asked there would quietly mean &quot;on this
        page&quot;. Every filter here is asked of the database, so the count below is the whole
        filtered set.
      </p>

      {/* §29 - a phone shows the list first and the controls on request. Above 900px the bar is
          always open and this button is not rendered at all (admin.css .only-narrow), so there is
          no state to get wrong on a desktop. */}
      <div className="pl-bar">
        <button
          className="btn btn-quiet only-narrow"
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="level3-filters"
          onClick={() => setFiltersOpen((v) => !v)}
        >
          {filtersOpen ? 'Hide filters' : 'Filters'}
          {activeCount > 0 ? ` (${activeCount})` : ''}
        </button>
      </div>

      {/* §28 - one filter bar above the list, pagination below it, and nothing between the two but
          the rows. role="group" gives the bar a name of its own, so a screen reader reaching it
          hears what these controls govern rather than a dozen loose fields. */}
      <div
        className={`filters pl-filters${filtersOpen ? ' is-open' : ''}`}
        id="level3-filters"
        role="group"
        aria-label="Filter the Level 3 report"
      >
        {/* The mobile number is searchable and is not a column, and those are two different
            rules rather than an inconsistency: 0035 matches `p_search` against the number so a
            સંચાલક holding one can find the yuvak it belongs to, while the table and both files
            carry no mobile and no email at all - the same line every other export on this
            section states in its hint. */}
        <div className="field">
          <label htmlFor="l3-search">Search</label>
          <input
            id="l3-search"
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Name, SMK or mobile"
          />
          <span className="hint">Asked of the database, so it searches every yuvak and not this page</span>
        </div>

        <div className="field">
          <label htmlFor="l3-city">City</label>
          <select id="l3-city" value={city} onChange={(e) => pickCity(e.target.value)}>
            <option value="">All cities</option>
            {(options?.cities || []).map((c) => (
              <option key={c.id} value={c.id}>{`${zoneNameEn(c.id)} (${c.count})`}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="l3-zone">Zone</label>
          <select id="l3-zone" value={zone} onChange={(e) => onFilter(setZone)(e.target.value)}>
            <option value="">{city ? 'All zones in this city' : 'All zones'}</option>
            {zoneOptions.map((z) => (
              <option key={z.id} value={z.id}>{`${subZoneNameEn(z.id)} (${z.count})`}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="l3-status">Account status</label>
          <select id="l3-status" value={status} onChange={(e) => onFilter(setStatus)(e.target.value)}>
            <option value="">All statuses</option>
            {(options?.statuses || []).map((s) => (
              <option key={s.id} value={s.id}>{`${accountStatus(s.id)} (${s.count})`}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="l3-from">Revisions from</label>
          <input
            id="l3-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => onFilter(setFrom)(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="l3-to">Revisions up to</label>
          <input
            id="l3-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => onFilter(setTo)(e.target.value)}
          />
          <span className="hint">Both days included, counted in India (IST). Blank is all time</span>
        </div>

        {/*
          The three-valued control, and the day it is asked about.

          A select and not a checkbox, because there are genuinely three answers and the middle one
          - "do not ask" - is the default. See the header of this file for why "Did not" cannot be
          expressed as one of the "at least" fields below: a minimum of zero matches everybody.
        */}
        <div className="field">
          <label htmlFor="l3-active">Activity on a day</label>
          <select id="l3-active" value={active} onChange={(e) => onFilter(setActive)(e.target.value)}>
            {DAY_ACTIVITY.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
          <span className="hint">
            {DAY_ACTIVITY.find((d) => d.id === active)?.hint}
          </span>
        </div>

        <div className="field">
          <label htmlFor="l3-day">That day</label>
          <input
            id="l3-day"
            type="date"
            value={onDay}
            // No `max`: a panel that refuses tomorrow would also refuse it to a સંચાલક whose
            // laptop clock is a day ahead, and a day nobody has reached yet is a day nobody did
            // any revision on, which is an honest answer.
            onChange={(e) => onFilter(setOnDay)(e.target.value)}
          />
          <span className="hint">
            The last three columns are this day. Left blank, the server uses today in India (IST)
          </span>
        </div>

        <div className="field">
          <label htmlFor="l3-min-points">Level 3 points at least</label>
          <input
            id="l3-min-points"
            type="number"
            step="1"
            inputMode="numeric"
            list="l3-point-presets"
            value={minPoints}
            onChange={(e) => onFilter(setMinPoints)(e.target.value)}
            placeholder="e.g. 50"
          />
          {/* A datalist rather than a select: the two figures §29 names are one press away and any
              other number is still typeable, which a fixed list of choices would not be. */}
          <datalist id="l3-point-presets">
            {POINT_PRESETS.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <span className="hint">Level 3 alone, over the date range above</span>
        </div>

        <div className="field">
          <label htmlFor="l3-min-ticks">Ticks at least</label>
          <input
            id="l3-min-ticks"
            type="number"
            step="1"
            min="0"
            inputMode="numeric"
            list="l3-tick-presets"
            value={minTicks}
            onChange={(e) => onFilter(setMinTicks)(e.target.value)}
            placeholder="e.g. 100"
          />
          <datalist id="l3-tick-presets">
            {TICK_PRESETS.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          {/* Which of the two counts this asks, said where it is asked. The distinct figure is a
              column and not a filter, because 0035 takes no threshold for it. */}
          <span className="hint">The added-up total, so a darshan revised twice counts twice</span>
        </div>

        <div className="field">
          <label htmlFor="l3-min-revs">Revisions at least</label>
          <input
            id="l3-min-revs"
            type="number"
            step="1"
            min="0"
            inputMode="numeric"
            list="l3-revision-presets"
            value={minRevisions}
            onChange={(e) => onFilter(setMinRevisions)(e.target.value)}
            placeholder="e.g. 5"
          />
          <datalist id="l3-revision-presets">
            {REVISION_PRESETS.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <span className="hint">How many times he submitted a revision</span>
        </div>
      </div>

      {/* The presets and Reset live OUTSIDE the grid: a button is not a field and does not want a
          field's track, and stretched to one it wraps into a row of half-empty buttons. */}
      <div className="pl-actions" role="group" aria-label="Date range presets">
        <button className="btn btn-quiet" type="button" onClick={() => quickRange(todayIST(), todayIST())}>
          Today
        </button>
        <button className="btn btn-quiet" type="button" onClick={() => quickRange(dateIST(-6), todayIST())}>
          Last 7 days
        </button>
        {/* -29 and not -30: the range is inclusive at both ends, so today plus the twenty-nine days
            behind it is thirty days. */}
        <button className="btn btn-quiet" type="button" onClick={() => quickRange(dateIST(-29), todayIST())}>
          Last 30 days
        </button>
        <button className="btn btn-quiet" type="button" onClick={() => quickRange('', '')}>
          All time
        </button>
        {filtered && (
          <button className="btn btn-quiet" type="button" onClick={clearAll}>
            Reset
          </button>
        )}
      </div>

      {/* What is currently narrowing the report, spelled out. Eleven controls, several of them
          inside a closed drawer on a phone, mean a list can be narrowed by something the સંચાલક
          cannot see - and a filtered report read as the whole is a wrong answer that looks like a
          right one. */}
      {filtered && (
        <div className="pl-chips" role="group" aria-label="Active filters">
          <span className="hint">Filtered:</span>
          {activeFilters.map((f) => (
            <button
              key={f.key}
              type="button"
              className="pl-chip"
              onClick={() => dropFilter(f)}
              title={`Remove this filter - ${f.label}`}
            >
              {f.label}
              <span aria-hidden="true">×</span>
              <span className="sr-only">remove</span>
            </button>
          ))}
          <button className="linklike" type="button" onClick={clearAll}>Clear all</button>
        </div>
      )}

      {/* A failed options read is not allowed to look like an organisation with one city in it:
          the lists degrade to "All" and say why, rather than quietly offering fewer choices than
          exist (§34). */}
      {optionsQ.error && (
        <div className="notice notice-warn" role="status">
          The City, Zone and Status lists could not be loaded, so they are showing "All" only.
          Everything else on this page is unaffected.{' '}
          <button className="linklike" type="button" onClick={optionsQ.retry}>Try again</button>
        </div>
      )}

      {/* §11 - its own row rather than a control inside the filter bar, so a press that writes a
          file cannot be mistaken for a press that narrows a list. */}
      <div className="toolbar">
        <span className="grow" />
        <button
          className={`btn btn-quiet${exporting ? ' is-busy' : ''}`}
          type="button"
          title={EXPORT_HINT}
          onClick={() => runExport('csv')}
          disabled={exporting || report.loading || missing || forbidden}
        >
          {exporting ? 'Preparing…' : 'Export CSV'}
        </button>
        <button
          className={`btn${exporting ? ' is-busy' : ''}`}
          type="button"
          title={EXPORT_HINT}
          onClick={() => runExport('xlsx')}
          disabled={exporting || report.loading || missing || forbidden}
        >
          {exporting ? 'Preparing…' : 'Export Excel'}
        </button>
      </div>

      {/* role="status" so a screen reader hears the result of a press that produced no visible
          change on the page itself - the file went to Downloads (§56). */}
      {exportNote && <div className={`notice ${exportNote.tone}`} role="status">{exportNote.text}</div>}

      <p className="card-note">
        Ticks and distinct darshan are two counts of the same work and both are true:{' '}
        <strong>Ticks (total)</strong> adds up every tick of every revision, so 50 then 40 then 30
        is 120 and that is what the points follow, while <strong>Distinct darshan</strong> counts
        each darshan once however often it was revised. The last three columns are one day and are
        not cut by the date range - they answer what happened {dayWord}. One file holds up to{' '}
        {gu(EXPORT_CAP)} yuvaks.
      </p>

      {/*
        A migration that has not landed, and a refusal, are both deployment states rather than
        failures.

        Plain notices and not an ErrorState: a Try again beside either would invite the સંચાલક to
        retry something that cannot succeed until somebody deploys or fixes a role. Same idiom as
        the bonus card on Point Management and the daily records report.
      */}
      {missing ? (
        <div className="notice notice-warn" role="status">
          This database has no Level 3 report yet - the migration that creates it has not been
          applied here. Nothing else in the panel is affected, and no yuvak&apos;s revisions are at
          risk: there is simply nothing for this page to read until it is deployed.
        </div>
      ) : forbidden ? (
        <div className="notice notice-warn" role="status">
          This report refused the read. It needs the same permission as the Progress section, so if
          you can open Progress and not this, the panel and the database disagree about your role -
          which is worth telling whoever built the panel.
        </div>
      ) : (
        /* isEmpty includes `page === 0`, because AsyncBlock renders <Empty> *instead of* its
           children and the children include the Pager. Walking one page past the end of a filtered
           list would otherwise dead-end it: "nothing matches", no Previous button, and no way back
           to the rows that do exist. */
        <AsyncBlock
          state={{ ...report, isEmpty: !report.loading && !report.error && rows.length === 0 && page === 0 }}
          emptyIcon="◔"
          emptyTitle={
            askedForAbsence
              ? `Everybody here did a revision ${dayWord}`
              : filtered
                ? 'No yuvak matches these filters'
                : 'No revision has been recorded yet'
          }
          empty={
            askedForAbsence
              ? // The one empty result on this page that is good news, and it is worth saying so
                // plainly rather than leaving "no rows" to be read as a failed read.
                'Every yuvak matching the other filters submitted at least one revision on that day, so nobody is left to list.'
              : filtered
                ? 'No yuvak matches these filters. Lower a threshold, widen the date range, or clear the filters.'
                : 'Level 3 revisions appear here as yuvaks submit them. An empty list is a quiet stretch, not a shortfall.'
          }
          emptyAction={
            filtered ? (
              <button className="btn btn-quiet" type="button" onClick={clearAll}>
                Clear all filters
              </button>
            ) : null
          }
          onRetry={report.retry}
          skeleton={<TableSkeleton cols={Math.max(1, tableColumns.length)} />}
        >
          <>
            <DataTable
              caption="Yuvaks by their Level 3 revisions"
              columns={tableColumns}
              rows={rows}
              // The header follows the rows: `.dt th` is sticky, and `is-tall` gives the wrap a
              // height so it owns the vertical scrolling and sticky has something to stick inside.
              wrapClassName="is-tall"
              rowKey={(r) => r.uid}
              sort={{ field: sortField, dir: sortDir }}
              // Sorting is a new query, never a re-sort of the twenty rows on screen: sorting a
              // paginated list client-side would only order the page you can see.
              onSort={applySort}
            />
            <Pager
              page={page}
              hasNext={!!report.data?.hasNext}
              onPrev={() => setPage((p) => Math.max(0, p - 1))}
              onNext={() => setPage((p) => p + 1)}
              pageSize={pageSize}
              onPageSize={(n) => {
                setPage(0);
                setPageSize(n);
              }}
              busy={report.loading}
            />
            {/* The pager can only say which page this is; the size of the whole filtered set comes
                back with the rows (`count(*) over ()`), so the two can never disagree. */}
            <p className="card-note">
              Showing {gu(showingFrom)}-{gu(showingTo)} of {gu(total)} yuvak{total === 1 ? '' : 's'} ·
              page {gu(page + 1)} of {gu(Math.max(1, pageCount))}.
            </p>
          </>
        </AsyncBlock>
      )}

      {/* The list of who did nothing is the one thing on this page that could be read as a
          scoreboard, so what it is for is said where it ends rather than left to be assumed. */}
      <p className="card-note">
        A yuvak with zeroes in every column did no revision in this range. That is all it says: no
        streak is counted here, nothing is marked as missed, and a quiet month is a quiet month.
        The list is here so somebody can be asked after, not measured.
      </p>
    </>
  );
}
