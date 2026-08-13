/**
 * મારી પ્રગતિ — the shape a day of સાધના takes on a screen.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The one idea this module exists to keep straight
 * ────────────────────────────────────────────────────────────────────────────
 *
 * There are **four** separate things in this system and they must never be collapsed into
 * one, because each answers a question the others cannot:
 *
 *     આજની સ્થિતિ      what he has done today          `progress`, `daily_activity_progress`
 *     પ્રયાસ            every submission, ever          `activity_attempts`, `level4_attempts`
 *     તાળું ખૂલ્યું      what he has earned permanently  `level4_activity_progress`
 *     ગુણ               what he was paid, and when      `point_transactions`
 *
 * The daily reset is a property of the *first* row only, and it is not a delete: a new IST day
 * simply has no `daily_activity_progress` row yet, so `find or create today` returns an empty
 * one while yesterday's sits untouched beside it. §25 of the brief asks for exactly this and
 * asks for it in these words — there is no cron job, and there must not be one. A job whose
 * purpose is to delete yesterday is a job that will one day delete today.
 *
 * Nothing here reaches the second, third or fourth of those through the first. In particular
 * **a new day never re-locks a કસોટી**: `level4_activity_states()` reads
 * `level4_activity_progress`, which has no date column at all, so there is no expression in
 * this codebase by which midnight could reach it. That is a structural guarantee rather than
 * a rule somebody has to remember, and it is why the unlock tables were left alone.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Pure, and why that matters here
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Everything below is a plain function of its arguments — no React, no supabase, no clock.
 * The યુવક's history page and the સંચાલક's per-user history render from the same functions,
 * so the two cannot describe the same day differently, and scripts/test-points.mjs can prove
 * the daily-reset and attempt-numbering rules without a database.
 *
 * The one thing this module must not acquire is a total. §62: no count of દ્રશ્યો lives
 * outside useScenes(). A day's `totalItems` arrives on the row, having been recorded by the
 * server at the moment of the attempt, which is also what makes an old day keep reading
 * ૮૨/૧૦૮ after the collection grows to ૧૦૯.
 */

import { ACTIVITY_KEY, ATTEMPT_STATUS } from './points.js';

/** `2026-08-13` — the same shape `activity_date` is written and compared in everywhere. */
export const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isISODay = (v) => ISO_DAY_RE.test(String(v ?? ''));

/**
 * What a યુવક reads where a row names its level.
 *
 * લેવલ ૪'s entry is the ladder's name and not a કસોટી's: a લેવલ ૪ row carries its own title
 * from `level4_activities.title`, and this is only what stands in front of it. The first three
 * have exactly one activity each, so their label is the level's.
 *
 * The names are the ones every other screen uses for the same three levels — the defaults in
 * shared/domain/settings.js and the page names in shared/domain/journey.js. They used to be a
 * third set: લેવલ ૧ was 'ધ્યાન' where the rest of the app calls it વિડિયો દર્શન, and લેવલ ૩ was
 * 'પુનરાવર્તન', which is also the name of લેવલ ૪'s revision screen — so a યુવક reading his own
 * history met the same word for two different places and no word at all for the level he does
 * every morning. One thing, one name.
 */
export const LEVEL_LABEL = Object.freeze({
  1: 'લેવલ ૧ - વિડિયો દર્શન',
  2: 'લેવલ ૨ - દર્શન',
  3: 'લેવલ ૩ - વર્ણન યાદી',
  4: 'લેવલ ૪',
});

/** What the activity itself is called, for the three levels whose activity is fixed. */
export const ACTIVITY_LABEL = Object.freeze({
  [ACTIVITY_KEY.VIDEO]: 'વિડિયો દર્શન',
  [ACTIVITY_KEY.DARSHAN]: 'દર્શન',
  [ACTIVITY_KEY.REVISION]: 'વર્ણન યાદી',
});

/**
 * The two outcomes, in the wording the rest of the app already uses.
 *
 * `થોડું બાકી` and not `નિષ્ફળ`. §1 rule 4 and the tone rules reportService.js states at
 * length: nothing in this app marks a યુવક as having failed, and a history screen — which he
 * will read more often than any other — is the last place to start. What is true is that some
 * દ્રશ્યો are still to be revised, and that is what it says.
 *
 * Plainer than the `પૂર્ણ` / `પુનરાવર્તન બાકી` these used to be: both were the register of a
 * form rather than of somebody talking, and `પુનરાવર્તન` in particular is the name of a
 * different screen. These two are read down a column of days, so they are the shortest honest
 * way to say "done" and "there is a little left" in the words a યુવક would use himself.
 */
export const STATUS_LABEL = Object.freeze({
  [ATTEMPT_STATUS.COMPLETED]: 'પૂરું થયું',
  [ATTEMPT_STATUS.REVISION_REQUIRED]: 'થોડું બાકી',
});

const int = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/**
 * One row of history, however it arrived, in the shape every screen renders.
 *
 * The server hands back snake_case from two different tables — `activity_attempts` for લેવલ
 * ૧-૩ and a view over `level4_attempts` for લેવલ ૪ — and both arrive here. Normalising in one
 * place is what lets a single `<HistoryDay>` render both without asking which it has.
 *
 * Unknown or malformed rows return null rather than a half-filled object. A history list is
 * read, never acted on, so dropping a row that cannot be understood is strictly better than
 * rendering `undefined / undefined` beside three good ones.
 */
export function normaliseHistoryRow(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const date = raw.activityDate ?? raw.activity_date;
  if (!isISODay(date)) return null;

  const levelId = Number(raw.levelId ?? raw.level_id);
  if (!Number.isInteger(levelId) || levelId < 1 || levelId > 4) return null;

  const activityKey = String(raw.activityKey ?? raw.activity_key ?? '');
  const status = raw.status === ATTEMPT_STATUS.COMPLETED
    ? ATTEMPT_STATUS.COMPLETED
    : ATTEMPT_STATUS.REVISION_REQUIRED;

  return {
    activityDate: date,
    levelId,
    activityKey,
    // લેવલ ૪ carries the કસોટી's own name; the other three fall back to the fixed label.
    title: String(raw.title ?? raw.activity_title ?? ACTIVITY_LABEL[activityKey] ?? ''),
    attemptCount: int(Number(raw.attemptCount ?? raw.attempt_count)),
    completedItems: int(Number(raw.completedItems ?? raw.completed_items)),
    totalItems: int(Number(raw.totalItems ?? raw.total_items)),
    status,
    points: int(Number(raw.points)),
  };
}

/**
 * Rows → days, newest first, each day's rows in ladder order.
 *
 * Two orderings, and both are deliberate. **Days descend** because the question a યુવક opens
 * this page with is "what did I do today", and yesterday is the second question. **Rows
 * within a day ascend by level**, because inside a day the ladder is the order he walked it
 * and a day that listed લેવલ ૪ above લેવલ ૧ would read as though he had climbed it backwards.
 *
 * Ties inside one level are broken by `activityKey`, which for લેવલ ૪ is the કસોટી code —
 * '4.1' before '4.2' — and gives a stable order for two કસોટીઓ sat on the same day. It is a
 * string comparison and so would put '4.10' before '4.2'; that is accepted, because ordering a
 * finished day's list is presentation and the code beside each row says which is which.
 */
export function groupByDate(rows) {
  const clean = (Array.isArray(rows) ? rows : []).map(normaliseHistoryRow).filter(Boolean);

  const byDate = new Map();
  for (const r of clean) {
    if (!byDate.has(r.activityDate)) byDate.set(r.activityDate, []);
    byDate.get(r.activityDate).push(r);
  }

  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([date, list]) => ({
      date,
      rows: list.sort((a, b) => a.levelId - b.levelId || (a.activityKey < b.activityKey ? -1 : 1)),
      points: list.reduce((sum, r) => sum + r.points, 0),
    }));
}

/**
 * `૮૨ / ૧૦૮`, or `૫ વાર`, or `પૂર્ણ` — what the right-hand side of a history row says.
 *
 * Which of the three a row gets is decided by what the activity actually measures, and the
 * three cases are genuinely different rather than three formats of one number:
 *
 *   * a row with items measures **coverage** — લેવલ ૩ and લેવલ ૪ both ask "how many of these
 *     do you hold", and ૮૨ of ૧૦૮ is the only honest summary of that.
 *   * a row without items measures **repetition** — લેવલ ૧ and લેવલ ૨ have nothing to count
 *     but the doing, so the count of attempts is the fact, and §5 and §6 ask for exactly that
 *     wording ("૨ વાર", "૫ વાર").
 *   * a single completed attempt with neither measures **that it happened**.
 *
 * Takes the digit-renderer as an argument rather than importing `gu()`. This module is loaded
 * by scripts/test-points.mjs, where the expected values are plainly readable as Latin digits;
 * passing the renderer keeps the assertion legible and the screen Gujarati, without this file
 * holding an opinion about either.
 */
export function summariseRow(row, digits = (n) => String(n)) {
  if (!row) return '';
  if (row.totalItems > 0) return `${digits(row.completedItems)} / ${digits(row.totalItems)}`;
  if (row.attemptCount > 1) return `${digits(row.attemptCount)} વાર`;
  return STATUS_LABEL[row.status];
}

/**
 * Today's points and every point ever, from the ledger the server hands over.
 *
 * §20 forbids deriving the lifetime figure by walking the day's UI events, and this is the
 * shape that makes that impossible to do by accident: both numbers arrive already summed, and
 * there is no path here that adds a row to a total. A missing or unreadable summary reads as
 * zero rather than throwing, because the ધ્યાન does not depend on the scoreboard.
 */
export function normalisePointSummary(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    today: int(Number(s.today ?? s.today_points)),
    total: int(Number(s.total ?? s.total_points)),
  };
}
