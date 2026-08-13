import { useEffect, useRef, useState } from 'react';
import {
  ACTIVITY_CODE_RE,
  POINTS_KEY,
  POINT_MAX,
  POINT_MIN,
  SUGGESTED_POINTS,
  resolvePoints,
  validatePoints,
} from '../../../../../shared/domain/points.js';
import { LEVELS_SETTINGS_DOC } from '../../../../../shared/domain/settings.js';
import { supabase } from '../../../lib/supabase';
import { useAdminAuth } from '../../../lib/adminAuth';
import { StatusBadge } from '../../../components/StatCard';
import { saveError } from '../../../lib/errors';

/**
 * What a finished activity is worth.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this is a card and not four fields on the Levels page
 * ────────────────────────────────────────────────────────────────────────────
 *
 * It writes into the same row the Levels page does - `settings['levels']`, alongside the
 * list and `level4Gate` - which is the argument for putting it there. It is here for the
 * reason GalleryCard is separate from the General card: this one has **bounds of its own**
 * that the database mirrors, so it has a refusal path of its own, and the message has to
 * land next to the field that caused it rather than under a Save button shared with the
 * level names. A save refused because Level 2 says '300 ' must not appear under the box
 * where somebody was renaming Level 1.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The two rules this card cannot change, and says out loud
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Both live in shared/domain/points.js and both are enforced in the database, not here:
 *
 *   * **An activity pays at most once per business day.** A unique index on
 *     `(user_id, activity_date, level_id, activity_key)` over the ledger is the guarantee,
 *     because an unlocked કસોટી may be sat again without limit and "points per completed
 *     attempt" would pay a yuvak 300 for pressing નોંધાવો eleven times. It follows that an
 *     attempt with darshan still to revise earns nothing **and does not use up the day's
 *     award** - he can finish later the same day and be paid then.
 *
 *   * **Nothing here reaches backwards.** The ledger stores the number that was paid, not a
 *     pointer to the rule that decided it, so lowering a value changes what tomorrow pays
 *     and cannot touch what anybody has already earned (§1 rule 4).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why Level 4's overrides are keyed by code
 * ────────────────────────────────────────────────────────────────────────────
 *
 * '4.1', '4.2' - `level4_activities.code`, which is what survives a republication. The row
 * ids do not: `level4_clone_config()` writes new activity rows every time a version is
 * published, so a value keyed by uuid would orphan itself silently and the ledger would go
 * on paying the old number with nothing on any screen able to say which. points.js sets this
 * out at length; this card only follows it.
 */
export default function PointsCard({ points, onSaved }) {
  const { can } = useAdminAuth();

  /**
   * The same split as every other card on this page: `settings.read` opens it,
   * `settings.update` moves the numbers. **Disabled, not hidden** - what each level is
   * currently worth is the useful fact on this card, and a VIEWER asked "how did he get 600
   * today?" should be able to read the answer rather than find an empty space.
   *
   * There is no `settings.write` in this system; that name grants nothing. The check that
   * actually decides is the RLS policy on `settings` (0004_rbac.sql), which asks for
   * `settings.update`; this is only where that becomes visible.
   */
  const mayEdit = can('settings.update');

  /**
   * Through the shared resolver the server awards from, never a looser read of this panel's
   * own. The fields have to show what is actually in force - including when the stored value
   * is one this panel would not have written, which is exactly when the difference matters.
   */
  const inUse = resolvePoints(points);

  /**
   * Has anybody ever configured this? Asked of the **raw** slice rather than the resolved
   * one, because resolvePoints() answers `enabled: false` and four zeros for both "switched
   * off deliberately" and "never touched", and only the second should be pre-filled.
   */
  const neverConfigured =
    !points || typeof points !== 'object' || Array.isArray(points) || Object.keys(points).length === 0;

  /*
    Every number is held as a **string**, exactly as GalleryCard holds its interval.

    A number-typed state forces a decision about what an empty box means on every keystroke,
    and the answer JavaScript gives - `Number('')` is 0 - is a value this field must not
    invent: 0 is a real, honoured value here ("this level is practised but worth nothing"),
    so coercing a half-typed box into it would silently save a level as free. An empty box
    stays an empty box: not yet a number.
  */
  const [enabled, setEnabled] = useState(inUse.enabled);
  const [level1, setLevel1] = useState(String(inUse.level1));
  const [level2, setLevel2] = useState(String(inUse.level2));
  const [level3, setLevel3] = useState(String(inUse.level3));
  const [level4, setLevel4] = useState(String(inUse.level4.default));
  // [{ key, code, value }] — `key` is React's, never stored. Renaming a code must not
  // remount the row and take the cursor with it, and removing the second of three must not
  // shift the third's identity onto it.
  const [overrides, setOverrides] = useState([]);
  const nextKey = useRef(0);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  // The rule is a hint before the first edit and an error only after one. A card that is red
  // the moment the page paints is telling the સંચાલક off for nothing (§31).
  const [touched, setTouched] = useState(false);

  /*
    Reload the boxes when the stored row changes. Keyed on a serialisation of the resolved
    value rather than on the `points` object, which is a fresh identity on every parent
    render and would fight the સંચાલક for the cursor.
  */
  const savedKey = canon(inUse);
  useEffect(() => {
    setEnabled(inUse.enabled);
    setLevel1(String(inUse.level1));
    setLevel2(String(inUse.level2));
    setLevel3(String(inUse.level3));
    setLevel4(String(inUse.level4.default));
    setOverrides(
      Object.entries(inUse.level4)
        .filter(([code]) => code !== 'default')
        .map(([code, value]) => ({ key: (nextKey.current += 1), code, value: String(value) }))
    );
    setTouched(false);
    setMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  /**
   * The candidate row, assembled from the boxes exactly as it would be stored.
   *
   * `parseWhole` returns NaN for anything that is not a run of digits, and NaN is passed
   * through rather than swallowed: `typeof NaN === 'number'` but `Number.isFinite(NaN)` is
   * false, which is precisely the pair validatePoints() tests, so a blank box arrives at the
   * shared rule as "not a number" instead of as a zero somebody would have been paid.
   */
  const candidate = {
    enabled,
    level1: parseWhole(level1),
    level2: parseWhole(level2),
    level3: parseWhole(level3),
    level4: buildLevel4(level4, overrides),
  };

  /*
    The shared rule, run as he types.

    The **same call the save makes** - not a livelier local approximation of it. A divergent
    live check is a second answer to one question, and the answer that loses is always the
    one the સંચાલક can see: he would watch a field turn green and then read a refusal from
    the server that named a bound this card never mentioned. save() runs it again and is the
    authority; this is only where the message arrives at the keystroke that caused it.
  */
  const check = validatePoints(candidate);
  const valueError = touched && !check.ok ? check.gu : '';

  /**
   * The one thing the shared validator structurally cannot see.
   *
   * `level4` is a plain object, so two rows both claiming '4.1' collapse into one key before
   * validatePoints() is ever called - the second silently wins and the first vanishes from a
   * form that still shows it. This is a question about the **shape of this list**, not about
   * what a value may be, so answering it here is not a second opinion on the shared rule; it
   * is a check the shared rule has no way to be asked.
   */
  const duplicate = findDuplicate(overrides);
  const listError = touched && duplicate ? `Level 4 points: "${duplicate}" is listed twice. Give each activity one value.` : '';

  /**
   * Nothing to save when the boxes already hold what is stored. Re-saving writes a settings
   * row and files an audit entry for a change that did not happen (§41), and an audit trail
   * carrying edits nobody made is worse than one carrying none.
   *
   * Compared through the canonical form, so re-ordering the override list - or removing a
   * row and typing it back - is correctly read as no change at all.
   */
  const changed = check.ok && !duplicate && canon(check.points) !== canon(inUse);

  function edited(fn) {
    return (...args) => {
      fn(...args);
      setTouched(true);
      setMsg(null);
    };
  }

  /**
   * §31 - the first tick on a row nobody has ever configured fills in the brief's numbers.
   *
   * DEFAULT_POINTS is deliberately all zeros, so that deploying this work does not switch a
   * scoring system on for two thousand yuvaks because a migration ran. The suggestion
   * belongs at the moment somebody actually asks for points, which is here - and it is a
   * pre-fill, not a decision: every number stays his to change before he presses Save.
   */
  function toggleEnabled(on) {
    setEnabled(on);
    setTouched(true);
    setMsg(null);
    // `touched` is read before it is set, so it still holds the value from before this
    // click. That is the guard against the second tick: switching points off and on again -
    // or typing a number first and then ticking - must not overwrite what he has already
    // decided with the suggestion. Only the very first tick on an untouched, never-
    // configured card pre-fills.
    if (!on || !neverConfigured || touched) return;
    setLevel1(String(SUGGESTED_POINTS.level1));
    setLevel2(String(SUGGESTED_POINTS.level2));
    setLevel3(String(SUGGESTED_POINTS.level3));
    setLevel4(String(SUGGESTED_POINTS.level4.default));
  }

  const patchOverride = (key, field, value) =>
    setOverrides((list) => list.map((o) => (o.key === key ? { ...o, [field]: value } : o)));

  const addOverride = () =>
    setOverrides((list) => [...list, { key: (nextKey.current += 1), code: '', value: '' }]);

  const removeOverride = (key) => setOverrides((list) => list.filter((o) => o.key !== key));

  async function save() {
    const v = validatePoints(candidate);
    if (!v.ok) {
      setTouched(true);
      setMsg({ tone: 'danger', text: v.gu });
      return;
    }
    if (duplicate) {
      setTouched(true);
      setMsg({ tone: 'danger', text: `Level 4 points: "${duplicate}" is listed twice.` });
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      await savePoints(v.points);
      // Audited by the `audit_settings` trigger (0004_rbac.sql), which files this as
      // LEVEL_UPDATED the moment the row is written. There is no audit call here and there
      // must not be one: a second entry written from the browser would double every edit in
      // the log and could be omitted by anyone talking to the database directly.
      setMsg({
        tone: 'ok',
        text: v.points.enabled
          ? 'Saved. Activities finished from now on are worth these values.'
          : 'Saved. Points are off, so every activity is worth 0 until this is switched back on.',
      });
      onSaved?.();
    } catch (e) {
      // §31 - a failed save leaves the typing where it is and offers the button again.
      // saveError() surfaces the trigger's own refusal, which names the bound, so a write
      // the database rejects explains itself rather than arriving as "something went wrong".
      setMsg({ tone: 'danger', text: saveError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div style={cardHead}>
        <h2 style={noMargin}>Points</h2>
        {/* Which of the two states the stored row is in, in a word. The word carries it; the
            tone only repeats it (§43). */}
        <StatusBadge tone={inUse.enabled ? 'ok' : 'off'}>{inUse.enabled ? 'On' : 'Off'}</StatusBadge>
      </div>

      <p className="card-note" style={cardIntro}>
        What a finished activity is worth. An activity pays <strong>once per day</strong>,
        however many times it is done - so a yuvak who submits Level 3 five times is paid
        once. An attempt with darshan still to revise earns nothing and does not use up that
        day's award: he can finish later the same day and be paid then. Changing a value here
        affects what is paid from now on and never rewrites what anybody has already earned.
      </p>

      {!mayEdit && (
        <div className="notice notice-warn" role="status">
          You can read what each level is worth; changing it needs the{' '}
          <strong>settings.update</strong> permission.
        </div>
      )}

      <div style={controlRow}>
        <div className="field" style={checkField}>
          <label className="check" htmlFor="points-on">
            <input
              id="points-on"
              type="checkbox"
              checked={enabled}
              onChange={(e) => toggleEnabled(e.target.checked)}
              disabled={!mayEdit || busy}
            />
            Award points
          </label>
          <span className="hint">
            {enabled
              ? 'Every value below is paid as it is set.'
              : 'Off - every activity is worth 0, whatever the boxes below say.'}
          </span>
        </div>
      </div>

      {/*
        The three fixed levels. Flex-wrap with a per-field basis rather than a fixed grid: a
        three-column grid holds its three columns all the way down to a 320px phone and clips
        the boxes, where this drops each field onto its own line as soon as there is no room,
        in the order they are in and with no media query.

        Nothing here sets a font-size on a number input. admin.css gives them 16px under
        `pointer: coarse` for one reason: below that, iOS Safari zooms the page on focus and
        never zooms back out, which leaves a સંચાલક stranded at 1.3x on a settings page.
      */}
      <div style={controlRow}>
        <PointField id="p-l1" label="Level 1 - Meditation" hint="The two entry answers" value={level1} onChange={edited((e) => setLevel1(e.target.value))} disabled={!mayEdit || busy} />
        <PointField id="p-l2" label="Level 2 - Darshan" hint="One darshan seen through" value={level2} onChange={edited((e) => setLevel2(e.target.value))} disabled={!mayEdit || busy} />
        <PointField id="p-l3" label="Level 3 - Revision" hint="One submitted revision" value={level3} onChange={edited((e) => setLevel3(e.target.value))} disabled={!mayEdit || busy} />
      </div>

      {/* Level 4 reads as one subject: a default, then the exceptions to it. Inset on the
          sunken surface with the same brand rule the Levels page uses to say "this belongs
          to that", rather than as a fourth field in the row above. */}
      <div style={level4Block}>
        <h3 style={blockTitle}>Level 4</h3>

        <div style={controlRow}>
          <PointField
            id="p-l4"
            label="Level 4 - default"
            hint="Any test with no value of its own"
            value={level4}
            onChange={edited((e) => setLevel4(e.target.value))}
            disabled={!mayEdit || busy}
          />
        </div>

        <p className="card-note">
          A test the સંચાલક creates and nobody has priced yet is worth the default, not
          nothing - a 0 there would look identical to a deliberate "this one is free", with no
          way to tell which. Give a test its own value below only when it should differ.
        </p>

        {overrides.map((o) => (
          <div key={o.key} style={controlRow}>
            <div className="field" style={codeField}>
              <label htmlFor={`p-code-${o.key}`}>Activity code</label>
              <input
                id={`p-code-${o.key}`}
                type="text"
                inputMode="decimal"
                value={o.code}
                placeholder="4.1"
                onChange={edited((e) => patchOverride(o.key, 'code', e.target.value))}
                disabled={!mayEdit || busy}
                aria-describedby={`p-code-help-${o.key}`}
              />
              <span className="hint" id={`p-code-help-${o.key}`}>
                As shown on the Level 4 page
              </span>
            </div>

            <PointField
              id={`p-val-${o.key}`}
              label="Worth"
              hint="Instead of the default"
              value={o.value}
              onChange={edited((e) => patchOverride(o.key, 'value', e.target.value))}
              disabled={!mayEdit || busy}
            />

            {/* Its own line on a narrow screen, and never smaller than the tap floor: the
                button carries `btn-sm`, whose min-height is the panel's control size, and
                admin.css raises that to --tap under `pointer: coarse`. */}
            <div className="field" style={checkField}>
              <button
                className="btn btn-quiet btn-sm"
                type="button"
                onClick={edited(() => removeOverride(o.key))}
                disabled={!mayEdit || busy}
              >
                Remove {o.code || 'this value'}
              </button>
            </div>
          </div>
        ))}

        <div className="form-actions">
          <button className="btn btn-quiet btn-sm" type="button" onClick={addOverride} disabled={!mayEdit || busy}>
            Add a value for one test
          </button>
        </div>
      </div>

      {/* The rule that refused, once, above the button it would refuse. Both messages are
          shown because they are different refusals: one is about a value, the other about
          the list. */}
      {valueError && (
        <p className="field-error" role="alert" style={errorLine}>
          <span aria-hidden="true">⚠</span> {valueError}
        </p>
      )}
      {listError && (
        <p className="field-error" role="alert" style={errorLine}>
          <span aria-hidden="true">⚠</span> {listError}
        </p>
      )}

      <div className="form-actions">
        <button
          className={`btn${busy ? ' is-busy' : ''}`}
          type="button"
          onClick={save}
          disabled={!mayEdit || busy || !changed}
        >
          {busy ? 'Saving…' : 'Save points'}
        </button>
        {msg && (
          <span
            className={`save-state ${msg.tone === 'ok' ? 'is-ok' : 'is-error'}`}
            role={msg.tone === 'ok' ? 'status' : 'alert'}
          >
            {msg.text}
          </span>
        )}
        {msg?.tone === 'danger' && (
          <button className="btn btn-quiet btn-sm" type="button" onClick={save} disabled={busy}>
            Try again
          </button>
        )}
      </div>

      {/* What is in force right now, read back through the resolver rather than from the
          boxes - so a row stored with a value this panel would not have written shows what
          the server will actually pay, not what somebody has half-typed above. */}
      <p className="card-note">
        In force now:{' '}
        {inUse.enabled ? (
          <>
            Level 1 <span className="mono">{inUse.level1}</span>, Level 2{' '}
            <span className="mono">{inUse.level2}</span>, Level 3{' '}
            <span className="mono">{inUse.level3}</span>, Level 4{' '}
            <span className="mono">{inUse.level4.default}</span> by default
            {Object.keys(inUse.level4).length > 1
              ? `, with ${Object.keys(inUse.level4).length - 1} test(s) priced separately.`
              : '.'}
          </>
        ) : (
          'points are off, so every activity is worth 0.'
        )}{' '}
        Whole numbers between <span className="mono">{POINT_MIN}</span> and{' '}
        <span className="mono">{POINT_MAX}</span>. The same range is checked in the database,
        so a value outside it cannot be stored by any route.
      </p>
    </div>
  );
}

/**
 * One number box. Extracted because there are four of them plus one per override, and five
 * copies of the same nine attributes is where a `type="text"` or a missing `inputMode`
 * eventually creeps into one of them.
 *
 * No font-size, ever - see the note above the fixed levels.
 */
function PointField({ id, label, hint, value, onChange, disabled }) {
  return (
    <div className="field" style={numField}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={POINT_MIN}
        max={POINT_MAX}
        step={1}
        value={value}
        onChange={onChange}
        disabled={disabled}
        aria-describedby={`${id}-help`}
      />
      <span className="hint" id={`${id}-help`}>{hint}</span>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * The write
 * ------------------------------------------------------------------------- */

/**
 * `settings['levels'].value.points`, merged into the row rather than replacing it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * This belongs in settingsService.js, and here is why it is not there yet
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Its home is `updateLevelsPoints(points)` in
 * admin/src/features/settings/services/settingsService.js, beside `updateLevelsConfig` and
 * built on the same private `writeSetting()` - one module owning every read and write of the
 * `settings` table is the whole point of that file. It is here because that file is being
 * edited in parallel by another session in this change, and a component reaching into the
 * table is a smaller, visible, easily-reversed wrong than two sessions writing one module.
 * Moving it is a delete and a one-line import; nothing else on this card changes.
 *
 * The existing pair could not carry it. `getLevelsConfig()` returns only the resolved list
 * and gate - the raw `points` slice never survives it - and `updateLevelsConfig({levels,
 * gate})` writes exactly those two keys, so routing a points save through it would mean
 * re-writing the level list from a card that has no business holding one, and would file the
 * levels list as edited in the audit log every time a number moved.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Merge, never replace
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `writeSetting()`'s pattern, followed exactly: read the current value, spread it, set one
 * key. `settings['levels']` also holds `levels` (the list the yuvak's home page is built
 * from) and `level4Gate` (what opens Level 4), and both are read by the yuvak app on every
 * visit. Writing the whole object from this card would silently delete them, and the first
 * symptom would be two thousand people seeing the built-in default level list.
 */
async function savePoints(points) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', LEVELS_SETTINGS_DOC)
    .maybeSingle();
  if (error) throw error;

  const current = data?.value ?? {};

  const { error: writeError } = await supabase.from('settings').upsert(
    {
      key: LEVELS_SETTINGS_DOC,
      value: { ...current, [POINTS_KEY]: points },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );
  if (writeError) throw writeError;
}

/* ---------------------------------------------------------------------------
 * Pure helpers
 * ------------------------------------------------------------------------- */

/**
 * A box of digits → a number, and anything else → NaN.
 *
 * Deliberately not `Number(text)`. `Number('')`, `Number(' ')` and `Number(null)` are all 0,
 * and 0 is a real value here, so a coercing read would turn a box somebody cleared into a
 * level saved as free without a word about it. Negatives are not accepted because POINT_MIN
 * is 0; a leading minus falls to NaN and the shared validator names the bound.
 */
function parseWhole(text) {
  const t = String(text ?? '').trim();
  return t === '' || !/^\d+$/.test(t) ? NaN : Number(t);
}

/**
 * The Level 4 map as it would be stored: the default first, then each listed code.
 *
 * Codes are trimmed but never repaired. A row typed as '4' or left blank arrives at
 * validatePoints() as a key ACTIVITY_CODE_RE rejects, and it says so by name - which is the
 * message somebody can act on. Silently dropping the row would leave a filled-in line on
 * screen that saved nothing.
 */
function buildLevel4(defaultText, overrides) {
  const out = { default: parseWhole(defaultText) };
  for (const o of overrides) out[String(o.code ?? '').trim()] = parseWhole(o.value);
  return out;
}

/** The first code claimed twice, or claimed by the word the default already uses. */
function findDuplicate(overrides) {
  const seen = new Set(['default']);
  for (const o of overrides) {
    const code = String(o.code ?? '').trim();
    // An empty or malformed code is the shared validator's to refuse, not this check's - it
    // would otherwise report two blank rows as a duplicate and hide the real message.
    if (!code || !ACTIVITY_CODE_RE.test(code)) continue;
    if (seen.has(code)) return code;
    seen.add(code);
  }
  return '';
}

/**
 * A stable serialisation of a resolved points map, for equality only.
 *
 * The Level 4 keys are sorted, so a map rebuilt in a different order - which is what
 * removing an override row and typing it back produces - compares equal to the stored one.
 * Without the sort the Save button would light up for an edit that changed nothing, and the
 * audit log would fill with entries recording it.
 */
function canon(p) {
  return JSON.stringify([
    p.enabled,
    p.level1,
    p.level2,
    p.level3,
    Object.entries(p.level4 || {}).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  ]);
}

/* ---------------------------------------------------------------------------
 * Layout constants — module scope, so a keystroke in a number box does not allocate a fresh
 * style object per field. Tokens only; admin.css owns every value, and this file adds none.
 * ------------------------------------------------------------------------- */

const cardHead = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  flexWrap: 'wrap',
  marginBottom: 'var(--sp-2)',
};

const noMargin = { marginBottom: 0 };

const cardIntro = { marginTop: 0, marginBottom: 'var(--sp-4)' };

/** The row of controls. `flex-wrap` with per-field bases is what makes this survive 320px
 *  without a media query: fields drop to their own line in the order they are in. */
const controlRow = {
  display: 'flex',
  gap: 'var(--sp-4)',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
};

/** Shrinkable, but never below a width where three digits and the spinner still fit. */
const numField = { marginBottom: 'var(--sp-3)', flex: '0 1 180px' };

const codeField = { marginBottom: 'var(--sp-3)', flex: '0 1 160px' };

const checkField = { marginBottom: 'var(--sp-3)', flex: '0 0 auto' };

/** Level 4 reads as a property of the ladder, not as a fifth level - inset, on the sunken
 *  surface, with the same brand rule the sidebar uses to mark "this belongs to that". */
const level4Block = {
  marginTop: 'var(--sp-4)',
  padding: 'var(--sp-4)',
  background: 'var(--surface-sunken)',
  borderInlineStart: '3px solid var(--brand-200)',
  borderRadius: 'var(--r-md)',
};

const blockTitle = {
  fontSize: 'var(--fs-label)',
  fontWeight: 'var(--fw-semi)',
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 'var(--sp-3)',
};

const errorLine = { marginTop: 'var(--sp-3)' };
