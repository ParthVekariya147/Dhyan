import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { loadDashboard, loadDarshanSummary } from '../services/dashboardService';
import StatCard, { PageHeader } from '../../../components/StatCard';
import DataTable from '../../../components/DataTable';
import { CardSkeleton, ErrorState } from '../../../components/StateBlocks';
import { dateGu, gu } from '../../../lib/format';
import { STAGE_LABEL } from '../../../lib/domain';

/**
 * §13, §14 — the operational glance.
 *
 * Every number here is counted by Postgres, on Postgres's side — `count: 'exact', head:
 * true` and a GROUP BY RPC. Nothing downloads a table to measure it, and no number is a
 * placeholder: a metric that cannot be computed says so instead of showing a plausible
 * zero.
 *
 * §49 — the page is assembled from two independent reads and stays that way. `loadDashboard()`
 * covers the two groups that share the profiles/learning_state connection; `loadDarshanSummary()`
 * is a second, lazily-imported read of the દર્શન manifest and resolves on its own schedule.
 * Neither waits for the other, so the first group to arrive is on screen while the second is
 * still in flight, and one failing query costs its own band rather than the page.
 *
 * That is also why nothing here early-returns on an error any more. A thrown envelope used
 * to replace the whole page with one ErrorState — including the દર્શન tiles, which had
 * loaded perfectly well from a different read. Each band now states its own outcome and
 * carries its own Try again.
 *
 * The skeletons are stat-shaped (CardSkeleton), not spinners: the tiles arrive into the
 * space their placeholders were already holding, so nothing below them jumps (§33).
 */

export default function DashboardPage() {
  const main = useAsync(() => loadDashboard(), []);
  const darshan = useAsync(() => loadDarshanSummary(), []);

  const users = main.data?.users;
  const learning = main.data?.learning;
  const report = darshan.data?.report;

  /*
    Two ways a group can be unreadable, and they arrive by different routes: the service
    catches each group and hands back `{ error }`, while a failure of the envelope itself
    lands on `main.error`. Both mean "this band could not be read", so both are folded into
    one flag per band rather than checked in two places and forgotten in one.
  */
  const usersError = main.error || users?.error;
  const learningError = main.error || learning?.error;

  /**
   * "Nobody has started" is a measurement, and this is the measurement: the read
   * succeeded, and it found no learning_state row at any stage and no submitted session.
   * Anything else — an error, a still-loading page — is not entitled to that sentence.
   */
  const nothingRecorded =
    !main.loading && !learningError && !!learning && !learning.tracked && !learning.sessions;

  // One press re-runs both reads. They still travel independently — this is two retries,
  // not a new combined query — so a દર્શન read that is already fine simply comes back fine.
  const busy = main.loading || darshan.loading;
  const refresh = () => {
    main.retry();
    darshan.retry();
  };

  return (
    <>
      <PageHeader
        title="Dashboard"
        // The date is the IST day the counts describe (§9). Until it has arrived the line
        // says what the page is rather than "Loading…", which is a caption for a spinner
        // and not information.
        sub={main.data ? `Today - ${dateGu(main.data.today)}, India (IST)` : 'Counted by the database, not cached'}
        actions={
          <button
            className={`btn btn-quiet${busy ? ' is-busy' : ''}`}
            type="button"
            onClick={refresh}
            disabled={busy}
          >
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      <h2 className="section-title">Users</h2>
      {usersError ? (
        <ErrorState message="The user statistics could not be loaded." onRetry={main.retry} />
      ) : main.loading ? (
        <CardSkeleton count={4} />
      ) : (
        <div className="grid-stats">
          <StatCard label="Total registered" value={gu(users?.total ?? 0)} />
          <StatCard label="New in the last 7 days" value={gu(users?.newWeek ?? 0)} />
          <StatCard label="New in the last 30 days" value={gu(users?.newMonth ?? 0)} />
          <StatCard
            /*
              Worded as the column on the યુવક list is, and for the same reason: this counts
              `level4_gate_open`, the gate the *published* configuration defines now (0011),
              not 0008's fixed 80. "Unlocked" would describe something nobody had earned the
              moment a સંચાલક lowers the threshold.
            */
            label="Level 4 open"
            value={gu(users?.gated ?? 0)}
            sub={users?.total ? `${gu(sharePct(users.gated, users.total))}% of everyone registered` : null}
          />
        </div>
      )}

      <h2 className="section-title">Learning progress</h2>
      {learningError ? (
        /*
          This branch used to render "Progress statistics are not available yet. No user has
          started learning so far." — a statement about the data, printed whenever the
          *read* failed. dashboardService turns any thrown error into `{ error }`, so a
          missing stage_breakdown() RPC or a dropped connection had the panel telling a
          સંચાલક as fact that 2,000 યુવક had done nothing, with no way to try again.
          It says what it knows now, and offers the retry every other band on this page has.
          The genuinely-empty case is `nothingRecorded` below, and it is measured.
        */
        <ErrorState message="The progress statistics could not be loaded." onRetry={main.retry} />
      ) : main.loading ? (
        <CardSkeleton count={4} />
      ) : (
        <>
          {nothingRecorded && (
            <div className="notice" role="status">
              No learning has been recorded yet - no user has started so far.
            </div>
          )}

          <div className="grid-stats">
            <StatCard label="Active users" value={gu(learning?.active ?? 0)} />
            <StatCard label="Completed" value={gu(learning?.completed ?? 0)} tone="ok" />
            <StatCard
              label="Pending at the Darshan stage"
              value={gu(learning?.pendingReview ?? 0)}
              tone={learning?.pendingReview ? 'warn' : 'plain'}
            />
            <StatCard label="Total sessions" value={gu(learning?.sessions ?? 0)} />
          </div>

          {!!learning?.byStage?.some((b) => b.count) && (
            <>
              {/*
                No card around the table. `.table-wrap` is already a bordered surface, and
                below 900px DataTable turns each row into a card of its own — a card holding
                cards is a frame inside a frame either way. Both columns carry a real
                `label`, because on a phone the label is the only thing saying what the
                number is.
              */}
              <h2 className="section-title">Users at each stage</h2>
              <DataTable
                caption="How many users are at each stage"
                columns={[
                  { key: 'stage', label: 'Stage', render: (b) => STAGE_LABEL[b.stage] || b.stage },
                  { key: 'count', label: 'Users', align: 'right', render: (b) => <span className="mono">{b.count}</span> },
                ]}
                rows={learning.byStage}
                rowKey={(b) => b.stage}
              />
            </>
          )}
        </>
      )}

      <h2 className="section-title">Darshan content</h2>
      {darshan.error ? (
        <ErrorState message={darshan.error} onRetry={darshan.retry} />
      ) : darshan.loading ? (
        <CardSkeleton count={4} />
      ) : (
        <>
          <div className="grid-stats">
            <StatCard label="Total images" value={gu(report?.total ?? 0)} />
            <StatCard label="Ready for learning" value={gu(report?.active ?? 0)} tone="ok" />
            <StatCard
              label="Description pending"
              value={gu(report?.missingCaptions ?? 0)}
              tone={report?.missingCaptions ? 'warn' : 'ok'}
            />
            <StatCard
              label="With errors"
              value={gu(report?.invalid ?? 0)}
              tone={report?.invalid ? 'danger' : 'ok'}
              // The tone repeats what the words already say, so the tile still reads
              // correctly to someone who cannot separate the tints (§43).
              sub={report?.invalid ? 'Needs checking' : 'All good'}
            />
          </div>

          {!!report?.missingCaptions && (
            <div className="notice notice-warn">
              {gu(report.missingCaptions)} images still have no description written, so users cannot
              learn from them. See <Link to="/darshan/health">Darshan check</Link> for details.
            </div>
          )}
        </>
      )}
    </>
  );
}

/**
 * A share of a total, clamped.
 *
 * Both halves are counts of rows the caller may *read*, not of rows that exist: the
 * profiles policy in 0004_rbac.sql is `id = auth.uid() or has_permission('users.read')`,
 * and an RLS read denial returns rows rather than an error. A role without users.read
 * therefore counts its own profile and sees "Total registered: 1". Route-level permission
 * gating is what keeps such a role off this page; the clamp is here so that if one ever
 * reaches it, a numerator larger than the visible denominator cannot be printed as a
 * confident 400%. A wrong number that looks measured is worse than an obviously odd one.
 */
function sharePct(part, total) {
  return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}
