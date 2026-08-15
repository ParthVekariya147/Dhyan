import { useEffect, useState } from 'react';
import {
  DEFAULT_LEADERBOARD,
  LEADERBOARD_KEY,
  LEADERBOARD_PERIODS,
  LEADERBOARD_TOP_MAX,
  LEADERBOARD_TOP_MIN,
  PERIOD_LABEL_EN,
  SUGGESTED_LEADERBOARD,
  resolveLeaderboard,
  validateLeaderboard,
} from '../../../../../shared/domain/leaderboard.js';
import { LEVELS_SETTINGS_DOC } from '../../../../../shared/domain/settings.js';
import { supabase } from '../../../lib/supabase';
import { useAdminAuth } from '../../../lib/adminAuth';
import { StatusBadge } from '../../../components/StatCard';
import { saveError } from '../../../lib/errors';

/**
 * ક્રમાંક — the one switch on this panel that lets a yuvak see another yuvak.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this card says more than a checkbox would
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every other setting on this page changes what a yuvak sees of **his own** સાધના. This one
 * changes who he is allowed to see, and it is the only feature in the project that does:
 * §13's rule is "there is no path that reads another યુવક's row without being a સંચાલક", and
 * a ranking is by definition a yuvak reading other yuvako. shared/domain/leaderboard.js sets
 * out at length how that line is crossed — once, through a single SECURITY DEFINER function,
 * with no RLS policy anywhere in the project widened, and returning a name and a number and
 * nothing else.
 *
 * A સંચાલક ticking a box labelled "Leaderboard" cannot know any of that, and the decision is
 * his to make rather than the software's. So the note on this card states plainly what a
 * yuvak will be shown and what he will not, and the card is written so that reading it is
 * how he decides, not the label.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why it is a card and not four fields on the Levels page
 * ────────────────────────────────────────────────────────────────────────────
 *
 * It writes into the same row the Levels page does — `settings['levels']`, alongside the
 * list, `level4Gate` and `points` — which is the argument for putting it there. It is here
 * for the reason PointsCard and GalleryCard are separate: this one has **bounds of its own**
 * that the database mirrors, so it has a refusal path of its own, and a save refused because
 * no period was chosen must land beside the period checkboxes rather than under a Save button
 * shared with the level names.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The two things this card cannot change, and says out loud
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   * **What a row carries.** Name and points. Not an id, not a SMK number, not a મોબાઈલ, not
 *     an email, not a સબઝોન, not a date. That is fixed in SQL and mirrored by
 *     `normaliseLeaderboard()`, and no setting on this card can widen it.
 *
 *   * **Who is on it.** Only yuvako who have actually earned something in the window. A list
 *     of everybody at ૦ is not a ranking, it is a directory — which is exactly the thing §13
 *     refuses.
 */
export default function LeaderboardCard({ leaderboard, onSaved }) {
  const { can } = useAdminAuth();

  /**
   * The same split as every other card on this page: `settings.read` opens it,
   * `settings.update` moves it. **Disabled, not hidden** — whether yuvako can currently see
   * each other's names is the single most useful fact on this card, and a VIEWER asked "how
   * does he know he is third?" should be able to read the answer rather than find an empty
   * space.
   *
   * The check that actually decides is the RLS policy on `settings` (0004_rbac.sql), which
   * asks for `settings.update`; this is only where that becomes visible.
   */
  const mayEdit = can('settings.update');

  /**
   * Through the shared resolver the SECURITY DEFINER function reads from, never a looser read
   * of this panel's own. The controls have to show what is actually in force — including when
   * the stored value is one this panel would not have written, which is exactly when the
   * difference matters. A row saying `enabled: true` with no period chosen resolves to **off**,
   * and this card must show it as off, because that is what a yuvak sees.
   */
  const inUse = resolveLeaderboard(leaderboard);

  /**
   * Has anybody ever configured this? Asked of the **raw** slice rather than the resolved one,
   * because resolveLeaderboard() answers `enabled: false` with no periods for both "switched
   * off deliberately" and "never touched", and only the second should be pre-filled.
   */
  const neverConfigured =
    !leaderboard ||
    typeof leaderboard !== 'object' ||
    Array.isArray(leaderboard) ||
    Object.keys(leaderboard).length === 0;

  /*
    `topN` is held as a **string**, exactly as PointsCard holds its values and GalleryCard its
    interval.

    A number-typed state forces a decision about what an empty box means on every keystroke,
    and the answer JavaScript gives — `Number('')` is 0 — is a value this field must not
    invent: 0 would be a board with nobody on it, saved silently while the box was still being
    typed into. An empty box stays an empty box: not yet a number.

    `periods` is held in the order he ticked them rather than in tab order, so that the
    canonical comparison below is doing real work: re-ticking the same three windows in a
    different order must read as no change at all.
  */
  const [enabled, setEnabled] = useState(inUse.enabled);
  const [periods, setPeriods] = useState(inUse.periods);
  const [defaultPeriod, setDefaultPeriod] = useState(inUse.defaultPeriod);
  const [topN, setTopN] = useState(String(inUse.topN));

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  // The rule is a hint before the first edit and an error only after one. A card that is red
  // the moment the page paints is telling the સંચાલક off for nothing (§31).
  const [touched, setTouched] = useState(false);

  /*
    Reload the controls when the stored row changes. Keyed on a serialisation of the resolved
    value rather than on the `leaderboard` object, which is a fresh identity on every parent
    render and would fight the સંચાલક for the cursor.
  */
  const savedKey = canon(inUse);
  useEffect(() => {
    setEnabled(inUse.enabled);
    setPeriods(inUse.periods);
    setDefaultPeriod(inUse.defaultPeriod);
    setTopN(String(inUse.topN));
    setTouched(false);
    setMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  /** The ticked windows in tab order, which is the order the yuvak app draws them in. */
  const offered = LEADERBOARD_PERIODS.filter((p) => periods.includes(p));

  /**
   * The candidate row, assembled from the controls exactly as it would be stored.
   *
   * `parseWhole` returns NaN for anything that is not a run of digits, and NaN is passed
   * through rather than swallowed: `typeof NaN === 'number'` but `Number.isFinite(NaN)` is
   * false, which is precisely the pair validateLeaderboard() tests, so a blank box arrives at
   * the shared rule as "not a number" instead of as a board of zero names.
   */
  const candidate = { enabled, periods, defaultPeriod, topN: parseWhole(topN) };

  /*
    The shared rule, run as he types.

    The **same call the save makes** — not a livelier local approximation of it. A divergent
    live check is a second answer to one question, and the answer that loses is always the one
    the સંચાલક can see: he would watch the card turn green and then read a refusal from the
    server naming a bound this card never mentioned. save() runs it again and is the
    authority; this is only where the message arrives at the click that caused it.
  */
  const check = validateLeaderboard(candidate);
  const error = touched && !check.ok ? check.gu : '';

  /**
   * Nothing to save when the controls already hold what is stored. Re-saving writes a settings
   * row and files an audit entry for a change that did not happen (§41), and an audit trail
   * carrying edits nobody made is worse than one carrying none.
   *
   * Compared through the canonical form, which sorts the periods into LEADERBOARD_PERIODS
   * order — so unticking આ અઠવાડિયે and ticking it again, or ticking the same three in a
   * different order, is correctly read as no change at all rather than as an edit worth
   * recording against somebody's name.
   */
  const changed = check.ok && canon(check.leaderboard) !== canon(inUse);

  /**
   * §31 — the first tick on a row nobody has ever configured fills in the suggestion.
   *
   * DEFAULT_LEADERBOARD is deliberately off with no window chosen, so that deploying this work
   * does not start showing two thousand yuvako to each other because a migration ran. The
   * suggestion belongs at the moment somebody actually asks for a board, which is here — and
   * it is a pre-fill, not a decision: every window and the length stay his to change before he
   * presses Save.
   */
  function toggleEnabled(on) {
    setEnabled(on);
    setTouched(true);
    setMsg(null);
    // `touched` is read before it is set, so it still holds the value from before this click.
    // That is the guard against the second tick: switching the board off and on again — or
    // choosing windows first and then ticking — must not overwrite what he has already
    // decided with the suggestion. Only the very first tick on an untouched, never-configured
    // card pre-fills.
    if (!on || !neverConfigured || touched) return;
    setPeriods([...SUGGESTED_LEADERBOARD.periods]);
    setDefaultPeriod(SUGGESTED_LEADERBOARD.defaultPeriod);
    setTopN(String(SUGGESTED_LEADERBOARD.topN));
  }

  /**
   * Tick or untick one window, and keep "which opens first" pointing at something on screen.
   *
   * Unticking the window that was the default would otherwise leave a board configured to open
   * on a tab that is not there. resolveLeaderboard() would quietly move it to the first offered
   * one, and validateLeaderboard() would refuse the save outright — both correct, and both
   * arriving after the fact. Moving it here means the radio he is looking at is never showing
   * an answer the save is about to reject.
   *
   * When the last window is unticked there is nothing to move it to, so it is left where it
   * is: re-ticking that window restores exactly what he had, and until he ticks something the
   * validator says in words that a board needs a window.
   */
  function togglePeriod(period, on) {
    setTouched(true);
    setMsg(null);

    const next = on ? [...periods.filter((p) => p !== period), period] : periods.filter((p) => p !== period);
    setPeriods(next);

    const stillOffered = LEADERBOARD_PERIODS.filter((p) => next.includes(p));
    if (stillOffered.length && !stillOffered.includes(defaultPeriod)) setDefaultPeriod(stillOffered[0]);
  }

  function edited(fn) {
    return (...args) => {
      fn(...args);
      setTouched(true);
      setMsg(null);
    };
  }

  async function save() {
    const v = validateLeaderboard(candidate);
    if (!v.ok) {
      setTouched(true);
      setMsg({ tone: 'danger', text: v.gu });
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      await saveLeaderboard(v.leaderboard);
      // Audited by the `audit_settings` trigger (0004_rbac.sql), which files this the moment
      // the row is written. There is no audit call here and there must not be one: a second
      // entry written from the browser would double every edit in the log, and could be
      // omitted by anyone talking to the database directly. Switching this particular setting
      // on is the one edit on this page it must be impossible to make without a trace.
      setMsg({
        tone: 'ok',
        text: v.leaderboard.enabled
          ? `Saved. Yuvaks can now see the top ${v.leaderboard.topN} names and their points.`
          : 'Saved. The leaderboard is off, so no yuvak sees any other name.',
      });
      onSaved?.();
    } catch (e) {
      // §31 — a failed save leaves every choice where it is and offers the button again.
      // saveError() surfaces the trigger's own refusal, which names the bound, so a write the
      // database rejects explains itself rather than arriving as "something went wrong".
      setMsg({ tone: 'danger', text: saveError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div style={cardHead}>
        <h2 style={noMargin}>Leaderboard</h2>
        {/* Which of the two states the stored row is in, in a word. The word carries it; the
            tone only repeats it (§43). Read back through the resolver, so a row switched on
            with no window chosen reads Off - which is what a yuvak sees. */}
        <StatusBadge tone={inUse.enabled ? 'ok' : 'off'}>{inUse.enabled ? 'On' : 'Off'}</StatusBadge>
      </div>

      {/*
        The substance, not the label. This is the only feature in the project where one yuvak
        sees another yuvak, so the card says what is shown and what is not before it offers a
        checkbox - the decision is his, and he cannot make it from the word "Leaderboard".
      */}
      <p className="card-note" style={cardIntro}>
        A ranking of yuvaks by the points they have earned. This is the{' '}
        <strong>only place in the app where one yuvak sees another yuvak</strong>, so it is off
        until you switch it on.
      </p>

      <p className="card-note" style={noTopMargin}>
        Each line shows <strong>a name and a number of points, and nothing else</strong>. No
        phone number, no SMK number, no email, no sub-zone, no dates, and no id of any kind - a
        line on this list cannot be used to look anything else up. Only yuvaks who have actually
        earned points in the chosen period appear; nobody is listed at 0, so this never becomes
        a directory of everyone. A yuvak is also told where he himself stands, even when he is
        not high enough to be on the list.
      </p>

      {!mayEdit && (
        <div className="notice notice-warn" role="status">
          You can read whether the leaderboard is on; changing it needs the{' '}
          <strong>settings.update</strong> permission.
        </div>
      )}

      <div style={controlRow}>
        <div className="field" style={checkField}>
          <label className="check" htmlFor="lb-on">
            <input
              id="lb-on"
              type="checkbox"
              checked={enabled}
              onChange={(e) => toggleEnabled(e.target.checked)}
              disabled={!mayEdit || busy}
            />
            Show a leaderboard
          </label>
          <span className="hint">
            {enabled
              ? 'Yuvaks can see the names below their own.'
              : 'Off - no yuvak sees any other name anywhere in the app.'}
          </span>
        </div>
      </div>

      {/*
        The windows, then which of them opens first, then how long the list is.

        Flex-wrap with a per-field basis rather than a fixed grid: a three-column grid holds
        its three columns all the way down to a 320px phone and clips the controls, where this
        drops each field onto its own line as soon as there is no room, in the order they are
        in and with no media query.
      */}
      <div style={controlRow}>
        <div className="field" style={periodField}>
          <span style={groupLabel} id="lb-periods-label">
            Periods to show
          </span>
          <div role="group" aria-labelledby="lb-periods-label" style={checkStack}>
            {LEADERBOARD_PERIODS.map((p) => (
              <label className="check" key={p} htmlFor={`lb-period-${p}`}>
                <input
                  id={`lb-period-${p}`}
                  type="checkbox"
                  checked={periods.includes(p)}
                  onChange={(e) => togglePeriod(p, e.target.checked)}
                  disabled={!mayEdit || busy}
                />
                {PERIOD_LABEL_EN[p]}
              </label>
            ))}
          </div>
          <span className="hint">
            More than one shows as tabs. The week starts on Monday and every period is counted
            in India time, on the server - so two yuvaks in different places are always being
            ranked over the same days.
          </span>
        </div>

        {/*
          Only the ticked windows are offered. A default pointing at a tab that is not on
          screen would open the board on nothing, so the list a સંચાલક can choose from is the
          list a yuvak will actually see.
        */}
        <div className="field" style={selectField}>
          <label htmlFor="lb-default">Opens first</label>
          <select
            id="lb-default"
            value={offered.includes(defaultPeriod) ? defaultPeriod : ''}
            onChange={edited((e) => setDefaultPeriod(e.target.value))}
            disabled={!mayEdit || busy || !offered.length}
            aria-describedby="lb-default-help"
          >
            {!offered.length && <option value="">Choose a period first</option>}
            {offered.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABEL_EN[p]}
              </option>
            ))}
          </select>
          <span className="hint" id="lb-default-help">
            {offered.length > 1
              ? 'The tab a yuvak lands on. He can switch to the others.'
              : 'Only the periods ticked beside this can open first.'}
          </span>
        </div>

        {/* No font-size on this input, ever. admin.css gives number inputs 16px under
            `pointer: coarse` for one reason: below that, iOS Safari zooms the page on focus
            and never zooms back out, which leaves a સંચાલક stranded at 1.3x. */}
        <div className="field" style={numField}>
          <label htmlFor="lb-top">How many names</label>
          <input
            id="lb-top"
            type="number"
            inputMode="numeric"
            min={LEADERBOARD_TOP_MIN}
            max={LEADERBOARD_TOP_MAX}
            step={1}
            value={topN}
            onChange={edited((e) => setTopN(e.target.value))}
            disabled={!mayEdit || busy}
            aria-describedby="lb-top-help"
          />
          <span className="hint" id="lb-top-help">
            Between <span className="mono">{LEADERBOARD_TOP_MIN}</span> and{' '}
            <span className="mono">{LEADERBOARD_TOP_MAX}</span>. A longer list is more names
            shown to more people.
          </span>
        </div>
      </div>

      {/* The rule that refused, once, above the button it would refuse. */}
      {error && (
        <p className="field-error" role="alert" style={errorLine}>
          <span aria-hidden="true">⚠</span> {error}
        </p>
      )}

      <div className="form-actions">
        <button
          className={`btn${busy ? ' is-busy' : ''}`}
          type="button"
          onClick={save}
          disabled={!mayEdit || busy || !changed}
        >
          {busy ? 'Saving…' : 'Save leaderboard'}
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
          controls - so a row stored in a state this panel would not have written shows what
          yuvaks are actually seeing, not what somebody has half-chosen above. */}
      <p className="card-note">
        In force now:{' '}
        {inUse.enabled ? (
          <>
            the top <span className="mono">{inUse.topN}</span> names for{' '}
            {inUse.periods.map((p) => PERIOD_LABEL_EN[p]).join(', ')}, opening on{' '}
            {PERIOD_LABEL_EN[inUse.defaultPeriod]}.
          </>
        ) : (
          'nothing - no yuvak sees any other name.'
        )}{' '}
        The same range is checked in the database, so a length outside{' '}
        <span className="mono">{LEADERBOARD_TOP_MIN}</span>-
        <span className="mono">{LEADERBOARD_TOP_MAX}</span> cannot be stored by any route, and
        the leaderboard is built by one function that returns names and points only.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * The write
 * ------------------------------------------------------------------------- */

/**
 * `settings['levels'].value.leaderboard`, merged into the row rather than replacing it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * This belongs in settingsService.js, and here is why it is not there yet
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Its home is `updateLevelsLeaderboard(leaderboard)` in
 * admin/src/features/settings/services/settingsService.js, beside `updateLevelsConfig` and
 * built on the same private `writeSetting()` — one module owning every read and write of the
 * `settings` table is the whole point of that file. It is here for the same reason PointsCard
 * keeps its own writer: that file is being edited in parallel by another session in this
 * change, and a component reaching into the table is a smaller, visible, easily-reversed wrong
 * than two sessions writing one module. Moving it is a delete and a one-line import; nothing
 * else on this card changes.
 *
 * The existing pair could not carry it. `getLevelsConfig()` returns only the resolved list and
 * gate — the raw `leaderboard` slice never survives it — and `updateLevelsConfig({levels,
 * gate})` writes exactly those two keys, so routing this save through it would mean re-writing
 * the level list from a card that has no business holding one, and would file the levels list
 * as edited in the audit log every time a window was ticked.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Merge, never replace
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `writeSetting()`'s pattern, followed exactly: read the current value, spread it, set one
 * key. `settings['levels']` also holds `levels` (the list the yuvak's home page is built
 * from), `level4Gate` (what opens Level 4) and `points`, and all three are read by the yuvak
 * app on every visit. Writing the whole object from this card would silently delete them, and
 * the first symptom would be two thousand people seeing the built-in default level list.
 */
async function saveLeaderboard(board) {
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
      value: { ...current, [LEADERBOARD_KEY]: board },
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
 * so a coercing read would turn a box somebody cleared into a request for a board of nobody,
 * and the shared validator would then have to guess whether he meant it. Negatives fall to NaN
 * and the shared rule names the bound.
 */
function parseWhole(text) {
  const t = String(text ?? '').trim();
  return t === '' || !/^\d+$/.test(t) ? NaN : Number(t);
}

/**
 * A stable serialisation of a leaderboard, for equality only.
 *
 * The periods are sorted into LEADERBOARD_PERIODS order, so a selection rebuilt in a different
 * order — which is what unticking a window and ticking it back produces — compares equal to
 * the stored one. Without the sort the Save button would light up for an edit that changed
 * nothing, and the audit log would fill with entries recording it (§41).
 */
function canon(b) {
  return JSON.stringify([
    b.enabled,
    LEADERBOARD_PERIODS.filter((p) => (b.periods || []).includes(p)),
    b.defaultPeriod,
    b.topN,
  ]);
}

/* ---------------------------------------------------------------------------
 * Layout constants — module scope, so a keystroke in the number box does not allocate a fresh
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

const cardIntro = { marginTop: 0, marginBottom: 'var(--sp-2)' };

const noTopMargin = { marginTop: 0, marginBottom: 'var(--sp-4)' };

/** The row of controls. `flex-wrap` with per-field bases is what makes this survive 320px
 *  without a media query: fields drop to their own line in the order they are in. */
const controlRow = {
  display: 'flex',
  gap: 'var(--sp-4)',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
};

/** Four labels stacked; wide enough for 'This month' without wrapping mid-label. */
const periodField = { marginBottom: 'var(--sp-3)', flex: '1 1 200px' };

const selectField = { marginBottom: 'var(--sp-3)', flex: '0 1 200px' };

/** Shrinkable, but never below a width where three digits and the spinner still fit. */
const numField = { marginBottom: 'var(--sp-3)', flex: '0 1 180px' };

/**
 * The enable row - one field, alone on its own `controlRow`.
 *
 * It was `0 0 auto`, reasoned from the line rather than from the screen: there is nothing
 * beside it to share the width with, so there seemed to be nothing to shrink against. There
 * is. `flex-basis: auto` on a flex item resolves to its content width, and for a flex base
 * size that means MAX-content - the whole hint on one line, never wrapped - and
 * `flex-shrink: 0` then refuses to give any of it back. The longer of the two hints under the
 * box, "Off - no yuvak sees any other name anywhere in the app.", is 301px of one line; at
 * 320px the card has 288px to offer, so the field hung 6px past the right edge and made the
 * whole of /settings scroll sideways. `body { overflow-x: hidden }` in admin.css HIDES that
 * scrollbar rather than preventing it, which is exactly why it went unseen until
 * verify-admin-responsive measured every element against the viewport at 320px.
 *
 * `0 1 auto` changes nothing on any width that has the room - the field still asks for its
 * content width, still does not grow, still sits alone on its line - and simply lets the hint
 * wrap onto a second line instead of widening the page when the room runs out. It does not
 * need a `min-width: 0` of its own: `.field` in admin.css already carries one, which is what
 * lets a shrinkable item go below its min-content width.
 */
const checkField = { marginBottom: 'var(--sp-3)', flex: '0 1 auto' };

const checkStack = { display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' };

/** A <span>, not a <label>: this names a group of four checkboxes and each of those has a
 *  label of its own, so a second `for`-less label would be a second thing to read. Styled to
 *  match `.field label` through tokens rather than by copying its rule. */
const groupLabel = {
  fontSize: 'var(--fs-label)',
  fontWeight: 'var(--fw-medium)',
  color: 'var(--text-body)',
};

const errorLine = { marginTop: 'var(--sp-3)' };
