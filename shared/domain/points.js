/**
 * settings['levels'].value.points — what a finished activity is worth.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this is a settings key and not a `point_rules` table
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Because 0014 already made this decision once, in the other direction, and it was right.
 *
 * લેવલ ૪'s gate began life as two columns on `level4_configs` — `require_gate` and
 * `gate_threshold` — and 0014 moved it into `settings['levels'].value.level4Gate` because a
 * number the સંચાલક adjusts is configuration, not content, and content in this project is
 * versioned, publishable and freezable. A gate that lived on a frozen configuration could not
 * be changed without cutting a new version of લેવલ ૪, which is absurd for a number somebody
 * wants to nudge from ૮૦ to ૭૫ on a Tuesday.
 *
 * Point values are the same kind of number, and would inherit the same problem in a sharper
 * form: a `point_rules` row keyed by `level4_activities.id` is keyed by a **uuid that changes
 * every time the સંચાલક republishes**, because `level4_clone_config()` writes new activity
 * rows. Every rule would silently orphan itself on the next publication, and the ledger would
 * go on paying the old number or nothing at all, with no screen able to say which.
 *
 * So લેવલ ૪'s half of this map is keyed by `code` — '4.1', '4.2' — which is what
 * `level4_activities.code` actually promises to keep stable across configurations
 * (0010:118, `^[0-9]+\.[0-9]+$`, unique per config). A કસોટી that is ૪.૧ in version 3 is ૪.૧
 * in version 4, and that is the identity a point value belongs to.
 *
 * What the settings row buys, all of it already built and none of it written here:
 *
 *   * one RLS policy — "settings writable by permission", `settings.update` (0004:648)
 *   * one audit trigger — `audit_setting()` files this as LEVEL_UPDATED (0004:436)
 *   * one validation shape — a resolver that forgives and a validator that refuses, mirrored
 *     into SQL by a BEFORE trigger, exactly as 0018 does for the slideshow
 *   * one read the યુવક app is already making — `useLevels()` fetches this row anyway
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The rule that makes points un-farmable, and where it is enforced
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **A યુવક earns an activity's points at most once per business day.**
 *
 * This is not a nicety. Since 0017 an unlocked કસોટી may be sat again without limit, and
 * લેવલ ૩ may be submitted as often as he likes, so "points per completed attempt" would pay
 * a યુવક ૩૦૦ for pressing નોંધાવો eleven times. The brief's §18 asks for exactly this
 * property and asks for it in the database rather than the browser, so the guarantee is a
 * unique index on `(user_id, activity_date, level_id, activity_key)` over the ledger, and not
 * a check in any of this code.
 *
 * The direction that follows from it and is worth stating plainly: a **failed** attempt earns
 * nothing and does not consume the day's award. A યુવક who reaches ૯૬/૧૦૮ this morning and
 * ૧૦૮/૧૦૮ this afternoon is paid once, this afternoon — §23's own worked example, where
 * attempt #2 earns +0 and attempt #3 earns +300.
 *
 * Nothing here revokes an award. §1 rule 4 — a ધ્યાન already done is never taken away — and a
 * ledger row, once written, is history. Lowering the configured value tomorrow changes what
 * tomorrow pays and cannot reach back, because the ledger stores the number that was paid
 * rather than a pointer to the rule that decided it.
 */

/** The key inside `settings['levels'].value`. */
export const POINTS_KEY = 'points';

/**
 * Zero to ten thousand, per activity.
 *
 * The floor is 0 and is meant: a સંચાલક who wants a level to count for nothing while still
 * being practised has said something coherent, and forcing him to 1 would make him express it
 * by switching the whole system off instead. `enabled: false` is the switch for that, and it
 * is a different sentence.
 *
 * The ceiling is arbitrary and admitted to be. It exists so a mistyped ૩૦૦૦૦૦ is refused at
 * the field rather than quietly making every other level worthless, and it is high enough
 * that no honest configuration will ever meet it.
 */
export const POINT_MIN = 0;
export const POINT_MAX = 10_000;

/**
 * The four levels, and the one activity key each of the first three has.
 *
 * લેવલ ૪ is absent from this list on purpose: its activities are rows the સંચાલક creates, so
 * its keys are `level4_activities.code` and cannot be enumerated here. `pointsFor()` takes
 * them as an argument instead.
 *
 * These strings are stored in `activity_attempts.activity_key` and in the ledger, so they are
 * an identity and not a label. Renaming one is a migration, which is why they are short,
 * English, and describe the act rather than the screen — 'darshan' stays correct if the
 * દર્શન page is rewritten, where 'feed' would not.
 */
export const ACTIVITY_KEY = Object.freeze({
  /** લેવલ ૧ — the પ્રવેશદ્વાર's two answers. There is no video event; see the header of src/lib/history.js. */
  VIDEO: 'video',
  /** લેવલ ૨ — one દર્શન carried through to the last દ્રશ્ય. */
  DARSHAN: 'darshan',
  /** લેવલ ૩ — one નોંધાવો, carrying the ticked દ્રશ્યો. */
  REVISION: 'revision',
});

/** Which level each key belongs to. The pair is what the ledger's unique index is built on. */
export const ACTIVITY_LEVEL = Object.freeze({
  [ACTIVITY_KEY.VIDEO]: 1,
  [ACTIVITY_KEY.DARSHAN]: 2,
  [ACTIVITY_KEY.REVISION]: 3,
});

/**
 * What an attempt came to.
 *
 * The same two words `level4_activity_progress` already uses (0010:190-191), deliberately, so
 * one history screen can render a લેવલ ૩ attempt and a લેવલ ૪ attempt in the same column
 * without translating between two vocabularies. IN_PROGRESS is not here: an attempt is a
 * submission, and a submission has always already happened.
 */
export const ATTEMPT_STATUS = Object.freeze({
  COMPLETED: 'COMPLETED',
  REVISION_REQUIRED: 'REVISION_REQUIRED',
});

/**
 * Points off, and every level worth nothing.
 *
 * The default is deliberately **not** the brief's ૧૦૦/૨૦૦/૩૦૦. A project that deploys this
 * work and never opens the field should see the app it had yesterday, and the app it had
 * yesterday had no points at all — turning a scoring system on for two thousand યુવકો because
 * a migration ran is precisely the kind of surprise DEFAULT_SLIDESHOW's six seconds exists to
 * avoid. The panel offers ૧૦૦/૨૦૦/૩૦૦ as the value it pre-fills when the સંચાલક switches the
 * system on, which is where a suggestion belongs.
 */
export const DEFAULT_POINTS = Object.freeze({
  enabled: false,
  level1: 0,
  level2: 0,
  level3: 0,
  level4: Object.freeze({ default: 0 }),
});

/** What the panel pre-fills the moment the સંચાલક first switches points on. The brief's numbers. */
export const SUGGESTED_POINTS = Object.freeze({
  enabled: true,
  level1: 100,
  level2: 200,
  level3: 300,
  level4: Object.freeze({ default: 100 }),
});

/** `4.1`, `4.12`, `10.3` — `level4_activities.code`'s own shape (0010:118). */
export const ACTIVITY_CODE_RE = /^[0-9]+\.[0-9]+$/;

/**
 * A whole number inside the bounds, or null.
 *
 * `typeof`, never `Number()`. This is the rule every resolver in shared/domain/settings.js
 * argues for and it is load-bearing in the same way here: `Number(null)`, `Number('')` and
 * `Number([])` are all 0, so a coercing check turns "nothing configured" into a real,
 * awardable zero — and, worse, turns the string '300' into 300 while the SQL mirror's
 * `jsonb_typeof(...) = 'number'` refuses it. The panel and the ledger would then disagree
 * about what a level is worth, which is the one disagreement a points system may not have.
 */
function whole(n) {
  return bounded(n, POINT_MIN, POINT_MAX);
}

/**
 * The same rule, over a bound the caller names.
 *
 * `whole()` is this function with the point bounds already applied, and every 0031 field below
 * is this function with its own pair — because the fields do not share a ceiling. A daily limit
 * of ૧૦૦૦ repeats and a daily cap of ૧,૦૦,૦૦૦ ગુણ are different quantities that happen to be
 * stored side by side, and giving them one bound would either let a limit of ૯૯૯૯ through or
 * refuse a cap the સંચાલક is entitled to set. 0031 states each pair separately for the same
 * reason (`between 0 and 1000`, `between 0 and 100000`), and this is that statement's mirror.
 */
function bounded(n, min, max) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const v = Math.round(n);
  if (v < min || v > max) return null;
  return v;
}

/** An object the stored jsonb could actually have been, or null. Arrays are not objects here. */
function plainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

/**
 * settings['levels'].value.points → the values actually in force.
 *
 * Forgiving, in the shape resolveLevel4Gate() and resolveSlideshow() established. Every way
 * the stored jsonb can be wrong ends at a map the server can award from, because this runs
 * inside a SECURITY DEFINER function on the submit path: a throw here would reach a યુવક as a
 * failed નોંધાવો for a mistake the સંચાલક made in a field he cannot see.
 *
 * Which way each branch falls:
 *
 *   absent / not an object    → DEFAULT_POINTS. Nothing has been configured, and nothing is
 *                               paid. Never SUGGESTED_POINTS — a default that pays is a
 *                               scoring system nobody switched on.
 *   `enabled` not exactly     → treated as off. Unlike the લેવલ ૪ gate, whose absent value
 *   JSON true                   means "required", the safe direction here is *not* to pay.
 *   a level value that is     → 0 for that level only. One malformed field does not take the
 *   not a number                other three down with it, because a partially-typed row is
 *                               ordinary and a silent total blackout is not.
 *   out of range              → 0, not clamped. This differs from the slideshow on purpose:
 *                               clamping a dwell of 90 to 60 still gives a slideshow, but
 *                               clamping a mistyped 300000 to 10000 pays a number nobody
 *                               chose. Refusing to pay is the only answer that cannot be
 *                               wrong in the સંચાલક's favour by accident.
 *   `level4` not an object    → `{ default: 0 }`.
 *   a level4 key that is not  → dropped. A stray key cannot be a કસોટી, so it cannot be
 *   an activity code            worth anything.
 */
export function resolvePoints(stored) {
  const s = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};

  const raw4 = s.level4 && typeof s.level4 === 'object' && !Array.isArray(s.level4) ? s.level4 : {};
  const level4 = { default: whole(raw4.default) ?? 0 };
  for (const [code, v] of Object.entries(raw4)) {
    if (code === 'default' || !ACTIVITY_CODE_RE.test(code)) continue;
    const n = whole(v);
    if (n !== null) level4[code] = n;
  }

  return {
    // `=== true`, not truthiness: the stored value is jsonb, and a string 'false' is truthy.
    enabled: s.enabled === true,
    level1: whole(s.level1) ?? 0,
    level2: whole(s.level2) ?? 0,
    level3: whole(s.level3) ?? 0,
    level4,
  };
}

/**
 * What this activity is worth right now, as a number the ledger can store.
 *
 * The single lookup, used by the panel to show a figure and mirrored into SQL by
 * `point_value_for()` so the server awards the same number the panel promised. Two rules:
 *
 *   * `enabled: false` is worth 0 everywhere. Switching the system off must not require
 *     blanking four fields, and must not leave a half-off state where લેવલ ૩ still pays.
 *   * an unlisted કસોટી falls to `level4.default`. The સંચાલક creates activities whenever he
 *     likes; a new ૪.૫ that nobody has priced yet is worth what લેવલ ૪ is worth, not nothing.
 *     A zero there would look identical to a deliberate "this one is free", and he would have
 *     no way to tell which he was looking at.
 *
 * @param {object} resolved  the output of resolvePoints(), never the raw stored value
 * @param {number} levelId   1, 2, 3 or 4
 * @param {string} [code]    `level4_activities.code`, for levelId 4 only
 */
export function pointsFor(resolved, levelId, code = '') {
  const p = resolved || DEFAULT_POINTS;
  if (!p.enabled) return 0;
  if (levelId === 1) return p.level1 ?? 0;
  if (levelId === 2) return p.level2 ?? 0;
  if (levelId === 3) return p.level3 ?? 0;
  if (levelId !== 4) return 0;
  const four = p.level4 || {};
  const named = four[code];
  return typeof named === 'number' ? named : four.default ?? 0;
}

/**
 * Refuses what resolvePoints() would silently zero.
 *
 * The resolver/validator split settings.js draws, for the reason it gives: a stored row must
 * always yield an awardable map, but a સંચાલક typing '300' into a field should be told it is
 * text rather than watch લેવલ ૩ quietly stop paying. A value this accepts is a value the
 * resolver returns unchanged, and that equivalence is what keeps the panel's fields and the
 * ledger's awards the same numbers.
 *
 * Messages name the bound, because `saveError()` puts this text in front of the સંચાલક and a
 * message that says only "invalid" is a message he works around.
 */
export function validatePoints(points) {
  const p = points && typeof points === 'object' && !Array.isArray(points) ? points : null;
  if (!p) return { ok: false, gu: 'The points setting is missing.' };

  if (typeof p.enabled !== 'boolean') {
    return { ok: false, gu: 'Points: turn the system on or off before saving.' };
  }

  const out = { enabled: p.enabled, level1: 0, level2: 0, level3: 0, level4: { default: 0 } };

  for (const [field, label] of [
    ['level1', 'Level 1'],
    ['level2', 'Level 2'],
    ['level3', 'Level 3'],
  ]) {
    const n = p[field];
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      return { ok: false, gu: `${label} points: enter a number.` };
    }
    if (!Number.isInteger(n)) {
      return { ok: false, gu: `${label} points: enter a whole number.` };
    }
    if (n < POINT_MIN || n > POINT_MAX) {
      return { ok: false, gu: `${label} points: between ${POINT_MIN} and ${POINT_MAX}.` };
    }
    out[field] = n;
  }

  const four = p.level4;
  if (!four || typeof four !== 'object' || Array.isArray(four)) {
    return { ok: false, gu: 'Level 4 points: expected a value for each activity.' };
  }

  for (const [code, v] of Object.entries(four)) {
    const isDefault = code === 'default';
    if (!isDefault && !ACTIVITY_CODE_RE.test(code)) {
      return { ok: false, gu: `Level 4 points: "${code}" is not an activity code like 4.1.` };
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { ok: false, gu: `Level ${isDefault ? '4 default' : code} points: enter a number.` };
    }
    if (!Number.isInteger(v)) {
      return { ok: false, gu: `Level ${isDefault ? '4 default' : code} points: enter a whole number.` };
    }
    if (v < POINT_MIN || v > POINT_MAX) {
      return { ok: false, gu: `Level ${isDefault ? '4 default' : code} points: between ${POINT_MIN} and ${POINT_MAX}.` };
    }
    out.level4[code] = v;
  }

  if (typeof four.default !== 'number') {
    return { ok: false, gu: 'Level 4 points: set a default for activities with no value of their own.' };
  }

  return { ok: true, points: out };
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * 0031's keys — repeat, tick, limits, effective date, disabled, version
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Everything above this line is 0021's question — *what is one activity worth* — and none of it
 * changes. What follows answers three questions 0021's ledger could not express at all, because
 * its unique key was `(user_id, activity_date, level_id, activity_key)` and so one યુવક, one IST
 * day, one activity was one row and one number:
 *
 *   * a **second** pass of ૪.૧ on the same day, worth its own smaller figure
 *   * a લેવલ ૩ પુનરાવર્તન paid per દ્રશ્ય newly brought to mind, several times a day
 *   * a rule the સંચાલક has switched off, or has not switched on yet
 *
 * 0031 makes those representable, and the authority for every branch below is that migration:
 * `point_rules()` (0031:208) is what `resolvePointRules()` mirrors, `point_rule_live()`
 * (0031:321) is what `isPointRuleLive()` mirrors, and `settings_check_points()` (0031:736) is
 * what `validatePointRules()` mirrors. Where this file and that file could disagree, that file
 * is right: it is the one the ledger obeys.
 *
 * Two properties hold across all of it, and they are the reason the panel can be deployed a
 * week after the migration rather than with it:
 *
 *   1. **Every key is optional, and absent means yesterday.** An untouched settings row resolves
 *      to DEFAULT_POINT_RULES, and DEFAULT_POINT_RULES is *by construction* the behaviour of
 *      0021 — no repeat, no tick mode, no cap, no date, nothing switched off. Turning a scoring
 *      rule on because a migration ran is the surprise DEFAULT_POINTS already refuses to be.
 *   2. **`resolvePoints()` is untouched.** The new keys are read by a second resolver, exactly
 *      as 0031 adds a second SQL function rather than widening `point_settings()`, and for the
 *      same reason: the price of a level and the shape of a repeat rule are separate questions,
 *      and widening the first to answer the second means re-verifying a mirror that was right.
 *
 * A note on where `byCode` lives, because it looks like a mistake and is not. The per-કસોટી
 * repeat overrides are read from `repeat`'s **own** keys — `{ repeat: { enabled: true,
 * default: 50, '4.1': 25 } }` — and gathered into `repeat.byCode` on the way out (0031:271-280).
 * The stored shape is flat because that is what a form posts and what the doc's rule set shows;
 * the resolved shape is nested because `enabled`, `default` and `dailyLimit` are not કસોટીઓ and
 * must never be mistaken for one. `ACTIVITY_CODE_RE` is what tells them apart, and it is the
 * whole separation: none of those three names can match `^[0-9]+\.[0-9]+$`.
 */

/**
 * The three ways લેવલ ૩ can be paid, and only one of them is a stack of nothing.
 *
 * ACTIVITY is 0021: one flat `level3` for the day, however many times he pressed નોંધાવો. TICK
 * pays per દ્રશ્ય newly brought to mind. REVISION pays per submission. They are a **choice**,
 * never a sum — §12 offers "per tick OR per revision OR another rule", and `award_points()`
 * takes the tick branch and returns from it (0031:502-563) rather than falling through to the
 * flat one, because a યુવક paid ૩૦૦ for the day *and* ૧ per તિક has been paid twice for one act
 * under two names.
 *
 * ACTIVITY is the fallback for everything unrecognised, which is what makes an unconfigured
 * project keep the awarding it had.
 */
export const TICK_MODE = Object.freeze({
  ACTIVITY: 'ACTIVITY',
  TICK: 'TICK',
  REVISION: 'REVISION',
});

/**
 * How many repeat awards one યુવક may collect in one day. 0 is "no limit", not "none".
 *
 * The floor reads as no-limit rather than as no-repeats because `repeat.enabled` is already the
 * switch, and a project that has said "repeats are on" and left the limit blank has asked for
 * repeats rather than for silence. The ceiling is a thousand for the same admitted reason
 * POINT_MAX is ten thousand: it exists so a mistyped figure is refused at the field, and no
 * honest configuration will meet it.
 */
export const REPEAT_DAILY_LIMIT_MIN = 0;
export const REPEAT_DAILY_LIMIT_MAX = 1_000;

/**
 * The most લેવલ ૩ may pay one યુવક in one day under a tick rule. 0 is "no cap".
 *
 * Ten times POINT_MAX, deliberately: a per-તિક rule multiplies a small number by however many
 * દ્રશ્યો the collection holds, so the sum it produces is of a different order from any single
 * award and a shared ceiling would make the cap unusable. `award_points()` reads the day's
 * spend from the ledger rather than counting it in the caller (0031:542-554), so two phones
 * submitting at once cannot spend the same headroom twice.
 */
export const TICK_DAILY_CAP_MIN = 0;
export const TICK_DAILY_CAP_MAX = 100_000;

/**
 * The rule revision stamped on every new award, as `point_transactions.rule_version`.
 *
 * It is a label and never a pointer: the ledger still stores the number that was paid (0021),
 * so raising this cannot reprice one historical row. It exists so a સંચાલક reading an award of
 * ૫૦ can tell which revision of the rules decided it.
 *
 * RULE_VERSION_MAX is int4's ceiling and **both mirrors enforce it**, which was not true of the
 * first draft of this module and is worth recording why it changed.
 *
 * The draft refused to invent a bound the server did not state: `settings_check_points()` then
 * accepted any whole number of 0 or more, and a validator refusing what the server accepts gives
 * a સંચાલક a field he cannot use and cannot find out why. The reasoning was right and the premise
 * was wrong — the server's silence was a defect, not a decision. `point_rules()` resolves this
 * field with `round(...)::integer` (0031:236-238), so a stored trillion saved happily and then
 * made every later call to `point_rules()` raise `integer out of range`; that function is on the
 * award path for every level through `point_rule_live()` and `award_points()`, so one number
 * typed into one field stopped the whole project being paid, for everybody.
 *
 * 0031 now states the ceiling (0031:832-843) and this mirrors it. The general rule, which is the
 * part worth carrying to the next field: **a bound the validator enforces must be inside the
 * range of the type the resolver casts to**, or the resolver's forgiveness is a raise.
 */
export const RULE_VERSION_MIN = 0;
export const RULE_VERSION_MAX = 2_147_483_647;

/**
 * `effectiveFrom`'s shape, which is `activity_date`'s shape.
 *
 * The same pattern as `ISO_DAY_RE` in shared/domain/history.js and deliberately *not* imported
 * from it: this module has no imports, and a domain module that reaches sideways for a regex
 * acquires a dependency graph. Duplicating four tokens is cheaper than that, and both copies
 * are checked against 0031's own `'^\d{4}-\d{2}-\d{2}$'` by scripts/test-point-rules.mjs.
 *
 * Y-M-D is load-bearing beyond validation: two days in this shape compare correctly as strings,
 * which is how `isPointRuleLive()` can answer a date question without a Date object, a timezone
 * or a clock.
 */
export const EFFECTIVE_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Is this string a **real day**, and not merely a string shaped like one?
 *
 * `EFFECTIVE_DAY_RE` answers a question about shape, and '2026-13-45' passes it. The calendar is
 * not a regular language — leap years alone defeat any pattern — so the check has to construct
 * the date and read it back. A month or day that does not exist rolls over into the next one, and
 * a value that rolled is a value that was never a day.
 *
 * This matters beyond tidiness, and the reason is the same one the version ceiling carries:
 * `point_rule_live()` casts `effectiveFrom` with `::date` on **every award** (0031:330), so a
 * stored non-day raises 22008 for every submission at every level, for everybody. 0031 now
 * refuses it in `settings_check_points()` and this is that refusal's mirror.
 *
 * `setUTCFullYear` rather than `Date.UTC(y, …)`, because that constructor maps years 0-99 into
 * the 1900s and would quietly accept '0001-01-01' as 1901.
 */
function isRealDay(s) {
  const m = EFFECTIVE_DAY_RE.exec(s);
  if (!m) return false;

  const y = Number(s.slice(0, 4));
  const mo = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;

  const probe = new Date(0);
  probe.setUTCFullYear(y, mo - 1, d);
  probe.setUTCHours(0, 0, 0, 0);

  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d
  );
}

/**
 * `level1` … `level4` — the other kind of thing `disabled` may name.
 *
 * Disabling accepts an activity code ('4.3') or a whole ladder ('level2'), so a સંચાલક can stop
 * one કસોટી or all of લેવલ ૨ without blanking values he would then have to retype. 1 to 4 only:
 * 'level0' is what `point_rule_live()` computes for a manual adjustment, which belongs to no
 * level and must not be switchable off by hand.
 */
export const DISABLED_LEVEL_RE = /^level[1-4]$/;

/**
 * How often one activity may be paid — 0033's `earn` block.
 *
 * This is the setting that decides whether a યુવક who does દર્શન five times in one afternoon is
 * paid once or five times, so it is worth being exact about what each mode means and why the
 * default is the one it is.
 *
 *   DAY_FIRST  at most one award per (યુવક, IST day, level, activity). 0021's rule, and the
 *              **default for every level when the key is absent**, so a settings row nobody has
 *              touched keeps paying precisely what it paid before 0033 existed. It is not a
 *              timid default: attempts have been unlimited since 0017, so without a ceiling of
 *              some kind points are farmable by pressing the same button again (0021:274-308).
 *   EVERY      every valid submission earns, deduplicated on the attempt id so that a *retry*
 *              of one submission still pays once while a genuinely new one pays again. This is
 *              the mode that makes "5 દર્શન = 5 × 200" true.
 *   ONCE       once per (યુવક, level, activity), ever.
 *
 * The choice is the સંચાલક's and the code assumes none of them — which is the whole point of
 * the key existing rather than the rule being written into a function.
 */
export const EARN_MODE = Object.freeze({
  DAY_FIRST: 'DAY_FIRST',
  EVERY: 'EVERY',
  ONCE: 'ONCE',
});

/**
 * What a લેવલ ૩ tick is counted against.
 *
 *   FRESH  only દ્રશ્યો not already counted for that યુવક that day. Today's behaviour: a યુવક
 *          who submits the same ૧૦૮ five times has brought ૧૦૮ to mind, not ૫૪૦, and the ledger
 *          would otherwise describe a day that did not happen.
 *   ALL    every valid tick submitted, every time.
 *
 * FRESH is the default for the same reason DAY_FIRST is.
 */
export const TICK_COUNT = Object.freeze({ FRESH: 'FRESH', ALL: 'ALL' });

/** What a milestone rule counts (0033's `point_bonus_rules.trigger_type`). */
export const BONUS_TRIGGER = Object.freeze({
  COMPLETION_COUNT: 'COMPLETION_COUNT',
  ITEM_COUNT: 'ITEM_COUNT',
  POINT_TOTAL: 'POINT_TOTAL',
});

/**
 * How often a milestone rule pays (0033's `point_bonus_rules.reward_mode`).
 *
 *   EVERY         a bonus at every multiple of the threshold — 5th, 10th, 15th …
 *   FIRST_ONLY    only the first time the threshold is reached, ever.
 *   HIGHEST_ONLY  of the rules matching one scope, only the highest threshold reached pays.
 *
 * The third is the one whose name does not carry its meaning, and it is the reason this is a
 * setting at all: the brief asks for "cumulative OR highest milestone only" to be the સંચાલક's
 * choice rather than an assumption compiled into a function.
 */
export const BONUS_MODE = Object.freeze({
  EVERY: 'EVERY',
  FIRST_ONLY: 'FIRST_ONLY',
  HIGHEST_ONLY: 'HIGHEST_ONLY',
});

export const BONUS_THRESHOLD_MIN = 1;
export const BONUS_THRESHOLD_MAX = 100_000;
export const BONUS_POINTS_MIN = -10_000;
export const BONUS_POINTS_MAX = 10_000;

/** `earn`, for a settings row that has never heard of 0033. */
export const DEFAULT_EARN = Object.freeze({
  level1: EARN_MODE.DAY_FIRST,
  level2: EARN_MODE.DAY_FIRST,
  level3: EARN_MODE.DAY_FIRST,
  level4: EARN_MODE.DAY_FIRST,
  tickCount: TICK_COUNT.FRESH,
});

/**
 * What `point_rules()` returns for a settings row that has never heard of 0031.
 *
 * This object *is* the "absent means today's behaviour" contract, written down. Every field is
 * the reading that reproduces 0021 exactly: version 0 stamps nothing new, a null date means
 * every day is on or after it, an empty `disabled` switches nothing off, a repeat rule that is
 * off pays no second pass, and ACTIVITY mode pays લેવલ ૩ its flat value once a day.
 *
 * Deep-frozen, unlike a resolver's output, because this one is shared: it is what `pointsFor()`'s
 * neighbours fall back to when a caller has no resolved rules at hand, and a fallback that can
 * be edited by the first caller who mutates it is a fallback for nobody.
 */
export const DEFAULT_POINT_RULES = Object.freeze({
  version: 0,
  effectiveFrom: null,
  disabled: Object.freeze([]),
  repeat: Object.freeze({
    enabled: false,
    default: 0,
    dailyLimit: 0,
    byCode: Object.freeze({}),
  }),
  tick: Object.freeze({
    mode: TICK_MODE.ACTIVITY,
    perTick: 0,
    perRevision: 0,
    dailyCap: 0,
  }),
  // 0033. Absent means DAY_FIRST at every level and FRESH ticks, which is 0021's behaviour and
  // therefore changes nothing on the day 0033 deploys.
  earn: DEFAULT_EARN,
});

/**
 * settings['levels'].value.points → the 0031 rules actually in force.
 *
 * `point_rules()`'s mirror (0031:208-304), branch for branch, and forgiving for the reason
 * `resolvePoints()` is forgiving and one more. The reason it shares: this runs on the submit
 * path inside a SECURITY DEFINER function, so a throw reaches a યુવક as a failed નોંધાવો for a
 * mistake the સંચાલક made in a field he cannot see. The reason it adds: these keys did not exist
 * last week, so *every* row in the wild is missing all of them, and "missing" cannot be an
 * error condition without breaking every project that has not opened the new panel.
 *
 * Which way each branch falls, and why that direction and not the other:
 *
 *   absent / not an object    → DEFAULT_POINT_RULES, which is 0021's behaviour.
 *   `version` not a number    → 0. A negative one is **clamped** to 0 rather than refused,
 *                               which is the one place these keys clamp: a version is a label
 *                               on a row and cannot pay anybody, so the worst a wrong one does
 *                               is mislabel, and 0 is the honest label for "unknown".
 *   `effectiveFrom` malformed → null, meaning in force since forever. "Not yet in force" would
 *                               stop every award in the project on a typo, and stopping awards
 *                               is the failure nobody notices until a week has passed.
 *   `disabled` not an array   → []. Nothing is switched off, because a rule the સંચાલક has not
 *                               managed to express is not a rule the ledger should act on.
 *   a non-string element      → dropped. `point_rule_live()` compares strings; a number 4 in
 *                               that list could only ever mean nothing.
 *   `repeat.enabled` not      → off. Same direction as `points.enabled` and for the same
 *   exactly JSON true           reason: the stored value is jsonb and the string 'false' is
 *                               truthy, so a truthiness test starts paying repeats because
 *                               somebody's form serialised a checkbox as text.
 *   a number out of range     → 0, never clamped, for the reason resolvePoints() gives at
 *                               length: a mistyped ૩૦૦૦૦૦ clamped to ૧૦૦૦૦ pays a figure nobody
 *                               chose. Refusing to pay cannot be wrong in the સંચાલક's favour.
 *   a `byCode` value out of   → dropped entirely rather than zeroed, so `repeatValueFor()` falls
 *   range                       through to `repeat.default` — which is a number somebody did
 *                               choose — instead of quietly pricing that કસોટી at nothing.
 *   `tick.mode` unrecognised  → ACTIVITY. The only fallback that keeps લેવલ ૩ paying what it
 *                               paid yesterday.
 *
 * @param {unknown} stored  settings['levels'].value.points, exactly as it came back
 */
export function resolvePointRules(stored) {
  const s = plainObject(stored) ?? {};
  const rep = plainObject(s.repeat) ?? {};
  const tk = plainObject(s.tick) ?? {};

  // Per-કસોટી overrides, read from `repeat`'s own keys (0031:271-280). `enabled`, `default` and
  // `dailyLimit` are excluded by the regex alone and need no naming here — none of the three can
  // look like '4.1' — which is why a fourth reserved key added later cannot leak in either.
  const byCode = {};
  for (const [code, v] of Object.entries(rep)) {
    if (!ACTIVITY_CODE_RE.test(code)) continue;
    const n = bounded(v, POINT_MIN, POINT_MAX);
    if (n !== null) byCode[code] = n;
  }

  const from = typeof s.effectiveFrom === 'string' && EFFECTIVE_DAY_RE.test(s.effectiveFrom)
    ? s.effectiveFrom
    : null;

  const disabled = [];
  if (Array.isArray(s.disabled)) {
    for (const e of s.disabled) if (typeof e === 'string') disabled.push(e);
  }

  const mode = typeof tk.mode === 'string' && Object.values(TICK_MODE).includes(tk.mode)
    ? tk.mode
    : TICK_MODE.ACTIVITY;

  // 0033's earning modes. An unrecognised mode falls to DAY_FIRST rather than to the most
  // generous reading: a typo in a settings row must not quietly start paying five times a day.
  const tkc = plainObject(s.earn) ?? {};
  const oneMode = (v) =>
    typeof v === 'string' && Object.values(EARN_MODE).includes(v) ? v : EARN_MODE.DAY_FIRST;
  const earn = {
    level1: oneMode(tkc.level1),
    level2: oneMode(tkc.level2),
    level3: oneMode(tkc.level3),
    level4: oneMode(tkc.level4),
    tickCount:
      typeof tkc.tickCount === 'string' && Object.values(TICK_COUNT).includes(tkc.tickCount)
        ? tkc.tickCount
        : TICK_COUNT.FRESH,
  };

  return {
    // `greatest(0, round(...))` — clamped, not refused, and with no ceiling. See the branch
    // table above for the first, RULE_VERSION_MAX's own comment for the second.
    version: typeof s.version === 'number' && Number.isFinite(s.version)
      ? Math.max(RULE_VERSION_MIN, Math.round(s.version))
      : RULE_VERSION_MIN,
    effectiveFrom: from,
    disabled,
    repeat: {
      // `= 'true'::jsonb`, not truthiness.
      enabled: rep.enabled === true,
      default: bounded(rep.default, POINT_MIN, POINT_MAX) ?? 0,
      dailyLimit: bounded(rep.dailyLimit, REPEAT_DAILY_LIMIT_MIN, REPEAT_DAILY_LIMIT_MAX) ?? 0,
      byCode,
    },
    tick: {
      mode,
      perTick: bounded(tk.perTick, POINT_MIN, POINT_MAX) ?? 0,
      perRevision: bounded(tk.perRevision, POINT_MIN, POINT_MAX) ?? 0,
      dailyCap: bounded(tk.dailyCap, TICK_DAILY_CAP_MIN, TICK_DAILY_CAP_MAX) ?? 0,
    },
    earn,
  };
}

/**
 * Which milestones a યુવક has earned, given where he has got to and what has already been paid.
 *
 * Pure arithmetic, and it lives here rather than only in SQL for two reasons: the panel has to
 * be able to *show* a સંચાલક what a rule would pay before he saves it, and this is the one part
 * of the milestone engine that can be tested exhaustively without a database.
 *
 * Returns the milestone **numbers** — 1 for the first threshold reached, 2 for the second, and
 * so on — because that number is what makes an award idempotent: 0033 keys each bonus row on
 * `'bonus:' || rule_id || ':' || milestone_number`, and a unique index refuses the second write.
 * A count alone could not do that; two different counts can name the same milestone.
 *
 *   EVERY         every multiple: 12 completions against a threshold of 5 earns milestones 1 and 2
 *   FIRST_ONLY    only milestone 1, however far past it he goes
 *   HIGHEST_ONLY  only the highest reached: milestone 2 and not 1
 *
 * `alreadyPaid` is the set of milestone numbers already in the ledger for this rule. Passing it
 * makes the function answer "what is owed now", which is what a caller wants; passing nothing
 * makes it answer "what has been earned in total", which is what a preview wants.
 *
 * @param {number} count        how far the યુવક has got (completions, items or points)
 * @param {number} threshold    the rule's threshold
 * @param {string} mode         one of BONUS_MODE
 * @param {Iterable<number>} [alreadyPaid]
 * @returns {number[]} milestone numbers to pay, ascending
 */
export function milestonesEarned(count, threshold, mode, alreadyPaid = []) {
  const n = Number.isFinite(count) ? Math.floor(count) : 0;
  const t = Number.isFinite(threshold) ? Math.floor(threshold) : 0;
  if (t < BONUS_THRESHOLD_MIN || n < t) return [];

  const reached = Math.floor(n / t);
  const paid = new Set(alreadyPaid);

  let wanted;
  if (mode === BONUS_MODE.FIRST_ONLY) wanted = [1];
  else if (mode === BONUS_MODE.HIGHEST_ONLY) wanted = [reached];
  else wanted = Array.from({ length: reached }, (_, i) => i + 1);

  return wanted.filter((m) => !paid.has(m));
}

/**
 * One milestone rule, refused rather than corrected.
 *
 * The refusing half of the pair, like `validatePointRules()` beside `resolvePointRules()`, and
 * mirroring 0033's own constraints on `point_bonus_rules`. Returns the same `{ok, gu}` shape the
 * other validators in this module return, so a caller handles one convention.
 */
export function validateBonusRule(rule) {
  const r = plainObject(rule);
  if (!r) return { ok: false, gu: 'Bonus rule: nothing to save.' };

  if (typeof r.name !== 'string' || r.name.trim() === '') {
    return { ok: false, gu: 'Bonus rule: give it a name.' };
  }

  // A rule may name no level (every level) but a rule that names an activity must name the level
  // it belongs to — an activity code is only unique inside its level, and a rule scoped to '4.1'
  // with no level would have to guess which ladder that is.
  if (r.levelId !== null && r.levelId !== undefined) {
    if (!Number.isInteger(r.levelId) || r.levelId < 1 || r.levelId > 4) {
      return { ok: false, gu: 'Bonus rule: choose a level, or leave it as every level.' };
    }
  } else if (r.activityKey) {
    return { ok: false, gu: 'Bonus rule: an activity needs the level it belongs to.' };
  }

  if (!Object.values(BONUS_TRIGGER).includes(r.triggerType)) {
    return { ok: false, gu: 'Bonus rule: count completions, items or points.' };
  }

  if (!Object.values(BONUS_MODE).includes(r.rewardMode)) {
    return { ok: false, gu: 'Bonus rule: pay every milestone, the first only, or the highest only.' };
  }

  if (!Number.isInteger(r.threshold) || r.threshold < BONUS_THRESHOLD_MIN || r.threshold > BONUS_THRESHOLD_MAX) {
    return {
      ok: false,
      gu: `Bonus rule: the trigger count is between ${BONUS_THRESHOLD_MIN} and ${BONUS_THRESHOLD_MAX}.`,
    };
  }

  // Zero is refused rather than treated as "off", because a rule that pays nothing and is marked
  // enabled is a rule the સંચાલક believes is working. `enabled` is how a rule is switched off.
  if (!Number.isInteger(r.bonusPoints) || r.bonusPoints === 0) {
    return { ok: false, gu: 'Bonus rule: the bonus is a whole number and not 0.' };
  }

  if (r.bonusPoints < BONUS_POINTS_MIN || r.bonusPoints > BONUS_POINTS_MAX) {
    return {
      ok: false,
      gu: `Bonus rule: the bonus is between ${BONUS_POINTS_MIN} and ${BONUS_POINTS_MAX}.`,
    };
  }

  return { ok: true, gu: '' };
}

/**
 * Is this rule live for this business day?
 *
 * `point_rule_live()`'s mirror (0031:321-336). Two questions in one, and both are about the
 * **rule** rather than about the યુવક: had the rule set taken effect by the day being paid, and
 * has the સંચાલક switched this one off.
 *
 * The day compared is the attempt's own business day, never `now()`. A submission made at ૨૩:૫૯
 * that commits at ૦૦:૦૦ belongs to the day it was made — the same reading
 * `level4_attempts_award()` takes of `new.at` — and comparing against a clock instead would pay
 * that submission under tomorrow's rules.
 *
 * Compared as strings, because Y-M-D sorts as it dates. No Date object is constructed anywhere
 * on this path: `new Date('2026-08-14')` is midnight **UTC**, which is ૫:૩૦ on the ૧૪મી in
 * Asia/Kolkata, and a comparison built on it would move the boundary of the business day by
 * five and a half hours for everyone.
 *
 * An unusable `dayISO` does not make a rule dead. `p_date` is a `date` in SQL, so the only way
 * it can fail to be a day is by being NULL — and a NULL there makes 0031's first WHEN evaluate
 * to NULL rather than to true, so the function falls through to the disabled checks and can
 * still answer. Mirroring that means an unparseable day skips the date branch instead of
 * returning false, and the alternative would be a garbage argument silently stopping every
 * award in the project.
 *
 * @param {object} rules    the output of resolvePointRules(), never the raw stored value
 * @param {number} levelId  1-4, or 0 for something that belongs to no level
 * @param {string} [code]   `activity_key` — 'darshan', '4.1'
 * @param {string} [dayISO] the attempt's business day as YYYY-MM-DD
 */
export function isPointRuleLive(rules, levelId, code = '', dayISO = '') {
  const r = rules || DEFAULT_POINT_RULES;

  const from = typeof r.effectiveFrom === 'string' ? r.effectiveFrom : null;
  const day = typeof dayISO === 'string' ? dayISO : '';
  if (from && EFFECTIVE_DAY_RE.test(day) && day < from) return false;

  const off = Array.isArray(r.disabled) ? r.disabled : [];
  // `coalesce(p_key, '')` — an award with no activity key is asking about '', and a સંચાલક who
  // has somehow put '' in the list has switched that off.
  if (off.includes(typeof code === 'string' ? code : '')) return false;
  if (off.includes(`level${levelId ?? 0}`)) return false;

  return true;
}

/**
 * What a *second* pass of this કસોટી is worth, before the daily limit is consulted.
 *
 * 0031:593-598's mirror, and the precedence is the whole content: a named code wins, an unnamed
 * one falls to `repeat.default`, and a rule with neither is worth 0. This is the same
 * fall-through `pointsFor()` uses for the first award and it is the same argument — the સંચાલક
 * creates કસોટીઓ whenever he likes, and a new ૪.૫ nobody has priced yet is worth what a repeat
 * is worth here, not nothing. A 0 he typed on purpose still means 0, because the resolver keeps
 * a priced zero and only drops what it could not read.
 *
 * `typeof === 'number'`, so a prototype key ('toString', 'constructor') falls through to the
 * default rather than resolving to a function and pricing a કસોટી at NaN.
 *
 * It does **not** ask whether repeats are enabled, whether the rule is live, or whether the
 * day's limit is spent. Those are three separate questions with three separate answers in
 * `award_points()` (0031:589, 495, 604-615), and folding them in here would give the panel one
 * number that could not explain itself.
 *
 * @param {object} rules  the output of resolvePointRules()
 * @param {string} [code] `level4_activities.code`
 */
export function repeatValueFor(rules, code = '') {
  const rep = (rules || DEFAULT_POINT_RULES).repeat || DEFAULT_POINT_RULES.repeat;
  const named = (rep.byCode || {})[code];
  if (typeof named === 'number') return named;
  return typeof rep.default === 'number' ? rep.default : 0;
}

/**
 * Refuses what resolvePointRules() would silently correct.
 *
 * `settings_check_points()`'s 0031 half (0031:822-968), check for check and message for message,
 * as `validatePoints()` is its 0021 half. The two are meant to be called together on one object:
 * this one deliberately says nothing about `enabled` or `level1`, because a validator that
 * duplicated those checks would be a second place for them to drift.
 *
 * Every key here is **optional**, and that is the one way this differs in kind from
 * `validatePoints()`, where an absent `level1` is a malformed row. A settings row written before
 * 0031 must still save unchanged — that is what lets the panel be deployed after the migration
 * rather than with it — so absence is never an error and only a *present* key is held to its
 * bound. `undefined` is read as absence rather than as a bad value, because `undefined` is not
 * a jsonb value and cannot be what was stored.
 *
 * Messages name the bound and quote the offending key, because `saveError()` puts this text in
 * front of the સંચાલક and a message that says only "invalid" is a message he works around.
 *
 * @returns {{ok: true, rules: object} | {ok: false, gu: string}}
 *   On acceptance, `rules` is the **resolved** rule set rather than an echo of the input. This
 *   is the one place the shape departs from validatePoints(), which returns the accepted map:
 *   there, every key is mandatory, so the accepted map and the input are the same object with
 *   the strays removed. Here a perfectly valid input can be `{}`, and echoing it back would
 *   hand the caller an object that says nothing about what the server will actually apply.
 */
export function validatePointRules(rules) {
  const p = plainObject(rules);
  if (!p) return { ok: false, gu: 'The points setting is missing.' };

  // ── version ───────────────────────────────────────────────────────────────
  if (p.version !== undefined) {
    const n = p.version;
    if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n) || n < RULE_VERSION_MIN) {
      return { ok: false, gu: 'Points version: a whole number of 0 or more.' };
    }
    // The ceiling is int4's, mirroring 0031:832-843. See RULE_VERSION_MAX's own comment for why
    // it is enforced here rather than left to the server: above this the resolver's `::integer`
    // cast raises, and the resolver is on every award path in the app.
    if (n > RULE_VERSION_MAX) {
      return { ok: false, gu: `Points version: between 0 and ${RULE_VERSION_MAX}.` };
    }
  }

  // ── effectiveFrom ─────────────────────────────────────────────────────────
  //
  // An explicit null is accepted and means "in force since forever", which is what the panel
  // writes when the સંચાલક clears the field. Only a value that is *present and not null* has to
  // be a day.
  if (p.effectiveFrom !== undefined && p.effectiveFrom !== null) {
    if (typeof p.effectiveFrom !== 'string' || !EFFECTIVE_DAY_RE.test(p.effectiveFrom)) {
      return { ok: false, gu: 'Points start date: write it as YYYY-MM-DD, or leave it empty.' };
    }
    // Shape, then value. See isRealDay() for why the pattern is not enough and what a stored
    // '2026-13-45' does to every award path. Mirrors 0031's own cast-and-catch.
    if (!isRealDay(p.effectiveFrom)) {
      return { ok: false, gu: `Points start date: "${p.effectiveFrom}" is not a real date.` };
    }
  }

  // ── disabled ──────────────────────────────────────────────────────────────
  if (p.disabled !== undefined) {
    if (!Array.isArray(p.disabled)) {
      return { ok: false, gu: 'Switched-off rules: expected a list like ["4.3", "level2"].' };
    }
    for (const e of p.disabled) {
      if (typeof e !== 'string' || !(ACTIVITY_CODE_RE.test(e) || DISABLED_LEVEL_RE.test(e))) {
        return {
          ok: false,
          gu: `Switched-off rules: "${asText(e)}" is not an activity code like 4.3 or a level like level2.`,
        };
      }
    }
  }

  // ── repeat ────────────────────────────────────────────────────────────────
  if (p.repeat !== undefined) {
    const rep = plainObject(p.repeat);
    if (!rep) return { ok: false, gu: 'Repeat points: expected a value for each activity.' };

    if (rep.enabled !== undefined && typeof rep.enabled !== 'boolean') {
      return { ok: false, gu: 'Repeat points: turn repeat awards on or off before saving.' };
    }

    for (const [key, v] of Object.entries(rep)) {
      if (key === 'enabled') continue;

      const isLimit = key === 'dailyLimit';
      if (key !== 'default' && !isLimit && !ACTIVITY_CODE_RE.test(key)) {
        return { ok: false, gu: `Repeat points: "${key}" is not an activity code like 4.1.` };
      }

      const label = key === 'default' ? 'Repeat default' : isLimit ? 'Repeat daily limit' : `Repeat ${key}`;
      const bad = numberProblem(
        v,
        label,
        isLimit ? REPEAT_DAILY_LIMIT_MIN : POINT_MIN,
        isLimit ? REPEAT_DAILY_LIMIT_MAX : POINT_MAX,
        isLimit ? ' 0 means no limit.' : ''
      );
      if (bad) return { ok: false, gu: bad };
    }
  }

  // ── tick ──────────────────────────────────────────────────────────────────
  if (p.tick !== undefined) {
    const tk = plainObject(p.tick);
    if (!tk) return { ok: false, gu: 'Level 3 rule: expected a mode and its values.' };

    // A null mode is an absent mode, and resolves to ACTIVITY. 0031 accepts it too, though by
    // accident rather than by intent: `(tk ->> 'mode') not in (...)` is NULL for a jsonb null,
    // and a NULL condition raises nothing. Both readings land on the same behaviour, and the
    // panel does post null for a cleared select, so this is worth accepting on purpose.
    if (tk.mode !== undefined && tk.mode !== null && !Object.values(TICK_MODE).includes(tk.mode)) {
      return {
        ok: false,
        gu: `Level 3 rule: choose ACTIVITY, TICK or REVISION (got "${asText(tk.mode)}").`,
      };
    }

    for (const [key, v] of Object.entries(tk)) {
      if (key === 'mode') continue;

      if (key !== 'perTick' && key !== 'perRevision' && key !== 'dailyCap') {
        return {
          ok: false,
          gu: `Level 3 rule: "${key}" is not one of perTick, perRevision, dailyCap.`,
        };
      }

      const isCap = key === 'dailyCap';
      const label = key === 'perTick'
        ? 'Points per tick'
        : key === 'perRevision' ? 'Points per revision' : 'Level 3 daily cap';
      const bad = numberProblem(
        v,
        label,
        isCap ? TICK_DAILY_CAP_MIN : POINT_MIN,
        isCap ? TICK_DAILY_CAP_MAX : POINT_MAX,
        isCap ? ' 0 means no cap.' : ''
      );
      if (bad) return { ok: false, gu: bad };
    }

    // A mode that pays nothing is a mode that switches લેવલ ૩ off while looking configured. The
    // સંચાલક is told now rather than discovering it in a week of unpaid પુનરાવર્તન.
    if (tk.mode === TICK_MODE.TICK && !(typeof tk.perTick === 'number' && tk.perTick > 0)) {
      return { ok: false, gu: 'Level 3 rule: per-tick mode needs points per tick above 0.' };
    }
    if (tk.mode === TICK_MODE.REVISION && !(typeof tk.perRevision === 'number' && tk.perRevision > 0)) {
      return { ok: false, gu: 'Level 3 rule: per-revision mode needs points per revision above 0.' };
    }
  }

  // ── earn (0033) ───────────────────────────────────────────────────────────
  //
  // Refused rather than corrected, and the asymmetry with the resolver matters more here than
  // anywhere else in this module: the resolver reads an unrecognised mode as DAY_FIRST so a
  // damaged row cannot start paying five times a day, while this refuses it outright so the
  // damaged row is never stored. A typo that silently means "the safe thing" is still a setting
  // the સંચાલક believes he changed.
  if (p.earn !== undefined) {
    const earn = plainObject(p.earn);
    if (!earn) {
      return { ok: false, gu: 'Earning rules: expected a mode for each level.' };
    }

    const MODES = Object.values(EARN_MODE).join(', ');
    for (const [key, value] of Object.entries(earn)) {
      if (key === 'tickCount') {
        if (!Object.values(TICK_COUNT).includes(value)) {
          return {
            ok: false,
            gu: `Level 3 tick counting: choose ${Object.values(TICK_COUNT).join(' or ')} (got "${value}").`,
          };
        }
        continue;
      }

      if (!DISABLED_LEVEL_RE.test(key)) {
        return { ok: false, gu: `Earning rules: "${key}" is not a level like level2.` };
      }

      if (!Object.values(EARN_MODE).includes(value)) {
        return { ok: false, gu: `Earning rules: ${key} must be one of ${MODES} (got "${value}").` };
      }
    }
  }

  return { ok: true, rules: resolvePointRules(p) };
}

/**
 * The three refusals every numeric rule field shares, in 0031's order and words.
 *
 * One helper rather than seven copies, because the order is part of the contract: "enter a
 * number" before "enter a whole number" before the bound, so a સંચાલક who typed text is not
 * told about a range he never reached. Returns the message, or null when the value is fine.
 *
 * `tail` carries the sentence 0031 appends to the two fields whose floor means something other
 * than zero: "0 means no limit." and "0 means no cap.", which is the difference between a bound
 * the સંચાલક must stay inside and a bound he can opt out of.
 */
function numberProblem(v, label, min, max, tail = '') {
  if (typeof v !== 'number' || !Number.isFinite(v)) return `${label}: enter a number.`;
  if (!Number.isInteger(v)) return `${label}: enter a whole number.`;
  if (v < min || v > max) return `${label}: between ${min} and ${max} (got ${v}).${tail}`;
  return null;
}

/**
 * A stored value as the text 0031 would quote back at the સંચાલક.
 *
 * The SQL reads the offending element with `#>> '{}'`, which unwraps a jsonb string and renders
 * anything else as its JSON text, so the message shows him what he actually typed rather than
 * the word "object". jsonb `null` unwraps to SQL NULL and prints as nothing, and that is the
 * empty string here.
 */
function asText(v) {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return '';
  }
}
