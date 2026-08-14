import { countUsers } from '../../users/services/userService';
import { progressSummary } from '../../progress/services/progressService';
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
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why the learning group is now the progress summary
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This file used to call `stageBreakdown()` and `sessionTotals()` from learningService.
 * Both read `learning_state` / `learning_sessions` — the 0001 system reached through the
 * `/learn` route, which nothing links to any more. Those two tables hold **zero rows** in
 * production and nothing has written them for as long as levels ૧–૪ have existed, so every
 * figure they produced was a confident zero over a busy database.
 *
 * What levels ૧–૪ really write is `activity_attempts`, `daily_activity_progress`,
 * `level4_attempts`, `level4_activity_progress`, `progress` and `point_transactions`, and
 * `admin_progress_summary()` (0028) aggregates exactly those, server-side, in one scan.
 * progressService.progressSummary() already wraps it for /progress; the dashboard calls the
 * same function rather than keeping a second copy of the mapping that could disagree with
 * the full report a click away.
 */

/**
 * ISO 8601, because it goes into a PostgREST `gte` on a timestamptz column. This was a
 * Firestore Timestamp before the migration; passing one now would serialise to an object
 * and the filter would silently match nothing.
 */
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

/**
 * The groups from §14, loaded independently so one failure — a missing migration, say, or a
 * connection that dropped — degrades that band rather than blanking the page.
 *
 * `{ error }` means the group could not be read. It does not mean the group is empty, and
 * the page must not word it as though it were: a caller that cannot tell the two apart
 * ends up stating "no user has started learning" because the network blinked.
 *
 * The distinction is sharper on the progress side than it used to be. `admin_progress_summary()`
 * raises 42501 when the caller holds neither `progress.read` nor `users.read`, instead of
 * returning an empty set the way an RLS read denial would — so a refusal arrives here as a
 * thrown error and reaches the page as a message with a retry, and can never be rendered as
 * a row of zeros about 2,000 યુવકો.
 */
export async function loadDashboard() {
  const [users, progress] = await Promise.all([
    loadUserMetrics().catch((e) => ({ error: e })),
    progressSummary().catch((e) => ({ error: e })),
  ]);
  return { today: todayIST(), users, progress };
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

/*
 * There is no `loadLearningMetrics()` here any more, and no stage breakdown behind it.
 *
 * It called `stage_breakdown()`, which groups `learning_state.current_stage` — a table with
 * zero rows in production and no writer. Every stage it returned was 0, and a table of
 * zeroes headed "Users at each stage" reads as a measurement rather than as the absence of
 * one. The dashboard now reads `admin_progress_summary()` (see the header), which counts the
 * levels the યુવક app actually writes. Please do not restore the breakdown: it cannot come
 * back correct until something writes `learning_state` again, and nothing does.
 */

/**
 * દર્શન health for the dashboard tile. Imported dynamically so the manifest lands in the
 * દર્શન chunk rather than the dashboard's (§51).
 */
export async function loadDarshanSummary() {
  const { loadDarshanHealth } = await import('../../darshan/services/darshanService');
  return loadDarshanHealth();
}
