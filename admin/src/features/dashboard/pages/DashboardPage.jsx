import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { loadDashboard, loadDarshanSummary } from '../services/dashboardService';
import StatCard, { PageHeader, guCount } from '../../../components/StatCard';
import { CardSkeleton, ErrorState } from '../../../components/StateBlocks';
import { dateGu, gu } from '../../../lib/format';

/**
 * §13, §14 — the operational glance.
 *
 * Every number here is counted by Postgres, on Postgres's side — `count: 'exact', head:
 * true` and one aggregating RPC. Nothing downloads a table to measure it, and no number is a
 * placeholder: a metric that cannot be computed says so instead of showing a plausible
 * zero.
 *
 * §49 — the page is assembled from two independent reads and stays that way. `loadDashboard()`
 * covers the two groups that share the Postgres connection; `loadDarshanSummary()`
 * is a second, lazily-imported read of the દર્શન manifest and resolves on its own schedule.
 * Neither waits for the other, so the first group to arrive is on screen while the second is
 * still in flight, and one failing query costs its own band rather than the page.
 *
 * That is also why nothing here early-returns on an error any more. A thrown envelope used
 * to replace the whole page with one ErrorState — including the દર્શન tiles, which had
 * loaded perfectly well from a different read. Each band now states its own outcome and
 * carries its own Try again.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Where the "Users at each stage" table went, and why it is not coming back
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This page used to end its progress band with a DataTable of `stage_breakdown()`, which
 * groups `learning_state.current_stage`. `learning_state` and `learning_sessions` belong to
 * the 0001 system behind the `/learn` route; nothing links to that route any more, nothing
 * writes those tables, and in production both hold **zero rows**. The breakdown could
 * therefore only ever render zeroes — and it hid itself when every count was 0, so the page
 * looked fine while saying nothing about the ૫૩ લેવલ ૧–૩ submissions and ૧૯ લેવલ ૪ કસોટીઓ
 * that did exist. The same reasoning removed the "Total sessions" and "Pending at the
 * Darshan stage" tiles beside it.
 *
 * The tiles below read `admin_progress_summary()` (0028) instead, over the tables levels
 * ૧–૪ actually write. Do not restore the stage breakdown: it cannot be correct again until
 * something writes `learning_state`, and nothing does.
 *
 * The skeletons are stat-shaped (CardSkeleton), not spinners: the tiles arrive into the
 * space their placeholders were already holding, so nothing below them jumps (§33).
 */

export default function DashboardPage() {
  const main = useAsync(() => loadDashboard(), []);
  const darshan = useAsync(() => loadDarshanSummary(), []);

  const users = main.data?.users;
  const progress = main.data?.progress;
  const report = darshan.data?.report;

  /*
    Two ways a group can be unreadable, and they arrive by different routes: the service
    catches each group and hands back `{ error }`, while a failure of the envelope itself
    lands on `main.error`. Both mean "this band could not be read", so both are folded into
    one flag per band rather than checked in two places and forgotten in one.

    A refusal counts as unreadable here too, and reaches this flag as an error rather than
    as zeroes: admin_progress_summary() raises 42501 when the caller holds neither
    progress.read nor users.read, instead of quietly returning nothing.
  */
  const usersError = main.error || users?.error;
  const progressError = main.error || progress?.error;

  /**
   * "Nobody has started" is a measurement, and this is the measurement: the read succeeded,
   * and it found nobody who has remembered a દ્રશ્ય or passed a કસોટી. Anything else — an
   * error, a still-loading page — is not entitled to that sentence.
   */
  const nothingRecorded = !main.loading && !progressError && !!progress && !progress.participants;

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
        // Two, matching the two tiles below — a skeleton that draws more boxes than the band
        // ever fills makes the page settle by shrinking, which reads as something failing to
        // load rather than as something arriving.
        <CardSkeleton count={2} />
      ) : (
        <div className="grid-stats">
          <StatCard label="Total registered" value={gu(users?.total ?? 0)} />
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

      <h2 className="section-title">Levels 1-4 progress</h2>
      {progressError ? (
        /*
          This branch used to render "Progress statistics are not available yet. No user has
          started learning so far." — a statement about the data, printed whenever the
          *read* failed. dashboardService turns any thrown error into `{ error }`, so a
          missing RPC, a dropped connection or a refusal had the panel telling a સંચાલક as
          fact that 2,000 યુવક had done nothing, with no way to try again. It says what it
          knows now, and offers the retry every other band on this page has. The
          genuinely-empty case is `nothingRecorded` below, and it is measured.
        */
        <ErrorState message="The progress statistics could not be loaded." onRetry={main.retry} />
      ) : main.loading ? (
        <CardSkeleton count={7} />
      ) : (
        <>
          {nothingRecorded && (
            <div className="notice" role="status">
              No progress has been recorded yet - no user has remembered a darshan or passed a
              Level 4 test so far.
            </div>
          )}

          {/*
            Seven of the figures the full report opens with, from the same
            admin_progress_summary() call — one document, so every tile is cut on the same
            scan and no two of them can describe different moments. guCount() prints '-'
            for a key that never arrived rather than a 0 nobody measured.

            "Average remembered" was the eighth and is no longer drawn here. The figure itself
            is untouched: admin_progress_summary() still returns it, `nothingRecorded` above
            still reads `participants` from the same document to decide whether anything has
            been recorded at all, and ProgressPage still shows the average in full. It is one
            tile fewer on the glance, not one measurement fewer.
          */}
          <div className="grid-stats">
            <StatCard
              label="Total users"
              value={guCount(progress?.totalUsers)}
              sub={progress ? `${guCount(progress.activeUsers)} active accounts` : null}
            />
            <StatCard label="Active today" value={guCount(progress?.activeToday)} sub="Counted in India (IST)" tone="ok" />
            <StatCard label="Level 1 completed" value={guCount(progress?.level1Completed)} />
            <StatCard label="Level 2 completed" value={guCount(progress?.level2Completed)} />
            <StatCard label="Level 3 Full completed" value={guCount(progress?.level3Completed)} />
            {/*
              The same figure the Users band shows as a share of everyone registered, and
              deliberately both: this row is the levels read left to right and would have a
              hole in it without લેવલ ૪'s gate. They cannot disagree — profiles_level4
              inlines the predicate `level4_gate_open(uuid)` evaluates (0014), so the count
              and the RPC are reading one rule.
            */}
            <StatCard label="Level 4 gate open" value={guCount(progress?.level4GateOpen)} sub="Open to start" />
            <StatCard
              label="Level 4 passed"
              value={guCount(progress?.level4AnyPassed)}
              /*
                "Every sub-level" and not a number typed here: how many sub-levels there are
                is whatever the published Level 4 configuration says today (`level4Total`),
                and a literal would go stale the first time a સંચાલક publishes a new one.
              */
              sub={
                progress?.level4Total
                  ? `${guCount(progress.level4AllPassed)} have passed all ${gu(progress.level4Total)} sub-levels`
                  : null
              }
              tone="ok"
            />
          </div>

          {/*
            The tiles are the glance; who is where is a different question and has its own
            page. Quiet, because reading the full report is not what a સંચાલક opens the
            dashboard to do — it is what he does next when a tile surprises him.
          */}
          <p className="card-note">
            <Link to="/progress">See the full progress report</Link> - every yuvak, level by
            level, with filters and an export.
          </p>
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
