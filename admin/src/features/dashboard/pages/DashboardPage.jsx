import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { loadDashboard, loadDarshanSummary } from '../services/dashboardService';
import StatCard, { PageHeader } from '../../../components/StatCard';
import DataTable from '../../../components/DataTable';
import { ErrorState } from '../../../components/StateBlocks';
import { dateGu, gu } from '../../../lib/format';
import { STAGE_LABEL } from '../../../lib/domain';

/**
 * §14 — the operational glance.
 *
 * Every number here is counted by Postgres, on Postgres's side — `count: 'exact', head:
 * true` and a GROUP BY RPC. Nothing downloads a table to measure it, and no number is a
 * placeholder: a metric that cannot be computed says so instead of showing a plausible
 * zero.
 *
 * The three groups load independently, so one failing query degrades that tile alone.
 */

export default function DashboardPage() {
  const main = useAsync(() => loadDashboard(), []);
  const darshan = useAsync(() => loadDarshanSummary(), []);

  if (main.error) return <ErrorState message={main.error} onRetry={main.retry} />;

  const users = main.data?.users;
  const learning = main.data?.learning;
  const report = darshan.data?.report;

  /**
   * "Nobody has started" is a measurement, and this is the measurement: the read
   * succeeded, and it found no learning_state row at any stage and no submitted session.
   * Anything else — an error, a still-loading page — is not entitled to that sentence.
   */
  const nothingRecorded = !main.loading && !!learning && !learning.error && !learning.tracked && !learning.sessions;

  return (
    <>
      <PageHeader
        title="Dashboard"
        sub={main.data ? `Today's date — ${dateGu(main.data.today)}` : 'Loading…'}
      />

      <h2 className="section-title">Users</h2>
      {users?.error ? (
        <ErrorState message="The user statistics could not be loaded." onRetry={main.retry} />
      ) : (
        <div className="grid-stats">
          <StatCard label="Total registered" value={gu(users?.total ?? 0)} loading={main.loading} />
          <StatCard label="New in the last 7 days" value={gu(users?.newWeek ?? 0)} loading={main.loading} />
          <StatCard label="New in the last 30 days" value={gu(users?.newMonth ?? 0)} loading={main.loading} />
          <StatCard
            label="Level 4 unlocked"
            value={gu(users?.gated ?? 0)}
            sub={users?.total ? `${gu(sharePct(users.gated, users.total))}%` : null}
            loading={main.loading}
          />
        </div>
      )}

      <h2 className="section-title">Learning progress</h2>
      {learning?.error ? (
        /*
          This branch used to render "Progress statistics are not available yet. No user has
          started learning so far." — a statement about the data, printed whenever the
          *read* failed. dashboardService turns any thrown error into `{ error }`, so a
          missing stage_breakdown() RPC or a dropped connection had the panel telling a
          સંચાલક as fact that 2,000 યુવક had done nothing, with no way to try again.
          It says what it knows now, and offers the retry every other tile on this page has.
          The genuinely-empty case is `nothingRecorded` below, and it is measured.
        */
        <ErrorState message="The progress statistics could not be loaded." onRetry={main.retry} />
      ) : (
        <>
          {nothingRecorded && (
            <div className="card">
              <div className="notice">
                No learning has been recorded yet — no user has started so far.
              </div>
            </div>
          )}

          <div className="grid-stats">
            <StatCard label="Active users" value={gu(learning?.active ?? 0)} loading={main.loading} />
            <StatCard label="Completed" value={gu(learning?.completed ?? 0)} tone="ok" loading={main.loading} />
            <StatCard
              label="Pending at the Darshan stage"
              value={gu(learning?.pendingReview ?? 0)}
              tone={learning?.pendingReview ? 'warn' : 'plain'}
              loading={main.loading}
            />
            <StatCard label="Total sessions" value={gu(learning?.sessions ?? 0)} loading={main.loading} />
          </div>

          {!!learning?.byStage?.some((b) => b.count) && (
            <div className="card">
              <h2>How many at each stage</h2>
              <DataTable
                caption="Users by stage"
                columns={[
                  { key: 'stage', label: 'Stage', render: (b) => STAGE_LABEL[b.stage] || b.stage },
                  { key: 'count', label: 'Users', align: 'right', render: (b) => <span className="mono">{b.count}</span> },
                ]}
                rows={learning.byStage}
                rowKey={(b) => b.stage}
              />
            </div>
          )}
        </>
      )}

      <h2 className="section-title">Darshan content</h2>
      {darshan.error ? (
        <ErrorState message={darshan.error} onRetry={darshan.retry} />
      ) : (
        <>
          <div className="grid-stats">
            <StatCard label="Total images" value={gu(report?.total ?? 0)} loading={darshan.loading} />
            <StatCard label="Ready for learning" value={gu(report?.active ?? 0)} tone="ok" loading={darshan.loading} />
            <StatCard
              label="Description pending"
              value={gu(report?.missingCaptions ?? 0)}
              tone={report?.missingCaptions ? 'warn' : 'ok'}
              loading={darshan.loading}
            />
            <StatCard
              label="With errors"
              value={gu(report?.invalid ?? 0)}
              tone={report?.invalid ? 'danger' : 'ok'}
              sub={report?.invalid ? 'Needs checking' : 'All good'}
              loading={darshan.loading}
            />
          </div>
          {!!report?.missingCaptions && (
            <div className="card">
              <div className="notice notice-warn">
                {gu(report.missingCaptions)} images still have no description written, so users cannot
                learn from them. See <Link to="/darshan/health">Darshan check</Link> for details.
              </div>
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
