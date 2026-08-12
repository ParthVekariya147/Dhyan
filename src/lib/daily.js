/**
 * The IST day — §9's midnight, expressed once.
 *
 * > રાત્રે ૧૨:૦૦ (Asia/Kolkata) — લેવલ ૩ અને ૪ નાં ટિક આપોઆપ ખાલી થાય.
 *
 * Everything about લેવલ ૩/૪ hangs off "which day is it": which `progress` row a tick
 * belongs to, when the board clears, and which day the સંચાલક sees on the dashboard. A
 * UTC/IST slip does not fail loudly — it silently files 5½ hours of every evening's ધ્યાન
 * under tomorrow, and the યુવક who sat down at 19:00 on the 11th appears on the 12th with
 * a score he does not recognise. So the boundary is computed in exactly one place, by
 * exactly one technique, and proved by a test rather than trusted.
 *
 * **One technique, deliberately.** admin/src/lib/export.js does this with an explicit
 * `+05:30` suffix on a timestamp string, because it is handing bounds to Postgres.
 * Here nothing goes to Postgres as a timestamp — `progress.date` is a `date` column and
 * takes `'2026-08-11'` verbatim — so this file works entirely in fixed-offset arithmetic.
 * That matters more than it looks: `todayIST()` and `msUntilISTMidnight()` must agree to
 * the millisecond, or the rollover timer fires and the date it then computes is still
 * yesterday's. Deriving one from `Intl` and the other from arithmetic is precisely how
 * that bug is written. Both come from IST_OFFSET_MS below.
 *
 * **A fixed offset is correct here and would not be everywhere.** India has observed no
 * daylight saving since 1945 and has a single time zone; `Asia/Kolkata` is +05:30 at every
 * instant this application will ever be asked about. (The test in the report cross-checks
 * every function here against `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })`
 * across a year of instants, so the claim is verified, not assumed.)
 *
 * Nothing here reads the device's own time zone, which is the other half of the same
 * problem: a યુવક whose phone is set to UTC, or who is travelling, still gets the same
 * IST day as everybody else, because the સાધના is kept in Surat's time and not in his.
 */

/** IST is UTC+05:30, always. See the note above on why this may be a constant. */
const IST_OFFSET_MINUTES = 5 * 60 + 30;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60_000;

const DAY_MS = 86_400_000;

/** `2026-08-11` — the only shape `progress.date` is ever written or compared in. */
export const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isISODay = (v) => ISO_DAY_RE.test(String(v ?? ''));

/**
 * Today in India, as `YYYY-MM-DD`.
 *
 * Shifting the instant by the offset and then reading the *UTC* calendar date off it is
 * the whole trick: `toISOString()` is defined to render UTC, so a clock moved forward by
 * 5½ hours renders the Indian calendar date. `getDate()` would have read the *device's*
 * calendar instead and quietly disagreed on a phone set to another zone.
 *
 * `now` is injectable so the day boundary is testable at a chosen instant — the one bug
 * class here is a half-hour or half-day off, and that cannot be caught by waiting.
 */
export function todayIST(now = Date.now()) {
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * How long until the ticks clear (§9).
 *
 * Returned rather than a wall-clock time, because the only caller is a `setTimeout` that
 * has to survive a phone that was asleep: a timer set for "23:59:59" is meaningless after
 * a four-hour suspend, whereas "how much longer from now" is re-askable at any moment and
 * is exactly what the visibility handler re-asks on waking.
 *
 * Never returns 0. At the instant of midnight the answer is a whole further day, which is
 * the honest answer — the day that just began has 24 hours left, and a 0 would spin a
 * timer that re-fires immediately.
 */
export function msUntilISTMidnight(now = Date.now()) {
  const intoDay = (((now + IST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  return DAY_MS - intoDay;
}

/**
 * `n` days from an IST date, still `YYYY-MM-DD` — used for "ગઈકાલે" and nothing more.
 *
 * `Date.UTC` here is calendar arithmetic, never an instant: it is only being asked what
 * day follows 11 August, which has the same answer in every zone. String maths would get
 * month ends and leap years wrong; this does not.
 */
export function shiftISODay(ymd, days) {
  if (!isISODay(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
