import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { loadLiveScenes, sceneIndex } from '../../../lib/liveScenes';
import { getUserLevel3Detail, getUserProgressDetail, verifyUserProgress } from '../services/detailService';
import { listUserAttempts, listUserPoints } from '../../users/services/activityService';
import DataTable, { Pager } from '../../../components/DataTable';
import { AsyncBlock, CardSkeleton, Empty, ErrorState, FormSkeleton, TableSkeleton } from '../../../components/StateBlocks';
import StatCard, { PageHeader, StatusBadge } from '../../../components/StatCard';
import { dateGu, dateTimeGu, gu, percent } from '../../../lib/format';
import { subZoneNameEn, zoneNameEn } from '../../../lib/labels';
import { ACTIVITY_KEY, ATTEMPT_STATUS } from '../../../../../shared/domain/points.js';

/**
 * One yuvak's progress, in full - the detail behind a row of the Progress list.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Built on the tables that are written
 * ────────────────────────────────────────────────────────────────────────────
 *
 * UserDetailPage's "Learning progress" card reads `learning_state`, and UserDetailPage's own
 * header explains why that made sense when it was written. It no longer does: that table and
 * `learning_sessions` are empty in production and nothing writes them. Everything on this
 * page comes instead from `activity_attempts`, `level4_attempts`, `level4_activity_progress`
 * and `point_transactions` - through `admin_user_progress_detail()` for the summary, and
 * through the `attempt_history` / `point_ledger` views for the two histories at the bottom.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The denominator arrives before the report does
 * ────────────────────────────────────────────────────────────────────────────
 *
 * "x of y" needs the y, and Postgres cannot produce it: the collection is
 * `content/darshan.json` overlaid by `public.scenes`, and the database has never seen the
 * manifest. `loadLiveScenes()` computes it here, from the same domain functions the yuvak
 * app runs, and `live.ids` is handed to both RPCs on this page.
 *
 * So the live collection is loaded FIRST and both reads wait on it. If it fails, this page
 * shows an ErrorState and nothing else - a report rendered against a fallback denominator
 * would print a percentage that looks entirely ordinary and is wrong about a person, which
 * is the one failure mode worse than a page that says it could not load.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A record, not a report card
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The rule UserActivityPage states and reportService.js sets: nothing here counts a missed
 * day, nothing returns a "failed" figure, and nothing marks a yuvak as behind. So there is
 * no red on this page and no streak. `REVISION_REQUIRED` is "Revision remaining" in the same
 * quiet grey as any other neutral state - an amber pill beside it would turn a position in
 * the journey into a warning about the person. `LOCKED` is grey for the same reason: a
 * કસોટી he has not reached is not a shortfall. A દ્રશ્ય he has not yet ticked is "Pending",
 * not "missing", everywhere a yuvak can see it named.
 *
 * The one place amber is allowed is the reconciliation panel at the foot, and it is not
 * about him: it fires when the panel's own arithmetic does not close, which is a statement
 * about the data and is worded as one.
 *
 * And a failed read is never rendered as a fact about him. The RPC **raises** 42501 when the
 * caller may not ask (0028 chose that over an empty document precisely so the two could be
 * told apart), so an error here becomes ErrorState with a retry, never four dashes under
 * "Not started yet".
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The sections
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   Summary            who he is, from `profiles`
 *   Overall progress   the four levels at a glance
 *   Darshan memory     the headline - his share of the live collection, and which દ્રશ્યો
 *   Levels 1, 2, 3     status and counts - all that those levels record
 *   Level 3 revisions  every પુનરાવર્તન, what it ticked and what it was paid - §20
 *   Level 4            per-કસોટી history, taken from level4_activity_states()
 *   Daily history      every attempt          - attempt_history
 *   Points history     every award            - point_ledger
 *   Verify progress    the reconciliation, on demand
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What 0035 changed about what this page may say
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Level 3 used to be paid once a business day however many times it was submitted, and half a
 * dozen sentences on this page said so - some of them to explain why a cell was permanently a
 * dash. That is no longer true: under a per-tick or per-revision rule **each પુનરાવર્તન is paid
 * on its own**, keyed idempotently on the attempt id, so 50 ticks then 40 then 30 is 120 ticks
 * and 120 ticks' worth of points rather than one flat award.
 *
 * The consequence for this page is not only that the old prose is wrong: it is that a
 * per-attempt points figure now **exists** for Level 3, so a cell that used to have nothing to
 * show can show it. The "Level 3 revisions" section is where the total is taken apart, and the
 * Points column in Daily history reads its per-attempt figure from that same document rather
 * than asking the ledger once per row.
 *
 * Which levels still pay once a day is a setting rather than a fact - `earn.levelN` in
 * Point Management - so nothing on this page states it as one any more. It says what the record
 * shows and lets the record answer.
 *
 * The two histories are still deliberately not merged. The reason has narrowed rather than
 * disappeared: an award is a row of the ledger and an attempt is a row of the attempt table,
 * and how many of the first a day's worth of the second produces is now a configured rule.
 */

/** Same three states, and the same words, the Users list and profile use. Read-only (§19). */
const ACCOUNT_STATUS = {
  ACTIVE: { label: 'Active', tone: 'ok' },
  SUSPENDED: { label: 'Suspended', tone: 'warn' },
  DISABLED: { label: 'Disabled', tone: 'off' },
};

/**
 * A level's own state, as `admin_user_progress_detail()` reports it: COMPLETED once any
 * attempt on that level completed, NOT_STARTED when none has. Grey, not amber - a level he
 * has not begun is one still ahead of him.
 */
const LEVEL_STATUS = {
  COMPLETED: { label: 'Complete', tone: 'ok' },
  NOT_STARTED: { label: 'Not started yet', tone: 'off' },
};

/**
 * The five words `level4_activity_states()` can return, in the panel's tones.
 *
 * LOCKED and AVAILABLE are derived on the server and stored nowhere - they carry the ક્રમ
 * rule, the gate and the coverage credit - so they are displayed as sent and never
 * re-derived here.
 *
 * REVISION_REQUIRED is `off`, plain grey, and this is the one entry in the map that must
 * not drift: "Revision remaining" is what shared/domain/history.js calls `થોડું બાકી` for
 * the yuvak himself, and an amber or red pill beside it would be the panel calling a
 * position a failure. UserActivityPage.jsx makes the same choice for the same reason.
 */
const L4_STATUS = {
  LOCKED: { label: 'Locked', tone: 'off' },
  AVAILABLE: { label: 'Open', tone: 'info' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  REVISION_REQUIRED: { label: 'Revision remaining', tone: 'off' },
  COMPLETED: { label: 'Complete', tone: 'ok' },
};

/** The ladder in English - the panel reads English, the yuvak app keeps the Gujarati. */
const LEVEL_EN = {
  1: 'Level 1 - Meditation',
  2: 'Level 2 - Darshan',
  3: 'Level 3 - Revision',
  4: 'Level 4',
};

/** Levels 1-3 have one fixed activity each; Level 4 rows carry their own title. */
const ACTIVITY_EN = {
  [ACTIVITY_KEY.VIDEO]: 'Video',
  [ACTIVITY_KEY.DARSHAN]: 'Darshan',
  [ACTIVITY_KEY.REVISION]: 'Revision',
};

/**
 * What a Level 4 sitting ended as - the only place "passed" is a word this page can use.
 *
 * Two outcomes, and neither of them is a failure: a કસોટી that ended in revision is a
 * position in the journey, so it is the same quiet grey as every other neutral state and
 * never amber and never red. `NOT_STARTED` is carried explicitly because a status the panel
 * understands must never leave the cell as a bare dash - a dash means "the record holds no
 * such figure", which is a different sentence.
 */
const L4_PASSED = {
  [ATTEMPT_STATUS.COMPLETED]: { label: 'Passed', tone: 'ok' },
  [ATTEMPT_STATUS.REVISION_REQUIRED]: { label: 'Revision remaining', tone: 'off' },
  NOT_STARTED: { label: 'Not started', tone: 'off' },
};

/**
 * What a Level 3 submission came to, in the panel's tones.
 *
 * The same two words `activity_attempts.status` can hold, and the same rule as everywhere else
 * on this page: neither is a failure. COMPLETED means every darshan in the collection was
 * ticked in that one sitting; REVISION_REQUIRED means some were not, which since 0035 is an
 * ordinary and **paid** thing to do rather than an incomplete act - a partial પુનરાવર્તન is what
 * repeated revision is made of. So it is grey, and the section says as much in words.
 */
const L3_RESULT = {
  [ATTEMPT_STATUS.COMPLETED]: { label: 'Whole collection', tone: 'ok' },
  [ATTEMPT_STATUS.REVISION_REQUIRED]: { label: 'Part of it', tone: 'off' },
};

/**
 * How many revisions the itemised list asks for.
 *
 * The server clamps to 1..1000 and defaults to 200; 200 is repeated here so the page can say
 * what it asked for when the answer is capped, rather than showing a truncated list that reads
 * as a complete one. The totals beside it are computed over his whole history and not over this
 * slice, which is what makes a capped list safe to show at all.
 */
const L3_LIMIT = 200;

/**
 * The three ways to read the per-દ્રશ્ય list. "Pending" and not "missing": the same set of
 * દ્રશ્યો is called `missingIds` by the reconciliation panel, where it is a statement about
 * an arithmetic identity, and "Pending" here, where it is a statement about a person.
 */
const SCENE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'remembered', label: 'Remembered' },
  { key: 'pending', label: 'Pending' },
];

/** How much વર્ણન fits on one row before the rest is left to the tooltip. */
const CAPTION_MAX = 80;

const shorten = (s) => {
  const text = String(s || '').trim();
  if (!text) return '';
  return text.length > CAPTION_MAX ? `${text.slice(0, CAPTION_MAX)}…` : text;
};

/** What a history row is called on screen. */
const activityName = (r) => r.title || ACTIVITY_EN[r.activityKey] || r.activityKey || '-';

/**
 * A dash that says why it is a dash.
 *
 * The four states this page keeps apart, and never lets collapse into one another: a real
 * zero is `0`, a figure the record never held is this, a level he has not begun is "Not
 * started" in words, and a read that failed is an ErrorState - never any of the three. A `0`
 * standing in for the second of those would be the panel stating a measurement nobody took.
 */
const noRecord = (why) => (
  <span className="mono" title={why}>-</span>
);

/**
 * Whether a history row is a Level 4 sitting - asked of the row's own activity key rather
 * than of its level number.
 *
 * Levels 1 to 3 have exactly one fixed activity each, named in ACTIVITY_KEY; a કસોટી carries
 * its own key and its own title, and how many of them exist is a published configuration
 * nothing here may assume. So the test is "this key is not one of the three fixed ones",
 * which stays true whatever the ladder above it is renumbered to.
 */
const isLevel4Row = (r) => !ACTIVITY_EN[r.activityKey];

/**
 * How many દ્રશ્યો a submission actually ticked, or null when the row holds no such figure.
 *
 * `selected_scene_ids` is the record itself - the ids he sent. `completed_items` is the same
 * count as the server stored it, and is the fallback rather than a second measurement: on a
 * level that records દ્રશ્યો the two are one number, and on a level that records none the
 * attempt carries an empty list *and* a zero total, which is why that case returns null and
 * not 0. A submission that genuinely ticked nothing has a total and returns a real zero.
 */
const tickCount = (r) => {
  const ids = Array.isArray(r.selectedSceneIds) ? r.selectedSceneIds.length : 0;
  if (ids > 0) return ids;
  return r.totalItems > 0 ? r.completedItems : null;
};

/**
 * Measured attention, said the way somebody would say it out loud.
 *
 * The seconds are the **database's** - accumulated from the gap between one autosave of the
 * draft and the next, against the server's own clock, with any silence longer than the
 * configured gap discarded. No browser measures or sends a duration anywhere in this project,
 * which is the property that makes this figure worth printing beside a points figure at all.
 *
 * Zero is not "he was not paying attention": every revision submitted before 0035 accumulated
 * none, because there was nothing accumulating it. So a 0 reads as "not measured" rather than
 * as a judgement, and the section's note says which days that covers.
 */
function spellMs(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (s === 0) return null;
  if (s < 60) return `${gu(s)}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${gu(m)}m ${gu(rest)}s` : `${gu(m)}m`;
}

/**
 * A badge for a value this bundle does not know. A status arriving from a later migration is
 * shown raw rather than as a blank or as the wrong word.
 */
const badge = (map, value) => {
  const s = map[value];
  return s ? <StatusBadge tone={s.tone}>{s.label}</StatusBadge> : <StatusBadge tone="off">{value || '-'}</StatusBadge>;
};

/**
 * Level 4 as one word, for the glance row only.
 *
 * Derived here and nowhere else on this page: the table below shows each કસોટી's own status
 * exactly as `level4_activity_states()` sent it, and this line is a summary of that table
 * rather than a sixth opinion about it. Locked before the gate opens, Complete only when
 * every published કસોટી is, In progress once he has sat one.
 */
function level4Glance(d) {
  const acts = d.level4.activities;
  if (!d.gateOpen) return { label: 'Not open yet', tone: 'off' };
  if (acts.length > 0 && acts.every((a) => a.status === 'COMPLETED')) return { label: 'Complete', tone: 'ok' };
  if (d.level4.attempts > 0) return { label: 'In progress', tone: 'info' };
  return { label: 'Open', tone: 'info' };
}

export default function UserProgressDetailPage() {
  const { userId } = useParams();

  /*
    The collection first, and everything else behind it.

    `loadLiveScenes()` memoises for the session, so opening five yuvakos in a row downloads
    the 124 KB manifest once. `live.data.ids` is therefore a stable reference and is safe to
    use as a dependency below - the two reads fire once each, not on every render.
  */
  const live = useAsync(() => loadLiveScenes(), []);
  const liveIds = live.data?.ids || null;

  const detail = useAsync(
    () => getUserProgressDetail(userId, liveIds),
    [userId, liveIds],
    { skip: !liveIds }
  );

  /*
    Every પુનરાવર્તન, itemised - §20's requirement that a total be checkable rather than trusted.

    Fetched on page load rather than on demand, unlike the reconciliation below, and the two are
    different in the way that decides it: the reconciliation is a second full scan of both
    attempt tables to answer a question most visits never ask, while this is one bounded read of
    one yuvak's own Level 3 rows and is the section an admin came here for the moment Level 3
    started accumulating. It does not depend on the live collection, so it does not wait for the
    manifest.

    It is allowed to fail on its own: the section shows the error and offers a retry, and the
    rest of the page is untouched. A read that failed is never rendered as a fact about him.
  */
  const level3 = useAsync(() => getUserLevel3Detail(userId, L3_LIMIT), [userId]);
  const l3 = level3.data;

  /**
   * (business day, revision number) → what that one submission was paid.
   *
   * The key is `activity_attempts.attempt_number` beside `activity_date`, which is exactly what
   * an attempt row in the Daily history below carries - so the Points column there can find its
   * own figure without a request per row, which is the cost that kept that cell empty before
   * there was anything to put in it. Built once per document rather than per render of the
   * table, because the table repaginates and this does not.
   */
  const l3PointsByAttempt = useMemo(() => {
    const m = new Map();
    for (const r of l3?.revisions || []) m.set(`${r.date}#${r.n}`, r);
    return m;
  }, [l3]);

  // Which દ્રશ્યો, rather than how many. Closed to begin with: a hundred rows would be the
  // tallest thing on the page and the least often wanted.
  const [showScenes, setShowScenes] = useState(false);
  const [sceneFilter, setSceneFilter] = useState('all');

  // The reconciliation is a second full scan of both attempt tables, so it runs when it is
  // asked for and not before. `skip` is what keeps it off the page load.
  const [verifyOn, setVerifyOn] = useState(false);
  const verify = useAsync(
    () => verifyUserProgress(userId, liveIds),
    [userId, liveIds],
    { skip: !verifyOn || !liveIds }
  );

  const [attemptSize, setAttemptSize] = useState(20);
  const [attemptPage, setAttemptPage] = useState(0);
  const attemptCursors = useRef([null]);

  const [pointSize, setPointSize] = useState(20);
  const [pointPage, setPointPage] = useState(0);
  const pointCursors = useRef([null]);

  const attempts = useAsync(
    () => listUserAttempts(userId, { cursor: attemptCursors.current[attemptPage], pageSize: attemptSize }),
    [userId, attemptPage, attemptSize]
  );

  const points = useAsync(
    () => listUserPoints(userId, { cursor: pointCursors.current[pointPage], pageSize: pointSize }),
    [userId, pointPage, pointSize]
  );

  const attemptRows = attempts.data?.rows || [];
  const pointRows = points.data?.rows || [];

  const nextAttempts = useCallback(() => {
    if (!attempts.data?.cursor) return;
    attemptCursors.current[attemptPage + 1] = attempts.data.cursor;
    setAttemptPage((p) => p + 1);
  }, [attempts.data, attemptPage]);

  const nextPoints = useCallback(() => {
    if (!points.data?.cursor) return;
    pointCursors.current[pointPage + 1] = points.data.cursor;
    setPointPage((p) => p + 1);
  }, [points.data, pointPage]);

  const d = detail.data;
  const u = d?.user;

  /*
    The join the brief is built on, and the reason the collection had to be loaded at all.

    `live.scenes` holds the number a yuvak reads and the વર્ણન he reads it by; `sceneDetail`
    holds the dates. Every દ્રશ્ય in the live collection gets a row - a દ્રશ્ય with no entry in
    `sceneDetail` is Pending, which is a fact worth stating and is invisible in a count.

    Driven from `live.scenes` and not from `sceneDetail`, so the list is always exactly as
    long as the collection: an id he submitted that has since left the collection is not a
    row here at all, and the panel at the foot is where it is accounted for by name.
  */
  const sceneRows = useMemo(() => {
    const scenes = live.data?.scenes || [];
    if (!scenes.length) return [];
    const ticks = new Map((d?.sceneDetail || []).map((s) => [s.sceneId, s]));
    return scenes.map((s) => {
      const tick = ticks.get(s.id);
      return {
        id: s.id,
        displayIndex: s.displayIndex,
        caption: s.t || s.title || '',
        remembered: Boolean(tick),
        firstAt: tick?.firstAt || null,
        lastAt: tick?.lastAt || null,
      };
    });
  }, [live.data, d]);

  const shownScenes = useMemo(() => {
    if (sceneFilter === 'remembered') return sceneRows.filter((r) => r.remembered);
    if (sceneFilter === 'pending') return sceneRows.filter((r) => !r.remembered);
    return sceneRows;
  }, [sceneRows, sceneFilter]);

  /** Scene id → the number a yuvak reads, for the reconciliation chips. */
  const byId = useMemo(() => sceneIndex(live.data), [live.data]);

  const name = u?.name || 'Progress';
  const crumbs = [{ to: '/progress', label: 'Progress' }, { label: u ? name : 'Yuvak' }];

  const loading = live.loading || detail.loading;

  const retryAll = useCallback(() => {
    live.retry();
    detail.retry();
  }, [live, detail]);

  /*
    The whole page rests on two reads, and their unhappy endings are handled before the
    layout is reached rather than repeated inside every section.

    The live collection comes first because a failure there is not survivable: the page would
    otherwise fall back to the server's estimate of the denominator, print "104 of 106" with
    no visible sign that either number was guessed, and be believed. §51's rule about lazy
    દર્શન loading is what makes that failure possible at all, so it is met head on.

    An error from the RPC is a real error and not an empty result: `admin_user_progress_detail()`
    opens with `admin_assert_progress_reader()` and raises 42501 when the caller holds less
    than progress.read and users.read. Rendering zeroes in that case would be the panel
    stating that a yuvak has done nothing, on the strength of a permission he has nothing to
    do with (§53).
  */
  if (live.error) {
    return (
      <>
        <PageHeader title="Progress" crumbs={crumbs} />
        <ErrorState
          message={`The darshan collection could not be loaded, so this record cannot be measured against it. ${live.error}`}
          onRetry={retryAll}
        />
      </>
    );
  }

  if (detail.error) {
    return (
      <>
        <PageHeader title="Progress" crumbs={crumbs} />
        <ErrorState message={detail.error} onRetry={detail.retry} />
      </>
    );
  }

  if (!loading && !d) {
    return (
      <>
        <PageHeader title="Yuvak not found" crumbs={crumbs} />
        <Empty
          icon="🔍"
          title="No yuvak with this ID"
          message="The link may be out of date, or the yuvak may have been removed from the list you came from."
          action={<Link className="btn" to="/progress">Back to the progress list</Link>}
        />
      </>
    );
  }

  const account = ACCOUNT_STATUS[u?.status] || { label: u?.status || '-', tone: 'off' };

  const total = d?.contentTotal ?? 0;
  const remembered = d?.remembered ?? 0;
  // Floored, and it can genuinely be needed: the denominator is today's collection while the
  // ids are everything he ever submitted, so a દ્રશ્ય withheld since he recalled it would
  // otherwise render as a negative number of scenes remaining.
  const remaining = Math.max(0, total - remembered);
  const complete = total > 0 && remembered >= total;
  const share = total > 0 ? Math.min(100, (remembered / total) * 100) : 0;

  const acts = d?.level4.activities || [];
  const glance4 = d ? level4Glance(d) : { label: '-', tone: 'off' };
  const unlocked = acts.filter((a) => a.status !== 'LOCKED').length;
  const completed4 = acts.filter((a) => a.status === 'COMPLETED').length;
  const revision4 = acts.filter((a) => a.status === 'REVISION_REQUIRED').length;

  const v = verify.data;

  /** A withheld or unknown id is by definition not in the live collection, so it shows as itself. */
  const chipLabel = (id) => {
    const n = byId.get(id)?.displayIndex;
    return n ? `Darshan ${gu(n)}` : id;
  };

  const idChips = (ids) =>
    ids.length === 0 ? (
      <span className="hint">None</span>
    ) : (
      <span style={chips}>
        {ids.map((id) => (
          <span className="chip mono" key={id}>{chipLabel(id)}</span>
        ))}
      </span>
    );

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        title={loading ? 'Progress' : name}
        sub={u ? `${u.smk || 'No SMK'} · ${subZoneNameEn(u.zoneId)}` : 'Loading this record…'}
        actions={
          <>
            {u && <StatusBadge tone={account.tone}>{account.label}</StatusBadge>}
            <Link className="btn btn-quiet" to="/progress">← Back to list</Link>
          </>
        }
      />

      {loading ? (
        <FormSkeleton fields={8} />
      ) : (
        <section className="card" aria-labelledby="s-summary">
          <h2 id="s-summary">Summary</h2>
          <dl className="kv">
            <dt>Name</dt><dd>{u?.name || '-'}</dd>
            {/*
              Mobile stays, email does not, and the line between them is not arbitrary.

              A સંચાલક phones a યુવક; the panel's own Users page has always shown the number,
              so withholding it only here would make this page worse at the job without making
              anyone safer. Email is different: it is the single route password recovery takes
              (§2.1), it answers no question a progress report asks, and this screen is read
              off a laptop at a meeting. It was on this page and it is now gone.

              Neither appears in the CSV or the Excel file either - see the column registry in
              ProgressPage, where they are not offered even as an opt-in (§13).
            */}
            <dt>Mobile</dt><dd className="mono">{u?.mobile || '-'}</dd>
            <dt>City</dt><dd>{zoneNameEn(u?.cityId)}</dd>
            <dt>Zone</dt><dd>{subZoneNameEn(u?.zoneId)}</dd>
            {/* Optional since 0027, so a blank is an ordinary answer and not a gap. */}
            <dt>SMK</dt><dd className="mono">{u?.smk || '-'}</dd>
            <dt>Registration date</dt><dd>{dateTimeGu(u?.registeredAt)}</dd>
            {/* The latest of every stamp the document carries - an attempt at any level, or
                an award. Words rather than a dash when there is none: a blank beside "Last
                active" reads as a missing value, and this one is known. */}
            <dt>Last active</dt>
            <dd>{d?.lastActivityAt ? dateTimeGu(d.lastActivityAt) : 'Nothing recorded yet'}</dd>
          </dl>
          <p className="card-note">
            This page is read-only. A yuvak's progress is written by the app as he goes and
            cannot be edited from the panel.
          </p>
        </section>
      )}

      <h2 className="section-title">Overall progress</h2>
      {loading ? (
        <FormSkeleton fields={2} />
      ) : (
        <section className="card" aria-labelledby="s-glance">
          <h2 id="s-glance">The four levels at a glance</h2>
          <dl className="kv">
            <dt>{LEVEL_EN[1]}</dt><dd>{badge(LEVEL_STATUS, d.level1.status)}</dd>
            <dt>{LEVEL_EN[2]}</dt><dd>{badge(LEVEL_STATUS, d.level2.status)}</dd>
            <dt>{LEVEL_EN[3]}</dt><dd>{badge(LEVEL_STATUS, d.level3.status)}</dd>
            <dt>{LEVEL_EN[4]}</dt>
            <dd>
              <StatusBadge tone={glance4.tone}>{glance4.label}</StatusBadge>
            </dd>
          </dl>
          <p className="card-note">
            A level shown as not started yet is one still ahead of him, not one he is behind on.
            Level 4 opens only once the gate is passed; each test inside it carries its own
            status further down.
          </p>
        </section>
      )}

      <h2 className="section-title">Darshan memory</h2>
      {loading ? (
        <CardSkeleton count={4} />
      ) : (
        <>
          {/*
            The headline, and the one figure this whole page exists to get right.

            The bar repeats the number rather than replacing it, and the state beside it is
            always a word: a yuvak holding the whole collection reads "Complete" in text, so
            the green is a second signal and never the only one (§43, §56).
          */}
          <section className={complete ? 'notice notice-ok' : 'card'} aria-labelledby="s-memory">
            <h2 id="s-memory" style={headlineHead}>
              {complete ? 'પૂર્ણ / Complete 100%' : 'Darshan remembered'}
            </h2>
            <p style={headline}>
              <strong style={headlineNum}>{gu(remembered)}</strong>
              <span style={headlineOf}> of {gu(total)}</span>
              <span style={headlinePct}>{total ? percent(remembered, total) : '-'}</span>
            </p>
            <div
              style={barTrack}
              role="progressbar"
              aria-valuenow={remembered}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-label="Darshan remembered out of the collection"
            >
              <div style={{ ...barFill, width: `${share}%`, background: complete ? 'var(--ok-ink)' : 'var(--brand-500)' }} />
            </div>
            <p className="card-note" style={{ marginTop: 'var(--sp-3)' }}>
              {complete
                ? 'He holds every darshan in the collection as it stands today. Nothing is remaining.'
                : `${gu(remaining)} remaining of the ${gu(total)} darshan in the collection as it stands today.`}
            </p>
          </section>

          <div className="grid-stats">
            <StatCard label="Darshan in all" value={gu(total)} sub="The collection as it stands today" />
            <StatCard
              label="Remembered"
              value={gu(remembered)}
              sub={total ? `of ${gu(total)} darshan` : null}
              tone={complete ? 'ok' : 'plain'}
            />
            <StatCard label="Remaining" value={gu(remaining)} />
            <StatCard label="Completion" value={total ? percent(remembered, total) : '-'} tone={complete ? 'ok' : 'plain'} />
          </div>

          <p className="card-note" style={note}>
            Counted from the scene ids on his own submissions - {gu(d.rememberedFromLevel3)} recalled
            at Level 3 and {gu(d.rememberedFromLevel4)} at Level 4. A darshan can be recalled at
            either level, so the headline figure is the distinct union of the two and the parts may
            add up to more than the whole.
          </p>

          {/*
            Said out loud when it happens, rather than quietly printed as a measurement. The
            server answers with its own estimate of the collection size when no live list
            reaches it; this page always sends one, so this line should never appear - and if
            it does, it is the sentence that explains an otherwise inexplicable total.
          */}
          {d.contentSource !== 'app-manifest' && (
            <div className="notice notice-warn">
              <strong>This total is an estimate.</strong> The figures above were measured against the
              server's estimate of the collection size rather than against the darshan collection the
              app actually shows. Reload the page before relying on them.
            </div>
          )}

          {/*
            Which દ્રશ્યો, in the order a yuvak meets them. Behind a toggle because it is as
            long as the collection, and built from `live.scenes` so a દ્રશ્ય he has never
            ticked appears as a row rather than as an absence.
          */}
          <section className="card" aria-labelledby="s-scenes">
            <h2 id="s-scenes">Darshan, one by one</h2>
            <div className="form-actions">
              <button
                className="btn btn-quiet btn-sm"
                type="button"
                aria-expanded={showScenes}
                aria-controls="scene-list"
                onClick={() => setShowScenes((s) => !s)}
              >
                {showScenes ? 'Hide details' : 'View details'}
              </button>
              <span className="save-state">
                {remembered === 0
                  ? 'Nothing submitted yet - the list fills itself as he goes.'
                  : `${gu(remembered)} remembered, ${gu(remaining)} pending.`}
              </span>
            </div>

            {showScenes && (
              <div id="scene-list">
                <div className="toolbar" style={{ marginTop: 'var(--sp-4)' }}>
                  {SCENE_FILTERS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      className={f.key === sceneFilter ? 'btn btn-sm' : 'btn btn-quiet btn-sm'}
                      aria-pressed={f.key === sceneFilter}
                      onClick={() => setSceneFilter(f.key)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {shownScenes.length === 0 ? (
                  <Empty
                    icon="◇"
                    title="Nothing to show under this filter"
                    message={
                      sceneFilter === 'pending'
                        ? 'Every darshan in the collection has been remembered.'
                        : 'No darshan has been remembered yet. The list fills itself as he goes.'
                    }
                  />
                ) : (
                  <DataTable
                    caption="Every darshan in the collection, in the order a yuvak meets them"
                    columns={[
                      {
                        key: 'displayIndex',
                        label: 'No.',
                        align: 'right',
                        // The number a yuvak actually reads, derived on read and stored
                        // nowhere. It, and not the stored id, is what he and the સંચાલક have
                        // in common when they talk about a દ્રશ્ય.
                        render: (r) => <span className="mono">{r.displayIndex ? gu(r.displayIndex) : '-'}</span>,
                      },
                      {
                        key: 'caption',
                        label: 'Darshan',
                        // The વર્ણન, truncated with the whole of it on the title attribute.
                        // The scene id is deliberately not the label here: it is a storage
                        // key, and a સંચાલક reading this list wants the words a yuvak learned.
                        render: (r) => <span title={r.caption || undefined}>{shorten(r.caption) || '-'}</span>,
                      },
                      {
                        key: 'remembered',
                        label: 'Status',
                        render: (r) =>
                          r.remembered ? (
                            <StatusBadge tone="ok">Remembered</StatusBadge>
                          ) : (
                            <StatusBadge tone="off">Pending</StatusBadge>
                          ),
                      },
                      { key: 'firstAt', label: 'First remembered', render: (r) => dateGu(r.firstAt) },
                      { key: 'lastAt', label: 'Last revised', render: (r) => dateGu(r.lastAt) },
                    ]}
                    rows={shownScenes}
                    rowKey={(r) => r.id}
                  />
                )}

                <p className="card-note">
                  Showing {gu(shownScenes.length)} of {gu(sceneRows.length)} darshan. A pending
                  darshan is simply one he has not reached yet. The dates are the first and the
                  latest time it was ticked, at either Level 3 or Level 4.
                </p>
              </div>
            )}
          </section>
        </>
      )}

      <h2 className="section-title">Levels 1 to 3</h2>
      {loading ? (
        <FormSkeleton fields={4} />
      ) : (
        <>
          <section className="card" aria-labelledby="s-l1">
            <h2 id="s-l1">{LEVEL_EN[1]}</h2>
            <dl className="kv">
              <dt>Status</dt><dd>{badge(LEVEL_STATUS, d.level1.status)}</dd>
              <dt>Attempts</dt><dd className="mono">{gu(d.level1.attempts)}</dd>
              <dt>Completed</dt><dd>{dateTimeGu(d.level1.completedAt)}</dd>
            </dl>
          </section>

          <section className="card" aria-labelledby="s-l2">
            <h2 id="s-l2">{LEVEL_EN[2]}</h2>
            <dl className="kv">
              <dt>Status</dt><dd>{badge(LEVEL_STATUS, d.level2.status)}</dd>
              <dt>Attempts</dt><dd className="mono">{gu(d.level2.attempts)}</dd>
              <dt>Days</dt><dd className="mono">{gu(d.level2.days)}</dd>
              <dt>Last attempt</dt><dd>{dateTimeGu(d.level2.lastAt)}</dd>
            </dl>
            {/*
              Said plainly, because its absence is the thing most likely to be read as a gap
              in the panel. Level 2 records no scene ids at all - every attempt carries an
              empty list and a total of zero - because watching darshan is not a per-scene
              act. There is no "x of y" to show and inventing one would be inventing a
              measurement the app never took.
            */}
            <p className="card-note">
              Level 2 keeps no per-darshan record - doing darshan is not a per-scene act, so
              there is no "x of y" for this level. What is recorded is that he did it, and on
              how many days.
            </p>
          </section>

          <section className="card" aria-labelledby="s-l3">
            <h2 id="s-l3">{LEVEL_EN[3]}</h2>
            <dl className="kv">
              <dt>Status</dt><dd>{badge(LEVEL_STATUS, d.level3.status)}</dd>
              <dt>Attempts</dt><dd className="mono">{gu(d.level3.attempts)}</dd>
              <dt>Days</dt><dd className="mono">{gu(d.level3.days)}</dd>
              {/* Measured against today's collection, the same denominator the cards above
                  use, so one page never states two totals. */}
              <dt>Best result</dt>
              <dd className="mono">{total ? `${gu(d.level3.best)} / ${gu(total)}` : gu(d.level3.best)}</dd>
              <dt>Latest result</dt>
              <dd className="mono">
                {d.level3.latest == null ? '-' : total ? `${gu(d.level3.latest)} / ${gu(total)}` : gu(d.level3.latest)}
              </dd>
              <dt>Last attempt</dt><dd>{dateTimeGu(d.level3.lastAt)}</dd>
            </dl>
            {/*
              Only when the two disagree, and then said rather than reconciled. The app
              computes the collection from a file the database cannot read, so a submission
              made before a darshan was added or withheld counted against a different total.
              Silently rescaling his old score to today's number would be rewriting what he
              did (§62).
            */}
            {d.level3.reportedTotal > 0 && d.level3.reportedTotal !== total && (
              <p className="card-note">
                His attempts were submitted against {gu(d.level3.reportedTotal)} darshan; the
                collection now holds {gu(total)}. Both figures are shown as they were recorded.
              </p>
            )}
          </section>
        </>
      )}

      {/*
        ────────────────────────────────────────────────────────────────────────
        Level 3 revision history - §20
        ────────────────────────────────────────────────────────────────────────

        The section that exists so a Level 3 total can be **checked** rather than believed.

        Since 0035 a repeated પુનરાવર્તન accumulates - 50 ticks, then 40, then 30 is 120 - and a
        figure arrived at by addition is a figure somebody will eventually dispute. §20 asks
        that the panel be able to show exactly how it was produced, so what is shown here is the
        addition itself: every submission with what it ticked and what it was paid, and the same
        rows gathered by day underneath.

        Three properties of the numbers here, each of which is easy to get wrong by reading them
        as something they are not:

          * **Ticks are additive.** The same darshan revised twice counts twice. That is the
            point of the level and it is why this figure can pass the size of the collection
            many times over. "Darshan remembered" at the top of the page is the other question -
            the distinct set - and the two are meant to differ.
          * **Points are the ledger's own rows for that attempt**, not a share of the day
            divided out. If they are 0 on a real revision, points were off, Level 3 was
            switched off, the day's cap was already spent, or the pace rule capped the ticks -
            each of which is a rule an admin set, and none of which is a mark against him.
          * **The attention is the server's measurement**, never the handset's.
      */}
      <h2 className="section-title">Level 3 revision history</h2>
      <p className="card-note" style={note}>
        Every revision he has submitted, newest first, with what each one ticked and what each
        one was paid. A repeated revision adds up rather than replacing the last: this is where
        the Level 3 total is taken apart.
      </p>

      <AsyncBlock
        state={{
          ...level3,
          isEmpty: !level3.loading && !level3.error && (l3?.revisions.length ?? 0) === 0,
        }}
        emptyIcon="◷"
        emptyTitle="No revision submitted yet"
        empty="Nothing appears here until this yuvak submits his first Level 3 revision. There is nothing to do from the panel - the record fills itself as he goes."
        onRetry={level3.retry}
        skeleton={<CardSkeleton count={4} />}
      >
        <>
          {l3 && (
            <>
              <div className="grid-stats">
                <StatCard
                  label="Revisions"
                  value={gu(l3.totals.revisions)}
                  sub={l3.totals.days ? `On ${gu(l3.totals.days)} day${l3.totals.days === 1 ? '' : 's'}` : null}
                />
                {/*
                  The additive sum, and it is labelled so it cannot be read as the other one.
                  A yuvak who has revised the whole collection three times reads three times the
                  collection here, and that is the correct answer to this question.
                */}
                <StatCard
                  label="Ticks in all"
                  value={gu(l3.totals.ticks)}
                  sub="Every revision added together"
                />
                <StatCard
                  label="Level 3 points"
                  value={gu(l3.totals.points)}
                  sub="From the ledger, as paid at the time"
                />
                <StatCard
                  label="Last revision"
                  value={l3.totals.lastAt ? dateGu(l3.totals.lastAt) : '-'}
                  sub={l3.totals.lastAt ? dateTimeGu(l3.totals.lastAt) : 'Nothing recorded yet'}
                />
              </div>

              <DataTable
                caption="Revisions submitted, newest first"
                columns={[
                  { key: 'date', label: 'Date', render: (r) => dateGu(r.date) },
                  {
                    key: 'n',
                    label: 'Revision on that day',
                    align: 'right',
                    // Which submission of that business day this was - the first, the second,
                    // the third. Not a lifetime count: the number restarts each day, which is
                    // what makes "50 + 40 + 30" a sentence about one day.
                    render: (r) => (
                      <>
                        <span className="mono">{gu(r.n)}</span>
                        {r.at && <span className="hint" style={cellNote}>{dateTimeGu(r.at)}</span>}
                      </>
                    ),
                  },
                  {
                    key: 'ticks',
                    label: 'Ticks',
                    align: 'right',
                    // What this one submission ticked, with the collection it was measured
                    // against beside it as it was recorded at the time - never rescaled to
                    // today's total, because a revision made before a darshan was published
                    // counted against a different collection (§62).
                    render: (r) => (
                      <>
                        <span className="mono">{gu(r.ticks)}</span>
                        {r.total > 0 && (
                          <span className="hint" style={cellNote}>of {gu(r.total)} then</span>
                        )}
                      </>
                    ),
                  },
                  {
                    key: 'points',
                    label: 'Points',
                    align: 'right',
                    /*
                      What this revision earned, from the ledger rows filed against this very
                      attempt. A real 0 is printed as 0 and is not a shortfall: points may be
                      off, Level 3 may be switched off, the day's cap may already be spent, or
                      the pace rule may have capped the ticks - and every one of those is a rule
                      an admin set rather than something the yuvak did.
                    */
                    render: (r) => <span className="mono">{gu(r.points)}</span>,
                  },
                  {
                    key: 'engagedMs',
                    label: 'Attention',
                    align: 'right',
                    render: (r) => {
                      const spelt = spellMs(r.engagedMs);
                      return spelt ? (
                        <span className="mono" title="Measured by the database from the draft's own autosaves">
                          {spelt}
                        </span>
                      ) : (
                        noRecord('No attention was measured for this revision - revisions submitted before the pace rule existed accumulated none.')
                      );
                    },
                  },
                  {
                    key: 'status',
                    label: 'Result',
                    // Two neutral words. "Part of it" is not a failure: a partial revision is
                    // what repeated revision is made of, and it is paid.
                    render: (r) => badge(L3_RESULT, r.status),
                  },
                ]}
                rows={l3.revisions}
                rowKey={(r) => `${r.date}#${r.n}#${r.at || ''}`}
              />

              {/* The cap, said out loud rather than left to be inferred from a list that stops.
                  The totals above are over his whole history, which is what makes a partial
                  list safe to show - so the sentence has to name both halves. */}
              {l3.revisions.length >= L3_LIMIT && l3.totals.revisions > l3.revisions.length && (
                <div className="notice" role="status">
                  Showing the most recent {gu(l3.revisions.length)} of {gu(l3.totals.revisions)}{' '}
                  revisions. The totals above cover all of them.
                </div>
              )}

              {/* The day roll-up - the requirement's own worked example: 14 August = 50 + 40 = 90. */}
              {l3.days.length > 0 && (
                <>
                  <h2 className="section-title">Level 3 by day</h2>
                  <DataTable
                    caption="Revisions gathered by business day, newest first"
                    columns={[
                      { key: 'date', label: 'Date', render: (r) => dateGu(r.date) },
                      {
                        key: 'revisions',
                        label: 'Revisions',
                        align: 'right',
                        render: (r) => <span className="mono">{gu(r.revisions)}</span>,
                      },
                      {
                        key: 'ticks',
                        label: 'Ticks that day',
                        align: 'right',
                        // The day's revisions added together, which is the whole content of the
                        // change 0035 made: three submissions of 50, 40 and 30 read 120 here
                        // and would have read one flat award before it.
                        render: (r) => <span className="mono">{gu(r.ticks)}</span>,
                      },
                      {
                        key: 'points',
                        label: 'Points that day',
                        align: 'right',
                        /*
                          Every Level 3 award filed under that business day - so it can exceed
                          the sum of the revisions above it when a manual adjustment was made
                          against the day. That is a fact about the ledger and not a discrepancy
                          to be reconciled away here; the Point ledger carries the reason.
                        */
                        render: (r) => <span className="mono">{gu(r.points)}</span>,
                      },
                    ]}
                    rows={l3.days}
                    rowKey={(r) => r.date}
                  />
                </>
              )}

              <p className="card-note">
                Ticks add up: the same darshan revised twice counts twice, so this figure can
                pass the size of the collection many times over. That is the level working, not
                an error - "Darshan remembered" at the top of this page is the other question,
                the darshan he holds counted once each. Points are the ledger's own rows for each
                revision, carrying the number that was actually paid at the time. A 0 there means
                a rule paid nothing - points switched off, Level 3 switched off, the day's cap
                already spent, or the pace rule capping the ticks to the attention measured - and
                never that the revision did not count. "Attention" is measured by the database
                from the revision's own autosaves and is never sent by the phone; a blank means
                none was measured, which is every revision submitted before that measurement
                existed.
              </p>
            </>
          )}
        </>
      </AsyncBlock>

      <h2 className="section-title">Level 4</h2>
      {loading ? (
        <CardSkeleton count={6} />
      ) : (
        <>
          <div className="grid-stats">
            <StatCard label="Tests in all" value={gu(d.level4.total)} />
            <StatCard
              label="Tests open to him"
              value={gu(unlocked)}
              sub={d.gateOpen ? 'Level 4 is open' : 'Level 4 not open yet'}
            />
            <StatCard label="Tests complete" value={gu(completed4)} />
            <StatCard label="Tests passed" value={gu(d.level4.passed)} />
            <StatCard label="Revision remaining" value={gu(revision4)} />
            <StatCard
              label="Attempts in all"
              value={gu(d.level4.attempts)}
              sub={d.level4.lastAt ? `Last on ${dateGu(d.level4.lastAt)}` : null}
            />
          </div>

          {/*
            Whatever the published configuration holds, in its own order - not a fixed set of
            four. The કસોટીઓ are rows a સંચાલક creates, and a table that assumed a count would
            silently drop the one after it.
          */}
          {acts.length === 0 ? (
            <Empty
              icon="◇"
              title="No tests to show"
              message="Nothing appears here until a Level 4 configuration is published with at least one test in it."
            />
          ) : (
            <DataTable
              caption="Level 4 history - every published test, in the order they are taken"
              columns={[
                {
                  key: 'code',
                  label: 'Activity',
                  // Code and title in one cell: below 820px each row becomes a card with no
                  // neighbouring column to borrow context from, and a bare title would not
                  // say which rung it is.
                  render: (a) => (
                    <>
                      <span className="mono">{a.code || '-'}</span>
                      <span className="hint" style={cellNote}>{a.title || '-'}</span>
                    </>
                  ),
                },
                {
                  key: 'attempts',
                  label: 'Attempt',
                  align: 'right',
                  // Sittings, in all. A genuine 0 is printed as 0 - he has not sat this one
                  // yet, which is a fact and not an absent figure - with the date of the last
                  // sitting under it when there has been one.
                  render: (a) => (
                    <>
                      <span className="mono">{gu(a.attempts)}</span>
                      {a.lastAttemptAt && (
                        <span className="hint" style={cellNote}>Last on {dateGu(a.lastAttemptAt)}</span>
                      )}
                    </>
                  ),
                },
                {
                  key: 'status',
                  label: 'Result',
                  /*
                    How many of his sittings passed, under the કસોટી's own state.
                    `bestSelected` is null until he has sat it once, and a 0 there would read
                    as a sitting that selected nothing - a different thing from never having
                    sat it - so it appears only when there is a sitting to describe.
                  */
                  render: (a) => {
                    const outOf = a.requiredCount ?? a.itemCount;
                    return (
                      <>
                        {badge(L4_STATUS, a.status)}
                        <span className="hint" style={cellNote}>
                          {a.attempts > 0
                            ? `${gu(a.passedAttempts)} of ${gu(a.attempts)} passed`
                            : 'No sitting yet'}
                        </span>
                        {a.bestSelected != null && (
                          <span className="hint" style={cellNote}>
                            Best {gu(a.bestSelected)}{outOf ? ` of ${gu(outOf)}` : ''}
                          </span>
                        )}
                      </>
                    );
                  },
                },
                {
                  key: 'completedAt',
                  label: 'Passed At',
                  /*
                    A COMPLETED કસોટી can carry no date, and that is not a missing value: it
                    was credited by the દ્રશ્યો he had already covered rather than by a
                    sitting, so there is no moment to name and none is invented here. The dash
                    carries which of the two silences it is.
                  */
                  render: (a) => {
                    if (a.completedAt) return dateTimeGu(a.completedAt);
                    return noRecord(
                      a.status === 'COMPLETED'
                        ? 'Credited by the darshan he had already covered rather than by a sitting, so there is no moment to name.'
                        : 'This test has not been passed yet.'
                    );
                  },
                },
                {
                  key: 'revisionCount',
                  label: 'Revision status',
                  /*
                    Grey, and only ever grey. "Revision remaining" is what the yuvak's own
                    history calls થોડું બાકી; an amber or a red pill beside it would turn a
                    position in the journey into a warning about the person.
                  */
                  render: (a) => (
                    <>
                      {a.status === 'REVISION_REQUIRED' && <StatusBadge tone="off">Revision remaining</StatusBadge>}
                      <span className="mono" style={cellNote}>{gu(a.revisionCount)}</span>
                      <span className="hint" style={cellNote}>
                        {a.revisionCount === 1 ? 'revision recorded' : 'revisions recorded'}
                      </span>
                    </>
                  ),
                },
              ]}
              rows={acts}
              rowKey={(a) => a.activityId}
            />
          )}

          <p className="card-note">
            Every test the published configuration holds, in its own order - the table is as long
            as that configuration and assumes no number of tests. "Open" and "Locked" are worked
            out by the server from the order of the tests, the Level 4 gate and the darshan
            already covered - they are not stored, and nothing on this page changes them. A test
            marked complete with no date under "Passed At" was credited by the darshan he had
            already covered rather than by a sitting, so there is no moment to name. "Revision
            remaining" is a position in the journey and not a mark against him.
          </p>
        </>
      )}

      <h2 className="section-title">Daily history</h2>
      <p className="card-note" style={note}>
        One row per submission, newest first. The same activity may appear more than once on a
        day - Level 3 may be submitted as often as he likes, and an unlocked Level 4 test may be
        sat again - and that is ordinary. A repeated Level 3 revision now carries an award of its
        own rather than sharing the first one's, so the Points column beside it is filled in
        wherever the record holds a figure for that attempt.
      </p>

      <AsyncBlock
        /*
          `isEmpty` describes the query, and `attemptPage === 0` is part of it on purpose:
          without it, landing on a later page that happens to be empty replaces the table with
          the empty state and takes the Pager with it, leaving no way back.
        */
        state={{ ...attempts, isEmpty: !attempts.loading && !attempts.error && !attemptRows.length && attemptPage === 0 }}
        emptyIcon="◷"
        emptyTitle="Nothing submitted yet"
        empty="Nothing appears here until this yuvak submits his first activity. There is nothing to do from the panel - the record fills itself as he goes."
        onRetry={attempts.retry}
        skeleton={<TableSkeleton cols={7} />}
      >
        <>
          <DataTable
            caption="Attempts submitted, newest first"
            columns={[
              // A plain 'YYYY-MM-DD' business day, filed by the server in IST.
              { key: 'activityDate', label: 'Date', render: (r) => dateGu(r.activityDate) },
              {
                key: 'levelId',
                label: 'Level',
                // The કસોટી's own name sits under the level on a Level 4 row: the "Activity"
                // column the table used to carry is gone, and below 820px each row becomes a
                // card with no neighbour to borrow the name from.
                render: (r) => (
                  <>
                    {LEVEL_EN[r.levelId] || `Level ${gu(r.levelId)}`}
                    {isLevel4Row(r) && <span className="hint" style={cellNote}>{activityName(r)}</span>}
                  </>
                ),
              },
              {
                key: 'completedItems',
                label: 'Remembered',
                align: 'right',
                // Levels 1 and 2 carry no items - an empty id list and a zero total - so they
                // get a dash that says so rather than a misleading "0 of 0".
                render: (r) =>
                  r.totalItems > 0 ? (
                    <span className="mono">{gu(r.completedItems)} / {gu(r.totalItems)}</span>
                  ) : (
                    noRecord('This level keeps no per-darshan record, so there is no figure to show.')
                  ),
              },
              {
                key: 'ticks',
                label: 'Ticks',
                align: 'right',
                /*
                  The same darshan as the column beside it, counted rather than divided - and
                  on a Level 3 row it is the very same number, not a second measurement. The
                  note under the table says so out loud, because two columns filled from one
                  figure look like two readings that happen to agree.
                */
                render: (r) => {
                  const ticks = tickCount(r);
                  if (ticks == null) {
                    return noRecord('This level records no darshan ids, so nothing was ticked to count.');
                  }
                  return <span className="mono">{gu(ticks)}</span>;
                },
              },
              {
                key: 'attemptNumber',
                label: 'Attempts',
                align: 'right',
                // Which sitting this row is, not how many there have ever been: one row is one
                // submission, and the count of them is the length of this list.
                render: (r) =>
                  r.attemptNumber > 0 ? (
                    <span className="mono" title="Which sitting of this activity this submission was">
                      {gu(r.attemptNumber)}
                    </span>
                  ) : (
                    noRecord('This submission carries no sitting number.')
                  ),
              },
              {
                key: 'status',
                label: 'L4 passed',
                // Only a કસોટી is passed. On any other row this is not an unknown value but a
                // question that does not apply, and the dash carries the reason.
                render: (r) =>
                  isLevel4Row(r)
                    ? badge(L4_PASSED, r.status)
                    : noRecord('Only a Level 4 test is marked passed.'),
              },
              {
                key: 'points',
                label: 'Points',
                align: 'right',
                /*
                  Filled for a Level 3 revision, and a reasoned dash everywhere else.

                  This cell used to be permanently blank, and the reason given was that the
                  ledger paid an activity once a day however many times it was done, so no
                  per-attempt figure existed to put here. Since 0035 that is no longer true of
                  Level 3: each પુનરાવર્તન is paid on its own, keyed idempotently on the attempt
                  id, so there is a real figure for this row and withholding it would be the
                  panel hiding the very number §20 asks it to show.

                  It is read from the Level 3 document already fetched for the section above -
                  matched on (business day, revision number), which is what both records key on -
                  rather than by asking the ledger once per row. A request per row is the cost
                  this table still will not pay for a prettier cell, and it is why the figure
                  appears only where that document reaches: beyond its cap, and on every other
                  level, the dash says which silence it is. What he was paid, in full and by
                  every level, is the paginated section below.
                */
                render: (r) => {
                  if (r.levelId !== 3 || r.activityKey !== ACTIVITY_KEY.REVISION) {
                    return noRecord(
                      'The per-attempt figure is only recorded for Level 3 revisions - see the points history below for every award.'
                    );
                  }
                  const paid = l3PointsByAttempt.get(`${r.activityDate}#${r.attemptNumber}`);
                  if (!paid) {
                    return noRecord(
                      `Older than the most recent ${L3_LIMIT} revisions listed above, so no per-attempt figure is loaded for it. The points history below still holds the award.`
                    );
                  }
                  // A real 0 is printed as 0. It means a rule paid nothing for this revision -
                  // points off, the day's cap spent, or the pace rule capping the ticks - and
                  // it is a different sentence from "no figure exists", which is the dash.
                  return <span className="mono">{gu(paid.points)}</span>;
                },
              },
            ]}
            rows={attemptRows}
            rowKey={(r) => r.id}
          />
          <p className="card-note">
            A dash means the record holds no such figure, never a zero. Levels 1 and 2 keep no
            per-darshan record at all - watching the video and doing darshan are not per-scene
            acts - so "Remembered" and "Ticks" are both blank for them. On a Level 3 row those
            two columns are one and the same figure, the darshan he ticked: shown as a share of
            the day's collection on the left and as a plain count on the right. "Attempts" is
            which sitting this submission was. "L4 passed" applies only to a Level 4 test.
            "Points" is what that one submission earned, on a Level 3 revision, taken from the
            revision history above: each revision is now paid on its own, so a second revision on
            the same day has a figure of its own rather than sharing the first one's. On every
            other level the record keeps no per-attempt figure, and the dash says so - the points
            history below is the record of every award, at every level.
          </p>
          <Pager
            page={attemptPage}
            hasNext={Boolean(attempts.data?.hasNext)}
            onPrev={() => setAttemptPage((p) => Math.max(0, p - 1))}
            onNext={nextAttempts}
            pageSize={attemptSize}
            onPageSize={(n) => {
              attemptCursors.current = [null];
              setAttemptPage(0);
              setAttemptSize(n);
            }}
            busy={attempts.loading}
          />
        </>
      </AsyncBlock>

      <h2 className="section-title">Points history</h2>
      <p className="card-note" style={note}>
        One row per award, carrying the number that was actually paid at the time - so changing
        what a level is worth today never rewrites what he was paid last week. How many rows a
        day produces is a rule an admin sets rather than a fixed fact: an activity set to pay
        once a day gathers three attempts into one row, while a Level 3 revision counted per tick
        or per revision is paid each time it is submitted and has a row of its own each time.
        Either way, an attempt that earned nothing did not use up anything another attempt was
        entitled to.
      </p>

      <AsyncBlock
        state={{ ...points, isEmpty: !points.loading && !points.error && !pointRows.length && pointPage === 0 }}
        emptyIcon="◇"
        emptyTitle="No points yet"
        empty="Nothing appears here until points are switched on in Settings and this yuvak finishes an activity. An empty list is not a shortfall - it usually means points were off."
        onRetry={points.retry}
        skeleton={<TableSkeleton cols={3} />}
      >
        <>
          <DataTable
            caption="Points awarded, newest first"
            columns={[
              { key: 'activityDate', label: 'Date', render: (r) => dateGu(r.activityDate) },
              {
                key: 'title',
                label: 'Activity',
                render: (r) => (
                  <>
                    {activityName(r)}
                    <span className="hint" style={cellNote}>{LEVEL_EN[r.levelId] || `Level ${gu(r.levelId)}`}</span>
                  </>
                ),
              },
              { key: 'points', label: 'Points', align: 'right', render: (r) => <span className="mono">{gu(r.points)}</span> },
            ]}
            rows={pointRows}
            rowKey={(r) => r.id}
          />
          <Pager
            page={pointPage}
            hasNext={Boolean(points.data?.hasNext)}
            onPrev={() => setPointPage((p) => Math.max(0, p - 1))}
            onNext={nextPoints}
            pageSize={pointSize}
            onPageSize={(n) => {
              pointCursors.current = [null];
              setPointPage(0);
              setPointSize(n);
            }}
            busy={points.loading}
          />
        </>
      </AsyncBlock>

      {/*
        ────────────────────────────────────────────────────────────────────────
        Verify progress data
        ────────────────────────────────────────────────────────────────────────

        The panel that exists so a disagreement can be explained rather than argued about.
        Several yuvakos in production read one short of the whole collection having submitted
        as many distinct દ્રશ્યો as it holds, and no count on the page above can tell that
        apart from "he missed one". This one can, by name.

        On demand and never on page load: it is a second full scan of both attempt tables to
        answer a question that is not asked on most visits.
      */}
      <h2 className="section-title">Verify progress data</h2>
      <section className="card" aria-labelledby="s-verify">
        <h2 id="s-verify">Where every darshan he submitted ended up</h2>
        <div className="form-actions">
          <button
            className={verify.loading ? 'btn is-busy' : 'btn'}
            type="button"
            disabled={!liveIds || verify.loading}
            onClick={() => (verifyOn ? verify.retry() : setVerifyOn(true))}
          >
            {verify.loading ? 'Checking…' : verifyOn ? 'Check again' : 'Verify progress data'}
          </button>
          <span className="save-state">
            {verifyOn
              ? 'Compares what he submitted with the collection as it stands today.'
              : 'Runs only when you ask for it - it re-reads every submission he has ever made.'}
          </span>
        </div>

        {verify.error && <ErrorState message={verify.error} onRetry={verify.retry} />}

        {v && !verify.loading && !verify.error && (
          <>
            <dl className="kv" style={{ marginTop: 'var(--sp-4)' }}>
              <dt>Submitted</dt>
              <dd className="mono">{gu(v.submitted)}</dd>

              <dt>Counted</dt>
              <dd>
                <span className="mono">{gu(v.counted)}</span>
                <span className="hint" style={cellNote}>This is the figure the report shows.</span>
              </dd>

              <dt>Withheld</dt>
              <dd>
                <span className="mono">{gu(v.withheldCount)}</span>
                {idChips(v.withheldIds)}
              </dd>

              <dt>Unknown</dt>
              <dd>
                <span className="mono">{gu(v.unknownCount)}</span>
                {idChips(v.unknownIds)}
              </dd>

              <dt>Pending</dt>
              <dd>
                <span className="mono">{gu(v.missingCount)}</span>
                {idChips(v.missingIds)}
              </dd>
            </dl>

            {/*
              The two identities, asserted rather than trusted - the SQL returns its own
              verdict and detailService.js ANDs it with the same sum over these very numbers.
              Loud when it fails, because a reconciliation tool that quietly disagrees with
              itself is worse than none.

              Amber and not red, and worded about the data: a figure that does not close is a
              fault in the collection or in this panel, and never a statement about a person.
            */}
            {v.submittedBalances && v.totalBalances ? (
              <div className="notice notice-ok">
                <strong>The figures balance.</strong>{' '}
                Counted + Withheld + Unknown = {gu(v.submitted)} submitted, and
                Counted + Pending = {gu(v.contentTotal)}, the size of the collection. The
                report and the submissions agree.
              </div>
            ) : (
              <div className="notice notice-warn">
                <strong>These figures do not reconcile.</strong>{' '}
                {!v.submittedBalances && (
                  <>
                    Counted + Withheld + Unknown comes to {gu(v.counted + v.withheldCount + v.unknownCount)},
                    but {gu(v.submitted)} darshan were submitted.{' '}
                  </>
                )}
                {!v.totalBalances && (
                  <>
                    Counted + Pending comes to {gu(v.counted + v.missingCount)}, but the collection
                    holds {gu(v.contentTotal)}.{' '}
                  </>
                )}
                Treat the figures on this page as unreliable until this is looked into. This is a
                fault in the data or in this panel, not in anything the yuvak did.
              </div>
            )}

            <p className="card-note">
              <strong>Submitted</strong> is every distinct darshan he has ever ticked, at Level 3 or
              Level 4. <strong>Counted</strong> is how many of those are in the collection as it
              stands today - the figure the report shows. <strong>Withheld</strong> are ones he
              ticked that an admin has since taken out of the collection.{' '}
              <strong>Unknown</strong> are ones from a collection that no longer exists in this
              shape. <strong>Pending</strong> are darshan in today's collection that he has not
              ticked yet. Withheld and unknown darshan are by definition not in today's collection,
              so they are shown by their stored id rather than by a number.
            </p>
          </>
        )}
      </section>

      <p className="card-note">
        This page is a record, not an assessment. Nothing here counts days a yuvak was away, and
        an activity left for another day is simply one still ahead of him.
      </p>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Layout constants — module scope, so paging does not allocate a fresh style object per
 * row. Every value is a token: admin.css owns the scale and nothing here invents one.
 * ------------------------------------------------------------------------- */

/** The sentence under a section heading, sitting closer to it than to what follows. */
const note = { marginTop: 0, marginBottom: 'var(--sp-3)' };

/** A second line inside one cell — the title under a code, the level under a name. */
const cellNote = { display: 'block' };

/** Scene-id chips, wrapping rather than scrolling sideways. */
const chips = { display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' };

/** The headline block: one number, big, with the total and the share beside it. */
const headlineHead = {
  // Spelled out rather than inherited: this heading sits inside `.notice` when the collection
  // is complete and inside `.card` when it is not, and only the second has a rule for it.
  fontSize: 'var(--fs-section)',
  fontWeight: 'var(--fw-semi)',
  color: 'var(--text-strong)',
  marginBottom: 'var(--sp-2)',
};
const headline = { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 'var(--sp-2)' };
const headlineNum = { fontSize: '34px', fontWeight: 'var(--fw-semi)', color: 'var(--text-strong)', lineHeight: 1.1 };
const headlineOf = { fontSize: 'var(--fs-body)', color: 'var(--text-muted)' };
const headlinePct = { fontSize: 'var(--fs-body)', color: 'var(--text-muted)', marginInlineStart: 'auto' };

/**
 * The bar. It repeats the two numbers above it and is never the only place the state is
 * said, so a reader who cannot tell the brand tint from the green still reads "Complete".
 */
const barTrack = {
  height: '10px',
  marginTop: 'var(--sp-3)',
  borderRadius: 'var(--r-sm)',
  background: 'var(--surface-sunken)',
  border: '1px solid var(--border)',
  overflow: 'hidden',
};

const barFill = { height: '100%', borderRadius: 'var(--r-sm)' };
