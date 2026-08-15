/**
 * ક્રમાંક — settings['levels'].value.leaderboard, and the one place §13 is deliberately bent.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Read this part before changing anything here
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every table in this project is built on one sentence from §13:
 *
 *   > There is no path that reads another યુવક's row without being a સંચાલક.
 *
 * `profiles`, `progress`, `learning_state`, `level4_attempts`, `activity_attempts` and
 * `point_transactions` all carry the same policy — `user_id = auth.uid() or
 * has_permission('progress.read')` — and 0010 goes further, revoking the write privilege as
 * well so that a future mistake in a policy still cannot open a door.
 *
 * A leaderboard is, by definition, a યુવક reading other યુવકો. There is no way to build one
 * that does not cross that line, so it is crossed **once, narrowly, and on purpose**:
 *
 *   * through a single SECURITY DEFINER function and no policy change. Not one RLS policy in
 *     the project is widened by this feature; the tables stay exactly as shut as they were,
 *     and `leaderboard()` is the only aperture.
 *   * returning **a name and a number, and nothing else**. No user id — not even an opaque
 *     one — because an id is what turns a list of names into a key another request can be
 *     built around. No SMK, no મોબાઈલ, no email, no સબઝોન, no dates, no per-activity detail.
 *     A row of this list cannot be joined to anything.
 *   * only for યુવકો who have actually earned something. A list of everybody at ૦ is not a
 *     ranking, it is a directory — which is precisely the thing §13 refuses.
 *   * only while the સંચાલક has switched it on. `enabled: false` is the default and the
 *     function returns an empty list in that state, so a project that never opens this field
 *     exposes nothing at all.
 *
 * If a future change wants one more column here, the question to ask is not "is it
 * sensitive?" but "can it be used to identify or contact a યુવક, or to ask a second question
 * about him?". The answer for everything except a display name and a total is yes.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The period is the સંચાલક's, and all four exist
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Which window a ક્રમાંક is counted over is a judgement about the સાધના, not about software:
 * a daily board rewards showing up this morning, an all-time board rewards years of it, and
 * which of those a સંઘ wants to put in front of its યુવકો is the સંચાલક's call — the same
 * argument 0014 made for moving the લેવલ ૪ gate into settings, and 0018 for the slideshow.
 *
 * So all four windows are built, and he chooses which of them a યુવક may see. More than one
 * may be offered at once, in which case the page shows them as tabs; exactly one is marked
 * the default and is what opens first.
 */

/**
 * The four windows, and what each one's lower bound is.
 *
 * The bound is computed **in SQL, in IST**, never here and never on the phone — `DAY` is
 * `timezone('Asia/Kolkata', now())::date` and the other two are `date_trunc` over the same
 * expression, which is the same technique `activity_submit()` uses to decide which day an
 * attempt belongs to. A browser in another time zone, or with a wrong clock, must not be able
 * to ask for a different week than everybody else is being ranked in.
 *
 * `WEEK` is the calendar week and not "the last seven days". Postgres's `date_trunc('week')`
 * starts on Monday, which is what a યુવક means by આ અઠવાડિયે — a rolling window would move
 * the board's contents every midnight and make yesterday's rank unreproducible.
 */
export const LEADERBOARD_PERIOD = Object.freeze({
  DAY: 'DAY',
  WEEK: 'WEEK',
  MONTH: 'MONTH',
  ALL: 'ALL',
});

/** Order matters: it is the order the tabs are drawn in, narrowest window first. */
export const LEADERBOARD_PERIODS = Object.freeze([
  LEADERBOARD_PERIOD.DAY,
  LEADERBOARD_PERIOD.WEEK,
  LEADERBOARD_PERIOD.MONTH,
  LEADERBOARD_PERIOD.ALL,
]);

/** What a યુવક reads on the tab. */
export const PERIOD_LABEL = Object.freeze({
  [LEADERBOARD_PERIOD.DAY]: 'આજે',
  [LEADERBOARD_PERIOD.WEEK]: 'આ અઠવાડિયે',
  [LEADERBOARD_PERIOD.MONTH]: 'આ મહિને',
  [LEADERBOARD_PERIOD.ALL]: 'કુલ',
});

/** What the સંચાલક reads in the panel. The panel is English; the yuvak app is Gujarati. */
export const PERIOD_LABEL_EN = Object.freeze({
  [LEADERBOARD_PERIOD.DAY]: 'Today',
  [LEADERBOARD_PERIOD.WEEK]: 'This week',
  [LEADERBOARD_PERIOD.MONTH]: 'This month',
  [LEADERBOARD_PERIOD.ALL]: 'All time',
});

/**
 * The board's own heading — "Today Top 5", "All Time Top 20".
 *
 * The one string in the યુવક app that is deliberately not Gujarati, and it is a choice rather
 * than an oversight: §14 puts the whole app in Gujarati and every other word on /leaderboard
 * obeys it, but "Top 10" is how a board is titled here in speech as well as in writing, and the
 * heading was asked for in exactly those words. The number goes with it in Latin digits — the
 * tab labels, the ranks and the points all stay Gujarati (`gu()`), so the heading is a title and
 * everything under it is the app's own script.
 *
 * Separate from PERIOD_LABEL_EN and not a reuse of it, because the two are read in different
 * places and want different capitals: the panel's are field labels in a sentence ("the top 20
 * names for This week"), these are the words inside a page title, so they are title-cased. One
 * map serving both would have to be wrong for one of them.
 */
export const PERIOD_HEADING_EN = Object.freeze({
  [LEADERBOARD_PERIOD.DAY]: 'Today',
  [LEADERBOARD_PERIOD.WEEK]: 'This Week',
  [LEADERBOARD_PERIOD.MONTH]: 'This Month',
  [LEADERBOARD_PERIOD.ALL]: 'All Time',
});

/** `{ period, topN }` → the heading a યુવક reads at the top of the board. */
export const leaderboardHeading = (period, topN) =>
  `${PERIOD_HEADING_EN[period] ?? ''} Top ${topN}`.trim();

export const LEADERBOARD_KEY = 'leaderboard';

/**
 * How many names may stand on the board.
 *
 * The floor is 3 because a board of one or two is not a ranking, it is a notice about the
 * person at the top. The ceiling is 100 because this list is read on a phone on Surat mobile
 * data, and because a board naming all ~500 યુવકો is a directory again — the §13 problem this
 * whole file is written around, arriving by the back door of a large number.
 */
export const LEADERBOARD_TOP_MIN = 3;
export const LEADERBOARD_TOP_MAX = 100;

/**
 * Off, showing nothing.
 *
 * The same reasoning as DEFAULT_POINTS, and it matters more here: this is the one feature in
 * the project that shows a યુવક another યુવક's name. Turning that on because a migration ran
 * would be making a decision about somebody's સંઘ on their behalf. `periods` is empty rather
 * than holding ALL, so that even a row where `enabled` was flipped by hand without choosing a
 * window shows nothing rather than defaulting to the widest one.
 */
export const DEFAULT_LEADERBOARD = Object.freeze({
  enabled: false,
  periods: Object.freeze([]),
  defaultPeriod: LEADERBOARD_PERIOD.ALL,
  topN: 20,
});

/** What the panel pre-fills when the સંચાલક first switches the board on. */
export const SUGGESTED_LEADERBOARD = Object.freeze({
  enabled: true,
  periods: Object.freeze([LEADERBOARD_PERIOD.WEEK, LEADERBOARD_PERIOD.MONTH, LEADERBOARD_PERIOD.ALL]),
  defaultPeriod: LEADERBOARD_PERIOD.WEEK,
  topN: 20,
});

export const isPeriod = (v) => typeof v === 'string' && LEADERBOARD_PERIODS.includes(v);

const whole = (n, lo, hi) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const v = Math.round(n);
  return v < lo || v > hi ? null : v;
};

/**
 * settings['levels'].value.leaderboard → what is actually in force.
 *
 * Forgiving, like every other resolver in this project, and for a reason that is sharper here
 * than anywhere else: this runs inside a SECURITY DEFINER function that decides **whether one
 * યુવક may see another's name**. A throw would be an error on a page; a wrong `true` would be
 * a disclosure. So every branch that cannot be understood falls the same way — closed.
 *
 *   absent / not an object     → DEFAULT_LEADERBOARD. Nothing configured, nothing shown.
 *   `enabled` not exactly true → off. `=== true`, not truthiness: the stored value is jsonb,
 *                                and the string 'false' is truthy in JavaScript.
 *   `periods` not an array     → empty, which resolves to a board with no window and so no
 *                                rows. Not "fall back to ALL" — a malformed field must not
 *                                widen the window it failed to describe.
 *   an unknown period string   → that entry is dropped, the rest survive. A row written by a
 *                                later build naming a fifth window costs one tab, not the
 *                                board.
 *   duplicate periods          → de-duplicated, order taken from LEADERBOARD_PERIODS so the
 *                                tabs are always narrowest-first whatever order they were
 *                                stored in.
 *   `defaultPeriod` not among  → the first offered period. A default pointing at a tab that
 *   the offered ones             is not on screen would open the board on nothing.
 *   `topN` absent/out of range → **20, the default. Not clamped** — a stored 101 becomes 20
 *                                and not 100, and a stored 2 becomes 20 and not 3.
 *
 *                                An earlier draft of this comment said "clamped", and it was
 *                                wrong about its own code: `whole()` returns null outside the
 *                                bounds and `?? DEFAULT_LEADERBOARD.topN` supplies the
 *                                default. The behaviour is the right one and the sentence was
 *                                the mistake, so the sentence moved. It matches resolvePoints(),
 *                                where a value out of range is refused rather than quietly
 *                                becoming the nearest legal one — a number nobody chose is
 *                                worse than the number nobody configured — and `leaderboard_settings()`
 *                                in 0023 mirrors it, so all three agree.
 *
 *                                It is unreachable through the panel in any case:
 *                                validateLeaderboard() and the BEFORE trigger both refuse an
 *                                out-of-range write, so a row this has to correct can only
 *                                come from something that bypassed both.
 */
export function resolveLeaderboard(stored) {
  const s = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};

  const asked = Array.isArray(s.periods) ? s.periods : [];
  // Filtered from the canonical list rather than from the stored one, which de-duplicates and
  // imposes the tab order in a single pass.
  const periods = LEADERBOARD_PERIODS.filter((p) => asked.includes(p));

  const wanted = isPeriod(s.defaultPeriod) && periods.includes(s.defaultPeriod)
    ? s.defaultPeriod
    : periods[0] ?? DEFAULT_LEADERBOARD.defaultPeriod;

  return {
    enabled: s.enabled === true && periods.length > 0,
    periods,
    defaultPeriod: wanted,
    topN: whole(s.topN, LEADERBOARD_TOP_MIN, LEADERBOARD_TOP_MAX) ?? DEFAULT_LEADERBOARD.topN,
  };
}

/**
 * Refuses what resolveLeaderboard() would silently narrow or clamp.
 *
 * Note the asymmetry with the resolver and that it is deliberate: switching the board on with
 * no window chosen resolves to "off", but is **refused** here. A સંચાલક who ticked the box and
 * saved would otherwise be told "Saved" and then find the board dark, with nothing on the
 * screen to tell him he had not finished.
 */
export function validateLeaderboard(board) {
  const b = board && typeof board === 'object' && !Array.isArray(board) ? board : null;
  if (!b) return { ok: false, gu: 'The leaderboard setting is missing.' };

  if (typeof b.enabled !== 'boolean') {
    return { ok: false, gu: 'Leaderboard: turn it on or off before saving.' };
  }

  if (!Array.isArray(b.periods)) {
    return { ok: false, gu: 'Leaderboard: choose which periods to show.' };
  }
  for (const p of b.periods) {
    if (!isPeriod(p)) return { ok: false, gu: `Leaderboard: "${p}" is not a period.` };
  }

  const periods = LEADERBOARD_PERIODS.filter((p) => b.periods.includes(p));
  if (b.enabled && !periods.length) {
    return { ok: false, gu: 'Leaderboard: choose at least one period to show.' };
  }

  if (!isPeriod(b.defaultPeriod)) {
    return { ok: false, gu: 'Leaderboard: choose which period opens first.' };
  }
  if (periods.length && !periods.includes(b.defaultPeriod)) {
    return {
      ok: false,
      gu: `Leaderboard: "${PERIOD_LABEL_EN[b.defaultPeriod]}" opens first but is not one of the periods shown.`,
    };
  }

  const n = b.topN;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return { ok: false, gu: 'Leaderboard: enter how many names to list.' };
  }
  if (!Number.isInteger(n)) {
    return { ok: false, gu: 'Leaderboard: the number of names must be a whole number.' };
  }
  if (n < LEADERBOARD_TOP_MIN || n > LEADERBOARD_TOP_MAX) {
    return {
      ok: false,
      gu: `Leaderboard: list between ${LEADERBOARD_TOP_MIN} and ${LEADERBOARD_TOP_MAX} names.`,
    };
  }

  return { ok: true, leaderboard: { enabled: b.enabled, periods, defaultPeriod: b.defaultPeriod, topN: n } };
}

const int = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/**
 * `leaderboard()`'s jsonb → what the page renders.
 *
 * Tolerant on the way in, and it drops any row that arrives carrying more than it should.
 * That last part is not defensive habit: it is the client half of the rule at the top of this
 * file. If a future migration ever widened the function's SELECT, this would go on rendering a
 * name and a number, and the extra column would have to be added here deliberately before it
 * could reach a screen.
 */
export function normaliseLeaderboard(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const rows = Array.isArray(d.rows) ? d.rows : [];

  return {
    period: isPeriod(d.period) ? d.period : LEADERBOARD_PERIOD.ALL,
    rows: rows
      .map((r) => ({
        rank: int(Number(r?.rank)),
        name: typeof r?.name === 'string' ? r.name : '',
        points: int(Number(r?.points)),
        isMe: r?.isMe === true,
      }))
      .filter((r) => r.rank > 0),
    // Null when he has earned nothing in this window, which is a different thing from being
    // last: there is no rank to report, and the page says so in words instead of a number.
    me: d.me && typeof d.me === 'object'
      ? { rank: int(Number(d.me.rank)), points: int(Number(d.me.points)) }
      : null,
    participants: int(Number(d.participants)),
  };
}
