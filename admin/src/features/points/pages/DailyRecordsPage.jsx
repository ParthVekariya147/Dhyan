import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
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
import {
  EXPORT_CAP,
  LEVEL_IDS,
  buildDailyRecordReport,
  dailyRecordDetail,
  dailyRecords,
  editWindow,
  filterOptions,
  levelLabel,
  selfReportedLevels,
} from '../services/dailyRecordService';
import '../ledger.css';

/**
 * Daily records - one row per yuvak per day, with what he reported beside what the app recorded.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * This is NOT the "Daily activity" page, and the difference is stated on screen
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The panel already has a page called Daily activity (`DailyActivityPage.jsx`, /points/daily).
 * It answers **one day across everybody** from the submissions the app observed: how many
 * darshan sessions, how many tests sat, how many points the project paid, with a per-person
 * timeline underneath.
 *
 * This page answers a different question: **one yuvak's day as a record** - the row he filled in
 * himself, what he reported against what the app saw, whether his 24-hour edit window is still
 * open, and the audit trail and ledger rows behind the figure. It spans a date *range* rather
 * than a single day, because a record is something a sanchalak reviews across a week.
 *
 * Two reports that look alike and answer different questions is the failure worth spending
 * words on, so the difference is said three times: in the title, in the header sentence, and in
 * a note carrying a link to the other page. docs/DAILY_RECORD_ARCHITECTURE.md §9 flagged the
 * name collision before either was written; this is where it is paid for.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Reported above recorded is a product decision, not an accusation
 * ────────────────────────────────────────────────────────────────────────────
 *
 * §7 of the design: a yuvak may report more than the app observed, because work done away from
 * the phone still happened. So this page shows both figures, side by side, and marks the ones
 * resting on self-report with a **grey** badge whose word describes the *figure* - "Self
 * reported" - and never the person. Not amber, not red, no "discrepancy", no "unverified days"
 * count and no total of who over-reported. It is the same temperature the panel already uses for
 * `REVISION_REQUIRED`, which is "Revision remaining" in quiet grey on every screen here for
 * exactly this reason (§10, §14).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The edit window comes from the server, never from this browser's clock
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `editWindow()` in the service reads `locked_at` and `status` - both decided by the server -
 * and `edit_until` is displayed as a deadline rather than evaluated. A sanchalak's laptop clock
 * running an hour fast would otherwise paint a still-open record as closed, and he would tell a
 * yuvak his day was finished when the server would still accept the edit.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Read only, and there is nothing here to press that changes a row
 * ────────────────────────────────────────────────────────────────────────────
 *
 * There is no edit path and no delete path for a daily record or for a ledger row anywhere in
 * this panel - not hidden behind a permission, not disabled, absent. A correction appears as an
 * **additional** ledger row; the detail panel says so in as many words, because "the total went
 * from 1430 to 1630" is a sentence a reader will otherwise assume meant a row was changed.
 */

/** Levels 1-3 have exactly one activity each; Level 4 rows carry their own title. */
const ACTIVITY_EN = {
  [ACTIVITY_KEY.VIDEO]: 'Video',
  [ACTIVITY_KEY.DARSHAN]: 'Darshan',
  [ACTIVITY_KEY.REVISION]: 'Revision',
};

/** Where the chosen columns live between visits. Versioned, so a renamed key cannot rot. */
const COLS_KEY = 'varni.admin.dailyrecords.columns.v1';

/**
 * The column picker's headings, and which column sits under each.
 *
 * A flat list of twenty-two checkboxes is a list nobody scans. Declared as one map rather than a
 * `group:` on each entry, so the grouping can be re-cut in one place and a column added to the
 * registry cannot half-belong to a heading. Anything the map does not name still renders, under
 * "Other" - visible rather than silently dropped.
 */
const COLUMN_GROUPS = [
  { title: 'Who and when', keys: ['date', 'name', 'smk', 'city', 'zone'] },
  { title: 'What he reported', keys: ['l1r', 'l2r', 'l3r', 'l4r', 'reportedTotal'] },
  { title: 'What the app recorded', keys: ['l1a', 'l2a', 'l3a', 'l4a', 'recordedTotal'] },
  { title: 'What the day paid', keys: ['basePoints', 'bonusPoints', 'totalPoints'] },
  { title: 'The edit window', keys: ['window', 'editUntil', 'lockedAt', 'firstAt', 'updatedAt', 'status'] },
];

/** localStorage is a convenience, never a dependency - a private window must not break. */
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
  'Every record matching the filters above - not just this page - with exactly the columns chosen here. No mobile numbers and no email addresses.';

/** Said once, where the badge is, so the word never has to carry the explanation on its own. */
const SELF_REPORT_HINT =
  'This count is higher than the app observed. Activity done away from the phone still counts, so his own figure is the one that is used - it is marked only so a reader knows which figures rest on it.';

export default function DailyRecordsPage() {
  /*
    The range opens on the last seven days rather than on all time.

    A records report is read a week at a time, and an unbounded first read of a table holding one
    row per yuvak per day is the one query on this page that could be genuinely slow on a busy
    project. "All time" is one press away and says so.
  */
  const [from, setFrom] = useState(() => dateIST(-6));
  const [to, setTo] = useState(() => todayIST());
  const [search, setSearch] = useState('');
  const [city, setCity] = useState('');
  const [zone, setZone] = useState('');
  const [minPoints, setMinPoints] = useState('');
  const [minLevel, setMinLevel] = useState({ 1: '', 2: '', 3: '', 4: '' });

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState(null); // { tone, text }

  /** Whose record is open underneath the list. Null until a row is pressed. */
  const [open, setOpen] = useState(null); // { uid, date, name }

  /** What the City and mandal lists may offer, read from the rows that exist. */
  const optionsQ = useAsync(() => filterOptions(), []);
  const options = optionsQ.data;

  const filters = useMemo(
    () => ({
      search,
      city,
      zone,
      from,
      to,
      minPoints,
      minLevel1: minLevel[1],
      minLevel2: minLevel[2],
      minLevel3: minLevel[3],
      minLevel4: minLevel[4],
    }),
    [search, city, zone, from, to, minPoints, minLevel]
  );

  const report = useAsync(() => dailyRecords(filters, { page, pageSize }), [filters, page, pageSize]);

  const missing = report.data?.missing === true;
  const rows = report.data?.rows || [];
  const total = report.data?.total ?? 0;
  const pageCount = report.data?.pageCount ?? 0;

  /*
    The opened record, skipped entirely until a row is pressed - this page must cost one read,
    not one plus a speculative second. Keyed on the pair, because a record is (yuvak, day) and
    neither half identifies it alone.
  */
  const detailQ = useAsync(
    () => dailyRecordDetail(open?.uid, open?.date),
    [open?.uid, open?.date],
    { skip: !open }
  );

  /** The mandal list narrows to the chosen city; with no city it offers all of them. */
  const zoneOptions = useMemo(
    () => (options?.zones || []).filter((z) => !city || z.cityId === city),
    [options, city]
  );

  /** Changing the query invalidates which record is open underneath it, and which page this is. */
  const closeDetail = () => setOpen(null);

  const onFilter = (set) => (value) => {
    closeDetail();
    setPage(0);
    set(value);
  };

  /**
   * Choosing a city can strand the mandal underneath it - "Surat + Navsari" would ask a question
   * with no answer and read as a week nobody recorded anything in. The zone is cleared when it no
   * longer belongs and kept when it does, so narrowing a city the sanchalak was already inside
   * does not throw away the finer filter he set first.
   */
  const pickCity = (next) => {
    closeDetail();
    setPage(0);
    setCity(next);
    if (next && zone) {
      const still = (options?.zones || []).some((z) => z.id === zone && z.cityId === next);
      if (!still) setZone('');
    }
  };

  const setLevelMin = (id) => (value) => {
    closeDetail();
    setPage(0);
    setMinLevel((m) => ({ ...m, [id]: value }));
  };

  const quickRange = (f, t) => {
    closeDetail();
    setPage(0);
    setFrom(f);
    setTo(t);
  };

  const clearAll = () => {
    closeDetail();
    setPage(0);
    setSearch('');
    setCity('');
    setZone('');
    setMinPoints('');
    setMinLevel({ 1: '', 2: '', 3: '', 4: '' });
    setFrom('');
    setTo('');
  };

  const openRecord = (r) => {
    // Pressing the same row again closes it. The alternative is a panel that can only ever be
    // opened and a sanchalak hunting for the control that puts it away (§35).
    setOpen((cur) =>
      cur?.uid === r.uid && cur?.date === r.recordDate
        ? null
        : { uid: r.uid, date: r.recordDate, name: r.name }
    );
  };

  const isOpen = (r) => open?.uid === r.uid && open?.date === r.recordDate;

  /**
   * Every filter currently narrowing the report, as one list.
   *
   * One list and not two: the chips and the count are the same fact, and deriving both from here
   * means a filter cannot be active and invisible - which is the failure that matters, because a
   * report narrowed by something the sanchalak cannot see is a report read as the whole.
   */
  const activeFilters = [
    search.trim() && { key: 'search', label: `Search: ${search.trim()}`, clear: () => setSearch('') },
    city && { key: 'city', label: `City: ${zoneNameEn(city)}`, clear: () => setCity('') },
    zone && { key: 'zone', label: `Zone: ${subZoneNameEn(zone)}`, clear: () => setZone('') },
    from && { key: 'from', label: `From ${from}`, clear: () => setFrom('') },
    to && { key: 'to', label: `To ${to}`, clear: () => setTo('') },
    minPoints !== '' && {
      key: 'minPoints',
      label: `At least ${gu(minPoints)} points`,
      clear: () => setMinPoints(''),
    },
    ...LEVEL_IDS.filter((id) => minLevel[id] !== '').map((id) => ({
      key: `min${id}`,
      label: `${levelLabel(id)}: at least ${gu(minLevel[id])}`,
      clear: () => setMinLevel((m) => ({ ...m, [id]: '' })),
    })),
  ].filter(Boolean);

  const activeCount = activeFilters.length;
  const filtered = activeCount > 0;

  /** Dropping one condition is still a new query, so it goes back to the first page. */
  const dropFilter = (f) => {
    closeDetail();
    setPage(0);
    f.clear();
  };

  // ---- the columns, one definition serving the table and both files -------

  /**
   * §11 - one registry, three consumers: the table, the CSV and the Excel file.
   *
   * Each entry carries how it *renders* and how it *exports*, side by side, because a report
   * whose file disagrees with the screen that produced it is the failure this page exists to
   * avoid. Every label reads on its own: below ~820px DataTable turns each row into a card of
   * label/value pairs, and "Level 2" beside a lone number says neither which figure it is nor
   * what it is being compared with.
   *
   * **Reported and recorded are two columns per level rather than one column holding a pair.**
   * A single "3 / 2" cell reads well on screen and is useless in a spreadsheet - neither half is
   * a number Excel can sum, which is the entire reason xlsx.js exists. Two numeric columns give
   * the sanchalak both sums, and on a phone DataTable stacks them as consecutive label/value
   * lines, which is if anything clearer than the pair. The badge that marks a self-reported
   * figure sits on the reported cell, where the figure it describes is.
   *
   * No column is sortable and that is not an omission. `admin_daily_records()` takes no sort
   * parameter, so a clickable header would either lie or would re-order the twenty rows on
   * screen and call it a sort of the report. The order is stated in words under the table.
   */
  const allColumns = useMemo(() => {
    const levelColumns = LEVEL_IDS.flatMap((id) => [
      {
        key: `l${id}r`,
        className: 'dr-c-count',
        label: `${levelLabel(id)} reported`,
        base: true,
        /*
          The one interpretation on this page, and it is deliberately the quietest thing on it.

          `off` - plain grey - and a word about the figure. An amber pill beside a yuvak's name
          would turn a decision the product made on his behalf into a warning about him.
        */
        render: (r) => {
          const above = r.reported[id] > r.recorded[id];
          return (
            <span className="pl-cell">
              <span className="mono pl-num">{gu(r.reported[id])}</span>
              {above ? (
                <StatusBadge tone="off" title={SELF_REPORT_HINT}>
                  Self reported
                </StatusBadge>
              ) : null}
            </span>
          );
        },
        value: (r) => r.reported[id],
        type: 'number',
      },
      {
        key: `l${id}a`,
        className: 'dr-c-count',
        label: `${levelLabel(id)} recorded`,
        base: true,
        // Never rendered as "of" the reported figure. It is not a denominator and the reported
        // count is not a fraction of it - a yuvak may legitimately report three where the app
        // saw two, and "2 / 3" would read as one third of the work missing.
        render: (r) => <span className="mono">{gu(r.recorded[id])}</span>,
        value: (r) => r.recorded[id],
        type: 'number',
      },
    ]);

    return [
      {
        key: 'date',
        className: 'pl-c-date',
        label: 'Day',
        base: true,
        // `record_date` is the IST business day the record belongs to (§9), a plain YYYY-MM-DD
        // rather than an instant - dateGu() reads it as midnight UTC and renders the same
        // calendar day, because India is ahead of UTC and never behind it.
        render: (r) => dateGu(r.recordDate),
        value: (r) => r.recordDate || '',
        type: 'date',
      },
      {
        key: 'name',
        className: 'pl-c-user',
        label: 'Yuvak',
        base: true,
        // `title` because the cell may ellipsize a long name (see .pl-c-user in ledger.css), and
        // an ellipsis with no way to read the rest is a value the sanchalak cannot act on.
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
      // profiles.sub_zone_id - the mandal. Yes, the two names are inverted; see the service.
      {
        key: 'zone',
        className: 'pl-c-zone',
        label: 'Zone',
        render: (r) => subZoneNameEn(r.zoneId),
        value: (r) => subZoneNameEn(r.zoneId),
      },

      ...levelColumns,

      {
        key: 'reportedTotal',
        className: 'dr-c-count',
        label: 'Reported total',
        align: 'right',
        render: (r) => <span className="mono">{gu(r.reportedTotal)}</span>,
        value: (r) => r.reportedTotal,
        type: 'number',
      },
      {
        key: 'recordedTotal',
        className: 'dr-c-count',
        label: 'Recorded total',
        align: 'right',
        render: (r) => <span className="mono">{gu(r.recordedTotal)}</span>,
        value: (r) => r.recordedTotal,
        type: 'number',
      },
      {
        key: 'basePoints',
        className: 'pl-c-points',
        label: 'Base points',
        align: 'right',
        render: (r) => <span className="mono">{gu(r.basePoints)}</span>,
        value: (r) => r.basePoints,
        type: 'number',
      },
      {
        key: 'bonusPoints',
        className: 'pl-c-points',
        label: 'Bonus points',
        align: 'right',
        // Blank rather than 0 would hide the ordinary case, which is a day that earned no bonus
        // at all - and a bonus engine that is switched off should read as "nothing extra", not
        // as a column that failed to load.
        render: (r) => <span className="mono">{gu(r.bonusPoints)}</span>,
        value: (r) => r.bonusPoints,
        type: 'number',
      },
      {
        key: 'totalPoints',
        className: 'pl-c-points',
        label: 'Points on the day',
        align: 'right',
        base: true,
        // A bare number in the file, so Excel sums the column. The sign is part of the number:
        // a day whose only movement was a downward correction is genuinely negative.
        render: (r) => (
          <span className={`mono pl-num${r.totalPoints < 0 ? ' pl-neg' : ''}`}>{gu(r.totalPoints)}</span>
        ),
        value: (r) => r.totalPoints,
        type: 'number',
      },
      {
        key: 'window',
        className: 'dr-c-window',
        label: 'Edit window',
        base: true,
        /*
          The badge is the server's state; the line under it is the deadline as a fact.

          The tense of that line follows the badge and never a comparison against this browser's
          clock - "Closed" only where the server has closed it. A machine an hour fast would
          otherwise tell a sanchalak a record was finished while the server would still take an
          edit, and he would pass that on.
        */
        render: (r) => {
          const w = editWindow(r);
          return (
            <span className="dr-window">
              <StatusBadge tone={w.tone}>{w.label}</StatusBadge>
              {r.editUntil ? (
                <span className="hint pl-sub">
                  {w.id === 'LOCKED' ? 'Closed ' : 'Open until '}
                  {dateTimeGu(r.editUntil)}
                </span>
              ) : null}
            </span>
          );
        },
        value: (r) => editWindow(r).label,
      },
      {
        key: 'editUntil',
        className: 'pl-c-when',
        label: 'Window closes',
        // The deadline on its own, for the file - a spreadsheet wants the instant in a column it
        // can sort, not a sentence with a badge in front of it.
        render: (r) => dateTimeGu(r.editUntil),
        value: (r) => istDate(r.editUntil),
        type: 'date',
      },
      {
        key: 'lockedAt',
        className: 'pl-c-when',
        label: 'Locked at',
        // Genuinely null on an open record, and a dash says that. A 0 or a repeat of the
        // deadline would claim the server had closed something it has not.
        render: (r) => (r.lockedAt ? dateTimeGu(r.lockedAt) : <span className="mono">-</span>),
        value: (r) => istDate(r.lockedAt),
        type: 'date',
      },
      {
        key: 'firstAt',
        className: 'pl-c-when',
        label: 'First submitted',
        render: (r) => dateTimeGu(r.firstSubmittedAt),
        value: (r) => istDate(r.firstSubmittedAt),
        type: 'date',
      },
      {
        key: 'updatedAt',
        className: 'pl-c-when',
        label: 'Last updated',
        // Distinct from First submitted, and the difference is the whole point of the window: the
        // same instant on both means the record was filled in once and never revisited.
        render: (r) => dateTimeGu(r.lastUpdatedAt),
        value: (r) => istDate(r.lastUpdatedAt),
        type: 'date',
      },
      {
        key: 'status',
        label: 'Status',
        // The server's own token, shown raw. Off by default: the Edit window column already says
        // what it means in words, and this is here for the occasion somebody has to trace a row
        // back to the state machine that produced it.
        render: (r) => <span className="mono">{r.status || '-'}</span>,
        value: (r) => r.status,
      },
      {
        key: 'open',
        label: 'This record',
        base: true,
        // A button and not a row click: the name in the second column is already a link to his
        // record, and two different destinations on one row is a row nobody presses confidently.
        render: (r) => (
          <button
            className="btn btn-quiet btn-sm"
            type="button"
            aria-expanded={isOpen(r)}
            onClick={() => openRecord(r)}
          >
            {isOpen(r) ? 'Hide' : 'Open'}
          </button>
        ),
        // Nothing to write: a button is not a value, and a column of the word "Open" in a
        // spreadsheet is a column somebody has to delete before sending it on.
        value: () => '',
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.uid, open?.date]);

  const columnKeys = useMemo(() => new Set(allColumns.map((c) => c.key)), [allColumns]);
  const defaultKeys = useMemo(() => allColumns.filter((c) => c.base).map((c) => c.key), [allColumns]);

  /*
    A key the picker no longer knows about is dropped rather than rendered as a blank column, and
    an empty result falls back to the registry's own defaults - so a stored choice from an older
    bundle degrades to a working table rather than to an empty one.
  */
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
        // so anything not named here is silently dropped - and `className` is what the column
        // width block in ledger.css matches on.
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

  /** The same array both files are built from - see buildDailyRecordReport() in the service. */
  const fileColumns = useMemo(
    () =>
      visibleColumns
        // The action column has no value, and a blank column in a report is noise a reader has to
        // account for before trusting the rest of the sheet.
        .filter((c) => c.key !== 'open')
        .map((c) => ({ label: c.label, value: c.value, type: c.type || 'text' })),
    [visibleColumns]
  );

  /**
   * §11 - the file, over the whole filtered set rather than the page on screen, and fetched once
   * for either format.
   *
   * `buildDailyRecordReport()` is the only fetch; CSV and Excel differ in the last two lines of
   * this function and nowhere else, so the two files can never hold different rows. The count
   * reported afterwards is what the exporter actually wrote, and a cap that was reached is stated
   * with the figure it fell short of (§62).
   */
  const runExport = async (format) => {
    setExporting(true);
    setExportNote(null);
    try {
      const res = await buildDailyRecordReport(filters);
      // The range in the filename, so two exports of two different weeks sort next to each other
      // in a folder and neither has to be opened to find out which is which.
      const csvName = reportFilename('daily-records', { from, to, stamp: todayIST() });
      const written =
        format === 'xlsx'
          ? exportXlsx({
              filename: xlsxFilename(csvName),
              sheetName: 'Daily records',
              columns: fileColumns,
              rows: res.rows,
            })
          : exportCsv({ filename: csvName, columns: fileColumns, rows: res.rows });

      const what = format === 'xlsx' ? 'Excel file' : 'CSV file';
      setExportNote(
        res.truncated
          ? {
              tone: 'notice-warn',
              text: `The ${what} holds the first ${gu(written)} of ${gu(res.total)} records matching these filters (one file holds ${gu(res.cap)}) - narrow the date range and export again.`,
            }
          : {
              tone: 'notice-ok',
              text: `Exported ${gu(written)} record${written === 1 ? '' : 's'} to the ${what}, with the ${gu(fileColumns.length)} columns shown here.`,
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

  return (
    <>
      <PageHeader
        title="Daily records"
        sub="One yuvak, one day: what he reported beside what the app recorded, whether his edit window is still open, and the ledger rows behind the figure."
      />

      {/* Said on the page rather than left to be discovered. Two reports whose names begin with
          the same word, one across everybody and one per record, is exactly the pair a sanchalak
          would otherwise have to open both of to tell apart. */}
      <p className="card-note">
        This is the <strong>record</strong> report - the row each yuvak fills in for his own day,
        over a range of days. For what the whole project did on a single day, from the submissions
        the app itself observed, open <Link to="/points/daily">Daily activity</Link>.
      </p>

      {/* §29 - a phone shows the list first and the controls on request. Above 900px the bar is
          always open and this button is not rendered at all (admin.css .only-narrow), so there is
          no state to get wrong on a desktop. */}
      <div className="pl-bar">
        <button
          className="btn btn-quiet only-narrow"
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="records-filters"
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
        id="records-filters"
        role="group"
        aria-label="Filter the daily records"
      >
        <div className="field">
          <label htmlFor="dr-search">Search</label>
          <input
            id="dr-search"
            type="search"
            value={search}
            onChange={(e) => onFilter(setSearch)(e.target.value)}
            placeholder="Name or SMK"
          />
          <span className="hint">Asked of the database, so it searches every record and not this page</span>
        </div>

        <div className="field">
          <label htmlFor="dr-city">City</label>
          <select id="dr-city" value={city} onChange={(e) => pickCity(e.target.value)}>
            <option value="">All cities</option>
            {(options?.cities || []).map((c) => (
              <option key={c.id} value={c.id}>{`${zoneNameEn(c.id)} (${c.count})`}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="dr-zone">Zone</label>
          <select id="dr-zone" value={zone} onChange={(e) => onFilter(setZone)(e.target.value)}>
            <option value="">{city ? 'All zones in this city' : 'All zones'}</option>
            {zoneOptions.map((z) => (
              <option key={z.id} value={z.id}>{`${subZoneNameEn(z.id)} (${z.count})`}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="dr-from">Day from</label>
          <input
            id="dr-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => onFilter(setFrom)(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="dr-to">Day up to</label>
          <input
            id="dr-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => onFilter(setTo)(e.target.value)}
          />
          <span className="hint">Both days included, counted in India (IST)</span>
        </div>

        <div className="field">
          <label htmlFor="dr-min-points">Points at least</label>
          <input
            id="dr-min-points"
            type="number"
            step="1"
            inputMode="numeric"
            value={minPoints}
            onChange={(e) => onFilter(setMinPoints)(e.target.value)}
            placeholder="e.g. 500"
          />
          {/* No `min="0"`: a day whose only movement was a downward correction is genuinely
              negative, so "at least -1" is a question somebody asks. */}
          <span className="hint">The day&apos;s total, base and bonus together</span>
        </div>

        {/* One threshold per level, from LEVEL_IDS rather than four hand-written fields: a rung
            added to the ladder is a filter here without this block being touched. Each one asks
            the *reported* count, because that is the figure the record is keyed on. */}
        {LEVEL_IDS.map((id) => (
          <div className="field" key={id}>
            <label htmlFor={`dr-min-l${id}`}>{levelLabel(id)} at least</label>
            <input
              id={`dr-min-l${id}`}
              type="number"
              step="1"
              min="0"
              inputMode="numeric"
              value={minLevel[id]}
              onChange={(e) => setLevelMin(id)(e.target.value)}
              placeholder="e.g. 1"
            />
            <span className="hint">Counted on what he reported</span>
          </div>
        ))}
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

      {/* What is currently narrowing the report, spelled out. Eleven controls, several of them
          inside a closed drawer on a phone, mean a list can be narrowed by something the sanchalak
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
          The City and Zone lists could not be loaded, so they are showing "All" only. Everything
          else on this page is unaffected.{' '}
          <button className="linklike" type="button" onClick={optionsQ.retry}>Try again</button>
        </div>
      )}

      {/* §11 - its own row rather than a control inside the filter bar, so a press that writes a
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
          disabled={exporting || report.loading || missing}
        >
          {exporting ? 'Preparing…' : 'Export CSV'}
        </button>
        <button
          className={`btn${exporting ? ' is-busy' : ''}`}
          type="button"
          title={EXPORT_HINT}
          onClick={() => runExport('xlsx')}
          disabled={exporting || report.loading || missing}
        >
          {exporting ? 'Preparing…' : 'Export Excel'}
        </button>
      </div>

      {/* role="status" so a screen reader hears the result of a press that produced no visible
          change on the page itself - the file went to Downloads (§56). */}
      {exportNote && <div className={`notice ${exportNote.tone}`} role="status">{exportNote.text}</div>}

      <p className="card-note">
        Newest day first. All filters combine, and every one of them is asked of the database
        rather than of this page - so the count below is the whole filtered set and not what
        happens to be on screen. One file holds up to {gu(EXPORT_CAP)} records. A count a yuvak
        reported above what the app recorded is marked, never corrected: work done away from the
        phone still counts.
      </p>

      {/*
        A migration that has not landed is a deployment state, not a failure.

        A plain notice and not an ErrorState: a Try again beside it would be inviting the
        sanchalak to retry something that cannot succeed until somebody deploys. Same idiom as
        the bonus card on Point Management.
      */}
      {missing ? (
        <div className="notice notice-warn" role="status">
          This database has no daily-record report yet - the migration that creates it has not been
          applied here. Nothing else in the panel is affected, and no yuvak's record is at risk:
          there is simply nothing for this page to read until it is deployed.
        </div>
      ) : (
        /* isEmpty includes `page === 0`, because AsyncBlock renders <Empty> *instead of* its
           children and the children include the Pager. Walking one page past the end of a filtered
           list would otherwise dead-end it: "nothing matches", no Previous button, and no way back
           to the rows that do exist. */
        <AsyncBlock
          state={{ ...report, isEmpty: !report.loading && !report.error && rows.length === 0 && page === 0 }}
          emptyIcon="◇"
          emptyTitle={filtered ? 'No record matches these filters' : 'No daily record has been filled in yet'}
          empty={
            filtered
              ? 'No daily record matches these filters. Widen the date range, or clear the filters.'
              : 'Records appear here as yuvaks fill in their day. An empty list is a quiet week, not a shortfall.'
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
              caption="Daily records, newest day first"
              columns={tableColumns}
              rows={rows}
              // The header follows the rows: `.dt th` is sticky, and `is-tall` gives the wrap a
              // height so it owns the vertical scrolling and sticky has something to stick inside.
              wrapClassName="is-tall"
              // A record is (yuvak, day) and neither half identifies it alone - two rows for the
              // same yuvak on two days would collide on the uid and React would drop one.
              rowKey={(r) => `${r.uid}|${r.recordDate}`}
            />
            <Pager
              page={page}
              hasNext={!!report.data?.hasNext}
              onPrev={() => {
                closeDetail();
                setPage((p) => Math.max(0, p - 1));
              }}
              onNext={() => {
                closeDetail();
                setPage((p) => p + 1);
              }}
              pageSize={pageSize}
              onPageSize={(n) => {
                closeDetail();
                setPage(0);
                setPageSize(n);
              }}
              busy={report.loading}
            />
            {/* The pager can only say which page this is; the size of the whole filtered set comes
                back with the rows (`count(*) over ()`), so the two can never disagree. */}
            <p className="card-note">
              Showing {gu(showingFrom)}-{gu(showingTo)} of {gu(total)} record{total === 1 ? '' : 's'} ·
              page {gu(page + 1)} of {gu(Math.max(1, pageCount))}.
            </p>
          </>
        </AsyncBlock>
      )}

      {open && <RecordDetail open={open} query={detailQ} onClose={closeDetail} />}

      <p className="card-note">
        This page is a record. Nothing here can be edited or removed from the panel. When a yuvak
        changes a count inside his edit window the ledger is not rewritten - a further row is added
        for the difference, so the day&apos;s history shows what was awarded, what was corrected
        and in which order.
      </p>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * One record, opened underneath its row
 * ------------------------------------------------------------------------- */

/**
 * The audit trail and the ledger rows behind one day, opened under the list rather than on a
 * route of its own: it is that row expanded, and a page change would throw away the date range,
 * the city and the mandal already chosen.
 *
 * Two tables and not one, because they are two different records of the same day and merging
 * them would be the panel inventing a causal link it cannot verify. The audit trail says a count
 * moved and what the day was worth either side; the ledger says which rows were written. The
 * prose between them says the second is append-only, which is the fact a reader is most likely
 * to assume the opposite of.
 */
function RecordDetail({ open, query, onClose }) {
  const detail = query.data;
  const missing = detail?.missing === true;
  const record = detail?.record || null;
  const levels = detail?.levels || [];
  const audit = detail?.audit || [];
  const ledger = detail?.ledger || [];

  const marked = record ? selfReportedLevels(record) : [];

  return (
    <section className="pl-timeline dr-detail">
      <div className="pl-timeline-head">
        <h2 className="section-title">
          {open.name || 'This yuvak'} - {dateGu(open.date)}
        </h2>
        <button className="linklike" type="button" onClick={onClose}>Close</button>
      </div>

      {missing ? (
        <div className="notice notice-warn" role="status">
          The detail of a record cannot be read on this database yet - the migration that creates
          it has not been applied here.
        </div>
      ) : (
        <AsyncBlock
          state={{
            ...query,
            isEmpty: !query.loading && !query.error && !record && levels.length === 0 && audit.length === 0 && ledger.length === 0,
          }}
          emptyIcon="◷"
          emptyTitle="Nothing recorded for this day"
          empty="No daily record was found for this yuvak on this day."
          onRetry={query.retry}
          skeleton={<TableSkeleton cols={6} />}
        >
          <>
            {/* The counts first, because they are what the row above was showing and what the two
                tables below are about. Reported and recorded side by side once more, at the size
                a reader actually compares numbers at. */}
            {levels.length > 0 && (
              <>
                <h3 className="dr-detail-head">Counts on this day</h3>
                <DataTable
                  caption="What was reported and what the app recorded, level by level"
                  columns={[
                    { key: 'level', label: 'Level', render: (r) => levelLabel(r.levelId) },
                    {
                      key: 'reported',
                      label: 'Reported',
                      align: 'right',
                      render: (r) => (
                        <span className="pl-cell">
                          <span className="mono pl-num">{gu(r.reported)}</span>
                          {r.reported > r.recorded ? (
                            <StatusBadge tone="off" title={SELF_REPORT_HINT}>Self reported</StatusBadge>
                          ) : null}
                        </span>
                      ),
                    },
                    {
                      key: 'recorded',
                      label: 'Recorded by the app',
                      align: 'right',
                      render: (r) => <span className="mono">{gu(r.recorded)}</span>,
                    },
                    {
                      key: 'points',
                      label: 'Points',
                      align: 'right',
                      render: (r) => (
                        <span className={`mono pl-num${r.points < 0 ? ' pl-neg' : ''}`}>{gu(r.points)}</span>
                      ),
                    },
                  ]}
                  rows={levels}
                  rowKey={(r) => `lvl-${r.levelId}`}
                />
                {marked.length > 0 && (
                  <p className="card-note">
                    {marked.length === 1
                      ? `${levelLabel(marked[0])} rests on the yuvak's own count.`
                      : `${marked.map(levelLabel).join(', ')} rest on the yuvak's own count.`}{' '}
                    That is how the record is meant to work - darshan and revision done away from
                    the phone still happened, and the count he gives is the one that is used.
                  </p>
                )}
              </>
            )}

            {/* ------------------------------------------------------ the audit trail */}

            <h3 className="dr-detail-head">Every change to this record</h3>
            {audit.length === 0 ? (
              <p className="card-note">
                This record was filled in once and never changed - so there is nothing in its audit
                trail, which is the ordinary case rather than a gap.
              </p>
            ) : (
              <>
                <DataTable
                  caption="Every edit to this record, newest first"
                  columns={[
                    { key: 'at', className: 'pl-c-when', label: 'At', render: (r) => dateTimeGu(r.at) },
                    {
                      key: 'level',
                      label: 'Level',
                      render: (r) => (r.levelId == null ? <span className="mono">-</span> : levelLabel(r.levelId)),
                    },
                    {
                      key: 'count',
                      label: 'Count',
                      align: 'right',
                      // The arrow carries the change, and both figures are kept: "3" alone would
                      // say what it became and lose what it was, which is the half a reader needs
                      // in order to make sense of the points beside it.
                      render: (r) =>
                        r.oldCount == null && r.newCount == null ? (
                          <span className="mono">-</span>
                        ) : (
                          <span className="mono pl-num">
                            {gu(r.oldCount ?? 0)} → {gu(r.newCount ?? 0)}
                          </span>
                        ),
                    },
                    {
                      key: 'points',
                      className: 'pl-c-points',
                      label: "The day's points",
                      align: 'right',
                      // Recorded by the server either side of the edit, never computed here from
                      // the counts: only the server knows which rules were live at that instant.
                      render: (r) =>
                        r.pointsBefore == null && r.pointsAfter == null ? (
                          <span className="mono">-</span>
                        ) : (
                          <span className="mono pl-num">
                            {gu(r.pointsBefore ?? 0)} → {gu(r.pointsAfter ?? 0)}
                          </span>
                        ),
                    },
                    {
                      key: 'who',
                      className: 'pl-c-reason',
                      label: 'Reason and who',
                      // Both in one cell because they are one fact: somebody changed the record,
                      // and this is why and who. Blank on an edit the yuvak made himself, which
                      // is the ordinary case and is not an omission.
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
                  rows={audit}
                  rowKey={(r) => r.key}
                />
                <p className="card-note">
                  The count and the points are recorded separately on purpose. The count is what the
                  yuvak changed; the points are what the engine then made of it under the rules that
                  were live at that moment, which is why an identical edit on two different days can
                  move the total by different amounts.
                </p>
              </>
            )}

            {/* ---------------------------------------------------------- the ledger */}

            <h3 className="dr-detail-head">The ledger behind this day</h3>
            {ledger.length === 0 ? (
              <p className="card-note">
                No award is attached to this day. Usually that means points were switched off, or
                every activity on it had already paid for the day.
              </p>
            ) : (
              <DataTable
                caption="Every ledger row written for this day, oldest first"
                columns={[
                  { key: 'at', className: 'pl-c-when', label: 'Written at', render: (r) => dateTimeGu(r.createdAt) },
                  {
                    key: 'activity',
                    className: 'pl-c-activity',
                    label: 'Activity',
                    // The level travels in the same cell as the name. Below ~820px this row is a
                    // card with no neighbouring column to borrow context from, so "Revision" alone
                    // would not say which rung it came from.
                    render: (r) => (
                      <>
                        {r.title || ACTIVITY_EN[r.activityKey] || r.activityKey || '-'}
                        {r.levelId == null ? null : <span className="hint pl-sub">{levelLabel(r.levelId)}</span>}
                      </>
                    ),
                  },
                  {
                    key: 'kind',
                    className: 'pl-c-kind',
                    label: 'Award kind',
                    // The server's own token rather than a translation of it: this panel's ledger
                    // vocabulary lives in ledgerService.js and a second copy here is a second place
                    // for a new kind to be rendered as the wrong word.
                    render: (r) => (
                      <StatusBadge tone={r.isLegacy ? 'off' : r.awardKind === 'MANUAL' ? 'warn' : 'info'}>
                        {r.isLegacy ? 'Before the new engine' : r.awardKind || '-'}
                      </StatusBadge>
                    ),
                  },
                  {
                    key: 'points',
                    className: 'pl-c-points',
                    label: 'Points',
                    align: 'right',
                    /*
                      A negative row is a correction, not an error.

                      Amber ink and never red: it is the compensating row the design calls for -
                      the yuvak brought a count back down and the ledger added the difference
                      rather than restating what it had already paid.
                    */
                    render: (r) => (
                      <span className={`mono pl-num${r.points < 0 ? ' pl-neg' : ''}`}>
                        {r.points > 0 ? '+' : ''}
                        {gu(r.points)}
                      </span>
                    ),
                  },
                  {
                    key: 'reason',
                    className: 'pl-c-reason',
                    label: 'Reason and who',
                    render: (r) =>
                      r.reason || r.adminName ? (
                        <>
                          {r.reason || '-'}
                          {r.adminName ? <span className="hint pl-sub">{r.adminName}</span> : null}
                        </>
                      ) : (
                        <span className="mono">-</span>
                      ),
                  },
                ]}
                rows={ledger}
                rowKey={(r) => r.key}
              />
            )}

            <p className="card-note">
              The ledger is only ever added to. Nothing above was edited and nothing was removed:
              where a count changed, the difference was written as a further row of its own, so the
              rows read in the order they happened and the day&apos;s total is their sum. That is
              also why a correction that was itself a mistake appears as a third row rather than as
              the second one being put right.
            </p>
          </>
        </AsyncBlock>
      )}
    </section>
  );
}
