import { supabase } from '../../../lib/supabase';
import { saveError } from '../../../lib/errors';
import { EFFECTIVE_DAY_RE, POINTS_KEY } from '../../../../../shared/domain/points.js';
import { LEVELS_SETTINGS_DOC } from '../../../../../shared/domain/settings.js';

/**
 * Every read and write the Point Management page makes.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this module may write, and what it may never write
 * ────────────────────────────────────────────────────────────────────────────
 *
 * It writes **configuration**, and one manual adjustment. It never writes a point value it
 * calculated, a total, or a ledger row of its own: `point_transactions` has a read policy and
 * no write policy, `insert/update/delete` are revoked from `authenticated`, and the only two
 * writers are `activity_submit()` and the `level4_attempts_award` trigger, both server-side
 * (0031, and docs/POINT_SYSTEM_ARCHITECTURE.md §E). The manual credit goes through
 * `admin_award_manual_points()`, which is SECURITY DEFINER over that table and appends a row —
 * so even the one write that touches the ledger from this panel cannot edit history.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Two reads of the same rules, on purpose
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `getPointsConfig()` reads `settings['levels'].value.points` **raw**, from the table, and that
 * is the read the form is built from. `getPointsOverview()` calls `admin_points_overview()`,
 * whose `rules` key is `point_rules()` output — resolved, and with the per-કસોટી repeat prices
 * moved into a nested `byCode` object that is *not* the stored shape (0031:271-280 reads them
 * from code-shaped keys sitting directly inside `repeat`). Editing the resolved shape and
 * saving it back would write `repeat.byCode`, which `settings_check_points()` refuses outright
 * (0031:873 allows only `enabled`, `dailyLimit`, `default` and activity codes inside `repeat`).
 *
 * So: the overview is for figures, the raw slice is for the form, and the two are never
 * crossed. The overview also asserts a *progress reader* rather than a settings reader, which
 * is the second reason it cannot be the form's source — see `isPermissionDenied()`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Read-modify-write, with a stale check instead of a lost update
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `settings['levels']` also holds the level list, the લેવલ ૪ gate and the leaderboard, all read
 * by every યુવક on every visit, so the row is merged and never replaced — settingsService.js's
 * `writeSetting()` pattern, followed exactly. Inside the `points` object the same rule applies
 * one level down and cannot be done by spreading: this page has to be able to *remove* a
 * per-activity price, and a merge can only add. The page therefore composes the whole `points`
 * object from the slice it loaded, and `savePointRules()` refuses the write if that slice has
 * changed underneath it. A silent lost update to a scoring rule is not something to trade for
 * one less round trip.
 */

/** The `settings` row every point rule lives in, and the key inside it. Never spelled twice. */
export { LEVELS_SETTINGS_DOC, POINTS_KEY };

/**
 * The manual adjustment's bounds, and the only bounds this file declares.
 *
 * Every rule bound - the point range, the repeat limit, the daily cap, the version ceiling, the
 * three tick modes - is imported from shared/domain/points.js by whoever renders the field.
 * Nothing on this page keeps a second copy of a number the SQL also holds: the third copy is the
 * one that drifts.
 *
 * These two are here because they belong to `admin_award_manual_points()` rather than to the rule
 * set (0031:677-690): a non-zero amount inside ±100000, and a reason of at least three characters.
 * They are not stored in the settings row, so no resolver or validator in the shared module has
 * anything to say about them. The function is still the authority; these only let the form put
 * the bound on the field and name it in the hint.
 */
export const MANUAL_MAX = 100_000;
export const MANUAL_REASON_MIN = 3;

/** How many yuvaks the manual-adjustment picker will offer for one search. */
export const PICKER_LIMIT = 20;

/**
 * A number that came off the wire, never a coercion.
 *
 * progressService.js makes this argument at length and it holds here for the same reason:
 * `Number(null)` and `Number('')` are both 0, and a 0 in this file is a claim about the ledger.
 * The string branch is not a coercion - PostgREST serialises `bigint` and `numeric` as JSON
 * strings, and an all-digits string is that exact number and nothing else.
 */
const int = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  return 0;
};

const text = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/** A business day, or nothing. The RPC parameter is a Postgres `date`, so there is no instant
 *  to get wrong and no IST offset to apply - the column behind it is already the IST day. The
 *  shape is the shared module's `EFFECTIVE_DAY_RE`, which is `activity_date`'s own shape; a
 *  local copy of those four tokens is exactly the second definition that drifts. */
const day = (v) => (EFFECTIVE_DAY_RE.test(String(v || '')) ? String(v) : null);

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A stable serialisation, for equality only.
 *
 * Keys are sorted at every depth, so a rules object rebuilt in a different order - which is
 * what removing a per-activity price and typing it back produces - compares equal to the stored
 * one. Without it the Save button would light up for an edit that changed nothing and the audit
 * log would fill with entries recording it (§41).
 */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * `42501` - insufficient_privilege, raised by name rather than answered with an empty result.
 *
 * `admin_points_overview()` and `admin_point_activities()` both open with
 * `admin_assert_progress_reader()` (0029), which wants `progress.read` **and** `users.read` and
 * raises. A CONTENT_MANAGER holds `settings.read` and neither of those, so he reaches this page
 * legitimately and is refused by those two calls alone. The page hides those two sections
 * instead of failing: what a level is worth is the useful fact on this screen, and it is
 * readable without any right to read anybody's progress.
 *
 * admin/src/lib/errors.js explains why this cannot be inferred from a message.
 */
export const isPermissionDenied = (e) => e?.code === '42501';

/** The lost-update refusal, thrown by `savePointRules()`. Recognised by the page, not by text. */
export const STALE_CONFIG = 'points_config_changed';

/**
 * A refused write, said in the most specific words anybody has for it.
 *
 * admin/src/lib/errors.js's rule is to branch on the code and never on the message, because a
 * trigger's `raise exception` text is developer English that was never written to be read by a
 * સંચાલક. `settings_check_points()` and `admin_award_manual_points()` are the deliberate
 * exception, in the same way લેવલ ૪'s publish errors are: their messages are *already* admin-
 * facing sentences that name the bound they refused - "Level 3 rule: per-tick mode needs points
 * per tick above 0.", "Repeat daily limit: between 0 and 1000 (got 4000)." - and they are more
 * specific than anything this form can say. `saveError()` maps every check_violation to one
 * generic sentence, which would throw exactly the useful half away.
 *
 * So: a check_violation whose message reads as a sentence is shown as it stands. The two
 * identifier-shaped refusals are translated, because they were written to be matched rather than
 * read. Everything else - a permission denial, a network failure, a constraint - goes through
 * `saveError()` unchanged, which is also what logs the real code and hint to the console.
 */
export function pointsSaveError(e) {
  const fallback = saveError(e);
  const msg = String(e?.message || '').trim();

  if (msg === 'points_unknown_user') return 'That yuvak was not found. Search for him again.';
  if (msg === 'points_not_signed_in') return 'Please log in again.';
  if (e?.code === STALE_CONFIG) {
    return 'Somebody else changed the point rules while this page was open. Reload before saving, so their change is not overwritten.';
  }

  // 23514 is check_violation, which is the errcode every bound in settings_check_points() and
  // admin_award_manual_points() raises with. The identifier test keeps a bare token like
  // `level4_config_frozen` out: a message with no space is a name, not a sentence.
  if (e?.code === '23514' && /\s/.test(msg)) return msg;

  return fallback;
}

/* ---------------------------------------------------------------------------
 * The rules
 * ------------------------------------------------------------------------- */

/**
 * The whole `settings['levels']` row, and the `points` slice out of it, unresolved.
 *
 * Raw for the reason `getLevelsConfig()` gives about the same key: the form has to show what is
 * actually stored, including a key this panel would not have written, and it has to be able to
 * tell "never configured" from "deliberately zero". Resolving it here would throw away both
 * facts and would also drop every key the page is required to preserve.
 *
 * `row` comes back beside it so the caller can see what else is in the row without a second
 * read. Nothing here writes it.
 */
export async function getPointsConfig() {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', LEVELS_SETTINGS_DOC)
    .maybeSingle();
  if (error) throw error;

  const row = isPlainObject(data?.value) ? data.value : {};
  const stored = isPlainObject(row[POINTS_KEY]) ? row[POINTS_KEY] : null;

  return {
    row,
    stored,
    /** The serialisation the save compares against. See savePointRules(). */
    baseline: stableJson(stored),
  };
}

/**
 * `settings['levels'].value.points`, replaced wholesale inside a row that is merged.
 *
 * Two different rules at two depths, and both are deliberate:
 *
 *   the **row** is merged - `{ ...current, points }`. `levels`, `level4Gate` and `leaderboard`
 *   live beside this key and are read by every યુવક on every visit; writing the whole row from
 *   this page would delete them and the first symptom would be two thousand people seeing the
 *   built-in default level list.
 *
 *   the **points object** is replaced. It has to be: removing a per-activity price or a
 *   switched-off rule is a *deleted key*, and no merge can express that. The caller composes
 *   the complete object from the slice it loaded, unknown keys and all.
 *
 * Which leaves the hazard replacement brings, and this is the guard for it: if the stored slice
 * has changed since the page read it, the write is refused rather than overwriting somebody
 * else's edit. The panel's other cards can merge their way out of this; a page that owns the
 * whole object cannot, so it asks instead of guessing.
 *
 * Nothing here validates. `validatePointRules()` runs in the page, before this is called, and
 * `settings_check_points()` runs in the database after - and its refusal is passed through
 * untouched, because it names the bound it refused and that sentence is the useful one.
 */
export async function savePointRules({ points, baseline }) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', LEVELS_SETTINGS_DOC)
    .maybeSingle();
  if (error) throw error;

  const current = isPlainObject(data?.value) ? data.value : {};
  const currentPoints = isPlainObject(current[POINTS_KEY]) ? current[POINTS_KEY] : null;

  if (typeof baseline === 'string' && stableJson(currentPoints) !== baseline) {
    const stale = new Error(STALE_CONFIG);
    stale.code = STALE_CONFIG;
    throw stale;
  }

  const { error: writeError } = await supabase.from('settings').upsert(
    { key: LEVELS_SETTINGS_DOC, value: { ...current, [POINTS_KEY]: points }, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (writeError) throw writeError;
}

/* ---------------------------------------------------------------------------
 * The reads that need a progress reader
 * ------------------------------------------------------------------------- */

/**
 * The લેવલ ૪ કસોટીઓ to offer a price for - the published configuration's, and nothing else.
 *
 * §11: 4.1 … 4.4 are never written down in this panel. A 4.5 published next month appears here
 * on the next load, and a retired code stops being offered while its stored value stays where
 * it is (harmless: the ledger is keyed by code, and a price for a કસોટી nobody can sit pays
 * nobody). The page still shows a stored price for a code this list does not carry, because a
 * value nobody can see is a value nobody can remove.
 *
 * `position` is the order the યુવક meets them in and is used as the sort; `active` is whether
 * the કસોટી is offered at all, which is a different question from whether its points are on.
 */
export async function getPointActivities() {
  const { data, error } = await supabase.rpc('admin_point_activities');
  if (error) throw error;

  return (Array.isArray(data) ? data : [])
    .map((r) => ({
      code: String(r?.code || ''),
      title: String(r?.title || ''),
      position: int(r?.position),
      active: r?.active === true,
    }))
    .filter((a) => a.code)
    .sort((a, b) => a.position - b.position);
}

/**
 * What the rules have paid, in one call.
 *
 * The reconciliation line is the point of it. `legacyRows`/`legacyPoints` are the transactions
 * written before 0031 - `award_kind is null` **is** the definition (§J1) - and that pair is the
 * figure that must never move again. It is printed rather than computed here so that a change
 * to it would be visible on a screen instead of only in a script.
 *
 * Every figure is `int()`d, so a key the function stops returning reads as 0 rather than as
 * `undefined` on screen. `rules` is passed through as it arrived: it is `point_rules()` output
 * and is displayed, never edited - see the header.
 */
export async function getPointsOverview() {
  const { data, error } = await supabase.rpc('admin_points_overview');
  if (error) throw error;

  const o = isPlainObject(data) ? data : {};
  const t = isPlainObject(o.totals) ? o.totals : {};

  return {
    rules: isPlainObject(o.rules) ? o.rules : {},
    settings: isPlainObject(o.settings) ? o.settings : {},
    leaderboard: isPlainObject(o.leaderboard) ? o.leaderboard : {},
    totals: {
      transactions: int(t.transactions),
      points: int(t.points),
      earners: int(t.earners),
      today: int(t.today),
      todayRows: int(t.todayRows),
      legacyRows: int(t.legacyRows),
      legacyPoints: int(t.legacyPoints),
      newRows: int(t.newRows),
      newPoints: int(t.newPoints),
    },
    byKind: (Array.isArray(o.byKind) ? o.byKind : []).map((k) => ({
      kind: String(k?.kind || ''),
      rows: int(k?.rows),
      points: int(k?.points),
    })),
    byLevel: (Array.isArray(o.byLevel) ? o.byLevel : []).map((l) => ({
      level: int(l?.level),
      rows: int(l?.rows),
      points: int(l?.points),
    })),
  };
}

/* ---------------------------------------------------------------------------
 * The manual adjustment
 * ------------------------------------------------------------------------- */

/**
 * Who to credit or debit - a short, bounded lookup, and the only read of `profiles` on this page.
 *
 * Deliberately not `searchUsers()` from features/users: nothing in this panel imports across
 * features, and this needs four columns rather than every column of the લેવલ ૪ view. The
 * predicate is the smaller half of that function's - an exact mobile, an exact SMK, or a name
 * prefix - because an adjustment is made for one named person the સંચાલક already has in mind,
 * not browsed for.
 *
 * An empty result can mean two things and the page says both: nobody matched, or the role holds
 * no `users.read` and the policy answered with no rows rather than an error (see
 * admin/src/lib/errors.js). Nothing here can tell them apart, so nothing here pretends to.
 */
export async function findYuvaks(termRaw) {
  const term = String(termRaw || '').trim();
  if (term.length < 2) return [];

  let q = supabase.from('profiles').select('id, name, smk, mobile, status').limit(PICKER_LIMIT);

  if (/^\d{10}$/.test(term)) {
    q = q.eq('mobile', term);
  } else {
    // The commas and brackets are PostgREST's own separators inside an `or` group, so they are
    // removed rather than escaped - a name cannot contain them and a filter that breaks on one
    // would read as "no such yuvak".
    const safe = term.replace(/[,()]/g, '');
    q = q.or(`smk.eq.${safe.toUpperCase()},name.ilike.${safe}%`).order('name');
  }

  const { data, error } = await q;
  if (error) throw error;

  return (Array.isArray(data) ? data : []).map((r) => ({
    id: r.id,
    name: String(r.name || ''),
    smk: String(r.smk || ''),
    mobile: String(r.mobile || ''),
    status: String(r.status || ''),
  }));
}

/**
 * One new ledger row, credit or debit. Never an edit of an existing one.
 *
 * The function is the authority on every bound and it is left to be: it wants a non-zero amount
 * inside ±100000, a reason of at least three characters, an existing યુવક and `settings.update`,
 * and it raises a named refusal for each (0031:664-690). The page checks the same things before
 * calling so the message arrives at the field, but nothing here re-implements them - and the
 * server's refusal is never swallowed.
 *
 * `date` is optional and defaults, in the function, to today in India. It is the *business day*
 * the adjustment is filed under, which is what makes a correction land in the same day's total
 * as the thing it corrects.
 */
export async function awardManualPoints({ userId, points, reason, date = '' }) {
  const { data, error } = await supabase.rpc('admin_award_manual_points', {
    p_user: userId,
    p_points: Math.trunc(Number(points)),
    p_reason: text(reason),
    p_date: day(date),
  });
  if (error) throw error;

  const r = isPlainObject(data) ? data : {};
  return {
    // How many rows were written: 1, or 0 when the amount resolved to nothing to record.
    awarded: int(r.awarded),
    // This yuvak's whole ledger, after the row. Read from the ledger by the function, never
    // added up here - a total this panel computed would be a second answer to the one question
    // the ledger exists to answer.
    total: int(r.total),
    date: String(r.date || ''),
  };
}
