import { countUsers } from '../../users/services/userService';
import { sessionTotals, stageBreakdown } from '../../learning/services/learningService';
import { STAGE } from '../../../lib/domain';
import { todayIST } from '../../../../../shared/domain/constants.js';

/**
 * §14, §15 — dashboard numbers that stay correct at 2,000 users and cheap at any size.
 *
 * Everything here is a server-side aggregation: `count: 'exact', head: true` makes
 * Postgres do the counting and returns no rows at all. The alternative — fetch every
 * profile and every learning row and reduce them in the browser — would ship thousands of
 * records per dashboard open. The browser never receives a row this page does not display.
 *
 * There is deliberately no analytics counter row. Aggregation queries already answer every
 * question this page asks, and a counter would be a second copy of the truth that can
 * drift out of step with the rows it summarises (§85).
 */

/**
 * ISO 8601, because it goes into a PostgREST `gte` on a timestamptz column. This was a
 * Firestore Timestamp before the migration; passing one now would serialise to an object
 * and the filter would silently match nothing.
 */
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

/**
 * The groups from §14, loaded independently so one failure — a missing `stage_breakdown()`
 * RPC, say, or a connection that dropped — degrades that tile rather than blanking the page.
 *
 * `{ error }` means the group could not be read. It does not mean the group is empty, and
 * the page must not word it as though it were: a caller that cannot tell the two apart
 * ends up stating "no user has started learning" because the network blinked. Emptiness is
 * a number (`tracked`, below); failure is this key.
 */
export async function loadDashboard() {
  const [users, learning] = await Promise.all([
    loadUserMetrics().catch((e) => ({ error: e })),
    loadLearningMetrics().catch((e) => ({ error: e })),
  ]);
  return { today: todayIST(), users, learning };
}

/**
 * Every count here is a count of rows *this account is allowed to read*, never of rows
 * that exist. The profiles policy in 0004_rbac.sql is
 * `id = auth.uid() or has_permission('users.read')`, so a role without users.read counts
 * its own profile and gets 1 — an RLS read denial returns no rows rather than an error
 * (admin/src/lib/errors.js says so), which is exactly why nothing downstream may treat
 * these as organisation-wide truth without the permission being checked first.
 */
async function loadUserMetrics() {
  const [total, gated, newWeek, newMonth] = await Promise.all([
    countUsers(),
    // "How many have reached લેવલ ૪" under the threshold that is published *now* — not
    // 0008's fixed 80. See userService's TABLE comment.
    countUsers({ level4Open: true }),
    countUsers({ createdAfter: daysAgo(7) }),
    countUsers({ createdAfter: daysAgo(30) }),
  ]);
  return { total, gated, newWeek, newMonth };
}

/**
 * Where everyone currently stands, by stage.
 *
 * "Active" is anyone past NOT_STARTED and short of COMPLETED — derived from the same
 * breakdown rather than counted again, so the two figures cannot disagree.
 */
async function loadLearningMetrics() {
  const [byStage, totals] = await Promise.all([stageBreakdown(), sessionTotals()]);
  const at = (s) => byStage.find((b) => b.stage === s)?.count || 0;

  const started = byStage.reduce((sum, b) => sum + b.count, 0);
  const notStarted = at(STAGE.NOT_STARTED);
  const completed = at(STAGE.COMPLETED);

  return {
    byStage,
    // How many learning_state rows are visible at all, across every stage. The page needs
    // it to say "nothing has been recorded yet" only when that is a measurement rather
    // than a guess — a zero here and a failed read are different facts, and the tile used
    // to print the same sentence for both. Derived from `byStage` rather than counted
    // again, so the two can never disagree.
    tracked: started,
    active: Math.max(0, started - notStarted - completed),
    completed,
    pendingReview: at(STAGE.PENDING_REVIEW),
    sessions: totals.sessions,
  };
}

/**
 * દર્શન health for the dashboard tile. Imported dynamically so the manifest lands in the
 * દર્શન chunk rather than the dashboard's (§51).
 */
export async function loadDarshanSummary() {
  const { loadDarshanHealth } = await import('../../darshan/services/darshanService');
  return loadDarshanHealth();
}
