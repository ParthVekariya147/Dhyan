import { useCallback, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { getUser } from '../services/userService';
import { getUserPointTotals, listUserAttempts, listUserPoints } from '../services/activityService';
import DataTable, { Pager } from '../../../components/DataTable';
import { AsyncBlock, CardSkeleton, ErrorState, TableSkeleton } from '../../../components/StateBlocks';
import StatCard, { PageHeader, StatusBadge } from '../../../components/StatCard';
import { dateGu, dateTimeGu, gu } from '../../../lib/format';
import { ACTIVITY_KEY, ATTEMPT_STATUS } from '../../../../../shared/domain/points.js';

/**
 * One yuvak's record - what he has done, and what he has been paid for it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A record, not a report card
 * ────────────────────────────────────────────────────────────────────────────
 *
 * reportService.js states the rule this page is most at risk of breaking: nothing in this
 * panel counts a missed day, nothing returns a "failed" figure, and nothing marks a yuvak as
 * behind. So there is no red on this page, no streak, no completion percentage against a
 * target he never agreed to, and no total of days he did not appear. An attempt that ended
 * with darshan still to revise is called exactly that - `REVISION_REQUIRED` is
 * `થોડું બાકી` in shared/domain/history.js and "Revision remaining" here, never
 * "failed" - and it wears the same quiet grey as any other neutral state.
 *
 * The one figure that could read as a judgement is points, and it is presented as what it
 * is: a record of awards, each stamped with the number that was actually paid on the day it
 * was paid. Points are earned at most once per activity per business day
 * (shared/domain/points.js), so a second attempt earning nothing is the rule working and
 * not a mark against anybody. The page says so in words rather than leaving a blank to be
 * read as one.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Two lists, because they answer two questions
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   Activity history   every submission - `attempt_history`
 *   Points history     every award      - `point_ledger`
 *
 * They are deliberately not merged. Three attempts on one day are three rows above and one
 * row below, and a single stitched table would have to either hide two attempts or invent
 * two payments. shared/domain/history.js opens with this distinction and it is kept here.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Read-only, and no new permission
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The route is gated on `users.read`, the same permission the profile behind it uses. The
 * three views this reads are `security_invoker`, so the grants already on the underlying
 * tables decide what comes back - nothing on this page widens who may see it, and there is
 * nothing on it to press that changes a yuvak's record. §19: progress is never hand-edited.
 */

/**
 * The ladder, in English.
 *
 * shared/domain/history.js's LEVEL_LABEL is the **yuvak's** wording - 'લેવલ ૧ - ધ્યાન' - and
 * it stays his. The panel switched to English (admin/src/lib/format.js documents that
 * switch in full), so a Gujarati level name in an English table would be the one word on the
 * row a સંચાલક could not skim. Keyed on the same level ids the views store, so the identity
 * comes from the contract and only the text is local.
 */
const LEVEL_EN = {
  1: 'Level 1 - Meditation',
  2: 'Level 2 - Darshan',
  3: 'Level 3 - Revision',
  4: 'Level 4',
};

/** Levels 1-3 have exactly one activity each; Level 4 rows carry their own title. */
const ACTIVITY_EN = {
  [ACTIVITY_KEY.VIDEO]: 'Video',
  [ACTIVITY_KEY.DARSHAN]: 'Darshan',
  [ACTIVITY_KEY.REVISION]: 'Revision',
};

/**
 * The two outcomes an attempt can have, in the panel's own words and its quietest tones.
 *
 * `ok` for a finished attempt and `off` - plain grey - for one with darshan still to revise.
 * Not `warn`, and certainly not `danger`: an amber pill beside "Revision remaining" would
 * turn a position in the journey into a warning about the person, which is the exact thing
 * §1 rule 4 and reportService.js's tone rules forbid.
 */
const RESULT_EN = {
  [ATTEMPT_STATUS.COMPLETED]: { label: 'Complete', tone: 'ok' },
  [ATTEMPT_STATUS.REVISION_REQUIRED]: { label: 'Revision remaining', tone: 'off' },
};

/** What the row is called on screen: Level 4's own title, or the fixed activity name. */
const activityName = (r) => r.title || ACTIVITY_EN[r.activityKey] || r.activityKey || '-';

export default function UserActivityPage() {
  const { userId } = useParams();

  const user = useAsync(() => getUser(userId), [userId]);
  const totals = useAsync(() => getUserPointTotals(userId), [userId]);

  /*
    One date range over both lists, and it is a **query** filter rather than a client-side
    one. That matters more than it looks: if the rows were fetched and then filtered in the
    browser, `isEmpty` computed from the filtered array would hide the Pager on a page whose
    query had plenty of rows, and the list would dead-end with no way forward or back. Both
    services apply the range in Postgres, on `activity_date`, so what is counted below is
    what was asked for.
  */
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [attemptSize, setAttemptSize] = useState(20);
  const [attemptPage, setAttemptPage] = useState(0);
  const attemptCursors = useRef([null]);

  const [pointSize, setPointSize] = useState(20);
  const [pointPage, setPointPage] = useState(0);
  const pointCursors = useRef([null]);

  const attempts = useAsync(
    () => listUserAttempts(userId, { cursor: attemptCursors.current[attemptPage], pageSize: attemptSize, from, to }),
    [userId, attemptPage, attemptSize, from, to]
  );

  const points = useAsync(
    () => listUserPoints(userId, { cursor: pointCursors.current[pointPage], pageSize: pointSize, from, to }),
    [userId, pointPage, pointSize, from, to]
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

  /** Changing what the query asks invalidates every cursor already collected for it. */
  const resetAll = () => {
    attemptCursors.current = [null];
    pointCursors.current = [null];
    setAttemptPage(0);
    setPointPage(0);
  };

  const u = user.data;
  const name = u?.name || 'User';
  const crumbs = [
    { to: '/users', label: 'Users' },
    { to: `/users/${userId}`, label: name },
    { label: 'Activity' },
  ];

  /*
    How many attempts are on record, said only as far as it is actually known.

    There is no count query behind this, and inventing one would be a fourth read of a table
    two reads already cover. What the pager knows is exact: the rows already paged through,
    plus whether a further page exists. So the figure is `n` when the last page is on screen
    and `n+` when it is not - true in both cases, and it grows as he pages. A flat "25" that
    silently meant "the first 25" would be a claim about his whole record made from one page
    of it (§62).
  */
  const attemptsSeen = attemptPage * attemptSize + attemptRows.length;
  const attemptsMore = Boolean(attempts.data?.hasNext);

  const ranged = Boolean(from || to);

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        title={user.loading ? 'Activity' : `${name} - activity`}
        sub="Every attempt he has submitted, and every point he has been paid"
        actions={
          <Link className="btn btn-quiet" to={`/users/${userId}`}>
            ← Back to profile
          </Link>
        }
      />

      {/*
        §53, and the rule UserDetailPage learned the hard way: a failed read is not a fact
        about the yuvak. An expired token or a dropped connection must never be rendered as
        "0 points today" - that is the panel asserting he did nothing. The band reports the
        failure and offers the same Try again the rest of the panel does.
      */}
      {totals.error ? (
        <ErrorState message={totals.error} onRetry={totals.retry} />
      ) : totals.loading ? (
        <CardSkeleton count={3} />
      ) : (
        <div className="grid-stats">
          <StatCard
            label="Points today"
            value={gu(totals.data?.today ?? 0)}
            sub="Counted in India (IST), from midnight"
          />
          <StatCard
            label="Points in total"
            value={gu(totals.data?.total ?? 0)}
            // Only when the scan actually stopped early. Said rather than left for somebody
            // to discover: a lifetime figure that is quietly a partial sum is worse than one
            // that admits it.
            sub={totals.data?.truncated ? `At least this many - the most recent ${gu(totals.data.cap)} awards were read` : 'Every award ever written'}
          />
          {/*
            Rendered only when the attempts read succeeded. On a failure the card is absent
            rather than showing 0 or a dash: the section below already carries the error and
            its retry, and an empty-looking figure beside it would state something the panel
            does not know.
          */}
          {!attempts.error && (
            <StatCard
              label="Attempts recorded"
              value={attemptsMore ? `${gu(attemptsSeen)}+` : gu(attemptsSeen)}
              loading={attempts.loading}
              sub={
                attemptsMore
                  ? 'At least this many - there are more pages below'
                  : ranged
                    ? 'In the dates chosen'
                    : 'Every submission on record'
              }
            />
          )}
        </div>
      )}

      {/* One range, both lists. Filtered on `activity_date`, the plain date the server files
          an attempt under, so a submission at 11 pm on the 11th belongs to the 11th in the
          same India the yuvak was in (§9). */}
      <div className="filters" role="group" aria-label="Filter this record by date">
        <div className="field">
          <label htmlFor="act-from">Activity from</label>
          <input
            id="act-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              resetAll();
              setFrom(e.target.value);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="act-to">Activity up to</label>
          <input
            id="act-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              resetAll();
              setTo(e.target.value);
            }}
          />
          <span className="hint">Both days included, counted in India (IST)</span>
        </div>
        {ranged && (
          <button
            className="btn btn-quiet"
            type="button"
            onClick={() => {
              resetAll();
              setFrom('');
              setTo('');
            }}
          >
            Clear dates
          </button>
        )}
      </div>

      <h2 className="section-title">Activity history</h2>
      <p className="card-note" style={note}>
        One row per submission. The same activity may appear more than once on a day - Level 3
        may be submitted as often as he likes, and an unlocked Level 4 test may be sat again -
        and that is ordinary. What each attempt was worth is in Points history below. How many of
        those repeats are paid is a rule an admin sets rather than a fixed fact: a Level 3
        revision counted per tick or per revision earns every time it is submitted, so 50 ticks
        then 40 is 90 and is paid as 90.
      </p>

      <AsyncBlock
        /*
          `isEmpty` is computed here, by the caller, because useAsync never produces it - it
          knows only loading, error and data. The condition describes the **query**: no rows
          came back for this user in these dates.

          `attemptPage === 0` is part of it on purpose. Without it, landing on a later page
          that happens to be empty replaces the table with the empty state, which takes the
          Pager with it - and with no Previous button the list dead-ends and the only way out
          is the browser's back button. Page one empty is a fact about his record; page four
          empty is a fact about the cursor, and only the first deserves the whole block.
        */
        state={{ ...attempts, isEmpty: !attempts.loading && !attempts.error && !attemptRows.length && attemptPage === 0 }}
        emptyIcon="◷"
        emptyTitle={ranged ? 'Nothing submitted in these dates' : 'Nothing submitted yet'}
        empty={
          ranged
            ? 'No attempt was recorded between these dates. Try a wider range.'
            : 'Nothing appears here until this yuvak submits his first activity. There is nothing to do from the panel - the record fills itself as he goes.'
        }
        onRetry={attempts.retry}
        skeleton={<TableSkeleton cols={7} />}
      >
        <>
          <DataTable
            caption="Attempts submitted, newest first"
            /*
              Every label reads on its own. Seven columns do not fit a phone, so the last of
              them are reached by swiping the table sideways and arrive alone at the edge of
              the screen with nothing but their own header for context - a heading that only
              made sense while its neighbours were on screen becomes a riddle there.
            */
            columns={[
              {
                key: 'activityDate',
                label: 'Date',
                /*
                  The column that does not move when this table is swiped on a phone.

                  Whose record this is was settled by the page itself - one yuvak, named in
                  the title and the breadcrumb - so the row's identity is not a person here,
                  it is a day. Every other column is an attribute of that day's attempt:
                  Level, Activity, Result and the counts all repeat down the page, and
                  "Complete" pinned to the edge of the screen would say nothing about which
                  attempt was complete. The date is what somebody reading a timeline is
                  holding in their head, and swiping right from it means "and what happened
                  on the 11th", which is the question this list is opened with.

                  It is the first column too, so nothing changes today - written anyway,
                  because DataTable's fallback is position rather than meaning.
                */
                pin: true,
                // A plain 'YYYY-MM-DD'. dateGu() reads it as midnight UTC and renders it in
                // IST, which is 5:30 am the same morning - the same calendar day, because
                // India is ahead of UTC and never behind it.
                render: (r) => dateGu(r.activityDate),
              },
              { key: 'levelId', label: 'Level', render: (r) => LEVEL_EN[r.levelId] || `Level ${gu(r.levelId)}` },
              { key: 'title', label: 'Activity', render: activityName },
              {
                key: 'attemptNumber',
                label: 'Attempt on that day',
                align: 'right',
                render: (r) => <span className="mono">{gu(r.attemptNumber)}</span>,
              },
              {
                key: 'status',
                label: 'Result',
                render: (r) => {
                  const s = RESULT_EN[r.status];
                  // A status this bundle does not know about can only come from a later
                  // migration: show it raw rather than as a blank or as the wrong word.
                  return s ? (
                    <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                  ) : (
                    <StatusBadge tone="off">{r.status || '-'}</StatusBadge>
                  );
                },
              },
              {
                key: 'completedItems',
                label: 'Darshan completed',
                align: 'right',
                // Levels 1 and 2 have nothing to count but the doing, so they carry no items
                // and get a dash rather than a misleading 0 of 0. shared/domain/history.js
                // summariseRow() makes the same three-way distinction for the yuvak's screen.
                render: (r) =>
                  r.totalItems > 0 ? (
                    <span className="mono">{gu(r.completedItems)} / {gu(r.totalItems)}</span>
                  ) : (
                    <span className="mono">-</span>
                  ),
              },
              {
                key: 'submittedAt',
                label: 'Submitted at',
                render: (r) => dateTimeGu(r.submittedAt),
              },
            ]}
            rows={attemptRows}
            rowKey={(r) => r.id}
          />
          <Pager
            page={attemptPage}
            hasNext={attemptsMore}
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
        One row per award. Each carries the number that was actually paid at the time, so
        changing what a level is worth today never rewrites what he was paid last week. How many
        rows a day produces depends on how the level is set to earn: an activity paying once a
        day gathers three attempts into one row, while a Level 3 revision counted per tick or per
        revision is paid each time and has a row of its own each time. An attempt that earned
        nothing never used up anything another attempt was entitled to.
      </p>

      <AsyncBlock
        // Same reasoning as above: the query, and only page one.
        state={{ ...points, isEmpty: !points.loading && !points.error && !pointRows.length && pointPage === 0 }}
        emptyIcon="◇"
        emptyTitle={ranged ? 'No points in these dates' : 'No points yet'}
        empty={
          ranged
            ? 'Nothing was awarded between these dates. Try a wider range.'
            : 'Nothing appears here until points are switched on in Settings and this yuvak finishes an activity. An empty list is not a shortfall - it usually means points were off.'
        }
        onRetry={points.retry}
        skeleton={<TableSkeleton cols={4} />}
      >
        <>
          <DataTable
            caption="Points awarded, newest first"
            columns={[
              {
                key: 'activityDate',
                label: 'Date',
                // Pinned for the same reason as the attempts table above, and it has to be
                // the same column in both: the two lists sit one under the other on one
                // page, and a phone that anchored one of them to the day and the other to
                // something else would read as two tables about different things.
                pin: true,
                render: (r) => dateGu(r.activityDate),
              },
              {
                key: 'title',
                label: 'Activity',
                // The level travels in the same cell as the name. On a phone this column is
                // reached by swiping and arrives with no neighbouring column in view to
                // borrow context from, so "Revision" alone would not say which ladder rung
                // it came from.
                render: (r) => (
                  <>
                    {activityName(r)}
                    <span className="hint" style={cellNote}>{LEVEL_EN[r.levelId] || `Level ${gu(r.levelId)}`}</span>
                  </>
                ),
              },
              {
                key: 'attemptNumber',
                label: 'Attempt that earned it',
                align: 'right',
                render: (r) => <span className="mono">{gu(r.attemptNumber)}</span>,
              },
              {
                key: 'points',
                label: 'Points awarded',
                align: 'right',
                render: (r) => <span className="mono">{gu(r.points)}</span>,
              },
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

      <p className="card-note">
        This page is a record, not an assessment. Nothing here can be edited from the panel,
        nothing counts days a yuvak was away, and an activity left for another day is simply
        one still ahead of him.
      </p>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Layout constants — module scope, so paging or typing a date does not allocate a fresh
 * style object per row. Every value is a token: admin.css owns the scale and the palette,
 * and nothing here may invent one.
 * ------------------------------------------------------------------------- */

/** The sentence under a section heading, sitting closer to it than to the table below. */
const note = { marginTop: 0, marginBottom: 'var(--sp-3)' };

/** A second line inside one cell — the level under the activity's own name. */
const cellNote = { display: 'block' };
