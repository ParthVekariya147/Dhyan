import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import {
  AWARD_KINDS,
  EXPORT_CAP,
  SOURCES,
  awardKind,
  buildLedgerReport,
  isUuid,
  levelLabel,
  pointActivities,
  pointTransactions,
  sourceLabel,
} from '../services/ledgerService';
import DataTable, { Pager } from '../../../components/DataTable';
import { AsyncBlock, TableSkeleton } from '../../../components/StateBlocks';
import { PageHeader, StatusBadge } from '../../../components/StatCard';
import { dateGu, dateTimeGu, gu } from '../../../lib/format';
import { dataError } from '../../../lib/errors';
import { exportCsv, istDate, reportFilename } from '../../../lib/export';
import { exportXlsx, xlsxFilename } from '../../../lib/xlsx';
import { subZoneNameEn, zoneNameEn } from '../../../lib/labels';
import { dateIST, todayIST } from '../../../../../shared/domain/constants.js';
import { ACTIVITY_KEY } from '../../../../../shared/domain/points.js';
import '../ledger.css';

/**
 * §24 — the point ledger, org-wide, filtered and paged.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this page is for
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every award the project has ever written, in one list, with every filter
 * `admin_point_transactions()` accepts exposed: the યુવક, the level, the activity code, a date
 * range, a points range, the award kind and the writer that produced the row. It is the screen
 * a સંચાલક opens to answer "why does he have that many" and "what did we pay for this week",
 * and it is the screen the reconciliation in §41 is checked on.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Read only, and there is nothing here to press that changes a row
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The ledger is append-only. There is no edit path and no delete path for a ledger row
 * anywhere in this panel — not hidden behind a permission, not disabled, absent. A correction
 * is a **new** MANUAL row carrying a reason and the name of the સંચાલક who entered it, which
 * is why those two columns are on by default: the correction has to be as readable as the
 * thing it corrects.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Legacy rows, and the number that must never move
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `award_kind is null` means the row was written before migration 0031, when no kind, no rule
 * version and no reason were recorded. Those fields are not blank on such a row — they were
 * never asked — so the panel prints a stated "Before the new engine" badge rather than three
 * empty cells that read as missing data. 0032 makes that judgement once, in SQL, and returns
 * it as `is_legacy`; this page never infers it.
 *
 * Those rows are also the historical total that §41 requires to stay exactly where it is, so
 * the kind filter offers them as a set of their own. Selecting it and reading the row count is
 * how a સંચાલક checks that the figure has not moved.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Tone (§10, §14)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Nothing on this page counts a missed day and nothing calls anybody behind. A `REVISION_REQUIRED`
 * attempt is not mentioned here at all — this is the payment record, not the attempt record —
 * and a negative MANUAL row is rendered as an adjustment with its reason beside it, in amber
 * rather than red. Red on a row carrying a person's name says he did something wrong; a
 * negative row says a સંચાલક corrected the books.
 */

/** Levels 1-3 have exactly one activity each; Level 4 rows carry their own title. */
const ACTIVITY_EN = {
  [ACTIVITY_KEY.VIDEO]: 'Video',
  [ACTIVITY_KEY.DARSHAN]: 'Darshan',
  [ACTIVITY_KEY.REVISION]: 'Revision',
};

/** Where the chosen columns live between visits. Versioned, so a renamed key cannot rot. */
const COLS_KEY = 'varni.admin.ledger.columns.v1';

/**
 * The column picker's headings, and which column sits under each.
 *
 * A flat list of seventeen checkboxes is a list nobody scans. Declared as one map rather than a
 * `group:` on each entry, so the grouping can be re-cut in one place and a column added to the
 * registry cannot half-belong to a heading. Anything the map does not name still renders, under
 * "Other" — visible rather than silently dropped.
 */
const COLUMN_GROUPS = [
  { title: 'Who and when', keys: ['date', 'name', 'smk', 'city', 'zone'] },
  { title: 'What was paid', keys: ['level', 'activity', 'points', 'kind'] },
  { title: 'Where it came from', keys: ['source', 'attempt', 'rule', 'sourceId', 'created', 'id'] },
  { title: 'The correction', keys: ['reason', 'admin'] },
];

/** localStorage is a convenience, never a dependency — a private window must not break. */
function readStoredColumns(valid) {
  try {
    const raw = JSON.parse(window.localStorage.getItem(COLS_KEY) || 'null');
    if (!Array.isArray(raw)) return null;
    const keep = raw.map(String).filter((k) => valid.has(k));
    return keep.length ? keep : null;
  } catch {
    return null;
  }
}

function writeStoredColumns(keys) {
  try {
    window.localStorage.setItem(COLS_KEY, JSON.stringify(keys));
  } catch {
    /* Private browsing, or a full quota. The choice simply does not outlive the session. */
  }
}

/** What both export buttons do, on the buttons rather than in a line of page prose. */
const EXPORT_HINT =
  'Every award matching the filters above - not just this page - with exactly the columns chosen here. No mobile numbers and no email addresses.';

export default function PointLedgerPage() {
  /*
    The યુવક filter lives in the URL, and that is deliberate rather than decorative.

    `p_user` is a uuid, which nobody types: a સંચાલક arrives at "this yuvak's awards" from his
    record, so the way in is a link. Keeping it in the query string makes that link exist, makes
    the browser's back button undo it, and makes the narrowed view something he can send to
    somebody else. Everything else on this page is a control, not an address, and stays in state.
  */
  const [searchParams, setSearchParams] = useSearchParams();
  const [userInput, setUserInput] = useState(() => searchParams.get('user') || '');

  /*
    A half-pasted id is not a filter. `p_user` is a Postgres uuid and an invalid one comes back
    as 22P02, which errors.js words as "the details entered are not in the right format" - a
    sentence about the whole ledger having failed to load. So only a complete uuid becomes a
    filter; anything else is ignored and the field says so under itself.
  */
  const user = isUuid(userInput) ? userInput.trim().toLowerCase() : '';

  const [level, setLevel] = useState('');
  const [activity, setActivity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [kind, setKind] = useState('');
  const [source, setSource] = useState('');

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState(null); // { tone, text }

  /* The address follows the filter. The string compare is what stops this from looping: setting
     the params re-runs the effect, and the second pass finds nothing to change. */
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (user) next.set('user', user);
    else next.delete('user');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [user, searchParams, setSearchParams]);

  /** Every filter change starts the list again: page 3 of the old query is not page 3 of this one. */
  const onFilter = (set) => (value) => {
    setPage(0);
    set(value);
  };

  /**
   * The લેવલ ૪ કસોટીઓ the activity filter may offer, from the published configuration.
   * Independent of the ledger read, so a failure here narrows one select and nothing else.
   */
  const activitiesQ = useAsync(() => pointActivities(), []);

  const filters = useMemo(
    () => ({ user, level, activity, from, to, min, max, kind, source }),
    [user, level, activity, from, to, min, max, kind, source]
  );

  const report = useAsync(() => pointTransactions(filters, { page, pageSize }), [filters, page, pageSize]);

  const rows = report.data?.rows || [];
  const total = report.data?.total ?? 0;
  const pageCount = report.data?.pageCount ?? 0;

  /*
    The name behind the uuid, read off the rows themselves rather than fetched.

    A chip reading "User: 3f2a…" is an id, not a person, and a second query to turn one uuid
    into one name would be a read this page can answer for free - every row it just loaded
    carries the name. Absent only when the filter matched nothing, and then the chip falls back
    to the id, which is still exactly what is being filtered on.
  */
  const userName = user ? rows[0]?.name || '' : '';

  const quickRange = (f, t) => {
    setPage(0);
    setFrom(f);
    setTo(t);
  };

  const clearUser = () => {
    setPage(0);
    setUserInput('');
  };

  /**
   * Every filter that is currently narrowing the ledger, as one list.
   *
   * One list and not two: the chips and the count are the same fact, and deriving both from
   * here means a filter cannot be active and invisible - which is the failure that matters,
   * because a ledger narrowed by something the સંચાલક cannot see is a ledger read as the whole.
   * `clear` is per chip so one condition can be dropped without losing the other eight.
   */
  const activeFilters = [
    user && {
      key: 'user',
      label: `Yuvak: ${userName || user.slice(0, 8)}`,
      clear: clearUser,
    },
    level !== '' && { key: 'level', label: levelLabel(Number(level)), clear: () => setLevel('') },
    activity && { key: 'activity', label: `Activity: ${activity}`, clear: () => setActivity('') },
    from && { key: 'from', label: `From ${from}`, clear: () => setFrom('') },
    to && { key: 'to', label: `To ${to}`, clear: () => setTo('') },
    min !== '' && { key: 'min', label: `At least ${gu(min)} points`, clear: () => setMin('') },
    max !== '' && { key: 'max', label: `At most ${gu(max)} points`, clear: () => setMax('') },
    kind && {
      key: 'kind',
      label: `Kind: ${AWARD_KINDS.find((k) => k.id === kind)?.label || kind}`,
      clear: () => setKind(''),
    },
    source && { key: 'source', label: `From: ${sourceLabel(source)}`, clear: () => setSource('') },
  ].filter(Boolean);

  const activeCount = activeFilters.length;
  const filtered = activeCount > 0;

  /** Dropping one condition is still a new query, so it goes back to the first page. */
  const dropFilter = (f) => {
    setPage(0);
    f.clear();
  };

  const clearAll = () => {
    setPage(0);
    setUserInput('');
    setLevel('');
    setActivity('');
    setFrom('');
    setTo('');
    setMin('');
    setMax('');
    setKind('');
    setSource('');
  };

  // ---- the columns, one definition serving the table and both files -------

  /**
   * §11 — one registry, three consumers.
   *
   * Each entry carries how it *renders* and how it *exports*, side by side, because a report
   * whose file disagrees with the screen that produced it is the failure this page exists to
   * avoid. Every label reads on its own: below ~820px DataTable turns each row into a card of
   * label/value pairs, and "Kind" beside a lone word says nothing without the header row that
   * is no longer there.
   *
   * No column is sortable and that is not an omission. `admin_point_transactions()` orders by
   * `created_at desc, id desc` and takes no sort parameter, so a clickable header would either
   * lie or would re-order the twenty rows on screen and call it a sort of the ledger. The page
   * says which order it is in, in words, under the table.
   *
   * Mobile numbers and email addresses are not on this list and are not offered as a choice.
   * SMK identifies a યુવક uniquely (§4), which is what makes the file useful without either.
   */
  const allColumns = useMemo(
    () => [
      {
        key: 'date',
        className: 'pl-c-date',
        label: 'Date',
        base: true,
        // `activity_date` is the IST business day the award was filed under (§9), and it is a
        // plain YYYY-MM-DD rather than an instant - dateGu() reads it as midnight UTC and
        // renders the same calendar day, because India is ahead of UTC and never behind it.
        render: (r) => dateGu(r.activityDate),
        value: (r) => r.activityDate || '',
        type: 'date',
      },
      {
        key: 'name',
        className: 'pl-c-user',
        label: 'Yuvak',
        base: true,
        // `title` because the cell may ellipsize a long name (see .pl-c-user in ledger.css),
        // and an ellipsis with no way to read the rest is a value the સંચાલક cannot act on.
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
        base: true,
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
      // profiles.sub_zone_id — the મંડળ. Yes, the two names are inverted; see the service.
      {
        key: 'zone',
        className: 'pl-c-zone',
        label: 'Zone',
        render: (r) => subZoneNameEn(r.zoneId),
        value: (r) => subZoneNameEn(r.zoneId),
      },
      {
        key: 'level',
        label: 'Level',
        base: true,
        // A manual adjustment carries level 0, which is not a rung of the ladder. levelLabel()
        // says "No level" rather than "Level 0", which would invent one.
        render: (r) => levelLabel(r.levelId),
        value: (r) => levelLabel(r.levelId),
      },
      {
        key: 'activity',
        className: 'pl-c-activity',
        label: 'Activity',
        base: true,
        // The કસોટી's own title when there is one, and the code underneath it. The code is what
        // the ledger is keyed on and what the filter above selects, so it stays visible even
        // when a friendlier name exists.
        render: (r) => {
          const name = r.title || ACTIVITY_EN[r.activityKey] || r.activityKey;
          if (!name) return <span className="mono">-</span>;
          return (
            <>
              {name}
              {r.title && r.activityKey ? (
                <span className="hint pl-sub mono">{r.activityKey}</span>
              ) : null}
            </>
          );
        },
        value: (r) => r.title || ACTIVITY_EN[r.activityKey] || r.activityKey,
      },
      {
        key: 'points',
        className: 'pl-c-points',
        label: 'Points',
        align: 'right',
        base: true,
        /*
          A negative award is an adjustment, not an error.

          Only MANUAL rows may be negative (0031's points check), and a negative one is a
          સંચાલક correcting the books with his name and his reason in the columns beside it. So
          it is printed with its sign, in amber, under a badge that says the word - the colour
          repeats the badge and is never the only signal (§43). The plus sign on a positive
          adjustment is there for the same reason: in a column that can hold both, an unsigned
          number is ambiguous at a glance.
        */
        render: (r) => {
          const neg = r.points < 0;
          const manual = r.awardKind === 'MANUAL';
          return (
            <span className="pl-cell">
              <span className={`mono pl-num${neg ? ' pl-neg' : ''}`}>
                {manual && r.points > 0 ? '+' : ''}
                {gu(r.points)}
              </span>
              {manual ? <StatusBadge tone="warn">Adjustment</StatusBadge> : null}
            </span>
          );
        },
        // A bare number in the file, so Excel sums the column. The sign is part of the number.
        value: (r) => r.points,
        type: 'number',
      },
      {
        key: 'kind',
        className: 'pl-c-kind',
        label: 'Award kind',
        base: true,
        /*
          The one column that is interpretation rather than data, and it earns its place.

          A legacy row (`award_kind is null`) has no kind, no rule version and no reason because
          none of them was ever recorded, and printing an empty cell there would read as a field
          somebody left blank. The badge states it instead, and its `title` says what it means.
        */
        render: (r) => {
          const k = awardKind(r);
          return <StatusBadge tone={k.tone} title={k.hint || undefined}>{k.label}</StatusBadge>;
        },
        value: (r) => awardKind(r).label,
      },
      {
        key: 'reason',
        className: 'pl-c-reason',
        label: 'Reason',
        base: true,
        // Only a MANUAL row has one - 0031 requires it by constraint - and it is the entire
        // justification for that row existing, so it is on by default and never truncated.
        render: (r) => (r.reason ? r.reason : <span className="mono">-</span>),
        value: (r) => r.reason || '',
      },
      {
        key: 'admin',
        label: 'Recorded by',
        base: true,
        // Blank on everything the engine wrote, which is most of the ledger: an award nobody
        // entered by hand has no author, and naming one would be inventing accountability.
        render: (r) => (r.adminName ? r.adminName : <span className="mono">-</span>),
        value: (r) => r.adminName,
      },
      {
        key: 'source',
        label: 'Source',
        render: (r) => sourceLabel(r.source),
        value: (r) => sourceLabel(r.source),
      },
      {
        key: 'attempt',
        label: 'Attempt',
        align: 'right',
        // 0 is not an attempt number: manual rows carry 0 because they attach to no attempt at
        // all. A dash says that; a 0 would read as "the zeroth try".
        render: (r) => <span className="mono">{r.attemptNumber > 0 ? gu(r.attemptNumber) : '-'}</span>,
        value: (r) => (r.attemptNumber > 0 ? r.attemptNumber : ''),
        type: 'number',
      },
      {
        key: 'rule',
        label: 'Rule version',
        align: 'right',
        // Which revision of the rules was in force. Null on a legacy row - never asked, not
        // blank - so a dash rather than a 0, which would claim version zero existed.
        render: (r) => <span className="mono">{r.ruleVersion == null ? '-' : gu(r.ruleVersion)}</span>,
        value: (r) => (r.ruleVersion == null ? '' : r.ruleVersion),
        type: 'number',
      },
      {
        key: 'sourceId',
        label: 'Source record',
        align: 'right',
        // The attempt row this award was written for - `activity_attempts.id` or
        // `level4_attempts.id`. Off by default, because it answers nothing a સંચાલક asks; it is
        // here for the one occasion somebody has to trace an award back to the exact submission.
        render: (r) => <span className="mono">{r.sourceId ? gu(r.sourceId) : '-'}</span>,
        value: (r) => (r.sourceId ? r.sourceId : ''),
        type: 'number',
      },
      {
        key: 'created',
        className: 'pl-c-when',
        label: 'Recorded at',
        // Distinct from Date, and the difference matters on a manual row: `activity_date` is the
        // day the award belongs to, and this is the moment the row was written. For an
        // adjustment backdated to last week those are different days on purpose.
        render: (r) => dateTimeGu(r.createdAt),
        // The IST calendar day, so Excel sorts and filters it as a date rather than as text
        // that puts August before February. istDate() is the one place that decides which day
        // an instant belongs to, and both formats ask it.
        value: (r) => istDate(r.createdAt),
        type: 'date',
      },
      {
        key: 'id',
        label: 'Ledger id',
        align: 'right',
        // The row's own identity, so a figure in a spreadsheet can be traced back to the exact
        // record it came from. Off by default: it is a bookkeeping handle, not a fact about
        // anybody.
        render: (r) => <span className="mono">{gu(r.id)}</span>,
        value: (r) => r.id,
        type: 'number',
      },
    ],
    []
  );

  const columnKeys = useMemo(() => new Set(allColumns.map((c) => c.key)), [allColumns]);
  const defaultKeys = useMemo(() => allColumns.filter((c) => c.base).map((c) => c.key), [allColumns]);

  const [chosen, setChosen] = useState(() => readStoredColumns(columnKeys) || defaultKeys);

  const setColumns = useCallback((keys) => {
    setChosen(keys);
    writeStoredColumns(keys);
  }, []);

  /**
   * The order is the registry's, never the order they were ticked in: a column list that
   * rearranges itself as it is edited makes two exports of the same query look like two
   * different reports.
   */
  const visibleColumns = useMemo(
    () => allColumns.filter((c) => chosen.includes(c.key)),
    [allColumns, chosen]
  );

  const toggleColumn = (key) => {
    if (chosen.includes(key)) {
      // A table with no columns is a page with no content and no way back to one.
      if (chosen.length === 1) return;
      setColumns(chosen.filter((k) => k !== key));
      return;
    }
    setColumns([...chosen, key]);
  };

  const tableColumns = useMemo(
    () =>
      visibleColumns.map((c) => ({
        key: c.key,
        label: c.label,
        align: c.align,
        render: c.render,
        // Carried through deliberately: this projection rebuilds each column as a fresh object,
        // so anything not named here is silently dropped - and `className` is what the whole
        // column-width block in ledger.css matches on.
        className: c.className,
      })),
    [visibleColumns]
  );

  /** The registry, arranged under COLUMN_GROUPS' headings, with anything unnamed under "Other". */
  const columnGroups = useMemo(() => {
    const named = new Set(COLUMN_GROUPS.flatMap((g) => g.keys));
    const groups = COLUMN_GROUPS.map((g) => ({
      title: g.title,
      columns: g.keys.map((k) => allColumns.find((c) => c.key === k)).filter(Boolean),
    })).filter((g) => g.columns.length);
    const rest = allColumns.filter((c) => !named.has(c.key));
    return rest.length ? [...groups, { title: 'Other', columns: rest }] : groups;
  }, [allColumns]);

  /** The same array both files are built from — see buildLedgerReport() in the service. */
  const fileColumns = useMemo(
    () => visibleColumns.map((c) => ({ label: c.label, value: c.value, type: c.type || 'text' })),
    [visibleColumns]
  );

  /**
   * §11 — the file, over the whole filtered set rather than the page on screen, and fetched
   * once for either format.
   *
   * `buildLedgerReport()` is the only fetch; CSV and Excel differ in the last two lines of this
   * function and nowhere else, so the two files can never hold different rows. The count
   * reported afterwards is what the exporter actually wrote, and a cap that was reached is
   * stated with the figure it fell short of (§62) - a file that quietly holds the first 5,000
   * of 8,300 awards is worse than no file, because somebody reconciles a total from it.
   */
  const runExport = async (format) => {
    setExporting(true);
    setExportNote(null);
    try {
      const res = await buildLedgerReport(filters);
      const csvName = reportFilename('points-ledger', { from, to, stamp: todayIST() });
      const written =
        format === 'xlsx'
          ? exportXlsx({
              filename: xlsxFilename(csvName),
              sheetName: 'Point ledger',
              columns: fileColumns,
              rows: res.rows,
            })
          : exportCsv({ filename: csvName, columns: fileColumns, rows: res.rows });

      const what = format === 'xlsx' ? 'Excel file' : 'CSV file';
      setExportNote(
        res.truncated
          ? {
              tone: 'notice-warn',
              text: `The ${what} holds the first ${gu(written)} of ${gu(res.total)} awards matching these filters (one file holds ${gu(res.cap)}) - narrow the date range and export again.`,
            }
          : {
              tone: 'notice-ok',
              text: `Exported ${gu(written)} award${written === 1 ? '' : 's'} to the ${what}, with the ${gu(fileColumns.length)} columns shown here.`,
            }
      );
    } catch (e) {
      setExportNote({ tone: 'notice-warn', text: dataError(e) });
    } finally {
      setExporting(false);
    }
  };

  const showingFrom = total === 0 ? 0 : page * pageSize + 1;
  const showingTo = Math.min(total, page * pageSize + rows.length);

  const level4 = activitiesQ.data || [];

  return (
    <>
      <PageHeader
        title="Point ledger"
        sub="Every award the project has written, with what it was for and who recorded it. Read only - the ledger is only ever added to."
      />

      {/* §29 — a phone shows the list first and the controls on request. Above 900px the bar is
          always open and this button is not rendered at all (admin.css .only-narrow), so there
          is no state to get wrong on a desktop. */}
      <div className="pl-bar">
        <button
          className="btn btn-quiet only-narrow"
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="ledger-filters"
          onClick={() => setFiltersOpen((v) => !v)}
        >
          {filtersOpen ? 'Hide filters' : 'Filters'}
          {activeCount > 0 ? ` (${activeCount})` : ''}
        </button>
      </div>

      {/* §28 — one filter bar above the list, pagination below it, and nothing between the two
          but the rows. role="group" gives the bar a name of its own, so a screen reader reaching
          it hears what these controls govern rather than a dozen loose fields. */}
      <div
        className={`filters pl-filters${filtersOpen ? ' is-open' : ''}`}
        id="ledger-filters"
        role="group"
        aria-label="Filter the point ledger"
      >
        <div className="field">
          <label htmlFor="lg-user">Yuvak</label>
          <input
            id="lg-user"
            type="text"
            value={userInput}
            onChange={(e) => {
              setPage(0);
              setUserInput(e.target.value);
            }}
            placeholder="Paste a user id"
            // An id, not prose: an autocapitalised first character would never match, and a
            // phone offering to correct it is offering to break the filter.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby="lg-user-hint"
          />
          <span className="hint" id="lg-user-hint">
            {userInput && !user
              ? 'Not a complete user id yet, so every yuvak is shown. The usual way in is the link from his record.'
              : 'Usually reached by opening a yuvak and following the link to his awards'}
          </span>
        </div>

        <div className="field">
          <label htmlFor="lg-level">Level</label>
          <select id="lg-level" value={level} onChange={(e) => onFilter(setLevel)(e.target.value)}>
            <option value="">All levels</option>
            <option value="1">Level 1 - Meditation</option>
            <option value="2">Level 2 - Darshan</option>
            <option value="3">Level 3 - Revision</option>
            <option value="4">Level 4</option>
            {/* A manual adjustment belongs to no level and carries 0, which is outside 1..4 so
                it can never be confused with one (0031). Offered as its own choice because
                "show me the corrections" is a question somebody asks. */}
            <option value="0">No level - manual adjustments</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="lg-activity">Activity</label>
          <select id="lg-activity" value={activity} onChange={(e) => onFilter(setActivity)(e.target.value)}>
            <option value="">All activities</option>
            <optgroup label="Levels 1-3">
              <option value={ACTIVITY_KEY.VIDEO}>Video</option>
              <option value={ACTIVITY_KEY.DARSHAN}>Darshan</option>
              <option value={ACTIVITY_KEY.REVISION}>Revision</option>
            </optgroup>
            {/* Never a hardcoded 4.1 … 4.4 (§11): a 4.5 published next month appears here the
                moment it exists. An inactive કસોટી is still offered, because its awards are
                still in the ledger and that is what this filter selects. */}
            {level4.length > 0 && (
              <optgroup label="Level 4">
                {level4.map((a) => (
                  <option key={a.code} value={a.code}>
                    {`${a.code} - ${a.title}`}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <span className="hint">
            {activitiesQ.error
              ? 'The Level 4 list could not be read, so only Levels 1-3 are offered here.'
              : 'The code the award is keyed on, not the screen it came from'}
          </span>
        </div>

        <div className="field">
          <label htmlFor="lg-kind">Award kind</label>
          <select id="lg-kind" value={kind} onChange={(e) => onFilter(setKind)(e.target.value)}>
            <option value="">All kinds</option>
            {AWARD_KINDS.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </select>
          <span className="hint">
            "Before the new engine" is every row written before the rules engine existed - the
            historical total that never moves.
          </span>
        </div>

        <div className="field">
          <label htmlFor="lg-source">Written by</label>
          <select id="lg-source" value={source} onChange={(e) => onFilter(setSource)(e.target.value)}>
            <option value="">Everything</option>
            {SOURCES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="lg-from">Date from</label>
          <input
            id="lg-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => onFilter(setFrom)(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="lg-to">Date up to</label>
          <input
            id="lg-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => onFilter(setTo)(e.target.value)}
          />
          <span className="hint">Both days included, counted in India (IST)</span>
        </div>

        <div className="field">
          <label htmlFor="lg-min">Points at least</label>
          <input
            id="lg-min"
            type="number"
            step="1"
            inputMode="numeric"
            value={min}
            onChange={(e) => onFilter(setMin)(e.target.value)}
            placeholder="e.g. 100"
          />
          {/* No `min="0"`: a manual adjustment may be negative, so "at most -1" is the way to
              ask for every correction that took points away. */}
          <span className="hint">Negative numbers are allowed - adjustments can take points away</span>
        </div>

        <div className="field">
          <label htmlFor="lg-max">Points at most</label>
          <input
            id="lg-max"
            type="number"
            step="1"
            inputMode="numeric"
            value={max}
            onChange={(e) => onFilter(setMax)(e.target.value)}
            placeholder="e.g. 0"
          />
        </div>
      </div>

      {/* The presets and Reset live OUTSIDE the grid: a button is not a field and does not want
          a field's track, and stretched to one it wraps into a row of half-empty buttons. */}
      <div className="pl-actions" role="group" aria-label="Date range presets">
        <button className="btn btn-quiet" type="button" onClick={() => quickRange(todayIST(), todayIST())}>
          Today
        </button>
        <button className="btn btn-quiet" type="button" onClick={() => quickRange(dateIST(-6), todayIST())}>
          Last 7 days
        </button>
        {/* -29 and not -30: the range is inclusive at both ends, so today plus the twenty-nine
            days behind it is thirty days. */}
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

      {/* What is currently narrowing the ledger, spelled out. Nine controls, several of them
          inside a closed drawer on a phone, mean a list can be narrowed by something the
          સંચાલક cannot see - and a filtered ledger read as the whole ledger is a wrong answer
          that looks like a right one. */}
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

      {/* §11 — its own row rather than a control inside the filter bar, so a press that writes a
          file cannot be mistaken for a press that narrows a list. */}
      <div className="toolbar">
        <span className="grow" />

        {/* A <details> rather than a managed popover: it opens on click and on Enter, closes on
            Escape, and is reachable by Tab without a line of JavaScript. */}
        <details className="pl-cols">
          <summary className="btn btn-quiet">Columns ({gu(visibleColumns.length)})</summary>
          <div className="pl-cols-panel">
            <p className="hint">What the table shows, and what both files hold. Kept on this device.</p>
            {columnGroups.map((g) => (
              <div key={g.title} className="pl-cols-group">
                <h3 className="pl-cols-head">{g.title}</h3>
                <ul className="pl-cols-list">
                  {g.columns.map((c) => {
                    const on = chosen.includes(c.key);
                    return (
                      <li key={c.key}>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={on && chosen.length === 1}
                            onChange={() => toggleColumn(c.key)}
                          />
                          {c.label}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            <button className="btn btn-quiet btn-sm" type="button" onClick={() => setColumns(defaultKeys)}>
              Reset to default columns
            </button>
          </div>
        </details>

        <button
          className={`btn btn-quiet${exporting ? ' is-busy' : ''}`}
          type="button"
          title={EXPORT_HINT}
          onClick={() => runExport('csv')}
          disabled={exporting || report.loading}
        >
          {exporting ? 'Preparing…' : 'Export CSV'}
        </button>
        <button
          className={`btn${exporting ? ' is-busy' : ''}`}
          type="button"
          title={EXPORT_HINT}
          onClick={() => runExport('xlsx')}
          disabled={exporting || report.loading}
        >
          {exporting ? 'Preparing…' : 'Export Excel'}
        </button>
      </div>

      {/* role="status" so a screen reader hears the result of a press that produced no visible
          change on the page itself — the file went to Downloads (§56). */}
      {exportNote && <div className={`notice ${exportNote.tone}`} role="status">{exportNote.text}</div>}

      <p className="card-note">
        Newest first, by the moment each row was written. All filters combine, and every one of
        them is asked of the database rather than of this page - so the count below is the whole
        filtered set and not what happens to be on screen. One file holds up to {gu(EXPORT_CAP)}{' '}
        awards.
      </p>

      {/* isEmpty includes `page === 0`, because AsyncBlock renders <Empty> *instead of* its
          children and the children include the Pager. Walking one page past the end of a
          filtered list would otherwise dead-end it: "nothing matches", no Previous button, and
          no way back to the rows that do exist. */}
      <AsyncBlock
        state={{ ...report, isEmpty: !report.loading && !report.error && rows.length === 0 && page === 0 }}
        emptyIcon="◇"
        emptyTitle={filtered ? 'Nothing matches these filters' : 'No points have been awarded yet'}
        empty={
          filtered
            ? 'No award matches these filters. Widen the date range, or clear the filters.'
            : 'The ledger fills as yuvaks finish activities, once points are switched on in Settings. An empty ledger is usually points being off, not a shortfall.'
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
            caption="Point awards, newest first"
            columns={tableColumns}
            rows={rows}
            // The header follows the rows: `.dt th` is sticky, and `is-tall` gives the wrap a
            // height so it owns the vertical scrolling and sticky has something to stick inside.
            wrapClassName="is-tall"
            rowKey={(r) => r.id}
            // No `sort` and no `onSort`, deliberately: the RPC takes no sort parameter, and a
            // clickable header that re-ordered the twenty rows on screen would call that a sort
            // of the ledger. See the note above the column registry.
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
            Showing {gu(showingFrom)}-{gu(showingTo)} of {gu(total)} award{total === 1 ? '' : 's'} ·
            page {gu(page + 1)} of {gu(Math.max(1, pageCount))}.
          </p>
        </>
      </AsyncBlock>

      <p className="card-note">
        This page is a record. Nothing here can be edited or removed from the panel - a
        correction is a new row of its own, carrying a reason and the name of whoever entered
        it, which is what keeps the history readable years later.
      </p>
    </>
  );
}
