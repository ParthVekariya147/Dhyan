import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import {
  activityCounts,
  buildProgressReport,
  progressFilterOptions,
  progressReport,
  progressSummary,
} from '../services/progressService';
import DataTable, { Pager } from '../../../components/DataTable';
import { AsyncBlock, CardSkeleton, TableSkeleton } from '../../../components/StateBlocks';
import StatCard, { PageHeader, StatusBadge, guCount } from '../../../components/StatCard';
import { dateTimeGu, gu, percent } from '../../../lib/format';
import { dataError } from '../../../lib/errors';
import { exportCsv, istDate, reportFilename } from '../../../lib/export';
import { exportXlsx, xlsxFilename } from '../../../lib/xlsx';
import { loadLiveScenes } from '../../../lib/liveScenes';
import { dateIST, todayIST } from '../../../../../shared/domain/constants.js';
import { subZoneNameEn, zoneNameEn } from '../../../lib/labels';
import '../progress.css';

/**
 * §38 — organisation-wide progress, from the tables the app actually writes.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The denominator is loaded before anything else is asked, and that is the whole design
 * ────────────────────────────────────────────────────────────────────────────
 *
 * "૮૭ of ૧૦૮" needs the second figure, and Postgres has never held it. The દર્શન collection
 * is `content/darshan.json` overlaid by `public.scenes`, which withholds some દ્રશ્યો and adds
 * others, so only a browser carrying the manifest can say what the live set is — or who is
 * in it. `loadLiveScenes()` resolves that set exactly as `src/lib/useScenes.js` does for the
 * યુવક, and its `ids` travel to every RPC on this page as `p_live_scene_ids`.
 *
 * That array is what turns "remembered" from a count into a membership test. A યુવક who
 * ticked 108 દ્રશ્યો, one of which has since been withheld, holds 107 of today's 108 — and a
 * count alone cannot tell that apart from "he missed one". Passing the ids makes the server
 * intersect against what the app actually shows today.
 *
 * So the manifest is loaded first and **everything** on this page waits for it. If it fails,
 * the page is an ErrorState with a Try again — never a table of counts divided by a total
 * nobody can vouch for. A wrong percentage looks exactly like a right one, which is why a
 * failed read is not allowed to become one (§62).
 *
 * No literal collection size appears in this file. Every threshold, every band edge and
 * every preset is a share of `contentTotal`, computed at render, so publishing or
 * withholding one દર્શન re-labels the whole page instead of quietly making it wrong.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Tone (§10, §14)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * No streaks. No "missed", no "failed", no "behind". No red anywhere on a person's record: a
 * level not yet reached is a dash, a યુવક who has not started reads "Not started" in grey,
 * and REVISION_REQUIRED reads "Revision remaining" — a thing still to do, never a verdict. A
 * read that failed is never rendered as a fact about anybody.
 */

/**
 * profiles.status — whether the account still works. §7 suspends and never deletes, so
 * SUSPENDED is a row a સંચાલક will meet here and it must not read as ACTIVE. DISABLED is
 * grey rather than red: it is an administrative state, not a verdict on the યુવક.
 */
const ACCOUNT_STATUS = {
  ACTIVE: { label: 'Active', tone: 'ok' },
  SUSPENDED: { label: 'Suspended', tone: 'warn' },
  DISABLED: { label: 'Disabled', tone: 'off' },
};

const accountStatus = (id) => ACCOUNT_STATUS[id] || { label: id || '-', tone: 'off' };

/** The bands the remembered filter offers, as shares of the live collection total. */
const REMEMBERED_PCTS = [25, 50, 75, 90];

/** Shares of the collection offered as a percentage threshold in their own right. */
const PERCENT_PRESETS = [25, 50, 75, 90, 100];

/** The same idea for લેવલ ૪ — see the note beside the filter for why it is not 20+. */
const LEVEL4_PCTS = [25, 50, 75, 100];

/** Attempt thresholds are small absolute numbers: nobody asks for "at least 40% of tries". */
const ATTEMPT_PRESETS = [1, 2, 3, 5, 10];

/**
 * The band keys the summary returns, said in words.
 *
 * The keys are the server's and the bounds beside them are the server's too — this map only
 * decides how a share is spoken, so "90+" reads as a range rather than as a number somebody
 * might mistake for a count of દર્શન. A key with no entry falls through unchanged, which is
 * visible rather than blank if the bins are ever re-cut.
 */
const BAND_LABEL = {
  '100%': 'The whole collection',
  '90+': '90% and above',
  '75-89': '75-89%',
  '50-74': '50-74%',
  '25-49': '25-49%',
  '1-24': '1-24%',
};

/**
 * The share of the collection above which a યુવક reads as "High progress" rather than
 * "In progress". A ratio, never a count — the same three-quarters whether the collection is
 * a hundred દ્રશ્યો or a thousand.
 */
const HIGH_SHARE = 0.75;

/**
 * §11's "Sort by", spelled the way the સંચાલક asks for it rather than the way Postgres
 * orders it. Each preset is a field the RPC accepts plus a direction, so choosing one is the
 * same operation as pressing a column header — there is no second sorting mechanism.
 */
const SORT_PRESETS = [
  { id: 'progress-high', label: 'Highest progress', field: 'remembered', dir: 'desc' },
  { id: 'progress-low', label: 'Lowest progress', field: 'remembered', dir: 'asc' },
  { id: 'name', label: 'Name (A-Z)', field: 'name', dir: 'asc' },
  { id: 'tests', label: 'Most tests passed', field: 'l4_passed', dir: 'desc' },
  { id: 'attempts', label: 'Most attempts', field: 'l4_attempts', dir: 'desc' },
  { id: 'active-new', label: 'Latest activity', field: 'last_active', dir: 'desc' },
  { id: 'active-old', label: 'Oldest activity', field: 'last_active', dir: 'asc' },
  { id: 'registered', label: 'Registration date', field: 'registered', dir: 'desc' },
];

/** Where the chosen columns live between visits. Versioned, so a renamed key cannot rot. */
const COLS_KEY = 'varni.admin.progress.columns.v2';

/**
 * The column picker's headings, and which column sits under each.
 *
 * A flat list of nineteen checkboxes is a list nobody scans; five headings turn it into
 * something a સંચાલક reads once and then navigates by. Declared here as one map rather than a
 * `group:` on each of the nineteen entries, so the grouping can be re-cut in one place and a
 * column added to the registry cannot half-belong to a heading.
 *
 * Order is the order the headings appear. A column named in no group still renders, under
 * "Other" - visible rather than silently dropped, which is what a missing entry deserves to be.
 */
const COLUMN_GROUPS = [
  { title: 'Identity', keys: ['name', 'smk', 'city', 'zone', 'status', 'registered'] },
  { title: 'Progress', keys: ['remembered', 'percentage', 'content_total'] },
  { title: 'Levels', keys: ['level1', 'level2', 'level3'] },
  { title: 'Level 4', keys: ['l4_passed', 'l4_attempts', 'revision', 'gate'] },
  {
    title: 'Activity',
    keys: [
      'last_active',
      'attempts_all',
      'darshan_sessions',
      'revision_sessions',
      'ticks',
      'points',
      'rank',
    ],
  },
];

/**
 * The five columns that arrive from a second call, and the two helpers that render them.
 *
 * `admin_progress_report()` does not carry Darshan sessions, revision sessions, ticks, the
 * all-level attempt count or the leaderboard rank; `admin_activity_counts()` does, keyed on the
 * page of ids the report just returned. So these cells have three states rather than two — a
 * number, a genuine zero, and "not fetched yet" — and the third must not print as the second.
 * A '-' says the panel has not asked; a ૦ says it asked and the answer was none. Collapsing
 * them would put a claim about a યુવક on screen that no read supports (§62).
 *
 * Switching one of these columns on is what makes the panel ask, which is what `needsCounts`
 * on the registry entry is for: a table showing none of them costs one round trip, exactly as
 * it did before they existed.
 */
const countCell = (r, n) => <span className="mono">{r.counted ? gu(n) : '-'}</span>;

/** The all-level attempt count this page can add up on its own - see the column's comment. */
const clientAttempts = (r) =>
  r.level1Attempts + r.level2Attempts + r.level3Attempts + r.level4Attempts;

/** What both export buttons do, on the buttons rather than in a line of page prose. */
const EXPORT_HINT =
  'Every yuvak matching the filters above - not just this page - with exactly the columns chosen here. No mobile numbers and no email addresses.';

/**
 * One level, as a badge.
 *
 * `NOT_STARTED` reads "Not started" and not a dash, because they are different answers and
 * the brief is explicit about not collapsing them: a dash means "no record of this", and a
 * યુવક who has registered and not yet begun લેવલ ૩ has a record — it says he has not begun.
 * The dash is kept for the genuinely absent status, which is what an unrecognised value is.
 */
function levelMark(status, attempts) {
  if (status === 'COMPLETED') {
    return (
      <StatusBadge tone="ok" title={attempts ? `${attempts} attempt${attempts === 1 ? '' : 's'}` : undefined}>
        ✓ Complete
      </StatusBadge>
    );
  }
  if (status === 'NOT_STARTED') return <StatusBadge tone="off">- Not started</StatusBadge>;
  return <span className="mono">-</span>;
}

/**
 * The share of the collection a યુવક holds — **the server's own figure**, not a second one.
 *
 * This used to be `Math.floor((r.remembered / r.contentTotal) * 1000) / 10`, and that was a
 * defect rather than a shortcut. `admin_progress_report()` already returns `remembered_pct`,
 * rounded in Postgres to two places, and recomputing it here with a floor produced a
 * different number: a real production row carries `remembered_pct = 99.07`, which this
 * printed as **99.0%** while the export — which reads the mapped `rememberedPct` — wrote
 * **99.1%**. The screen disagreed with the file and both claimed to be the same report.
 *
 * So there is one definition and it lives in the database, which is the rule the whole
 * reporting layer is built on. Null, never zero, when there is no denominator: "0%" is a
 * claim about a યુવક and "we cannot say" is the fact.
 */
const pctOf = (r) => (r.rememberedPct == null ? null : Number(r.rememberedPct));

/** One decimal for the eye. The file gets the unrounded number, so nothing is lost. */
const pctText = (r) => {
  const p = pctOf(r);
  return p === null ? '-' : `${p.toFixed(1)}%`;
};

/**
 * How far along, as one badge. Colour repeats the word and is never the only signal (§43).
 *
 * There is no band for "remembered nothing" that shames anybody: a યુવક who has not started
 * reads "Not started" in the same neutral grey as an administrative state.
 */
function stageOf(r) {
  const total = r.contentTotal;
  if (total && r.remembered >= total) return { tone: 'ok', label: 'Complete' };
  if (total && r.remembered >= Math.ceil(total * HIGH_SHARE)) return { tone: 'high', label: 'High progress' };
  if (r.remembered > 0) return { tone: 'info', label: 'In progress' };
  return { tone: 'off', label: 'Not started' };
}

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

export default function ProgressPage() {
  // ---- the filters, all of them server-side ------------------------------
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [city, setCity] = useState('');
  const [zone, setZone] = useState('');
  const [level, setLevel] = useState('');
  const [status, setStatus] = useState('');
  const [minRemembered, setMinRemembered] = useState('');
  const [customR, setCustomR] = useState(false);
  const [minPercentage, setMinPercentage] = useState('');
  const [minL4Passed, setMinL4Passed] = useState('');
  const [customL4, setCustomL4] = useState(false);
  const [minL4Attempts, setMinL4Attempts] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [activeSince, setActiveSince] = useState('');

  const [sortField, setSortField] = useState('remembered');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState(null); // { tone, text }

  /**
   * §84 — the search box is debounced, and that is a cost decision as much as a UX one.
   *
   * `admin_progress_report()` intersects two attempt tables against the live collection for
   * every યુવક the filter reaches. Firing that on every keystroke of "prakash" is seven of
   * those scans to answer one question, and six of them are already stale when they land.
   * 300ms is long enough to cover ordinary typing and short enough that the list still feels
   * like it is following the box. The page returns to one, because "page 3 of the old term"
   * is not a page of the new one.
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

  /**
   * The live collection, once. `loadLiveScenes()` memoises for the session, so the 124 KB
   * manifest is fetched on the first progress screen a સંચાલક opens and on no other.
   */
  const liveQ = useAsync(() => loadLiveScenes(), []);
  const live = liveQ.data;
  const liveIds = live?.ids || null;

  /** What the City, મંડળ and Status lists may offer. Independent of the manifest. */
  const optionsQ = useAsync(() => progressFilterOptions(), []);
  const options = optionsQ.data;

  const filters = useMemo(
    () => ({
      search,
      city,
      zone,
      level,
      status,
      minRemembered,
      minPercentage,
      minL4Passed,
      minL4Attempts,
      from,
      to,
      activeSince,
      sort: sortField,
      dir: sortDir,
      liveIds,
    }),
    [
      search, city, zone, level, status,
      minRemembered, minPercentage, minL4Passed, minL4Attempts,
      from, to, activeSince, sortField, sortDir, liveIds,
    ]
  );

  const summary = useAsync(
    () => progressSummary({ from, to, city, zone, liveIds }),
    [from, to, city, zone, liveIds],
    { skip: !liveIds }
  );
  const sum = summary.data;

  const report = useAsync(
    () => progressReport(filters, { page, pageSize }),
    [filters, page, pageSize],
    { skip: !liveIds }
  );

  const rows = report.data?.rows || [];
  const total = report.data?.total ?? 0;
  const pageCount = report.data?.pageCount ?? 0;

  /**
   * The denominator, and every threshold derived from it.
   *
   * The server echoes back the size of the collection it actually scored against, which with
   * `p_live_scene_ids` supplied is the array this browser sent. `live.total` is the fallback
   * only for the moment before the summary lands, so the heading does not flicker.
   */
  const contentTotal = sum?.contentTotal || live?.total || 0;
  const level4Total = sum?.level4Total || options?.level4Total || 0;
  const estimated = sum?.contentSource === 'server-estimate';

  const rememberedPresets = useMemo(
    () =>
      contentTotal > 0
        ? REMEMBERED_PCTS.map((pct) => ({ pct, value: Math.ceil((contentTotal * pct) / 100) }))
        : [],
    [contentTotal]
  );

  /**
   * લેવલ ૪'s thresholds are shares of however many કસોટીઓ the published configuration
   * actually has. Offering "20+" would be offering a filter that can only ever answer
   * "nobody" — and a filter that always returns nothing is read as a broken page, not as an
   * empty set. Deduplicated because 25% and 50% of a small number collide, and two identical
   * options in a select is a bug the reader has to diagnose.
   */
  const l4Presets = useMemo(
    () =>
      level4Total > 0
        ? [...new Set(LEVEL4_PCTS.map((pct) => Math.max(1, Math.ceil((level4Total * pct) / 100))))]
        : [],
    [level4Total]
  );

  /** The મંડળ list narrows to the chosen city; with no city it offers all of them. */
  const zoneOptions = useMemo(
    () => (options?.zones || []).filter((z) => !city || z.cityId === city),
    [options, city]
  );

  const rSelect = customR ? 'custom' : minRemembered;
  const l4Select = customL4 ? 'custom' : minL4Passed;

  /**
   * Choosing a city can strand the મંડળ underneath it — "Surat + Navsari" would ask a
   * question with no answer and read as an empty database. The zone is cleared when it no
   * longer belongs, and kept when it does, so narrowing a city the સંચાલક was already inside
   * does not throw away the finer filter he set first.
   */
  const pickCity = (next) => {
    setPage(0);
    setCity(next);
    if (next && zone) {
      const still = (options?.zones || []).some((z) => z.id === zone && z.cityId === next);
      if (!still) setZone('');
    }
  };

  /**
   * A band on the chart is a filter, pressed. Clicking it again clears it, because the
   * alternative is a chart that can only ever narrow the list and a સંચાલક hunting for which
   * control to undo (§35).
   *
   * `lo` is an absolute remembered-count derived by the function from the live total, so it
   * goes straight into `p_min_remembered`. For the '100%' band that number *is* the whole
   * collection. It usually equals one of the presets above; when it does not, the select
   * shows Custom with the number in it rather than silently reading "All" over a filtered
   * list.
   */
  const pickBand = (b) => {
    setPage(0);
    if (minRemembered === String(b.lo)) {
      setMinRemembered('');
      setCustomR(false);
      return;
    }
    setMinRemembered(String(b.lo));
    setCustomR(!rememberedPresets.some((p) => p.value === b.lo));
  };

  const quickRange = (f, t) => {
    setPage(0);
    setFrom(f);
    setTo(t);
  };

  /**
   * Every filter that is currently narrowing the report, as one list.
   *
   * One list and not two: the count and the chips are the same fact, and when they were
   * derived separately the count was a sum of twelve ternaries that a thirteenth filter would
   * have been added to on a good day and forgotten on a normal one. Deriving both from this
   * means a filter cannot be active and invisible - which is the failure that matters, because
   * a report narrowed by something the સંચાલક cannot see is a report read as the whole.
   *
   * `clear` is per chip so one condition can be dropped without losing the other five.
   */
  const activeFilters = [
    search && { key: 'q', label: `Search: ${search}`, clear: () => { setTerm(''); setSearch(''); } },
    city && { key: 'city', label: `City: ${zoneNameEn(city)}`, clear: () => setCity('') },
    zone && { key: 'zone', label: `Zone: ${subZoneNameEn(zone)}`, clear: () => setZone('') },
    level && { key: 'level', label: `Level ${level}`, clear: () => setLevel('') },
    status && { key: 'status', label: `Status: ${accountStatus(status).label}`, clear: () => setStatus('') },
    minRemembered && {
      key: 'rem',
      label: `Remembered: ${gu(minRemembered)}+`,
      clear: () => { setMinRemembered(''); setCustomR(false); },
    },
    minPercentage && {
      key: 'pct', label: `Percentage: ${gu(minPercentage)}%+`, clear: () => setMinPercentage(''),
    },
    minL4Passed && {
      key: 'l4p',
      label: `Level 4 passed: ${gu(minL4Passed)}+`,
      clear: () => { setMinL4Passed(''); setCustomL4(false); },
    },
    minL4Attempts && {
      key: 'l4a', label: `Level 4 attempts: ${gu(minL4Attempts)}+`, clear: () => setMinL4Attempts(''),
    },
    from && { key: 'from', label: `From ${from}`, clear: () => setFrom('') },
    to && { key: 'to', label: `To ${to}`, clear: () => setTo('') },
    activeSince && { key: 'since', label: `Active since ${activeSince}`, clear: () => setActiveSince('') },
  ].filter(Boolean);

  const activeCount = activeFilters.length;
  const filtered = activeCount > 0;

  /** Dropping one condition is still a new query, so it goes back to the first page. */
  const dropFilter = (f) => { setPage(0); f.clear(); };

  const clearAll = () => {
    setPage(0);
    setTerm('');
    setSearch('');
    setCity('');
    setZone('');
    setLevel('');
    setStatus('');
    setMinRemembered('');
    setCustomR(false);
    setMinPercentage('');
    setMinL4Passed('');
    setCustomL4(false);
    setMinL4Attempts('');
    setFrom('');
    setTo('');
    setActiveSince('');
  };

  // ---- the columns, one definition serving the table and both files -------

  /**
   * §11 — one registry, three consumers.
   *
   * Each entry carries how it *renders* and how it *exports*, side by side, because a report
   * whose file disagrees with the screen that produced it is the failure this whole page
   * exists to avoid. `sortKey` doubles as the column's key so `DataTable`'s `onSort` hands
   * back a token `p_sort` accepts with no lookup table in between — naming a sort twice is
   * how a rename gets to be silently wrong.
   *
   * Every label reads on its own: below ~820px `DataTable` turns each row into a card of
   * label/value pairs, and "L4" beside a lone number says nothing without the header row
   * that is no longer there.
   *
   * Mobile numbers and email addresses are not on this list and are not offered as a choice.
   * A progress report is read out at a meeting and forwarded on WhatsApp, and there is no
   * version of "how far has each yuvak reached" that needs 2,000 phone numbers on the same
   * sheet — some of which belong to minors. Email is the only password-recovery route (§2.1)
   * and answers no question a report asks. SMK identifies a યુવક uniquely (§4), which is what
   * makes the file useful without either (§13).
   */
  const allColumns = useMemo(
    () => [
      {
        key: 'name',
        className: 'pf-c-user',
        label: 'User',
        sortKey: 'name',
        base: true,
        // `title` because the cell may ellipsize a long name (see .pf-c-user in progress.css)
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
        className: 'pf-c-smk',
        label: 'SMK',
        base: true,
        render: (r) => <span className="mono">{r.smk || '-'}</span>,
        value: (r) => r.smk,
      },
      // profiles.zone_id. The business calls it the city; zoneNameEn() is its label helper.
      { key: 'city', className: 'pf-c-city', label: 'City', base: true, render: (r) => zoneNameEn(r.cityId), value: (r) => zoneNameEn(r.cityId) },
      // profiles.sub_zone_id — the મંડળ. Yes, the two names are inverted; see the service.
      { key: 'zone', className: 'pf-c-zone', label: 'Zone', base: true, render: (r) => subZoneNameEn(r.zoneId), value: (r) => subZoneNameEn(r.zoneId) },
      {
        key: 'level1',
        label: 'Level 1',
        base: true,
        render: (r) => levelMark(r.level1Status, r.level1Attempts),
        value: (r) => (r.level1Status === 'COMPLETED' ? 'Complete' : ''),
      },
      {
        key: 'level2',
        label: 'Level 2',
        base: true,
        render: (r) => levelMark(r.level2Status, r.level2Attempts),
        value: (r) => (r.level2Status === 'COMPLETED' ? 'Complete' : ''),
      },
      {
        key: 'level3',
        label: 'Level 3',
        base: true,
        render: (r) => levelMark(r.level3Status, r.level3Attempts),
        value: (r) => (r.level3Status === 'COMPLETED' ? 'Complete' : ''),
      },
      {
        key: 'remembered',
        className: 'pf-c-remembered',
        label: 'Darshan remembered',
        align: 'right',
        sortKey: 'remembered',
        base: true,
        // The share is derived from the two numbers printed beside it, so a row cannot show
        // a percentage that disagrees with its own figures (§62). The badge repeats the same
        // reading in a word, for anyone the tints do not reach.
        render: (r) => {
          const st = stageOf(r);
          return (
            <span className="pf-cell">
              <span className="mono pf-count">
                {gu(r.remembered)}
                {r.contentTotal ? ` / ${gu(r.contentTotal)}` : ''}
              </span>
              <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
            </span>
          );
        },
        value: (r) => r.remembered,
        type: 'number',
      },
      {
        key: 'content_total',
        label: 'Out of (darshan)',
        align: 'right',
        // Blank rather than 0 when the total is unknown: a 0 in a spreadsheet is a number
        // somebody will sum, and this one would be a denominator.
        render: (r) => <span className="mono">{r.contentTotal ? gu(r.contentTotal) : '-'}</span>,
        value: (r) => r.contentTotal || '',
        type: 'number',
      },
      {
        key: 'percentage',
        className: 'pf-c-pct',
        label: 'Remembered %',
        align: 'right',
        sortKey: 'percentage',
        base: true,
        // The server's `remembered_pct`, shown to one place. Not recomputed here — see pctOf.
        render: (r) => <span className="mono">{pctText(r)}</span>,
        // A bare number in the file, not "80.5%", so Excel sorts it as a quantity. Unrounded,
        // because a spreadsheet is where somebody averages a column and 99.07 is the truth.
        value: (r) => {
          const p = pctOf(r);
          return p === null ? '' : p;
        },
        type: 'number',
      },
      {
        key: 'l4_passed',
        label: 'Level 4 tests passed',
        align: 'right',
        sortKey: 'l4_passed',
        base: true,
        // r.level4Total is the row's own view of the published configuration, so a યુવક who
        // worked through an older one is not scored against a total he never saw. "Revision
        // remaining" is a thing still to do — grey, and never a word for failing.
        render: (r) => (
          <span className="pf-cell">
            <span className="mono">
              {gu(r.level4Passed)}
              {r.level4Total ? ` / ${gu(r.level4Total)}` : ''}
            </span>
            {r.level4Revision > 0 ? <StatusBadge tone="off">Revision remaining</StatusBadge> : null}
          </span>
        ),
        value: (r) => r.level4Passed,
        type: 'number',
      },
      {
        key: 'revision',
        label: 'Revision remaining',
        align: 'right',
        render: (r) => <span className="mono">{gu(r.level4Revision)}</span>,
        value: (r) => r.level4Revision,
        type: 'number',
      },
      {
        key: 'l4_attempts',
        label: 'Test attempts',
        align: 'right',
        sortKey: 'l4_attempts',
        base: true,
        render: (r) => <span className="mono">{gu(r.level4Attempts)}</span>,
        value: (r) => r.level4Attempts,
        type: 'number',
      },
      {
        key: 'attempts_all',
        label: 'All-level attempts',
        align: 'right',
        /**
         * The server's figure when it has arrived, this page's sum when it has not.
         *
         * They are the same number by two routes — `admin_activity_counts()` counts the rows in
         * `activity_attempts` and adds the કસોટી attempts, which is what the four per-level
         * figures beside it add up to. The server's is preferred anyway, because it counts rows
         * rather than trusting four columns to have been cut on the same window, and one day
         * one of them will not be. The fallback keeps the column readable in the moment before
         * the second call lands instead of blanking a cell that already had an answer.
         */
        needsCounts: true,
        render: (r) => <span className="mono">{gu(r.counted ? r.attemptsAll : clientAttempts(r))}</span>,
        value: (r) => (r.counted ? r.attemptsAll : clientAttempts(r)),
        type: 'number',
      },
      {
        key: 'darshan_sessions',
        label: 'Darshan sessions',
        align: 'right',
        needsCounts: true,
        render: (r) => countCell(r, r.darshanSessions),
        value: (r) => (r.counted ? r.darshanSessions : ''),
        type: 'number',
      },
      {
        key: 'revision_sessions',
        label: 'Revision sessions',
        align: 'right',
        needsCounts: true,
        render: (r) => countCell(r, r.revisionSessions),
        value: (r) => (r.counted ? r.revisionSessions : ''),
        type: 'number',
      },
      {
        key: 'ticks',
        label: 'Level 3 ticks',
        align: 'right',
        // The distinct દ્રશ્યો ticked across every લેવલ ૩ submission in the window, minus the
        // ones the સંચાલક has withheld. Distinct and not a running total: a યુવક who submits
        // the same 108 twice has brought 108 to mind, not 216.
        needsCounts: true,
        render: (r) => countCell(r, r.ticks),
        value: (r) => (r.counted ? r.ticks : ''),
        type: 'number',
      },
      {
        key: 'rank',
        label: 'Leaderboard rank',
        align: 'right',
        // Null is "has earned nothing", which the server distinguishes from last place and so
        // does this cell. Never a 0, and never a place at the bottom of the board that the
        // યુવક does not actually occupy.
        needsCounts: true,
        render: (r) => <span className="mono">{r.counted && r.rank ? gu(r.rank) : '-'}</span>,
        value: (r) => (r.counted && r.rank ? r.rank : ''),
        type: 'number',
      },
      {
        key: 'gate',
        label: 'Level 4 gate',
        render: (r) =>
          r.gateOpen ? <StatusBadge tone="ok">Open</StatusBadge> : <StatusBadge tone="off">Not open yet</StatusBadge>,
        value: (r) => (r.gateOpen ? 'Open' : 'Not open yet'),
      },
      {
        key: 'points',
        label: 'Points',
        align: 'right',
        sortKey: 'points',
        render: (r) => <span className="mono">{gu(r.points)}</span>,
        value: (r) => r.points,
        type: 'number',
      },
      {
        key: 'last_active',
        label: 'Last activity',
        sortKey: 'last_active',
        base: true,
        render: (r) => dateTimeGu(r.lastActiveAt),
        // The IST calendar day, so Excel filters and sorts it as a date rather than as text
        // that puts August before February. The screen keeps the time; the file keeps the
        // type, and istDate() is the one place that decides which day an instant belongs to.
        value: (r) => istDate(r.lastActiveAt),
        type: 'date',
      },
      {
        key: 'registered',
        label: 'Registered',
        sortKey: 'registered',
        render: (r) => dateTimeGu(r.registeredAt),
        value: (r) => istDate(r.registeredAt),
        type: 'date',
      },
      {
        key: 'status',
        label: 'Account status',
        render: (r) => {
          const s = accountStatus(r.status);
          return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
        },
        value: (r) => accountStatus(r.status).label,
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

  // ---- the five columns that need a second call ---------------------------

  /**
   * Whether any column on screen actually needs `admin_activity_counts()`.
   *
   * Switched off, the page costs exactly what it cost before these columns existed: one call
   * for the report and one for the summary. This is why the five are not simply appended to
   * `admin_progress_report()`'s own SELECT — four of the five are counts over other tables and
   * the fifth is a window function over the whole ledger, and a સંચાલક reading the identity
   * columns should not pay for a rank he is not looking at.
   */
  const needsCounts = useMemo(() => visibleColumns.some((c) => c.needsCounts), [visibleColumns]);

  /**
   * The page's ids as one string, and it is a dependency rather than a convenience.
   *
   * `rows.map(...)` is a fresh array on every render, so passing it to `useAsync` would refetch
   * forever. The join is stable for the same page of યુવકો, which is exactly when the answer
   * is unchanged.
   */
  const pageIds = useMemo(() => rows.map((r) => r.uid), [rows]);
  const idsKey = pageIds.join(',');

  /**
   * The counts for this page, on the same date window as the report.
   *
   * A second call and not a second source of truth: the report has already decided who is on
   * screen and this only fills in five cells for those ids. It is deliberately allowed to
   * fail quietly — `counted` stays false, the cells read '-', and the report itself is still
   * on screen. The alternative is throwing away a page of correct rows because an optional
   * column could not be filled, which is the worse trade for a report someone is reading now.
   */
  const counts = useAsync(
    () => activityCounts(pageIds, { from, to }),
    [idsKey, from, to, needsCounts],
    { skip: !needsCounts || pageIds.length === 0 }
  );

  /**
   * The rows the table renders: the report's, with the counts merged in where they arrived.
   *
   * Merged per id rather than by position. The two calls are ordered independently and a
   * positional merge would put one યુવક's ticks beside another's name the first time the sort
   * changed between them.
   */
  const tableRows = useMemo(() => {
    const map = counts.data;
    if (!map || map.size === 0) return rows;
    return rows.map((r) => {
      const c = map.get(r.uid);
      return c ? { ...r, ...c } : r;
    });
  }, [rows, counts.data]);

  const tableColumns = useMemo(
    () =>
      visibleColumns.map((c) => ({
        key: c.sortKey || c.key,
        label: c.label,
        align: c.align,
        sortable: !!c.sortKey,
        render: c.render,
        // Carried through, and it is worth saying why: this projection rebuilds each column
        // as a fresh object, so anything not named here is silently dropped. `className` was,
        // which meant the whole column-width block in progress.css was dead CSS matching no
        // element - the table still shredded "Surat" into "Sur / at" and the stylesheet
        // looked correct. Found by measuring the rendered cells, not by reading either file.
        className: c.className,
      })),
    [visibleColumns]
  );

  /**
   * The registry, arranged under COLUMN_GROUPS' headings.
   *
   * Built from the registry rather than duplicating it, and anything the map does not name
   * falls into "Other" instead of vanishing - a column that exists and cannot be switched on
   * is worse than an ugly heading.
   */
  const columnGroups = useMemo(() => {
    const named = new Set(COLUMN_GROUPS.flatMap((g) => g.keys));
    const groups = COLUMN_GROUPS.map((g) => ({
      title: g.title,
      columns: g.keys.map((k) => allColumns.find((c) => c.key === k)).filter(Boolean),
    })).filter((g) => g.columns.length);
    const rest = allColumns.filter((c) => !named.has(c.key));
    return rest.length ? [...groups, { title: 'Other', columns: rest }] : groups;
  }, [allColumns]);

  /** The same array both files are built from — see buildProgressReport() in the service. */
  const fileColumns = useMemo(
    () => visibleColumns.map((c) => ({ label: c.label, value: c.value, type: c.type || 'text' })),
    [visibleColumns]
  );

  const sortPreset =
    SORT_PRESETS.find((p) => p.field === sortField && p.dir === sortDir)?.id || 'custom';

  const applySort = (field, dir) => {
    setPage(0);
    setSortField(field);
    setSortDir(dir);
  };

  /**
   * §11 — the file, over the whole filtered set rather than the page on screen, and fetched
   * once for either format.
   *
   * `buildProgressReport()` is the only fetch; CSV and Excel differ in the last two lines of
   * this function and nowhere else, so the two files can never hold different rows. The
   * count reported afterwards is what the exporter actually wrote, not a number this
   * component assumed, and a cap that was reached is stated with the figure it fell short of
   * (§62). A file that quietly holds the first 2,000 of 3,140 is worse than no file.
   */
  const runExport = async (format) => {
    setExporting(true);
    setExportNote(null);
    try {
      // `withCounts` follows the chosen columns, so the file holds the same five cells the
      // screen does - and a file with none of them costs the same number of calls it always
      // did. The export enriches every chunk it walks rather than the page on screen, which is
      // why it is a parameter of the fetch here and a separate call up in the component.
      const res = await buildProgressReport(filters, { withCounts: needsCounts });
      const csvName = reportFilename('progress', { from, to, stamp: todayIST() });
      const written =
        format === 'xlsx'
          ? exportXlsx({
              filename: xlsxFilename(csvName),
              sheetName: 'Progress',
              columns: fileColumns,
              rows: res.rows,
            })
          : exportCsv({ filename: csvName, columns: fileColumns, rows: res.rows });

      const what = format === 'xlsx' ? 'Excel file' : 'CSV file';
      setExportNote(
        res.truncated
          ? {
              tone: 'notice-warn',
              text: `The ${what} holds the first ${gu(written)} of ${gu(res.total)} yuvaks matching these filters (one file holds ${gu(res.cap)}) - narrow the filters or the date range and export again.`,
            }
          : { tone: 'notice-ok', text: `Exported ${gu(written)} yuvak${written === 1 ? '' : 's'} to the ${what}, with the ${gu(fileColumns.length)} columns shown here.` }
      );
    } catch (e) {
      setExportNote({ tone: 'notice-warn', text: dataError(e) });
    } finally {
      setExporting(false);
    }
  };

  // The message follows the filter rather than describing the organisation: with a date
  // range set, "nobody has started" would be a claim about 2,000 people made from a query
  // that only looked at one week of them.
  const emptyMessage = filtered
    ? 'No yuvak matches these filters. Widen the range, lower the threshold, or clear the filters.'
    : 'No yuvak has submitted anything yet. The list fills as they go.';

  const bands = sum?.buckets || [];

  /**
   * How many યુવકો the table would badge "High progress" or better.
   *
   * Summed from the bands rather than asked for, because the bands are already cut at the
   * same shares `stageOf()` uses and the summary already returns them. Reading it off `lo`
   * rather than off the band's key means a re-cut of the bins cannot silently change what
   * this card counts: whatever the labels become, the arithmetic is still "at or above
   * three quarters of the live collection".
   */
  const highProgress = contentTotal
    ? bands
        .filter((b) => b.lo >= Math.ceil(contentTotal * HIGH_SHARE))
        .reduce((n, b) => n + (b.count || 0), 0)
    : null;
  const bandMax = Math.max(1, ...bands.map((b) => b.count));

  const showingFrom = total === 0 ? 0 : page * pageSize + 1;
  const showingTo = Math.min(total, page * pageSize + rows.length);

  return (
    <>
      <PageHeader
        title="Progress"
        sub="How far each yuvak has reached - counted by the database, against the darshan the app is showing today."
      />

      {/*
        Nothing on this page may render before the collection is known, because everything on
        it is a fraction of that collection. A manifest that failed to load becomes a Try
        again, never a table of counts over a denominator nobody can vouch for (§62).
      */}
      <AsyncBlock
        state={{
          loading: liveQ.loading,
          error: liveQ.error
            ? `The darshan collection could not be read, so nothing here can be counted against a reliable total. ${liveQ.error}`
            : null,
          isEmpty: false,
        }}
        onRetry={liveQ.retry}
        skeleton={<CardSkeleton count={9} />}
      >
        <>
          {/*
            The cards and the bands are one read, so they share one AsyncBlock: every figure
            in this section is cut on the same window and the same city, and a layout where
            half of it loaded would invite the two halves to be compared. isEmpty is never
            true — a summary of an empty organisation is still a summary, and "0 users" is a
            fact rather than an absence (§53).
          */}
          <AsyncBlock
            state={{ ...summary, isEmpty: false }}
            onRetry={summary.retry}
            skeleton={<CardSkeleton count={9} />}
          >
            <>
              {estimated && (
                <div className="notice" role="status">
                  The darshan collection could not be resolved from the app manifest for this
                  read, so the total of {gu(contentTotal)} is the database's estimate and every
                  percentage on this page is approximate. Reload the page to try again.
                </div>
              )}

              <div className="grid-stats">
                {/* The figure the whole report turns on, given the room to be read first. */}
                <StatCard
                  label="Fully remembered"
                  value={guCount(sum?.fullyRemembered)}
                  sub={
                    contentTotal
                      ? `Holding all ${gu(contentTotal)} darshan the app is showing today`
                      : 'Holding the whole collection'
                  }
                  tone="ok"
                />
                <StatCard
                  label="Total users"
                  value={guCount(sum?.totalUsers)}
                  sub={`${guCount(sum?.activeUsers)} active accounts`}
                />
                <StatCard
                  label="Started"
                  value={guCount(sum?.participants)}
                  sub="Have submitted at least one darshan"
                />
                {/*
                  The same three-quarters the table badges as "High progress", counted here
                  rather than asked for separately: the bands the summary already returns are
                  cut at the same shares, so summing the ones at or above 75% is the same
                  question with no second round trip and no second definition of the word.
                */}
                <StatCard
                  label="High progress"
                  value={guCount(highProgress)}
                  sub={`${Math.round(HIGH_SHARE * 100)}% of the collection or more`}
                />
                <StatCard
                  label="Level 4 passed"
                  value={guCount(sum?.level4AnyPassed)}
                  sub={`${guCount(sum?.level4AllPassed)} have passed every sub-level`}
                />
              </div>

              {/*
                Five cards and not nine. Level 1/2/3 completed, the લેવલ ૪ gate count and the
                mean all used to sit here, and each of them is a real figure - but a row of
                nine numbers is a row nobody reads, and this page's job is to be understood at
                a glance. The three level counts are one filter away (Level + Status), the
                gate is a column, and the mean is on the bands below, which say more than an
                average does by showing the shape rather than the middle.
              */}

              {/*
                §11 — 'કેટલું યાદ છે?' as bands rather than as a leaderboard. The heading names
                the live collection total; the number is read from the server, never typed.
              */}
              <div className="card">
                <h2>
                  How much is remembered? ·{' '}
                  {contentTotal ? `${gu(contentTotal)} માંથી કેટલું યાદ છે? · દર્શન યાદશક્તિ` : 'દર્શન યાદશક્તિ'}
                </h2>
                <p className="card-note">
                  How many yuvaks fall in each band. Press a band to see exactly who is in it -
                  press it again to clear. Counted from the darshan they actually submitted and
                  that the app is still showing, not from a score their phone reported.
                </p>

                {bands.length === 0 ? (
                  <p className="card-note">
                    Nobody has remembered any darshan in this range yet, so there is nothing to
                    compare.
                  </p>
                ) : (
                  <div className="rb-list">
                    {bands.map((b) => {
                      const on = minRemembered === String(b.lo);
                      return (
                        <button
                          key={b.key}
                          type="button"
                          className={`rb-row${on ? ' is-on' : ''}`}
                          onClick={() => pickBand(b)}
                          aria-pressed={on}
                        >
                          <span className="rb-band">
                            {/* The top band is a single number, not "108-108". */}
                            {b.lo === b.hi ? gu(b.lo) : `${gu(b.lo)}-${gu(b.hi)}`}
                            <small>{BAND_LABEL[b.key] || b.key}</small>
                          </span>
                          {/* aria-hidden: the bar repeats the count to its right and has
                              nothing of its own to say (§56). */}
                          <span className="rb-track" aria-hidden="true">
                            <span
                              className={`rb-fill${b.count ? '' : ' is-empty'}`}
                              style={{ width: `${Math.round((b.count / bandMax) * 100)}%` }}
                            />
                          </span>
                          <span className="rb-count">
                            {gu(b.count)}
                            {sum?.participants ? <small>{percent(b.count, sum.participants)}</small> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          </AsyncBlock>

          {/* §29 — a phone shows the list first and the controls on request. Above 900px the
              bar is always open and this button is not rendered at all (admin.css
              .only-narrow), so there is no state to get wrong on a desktop. */}
          <div className="pf-bar">
            <button
              className="btn btn-quiet only-narrow"
              type="button"
              aria-expanded={filtersOpen}
              aria-controls="progress-filters"
              onClick={() => setFiltersOpen((v) => !v)}
            >
              {filtersOpen ? 'Hide filters' : 'Filters'}
              {activeCount > 0 ? ` (${activeCount})` : ''}
            </button>
          </div>

          {/* §28 — one filter bar above the list, pagination below it, and nothing between the
              two but the rows. role="group" gives the bar a name of its own, so a screen
              reader reaching it hears what these controls govern rather than a dozen loose
              fields. */}
          <div
            className={`filters pf-filters${filtersOpen ? ' is-open' : ''}`}
            id="progress-filters"
            role="group"
            aria-label="Filter the progress list"
          >
            <div className="field">
              <label htmlFor="q">Search</label>
              <input
                id="q"
                type="search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Name, mobile, email or SMK"
                // The panel is English and these are identifiers: an autocapitalised "Pgv"
                // would not match an SMK, and a phone that offers to correct a name is
                // offering to break the search.
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby="q-hint"
              />
              <span className="hint" id="q-hint">Searches as you type - asked of the database, not of this page</span>
            </div>

            <div className="field">
              <label htmlFor="city">City</label>
              <select id="city" value={city} onChange={(e) => pickCity(e.target.value)}>
                <option value="">All cities</option>
                {(options?.cities || []).map((c) => (
                  <option key={c.id} value={c.id}>{`${zoneNameEn(c.id)} (${c.count})`}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="zone">Zone</label>
              <select id="zone" value={zone} onChange={(e) => onFilter(setZone)(e.target.value)}>
                <option value="">{city ? 'All zones in this city' : 'All zones'}</option>
                {zoneOptions.map((z) => (
                  <option key={z.id} value={z.id}>{`${subZoneNameEn(z.id)} (${z.count})`}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="lv">Level</label>
              <select id="lv" value={level} onChange={(e) => onFilter(setLevel)(e.target.value)}>
                <option value="">All levels</option>
                <option value="1">Level 1</option>
                <option value="2">Level 2</option>
                <option value="3">Level 3</option>
                <option value="4">Level 4</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="st">Account status</label>
              <select id="st" value={status} onChange={(e) => onFilter(setStatus)(e.target.value)}>
                <option value="">All statuses</option>
                {(options?.statuses || []).map((s) => (
                  <option key={s.id} value={s.id}>{`${accountStatus(s.id).label} (${s.count})`}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="rem">Remembered at least</label>
              <select
                id="rem"
                value={rSelect}
                onChange={(e) => {
                  const v = e.target.value;
                  setPage(0);
                  if (v === 'custom') {
                    setCustomR(true);
                    return;
                  }
                  setCustomR(false);
                  setMinRemembered(v);
                }}
              >
                <option value="">Any number</option>
                {rememberedPresets.map((p) => (
                  <option key={p.pct} value={String(p.value)}>{`${p.value}+ (${p.pct}%)`}</option>
                ))}
                <option value="custom">Custom</option>
              </select>
              {/* The presets are shares of the live collection, so this select re-labels
                  itself when a દર્શન is published or withheld. Nothing here is fixed. */}
              <span className="hint">
                {contentTotal ? `Out of ${gu(contentTotal)} darshan` : 'The collection total is not available'}
              </span>
            </div>

            {customR && (
              <div className="field">
                <label htmlFor="remn">Remembered - exact number</label>
                <input
                  id="remn"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={minRemembered}
                  onChange={(e) => onFilter(setMinRemembered)(e.target.value)}
                  placeholder="e.g. 40"
                />
                <span className="hint">Darshan remembered, any number</span>
              </div>
            )}

            <div className="field">
              <label htmlFor="pct">Percentage at least</label>
              <select id="pct" value={minPercentage} onChange={(e) => onFilter(setMinPercentage)(e.target.value)}>
                <option value="">Any percentage</option>
                {PERCENT_PRESETS.map((p) => (
                  <option key={p} value={String(p)}>{`${p}%`}</option>
                ))}
              </select>
              <span className="hint">The same share, asked as a percentage rather than a count</span>
            </div>

            <div className="field">
              <label htmlFor="l4p">Level 4 tests passed at least</label>
              <select
                id="l4p"
                value={l4Select}
                onChange={(e) => {
                  const v = e.target.value;
                  setPage(0);
                  if (v === 'custom') {
                    setCustomL4(true);
                    return;
                  }
                  setCustomL4(false);
                  setMinL4Passed(v);
                }}
              >
                <option value="">Any number</option>
                {l4Presets.map((n) => (
                  <option key={n} value={String(n)}>{`${n}+`}</option>
                ))}
                <option value="custom">Custom</option>
              </select>
              <span className="hint">
                {level4Total
                  ? `The published configuration has ${gu(level4Total)} sub-levels right now`
                  : 'No Level 4 configuration is published right now'}
              </span>
            </div>

            {customL4 && (
              <div className="field">
                <label htmlFor="l4n">Level 4 passed - exact number</label>
                <input
                  id="l4n"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={minL4Passed}
                  onChange={(e) => onFilter(setMinL4Passed)(e.target.value)}
                  placeholder="e.g. 2"
                />
                <span className="hint">Sub-levels passed, any number</span>
              </div>
            )}

            <div className="field">
              <label htmlFor="l4a">Level 4 attempts at least</label>
              <select id="l4a" value={minL4Attempts} onChange={(e) => onFilter(setMinL4Attempts)(e.target.value)}>
                <option value="">Any number</option>
                {ATTEMPT_PRESETS.map((n) => (
                  <option key={n} value={String(n)}>{`${n}+`}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="df">Activity from</label>
              <input
                id="df"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => onFilter(setFrom)(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="dt">Activity up to</label>
              <input
                id="dt"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => onFilter(setTo)(e.target.value)}
              />
              <span className="hint">Both days included, counted in India (IST)</span>
            </div>

            <div className="field">
              <label htmlFor="as">Active since</label>
              <input
                id="as"
                type="date"
                value={activeSince}
                onChange={(e) => onFilter(setActiveSince)(e.target.value)}
              />
              <span className="hint">Anyone whose latest activity is on or after this day</span>
            </div>

            <div className="field">
              <label htmlFor="sortby">Sort by</label>
              <select
                id="sortby"
                value={sortPreset}
                onChange={(e) => {
                  const p = SORT_PRESETS.find((x) => x.id === e.target.value);
                  if (p) applySort(p.field, p.dir);
                }}
              >
                {SORT_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
                {/* Only ever reachable by pressing a column header the presets do not name.
                    It is shown rather than hidden so the select never claims an order the
                    table is not in. */}
                {sortPreset === 'custom' && <option value="custom">Column header order</option>}
              </select>
            </div>

          </div>

          {/*
            The date presets and Reset live OUTSIDE the grid.

            They were grid items, which meant each one was stretched to a full track and the
            four of them wrapped onto two rows of half-empty buttons - the ragged block the
            redesign was asked to fix. A button is not a field and does not want a field's
            column; it wants to sit on a line with its siblings at its own width.
          */}
          <div className="pf-actions" role="group" aria-label="Date range presets">
            <button className="btn btn-quiet" type="button" onClick={() => quickRange(todayIST(), todayIST())}>
              Today
            </button>
            <button className="btn btn-quiet" type="button" onClick={() => quickRange(dateIST(-6), todayIST())}>
              Last 7 days
            </button>
            {/* -29 and not -30: the range is inclusive at both ends, so today plus the
                twenty-nine days behind it is thirty days. Off by one here would quietly
                report a month as a month and a day. */}
            <button className="btn btn-quiet" type="button" onClick={() => quickRange(dateIST(-29), todayIST())}>
              Last 30 days
            </button>
            <button className="btn btn-quiet" type="button" onClick={() => quickRange('', '')}>
              All time
            </button>
            {/*
              No "Apply Filters" button, deliberately, and it is the one thing the brief asks
              for that is not here. Every control on this page already re-runs the query as it
              changes - the search debounced, the rest immediately - so an Apply button would
              either do nothing or would have to make the other twelve controls stop working
              until it was pressed. Reset is the half of that pair which has something to do.
            */}
            {filtered && (
              <button className="btn btn-quiet" type="button" onClick={clearAll}>
                Reset
              </button>
            )}
          </div>

          {/* A failed options read is not allowed to look like an organisation with one city
              in it: the lists degrade to "All" and say why, rather than quietly offering
              fewer choices than exist (§34). */}
          {optionsQ.error && (
            <div className="notice notice-warn" role="status">
              The City, Zone and Status lists could not be loaded, so they are showing "All"
              only. Everything else on this page is unaffected.{' '}
              <button className="linklike" type="button" onClick={optionsQ.retry}>Try again</button>
            </div>
          )}

          {/*
            The one thing about this bar a સંચાલક has to know before he reads a number off it.
            A date range does not merely filter the table: it re-cuts every figure on the
            page, including the cards and the bands, and a યુવક with no activity inside it is
            not in the report at all. Said here, once, in the panel.
          */}
          {/* One line, not four. The long form said the same thing three ways and pushed the
              table below the fold on a laptop, which is the opposite of useful for a note
              about how to read the table. */}
          <p className="card-note">
            All filters combine. A date range re-cuts every figure on this page and hides
            anyone with no activity in it - leave both dates empty for all time.
          </p>

          {/*
            What is currently narrowing the report, spelled out.

            Thirteen controls, several of them scrolled off or inside a closed drawer on a
            phone, mean a report can be narrowed by something the સંચાલક cannot see - and a
            filtered list read as the whole list is a wrong answer that looks like a right one.
            The count beside the chips is the server's `total_rows` for exactly this query, not
            a tally of the rows on screen.
          */}
          {filtered && (
            <div className="pf-chips" role="group" aria-label="Active filters">
              <span className="hint">Filtered:</span>
              {activeFilters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className="pf-chip"
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

          {/* §11 — its own row rather than a control inside the filter bar, so a press that
              writes a file cannot be mistaken for a press that narrows a list. */}
          <div className="toolbar">
            {/* The explanation moved onto the buttons themselves (see their `title`), because
                it is about what pressing them does and it was costing a line of the page to
                say so to everyone who was never going to press them. */}
            <span className="grow" />

            {/* A <details> rather than a managed popover: it opens on click and on Enter,
                closes on Escape, and is reachable by Tab without a line of JavaScript. */}
            <details className="pf-cols">
              <summary className="btn btn-quiet">Columns ({gu(visibleColumns.length)})</summary>
              <div className="pf-cols-panel">
                <p className="hint">
                  What the table shows, and what both files hold. Kept on this device.
                </p>
                {columnGroups.map((g) => (
                  <div key={g.title} className="pf-cols-group">
                    <h3 className="pf-cols-head">{g.title}</h3>
                    <ul className="pf-cols-list">
                      {g.columns.map((c) => {
                        const on = chosen.includes(c.key);
                        return (
                          <li key={c.key}>
                            <label className="check">
                              <input
                                type="checkbox"
                                checked={on}
                                // The last column cannot be removed: a table with no columns
                                // is a page with no content and no way back to one.
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

          {/* role="status" so a screen reader hears the result of a press that produced no
              visible change on the page itself — the file went to Downloads (§56). */}
          {exportNote && <div className={`notice ${exportNote.tone}`} role="status">{exportNote.text}</div>}

          {/*
            isEmpty is the query's own answer and includes `page === 0`, because AsyncBlock
            renders <Empty> *instead of* its children and the children include the Pager.
            Walking one page past the end of a filtered list would otherwise dead-end it:
            "nothing matches", no Previous button, and no way back to the rows that do exist.
          */}
          <AsyncBlock
            state={{ ...report, isEmpty: !report.loading && !report.error && rows.length === 0 && page === 0 }}
            emptyIcon="◔"
            emptyTitle={filtered ? 'Nothing matches these filters' : 'Nothing to show yet'}
            empty={emptyMessage}
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
                caption="Progress by yuvak"
                columns={tableColumns}
                // The report's rows with the five extra counts merged in where they have
                // arrived - the same objects until then, so the table renders on the first
                // call and does not wait on the second.
                rows={tableRows}
                // The header follows the rows. `.dt th` has carried `position: sticky` for a
                // long time and it never worked, because `.table-wrap` sets `overflow-x: auto`
                // and a box that scrolls in one axis is a scroll container in both — the
                // header was sticking to the top of that box, which is itself off-screen once
                // the page scrolls past it. `is-tall` gives the wrap a height so it owns the
                // vertical scrolling and sticky finally has something to stick inside.
                wrapClassName="is-tall"
                rowKey={(r) => r.uid}
                sort={{ field: sortField, dir: sortDir }}
                // Sorting is a new query, never a re-sort of the twenty rows on screen:
                // sorting a paginated list client-side would only order the page you can
                // already see, which is worse than not offering it.
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
              {/* The pager can only say which page this is; the size of the whole filtered
                  set comes back with the rows, so the two can never disagree. */}
              <p className="card-note">
                Showing {gu(showingFrom)}-{gu(showingTo)} of {gu(total)} yuvak{total === 1 ? '' : 's'} ·
                page {gu(page + 1)} of {gu(Math.max(1, pageCount))}.
              </p>
            </>
          </AsyncBlock>
        </>
      </AsyncBlock>
    </>
  );
}
