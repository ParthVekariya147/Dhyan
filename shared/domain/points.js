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
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const v = Math.round(n);
  if (v < POINT_MIN || v > POINT_MAX) return null;
  return v;
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
