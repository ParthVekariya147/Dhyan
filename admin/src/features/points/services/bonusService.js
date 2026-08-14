import { supabase } from '../../../lib/supabase';
/*
  Imported and then re-exported rather than forwarded with `export … from`, because this module
  uses `DEFAULT_EARN` itself (resolveEarn/isDefaultEarn below). A bare re-export forwards the
  binding to importers without creating a local one, so the forwarding form would compile and
  then throw at the first call - the kind of break a build cannot show you.
*/
import {
  ACTIVITY_LEVEL,
  BONUS_MODE,
  BONUS_POINTS_MAX,
  BONUS_POINTS_MIN,
  BONUS_THRESHOLD_MAX,
  BONUS_THRESHOLD_MIN,
  BONUS_TRIGGER,
  DEFAULT_EARN,
  EARN_MODE,
  TICK_COUNT,
} from '../../../../../shared/domain/points.js';

/**
 * The bonus rules, and the per-level earning modes.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Two things that look alike on screen and are stored in two different places
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A **bonus rule** is a row of `point_bonus_rules`, written one at a time through
 * `admin_bonus_rule_save()` / `admin_bonus_rule_delete()`. Pressing Save on the rule set does
 * not store one, and this file never puts a bonus rule anywhere near the settings row.
 *
 * An **earning mode** is one key inside `settings['levels'].value.points` - `earn` - and rides
 * along with every other point rule on the page's single Save. It deliberately has no RPC of its
 * own: a second write for one key of the same object is a second thing that can half-succeed, and
 * "the level values saved but the mode did not" is a state nobody could read off the screen.
 *
 * So this module owns the *shape* of `earn` and the *calls* for the rules, and PointsPage owns the
 * one write, exactly as it already owns `repeat` and `tick`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why the vocabulary is declared here and not imported
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every other bound on this page is imported from shared/domain/points.js, and that is the rule
 * this file would follow if it could: a second copy of a number the SQL also holds is the copy
 * that drifts. These four sets are the exception because the migration that introduces them
 * (0033) and the shared module's half of them are landing beside this work, and a named import of
 * a symbol that is not exported yet is not a missing feature - it is a build that does not
 * compile and a panel that serves a blank screen. They are declared once, here, and every
 * component reads them from this file; when the shared module carries them, this block is the one
 * place that has to change.
 */

/* ---------------------------------------------------------------------------
 * The vocabulary
 * ------------------------------------------------------------------------- */

/**
 * Re-exported from the shared module, not declared here.
 *
 * The block above described these four sets as a temporary local copy, made because
 * `shared/domain/points.js` and migration 0033 were being written beside this file and a named
 * import of a symbol that does not exist yet is not a missing feature - it is a build that does
 * not compile. The shared module now carries them, mirrored against the SQL branch for branch and
 * covered by `scripts/test-point-rules.mjs`, so this is that one block changing as promised.
 *
 * They are re-exported rather than imported directly by each component for one reason: every
 * component in this feature already reads them from this file, and a re-export keeps the panel's
 * import graph pointing at one place while the definition lives where the mirror is tested. The
 * two bonus sets are renamed on the way through - `BONUS_TRIGGER` and `BONUS_MODE` say which
 * domain they belong to when read beside `TICK_MODE` and `EARN_MODE` in the shared module, while
 * inside this feature the shorter names read better against `rule.triggerType`.
 */
export { BONUS_TRIGGER as TRIGGER, BONUS_MODE as REWARD_MODE, EARN_MODE, TICK_COUNT, DEFAULT_EARN };

/** The key the earning modes live under, inside the `points` object. Never spelled twice. */
export const EARN_KEY = 'earn';

/** The one key of `earn` that is not a level. */
export const TICK_COUNT_KEY = 'tickCount';

/** `1` → `level1`. The stored key for one level, derived rather than listed. */
export const earnKeyFor = (levelId) => `level${levelId}`;

/**
 * A threshold is a count of something that has happened, so 0 is not a threshold - it is a rule
 * that has already been met by everybody who has done nothing. The database refuses it; this is
 * only where the field says so before the round trip.
 *
 * Aliased from the shared module rather than written as `1` here, for the reason the header gives
 * about the vocabulary: a bound the panel enforces and the database does not is the one
 * disagreement a rules screen may not have, and the way that happens is two copies of a number.
 */
export {
  BONUS_THRESHOLD_MIN as THRESHOLD_MIN,
  BONUS_THRESHOLD_MAX as THRESHOLD_MAX,
  BONUS_POINTS_MIN as BONUS_MIN,
  BONUS_POINTS_MAX as BONUS_MAX,
};

/* ---------------------------------------------------------------------------
 * Reading the stored `earn` object
 * ------------------------------------------------------------------------- */

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The stored `points` slice → the five earning modes actually in force.
 *
 * Resolved rather than read raw, for the reason `resolvePoints()` gives: the card has to show what
 * the engine will *do*, including when the stored value is one this panel would not have written.
 * A `level2` stored as `"every"` in lower case is not EVERY to a SQL `in` check, so it is shown as
 * DAY_FIRST here - because DAY_FIRST is what that યુવક is actually being paid under.
 */
export function resolveEarn(storedPoints) {
  const raw = isObj(storedPoints) && isObj(storedPoints[EARN_KEY]) ? storedPoints[EARN_KEY] : {};
  const out = { ...DEFAULT_EARN };

  for (const key of Object.keys(DEFAULT_EARN)) {
    const allowed = key === TICK_COUNT_KEY ? TICK_COUNT : EARN_MODE;
    if (Object.values(allowed).includes(raw[key])) out[key] = raw[key];
  }
  return out;
}

/**
 * Whether these five values are what an absent `earn` key already means.
 *
 * PointsPage uses it to decide whether to write the key at all. An absent `earn` and one holding
 * the defaults award identically, but only one of them is a row somebody edited - and a page that
 * adds a key to the settings row just by being opened files an audit entry for a change nobody
 * made (§41).
 */
export function isDefaultEarn(earn) {
  return Object.keys(DEFAULT_EARN).every((k) => earn?.[k] === DEFAULT_EARN[k]);
}

/* ---------------------------------------------------------------------------
 * The scope pickers' options
 * ------------------------------------------------------------------------- */

/**
 * Which activity keys belong to which level, built from the shared map rather than typed out.
 *
 * Levels 1 to 3 have one fixed key each - `ACTIVITY_LEVEL` is the ledger's own pairing - and
 * Level 4's keys are `code`s, which are configuration and change without a deploy. So this takes
 * the published કસોટીઓ as an argument instead of knowing anything about 4.1 … 4.4: a 4.5
 * published tomorrow is an option here on the next load, and nothing in this panel had to be
 * edited for it.
 */
export function activityOptions(levelId, level4Activities = []) {
  const level = Number(levelId);
  if (!Number.isInteger(level)) return [];

  const fixed = Object.entries(ACTIVITY_LEVEL)
    .filter(([, lvl]) => lvl === level)
    .map(([key]) => ({ key, label: key }));
  if (fixed.length) return fixed;

  // Anything that is not one of the fixed three is priced by code, so the published list is the
  // only honest source. An empty list means "nothing published yet", which the dialog says out
  // loud rather than rendering an empty picker.
  return (Array.isArray(level4Activities) ? level4Activities : []).map((a) => ({
    key: a.code,
    label: a.title ? `${a.code} - ${a.title}` : a.code,
  }));
}

/* ---------------------------------------------------------------------------
 * The rules
 * ------------------------------------------------------------------------- */

const int = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  // PostgREST serialises `bigint` as a JSON string, and an all-digits string is that exact
  // number and nothing else. This is not a coercion: `Number('')` and `Number(null)` are 0, and
  // a 0 in a usage column is a claim about the ledger.
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
};

const text = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/**
 * The first key of `names` the row actually carries.
 *
 * `admin_bonus_rules()` is being written beside this page and the contract fixes the *columns of
 * the table* rather than the names the function returns them under - `bonus_points` as a column
 * could arrive as `bonus_points` or as `points`, and the two usage figures have no column at all
 * to take their name from. Reading a small set of spellings costs one line and fails soft; hard-
 * coding one spelling would show every bonus as 0 points if the function chose the other, which
 * is a wrong number on screen rather than a missing one.
 */
const pick = (row, ...names) => {
  for (const n of names) {
    const v = row?.[n];
    if (v !== undefined && v !== null) return v;
  }
  return null;
};

/** One row of `admin_bonus_rules()` → the shape every component on this page reads. */
function toRule(r) {
  return {
    id: String(pick(r, 'id') ?? ''),
    name: String(pick(r, 'name') ?? ''),
    // null is a value here and not a missing one: no level means "any level", and no activity
    // means "every activity of that level". They are kept as null rather than defaulted.
    levelId: int(pick(r, 'level_id', 'levelId')),
    activityKey: text(pick(r, 'activity_key', 'activityKey')),
    trigger: String(pick(r, 'trigger_type', 'trigger') ?? ''),
    threshold: int(pick(r, 'threshold')) ?? 0,
    points: int(pick(r, 'bonus_points', 'points', 'bonusPoints')) ?? 0,
    mode: String(pick(r, 'reward_mode', 'mode') ?? ''),
    enabled: pick(r, 'enabled') !== false,
    /*
      The two usage figures, and `null` when the function did not send them.

      Deliberately not 0. "This rule has never paid" and "nobody may read what it has paid" are
      different facts, and only one of them is a reason to delete a rule - so an unknown figure
      is printed as unknown and never as a zero somebody could act on.
    */
    timesPaid: int(pick(r, 'times_paid', 'timesPaid', 'paid_count', 'awards')),
    yuvaksPaid: int(pick(r, 'yuvaks_paid', 'youths_paid', 'users_paid', 'user_count', 'yuvaks')),
  };
}

/**
 * Every configured bonus rule, with what it has paid.
 *
 * `admin_bonus_rules()` asserts a *progress reader* - `progress.read` and `users.read` - because
 * it counts ledger rows, and a CONTENT_MANAGER holds `settings.read` and neither of those. He
 * reaches this page legitimately, so that refusal is returned as data rather than thrown:
 * `{ denied: true }`, and the card keeps its editor and drops the list. Every other failure still
 * throws and still becomes an ErrorState, because those are conditions the page must not paint
 * over.
 *
 * A missing function is the third outcome and is separated for the same reason: until 0033 is
 * applied, `admin_bonus_rules()` does not exist, and "there are no bonus rules" is a very
 * different sentence from "this database has no bonus engine yet".
 */
export async function getBonusRules() {
  const { data, error } = await supabase.rpc('admin_bonus_rules');
  if (error) {
    if (isPermissionDenied(error)) return { denied: true, rules: [] };
    if (isEngineMissing(error)) return { missing: true, rules: [] };
    throw error;
  }
  return { rules: (Array.isArray(data) ? data : []).map(toRule).filter((r) => r.id) };
}

/**
 * Insert when `id` is null, update otherwise - the function's own branch, not a second one here.
 *
 * Nothing is validated on the way out. `bonusRuleProblem()` runs in the dialog before this is
 * called so the message arrives at the field, and `admin_bonus_rule_save()` runs after and is the
 * authority; its refusal is passed through untouched by `pointsSaveError()`, because it names the
 * bound it refused and that sentence is the useful one.
 */
export async function saveBonusRule({ id, name, levelId, activityKey, trigger, threshold, points, mode, enabled }) {
  const { data, error } = await supabase.rpc('admin_bonus_rule_save', {
    p_id: id || null,
    p_name: text(name),
    // A blank level or activity is sent as SQL null on purpose: null is the *widest* scope, so
    // coercing it to 0 or to '' would narrow a rule to a level that does not exist and it would
    // quietly stop paying anybody.
    p_level: Number.isInteger(levelId) ? levelId : null,
    p_activity: text(activityKey),
    p_trigger: text(trigger),
    p_threshold: Math.trunc(Number(threshold)),
    p_points: Math.trunc(Number(points)),
    p_mode: text(mode),
    p_enabled: enabled !== false,
  });
  if (error) throw error;
  return data ?? null;
}

/**
 * Stop a rule paying. It does not, and cannot, take back what it has already paid.
 *
 * `point_transactions` has no delete grant and no update policy anywhere in the panel, so every
 * bonus this rule has awarded stays in the ledger and in every total computed from it. The card
 * says that in the confirmation, because "delete" is a word an admin reasonably reads as "undo".
 */
export async function deleteBonusRule(id) {
  const { error } = await supabase.rpc('admin_bonus_rule_delete', { p_id: id });
  if (error) throw error;
}

/* ---------------------------------------------------------------------------
 * The refusals
 * ------------------------------------------------------------------------- */

/**
 * `42501` - insufficient_privilege, raised by name rather than answered with an empty result.
 *
 * The same test pointsService.js makes and for the same reason; it is repeated as one expression
 * rather than imported so that this module has no cycle with the module that imports it. See
 * admin/src/lib/errors.js for why this cannot be inferred from a message.
 */
export const isPermissionDenied = (e) => e?.code === '42501';

/**
 * The bonus engine is not in this database yet.
 *
 * `42883` is Postgres's undefined_function; `PGRST202` is PostgREST answering that no function of
 * that name and signature is in its schema cache, which is what a caller actually sees for a
 * migration that has not been applied. Separated from a real error because production runs
 * migrations on its own schedule: a panel that shows an ErrorState with a Try again for it is
 * telling the સંચાલક to retry something that cannot succeed until somebody deploys.
 */
export const isEngineMissing = (e) => e?.code === '42883' || e?.code === 'PGRST202';

/* ---------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------- */

/**
 * What is wrong with this rule, in one sentence, or ''.
 *
 * Checked before sending for the reason the rest of the page gives: the function would refuse a
 * bad payload anyway - that is the guarantee, and it is why this can never be the only check -
 * but sending one and letting it bounce puts a database refusal in front of the સંચાલક for
 * something the form could have named beside the field.
 *
 * The order is the order he fills the form in, so the message moves down the dialog as he works
 * rather than jumping back to a field he has already answered.
 */
export function bonusRuleProblem(rule) {
  if (!String(rule?.name || '').trim()) {
    return 'Give the rule a name. It is what the list is read by and what an audit entry names.';
  }
  // The imported names, never the aliases this module exports - see the note on the threshold
  // check below for what reading an export-only alias does here.
  if (!Object.values(BONUS_TRIGGER).includes(rule?.trigger)) {
    return 'Choose what this rule counts.';
  }
  if (!Object.values(BONUS_MODE).includes(rule?.mode)) {
    return 'Choose how often the bonus is paid.';
  }

  // BONUS_THRESHOLD_MIN and not the THRESHOLD_MIN this module exports: the export above is an
  // aliased re-export, which forwards a binding to importers WITHOUT creating a local one. Reading
  // the alias here compiles cleanly and throws at the first keystroke in the dialog - a break no
  // build can show you, which is why the imported name is the one used inside this file.
  const threshold = Number(rule?.threshold);
  if (!Number.isInteger(threshold) || threshold < BONUS_THRESHOLD_MIN) {
    return `The threshold is a whole number of ${BONUS_THRESHOLD_MIN} or more. A threshold of 0 is met by somebody who has done nothing.`;
  }
  if (threshold > BONUS_THRESHOLD_MAX) {
    return `The threshold is at most ${BONUS_THRESHOLD_MAX}.`;
  }

  const points = Number(rule?.points);
  if (!Number.isInteger(points)) return 'The bonus is a whole number of points.';
  if (points === 0) {
    return 'A bonus of 0 pays nothing and writes no ledger row. Enter an amount, or switch the rule off instead.';
  }
  // A negative bonus is allowed on purpose - a milestone may be a correction - so the bound is a
  // range rather than a floor, and it is the same range the database enforces.
  if (points < BONUS_POINTS_MIN || points > BONUS_POINTS_MAX) {
    return `The bonus is between ${BONUS_POINTS_MIN} and ${BONUS_POINTS_MAX} points.`;
  }

  // An activity without a level is a scope nothing can resolve: `darshan` belongs to Level 2 and
  // `4.3` to Level 4, and a rule that names one without the other is asking the engine to guess.
  if (rule?.activityKey && !Number.isInteger(rule?.levelId)) {
    return 'Choose a level before choosing one of its activities, or leave the scope on every level.';
  }
  return '';
}
