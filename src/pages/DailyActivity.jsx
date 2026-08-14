import { useEffect, useMemo, useRef, useState } from 'react';
import { SelectField, TextField } from '../components/Field';
import { gu } from '../lib/constants';
import { isISODay, shiftISODay, todayIST } from '../lib/daily';
import {
  countsPayload,
  emptyRecord,
  formatCountdown,
  newClientToken,
  useCountdown,
  useDailyRecord,
  useOpenDays,
} from '../lib/dailyRecord';
/*
  Two stylesheets, and both are load-bearing.

  Vite ships a chunk's CSS with the chunk, so a class defined in a stylesheet this route has
  not imported is simply *absent* here — the same trap History.jsx documents at its own import
  and the one src/modules/level4/RevisionPage.jsx explains at length. This page is its own lazy
  chunk and borrows five things from forms.css: `.field` and everything inside it (the whole of
  <Field>'s geometry, which is what stops a validation message moving the button), `.btn`,
  `.btn-quiet`, `.notice` and `.spinner-page` with its `.dot`s. Importing it is not tidiness,
  it is the only way those rules exist on this route at all. It has already caused a blank
  screen twice.

  `.site-header`, `.rule` and the palette come from index.css, which main.jsx imports eagerly
  for every route, so they need no import here.
*/
import '../styles/forms.css';
import './daily-activity.css';

/**
 * The twelve months, in Gujarati.
 *
 * A second copy of History.jsx's list, and deliberately a copy. The original is a page-local
 * constant in a file this task does not own, and the two places it could be shared from —
 * `shared/domain/` and `src/lib/history.js` — are respectively not ours to edit and a module
 * whose four Supabase hooks would then be pulled into this chunk to render twelve words.
 *
 * `Intl.DateTimeFormat('gu-IN')` is refused for the reason History.jsx gives: the Gujarati
 * locale data is not on every Android in this zone, so a phone without it falls back to English
 * month names and the screen would read "14 August" on his handset and "૧૪ ઓગસ્ટ" on the
 * reviewer's, with nothing in a test catching it.
 */
const GU_MONTHS = [
  'જાન્યુઆરી', 'ફેબ્રુઆરી', 'માર્ચ', 'એપ્રિલ', 'મે', 'જૂન',
  'જુલાઈ', 'ઓગસ્ટ', 'સપ્ટેમ્બર', 'ઓક્ટોબર', 'નવેમ્બર', 'ડિસેમ્બર',
];

/**
 * `2026-08-14` → `આજે`, `ગઈકાલે`, `૧૩ ઓગસ્ટ`, or `૧૩ ઓગસ્ટ ૨૦૨૫`.
 *
 * Split on the string rather than passed through `new Date()`, which is the whole reason this
 * is six lines and not one: `new Date('2026-08-14')` is parsed as **UTC midnight** and read
 * back in the device's zone, so a phone anywhere west of Greenwich would render every heading
 * as the day before. The date is already the IST calendar date (src/lib/daily.js) and there is
 * nothing to convert — only to read.
 *
 * `ગઈકાલે` appears here where /history refuses it, and the difference is what the two screens
 * are for. History is a column of days scanned downward, where two relative words are a small
 * vocabulary the eye has to translate back into dates. This screen shows **one** day and offers
 * a handful of others to switch to, and yesterday is the one a યુવક reaches for most — the
 * whole point of a twenty-four hour window is that last night is still his to finish.
 */
function dayLabel(iso, today, yesterday) {
  if (iso === today) return 'આજે';
  if (iso === yesterday) return 'ગઈકાલે';

  const [y, m, d] = iso.split('-').map(Number);
  const month = GU_MONTHS[m - 1] ?? '';
  const thisYear = Number(today.slice(0, 4));

  return y === thisYear ? `${gu(d)} ${month}` : `${gu(d)} ${month} ${gu(y)}`;
}

/** `+૨૦૦`, or `-૫૦`. Zero never reaches this — every caller checks first. See the `+૦` rule. */
const signed = (n) => (n > 0 ? `+${gu(n)}` : gu(n));

/**
 * The dropdown's options, `0 … top`.
 *
 * **`top` is never a number this file chose.** §7 of docs/DAILY_RECORD_ARCHITECTURE.md is
 * explicit that the ceiling is *"a per-level daily maximum, admin-configurable"* and that
 * *"nothing is hardcoded; the maximum is a setting"* — so there is no 108 here, no 27, and no
 * fallback range invented when the setting has not arrived. A level whose maximum is missing is
 * rendered as text instead of a dropdown; see the form below.
 */
const optionRange = (top) => Array.from({ length: top + 1 }, (_, i) => i);

/**
 * What the reserved slot under a level says.
 *
 * Two sentences, and the second is the one this feature is really about. The decision recorded
 * in §7 is that *"a યુવક may report more than the app observed — activity done away from the
 * phone still happened"*, so a figure above the recorded one is stated as **his own record**
 * beside what the app happened to see. It is not a warning, it is not a confirmation to
 * dismiss, and it does not ask him to justify anything: this is a record he is keeping, not a
 * claim being audited. The app's number stays visible because the સંચાલક's report shows both
 * (§7 again) and a યુવક should be able to see what he is looking at.
 *
 * Both are one short line at 320px, which is what keeps the slot's reserved height honest.
 */
function levelHint(recorded, chosen) {
  return chosen > recorded
    ? `તમારી પોતાની નોંધ - એપ્લિકેશનમાં ${gu(recorded)}`
    : `એપ્લિકેશનમાં નોંધાયું: ${gu(recorded)}`;
}

/**
 * The whole of this page's validation, pure and returning `{ field: 'સંદેશ' }`.
 *
 * The shape Register.jsx establishes, and short for the same reason its own is long: almost
 * nothing here can be typed. The counts come from selects bounded by the server's maximum, so
 * the only free text on the screen is the date — and the only thing that can be wrong with it
 * is that it is not a day, or that it has not happened yet. Every message says what is wrong
 * AND what to do, in one line that fits the reserved slot, and none of them scolds.
 */
export function validateDaily({ date, today, levels, counts }) {
  const e = {};

  if (!isISODay(date)) e.date = 'તારીખ પસંદ કરો.';
  else if (date > today) e.date = 'આજ સુધીની તારીખ પસંદ કરો.';

  for (const l of levels) {
    // The same resolution `submit()` uses when it builds the payload — a level he has not
    // touched is his saved figure, not `undefined`. Validating a different value from the one
    // that is sent is how a form comes to refuse something it would have submitted happily.
    const n = counts[l.levelId] ?? l.reported;
    if (!Number.isInteger(n) || n < 0) e[`level-${l.levelId}`] = 'સંખ્યા પસંદ કરો.';
  }

  return e;
}

/** The app's three dots. forms.css owns them; daily-activity.css only takes the 70dvh back. */
function Dots() {
  return (
    <div className="spinner-page">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </div>
  );
}

/**
 * A difficulty, said as the app's and never as his (§1 rule 4), with the way out attached.
 *
 * `.notice` is the app's calm panel and `.notice.warn` its warmer amber, which is as far as
 * this app goes — nothing on this screen is red.
 */
function Notice({ text, onRetry }) {
  return (
    <div className="notice">
      <p>{text}</p>
      <button type="button" className="btn btn-quiet" onClick={onRetry}>
        ફરી પ્રયત્ન કરો
      </button>
    </div>
  );
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * PAGE CONTRACT — આજની પ્રગતિ (/daily)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Purpose        Let a યુવક write down what he actually did on a day — including what he did
 *                away from the phone — and correct it for twenty-four hours afterwards. The
 *                app's own count is the starting point, not the verdict.
 *
 * Input          useDailyRecord(date) — `daily_record_get(p_date)`: the record, its
 *                `reported_count` and `recorded_count` per level, the maximum each dropdown may
 *                run to, the points the server computed, and the window (`status`, `edit_until`,
 *                `remaining_seconds`). useOpenDays() — `daily_record_status()`, used for one
 *                quiet row of other days still open. All three derive the યુવક from
 *                `auth.uid()`; no call carries a user. This page's alone, like /history's hooks
 *                (§27): opening મુખપૃષ્ઠ costs nothing for them.
 * Visible        The chosen day, a date picker defaulting to today, the state of its
 *                twenty-four hour window with a live countdown when it is running, one row per
 *                level holding a dropdown from 0 to the સંચાલક's maximum with what the app
 *                recorded beneath it, the save button, and — below the button — what the server
 *                last computed: the points per level that earned any, the bonus if there is
 *                one, and the total.
 * Actions        Change the day. Change a count. Save. Retry a failed read. Nothing else.
 * Persisted      One row per (યુવક, day) through `daily_record_save()`, which validates the
 *                window, clamps to the maximum, computes the points and reconciles the ledger.
 *                Nothing on this handset: no localStorage, no draft, no remembered date.
 * Completion     A save the server accepted. It says so in one sentence and the figures below
 *                the button become the server's new answer.
 * Next           Nowhere. It is a leaf; the bottom bar is how a યુવક leaves it.
 * Previous       મારું, where the link to this page lives. No back link, for the same reason
 *                /history has none — the bar that brought him here is still on screen.
 * Excluded       **Any arithmetic on points.** Not one figure on this screen is computed here;
 *                every one is read from what the server returned, because §3 of
 *                docs/DAILY_RECORD_ARCHITECTURE.md records that there is no second scoring
 *                computation anywhere and that this work must not introduce one. A count he has
 *                changed but not saved therefore shows no points at all, and says why.
 *                **Streaks**, **any count of days he missed**, **any comparison with another
 *                યુવક**, and **anything red** (§1 rule 4). **No `+૦`**: a level that earned
 *                nothing has no pill, a day that earned nothing has no total, and a window with
 *                no time left has no clock — a confident zero is worse than a missing line
 *                (shared/domain/viewing-speed.js). **No word implying he is exaggerating**: a
 *                figure above the recorded one is his own record, said plainly, once.
 *                **No hardcoded range**: the dropdown's ceiling is the સંચાલક's setting or
 *                there is no dropdown.
 * Loading        The app's three dots, in place of the form. Saving does not blank anything —
 *                the button changes its word and every control is disabled.
 * Error / empty  Quiet, and never worded as his doing. An unmigrated 0034 answers 404 and the
 *                page says `આ નોંધ હમણાં ખૂલી નથી` with a way to ask again, rather than
 *                rendering blank. A save refused at the window's edge is stated as the day
 *                having closed, and the record is immediately re-read so the screen shows what
 *                the server actually thinks rather than what the phone's clock believed.
 * Source of truth  `daily_record_get()`, `daily_record_save()` and `daily_record_status()`
 *                  (0034), all limited to this યુવક by `auth.uid()`. **The server owns the
 *                  window**: the countdown here is a display of `remaining_seconds`, and when
 *                  it reaches zero the form closes because that is the honest thing to show —
 *                  never because the client has decided anything. A save is always attempted
 *                  and a refusal is always accepted.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why the points sit BELOW the save button
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Because they are the day's answer, not a preview of one. Only the server scores, so the
 * moment a dropdown moves, every figure on screen describes the previous save — and a total
 * that silently keeps saying ૧૪૩૦ while the form now says ૩ દર્શન would be the screen telling
 * a યુવક something untrue at exactly the moment he is deciding whether to save.
 *
 * Two things follow from that and both are deliberate. The figures live under the button, where
 * they read as the result of pressing it rather than as a running total above it. And the one
 * line that says `સેવ કર્યા પછી ગુણ ગણાશે.` sits in a slot whose height is reserved whether it
 * is filled or not — the same device <Field> uses for hint-or-error, for the same reason:
 * changing a count must not move the button under a thumb already travelling towards it.
 */
export default function DailyActivity() {
  /*
    Today, in India, and not on this handset. src/lib/daily.js's whole argument: a યુવક whose
    phone is set to another zone, or who is travelling, still gets the same day as everybody
    else, because the સાધના is kept in Surat's time and not in his.

    `useState(todayIST)` and not `useState(todayIST())` — the lazy initialiser form, so the
    boundary is read once when the page mounts rather than on every render.
  */
  const today = todayIST();
  // Calendar arithmetic, from the one module that owns it. `shiftISODay` asks only what day
  // precedes 14 August, which has the same answer in every zone; string maths would get month
  // ends and leap years wrong and a `new Date()` would reintroduce the UTC-midnight bug.
  const yesterday = shiftISODay(today, -1);
  const [date, setDate] = useState(todayIST);

  const { loading, error, record, retry, save, saving, saveError, savedAt } = useDailyRecord(date);
  const openDays = useOpenDays();

  /*
    His figures, as they stand on screen. Seeded from the record and re-seeded whenever a new
    one arrives — a different day, a retry, or the answer to a save — because the record IS the
    truth and anything typed against the previous one belongs to the previous one.

    `record` identity changes only on those three events, so this cannot wipe an edit made while
    nothing was in flight.
  */
  const [counts, setCounts] = useState({});
  const [errs, setErrs] = useState({});

  /*
    The idempotency key, held as a ref because it is the identity of an INTENTION rather than a
    piece of rendered state.

    Minted at the first save of a set of counts and kept while that set is retried, so a tap
    whose answer was lost on Surat mobile data can be repeated without §6's delta row being
    reconciled into the ledger twice. Cleared the moment a count changes — that is a different
    intention and must be a different token — and cleared again on success.
  */
  const tokenRef = useRef(null);

  const rec = record ?? emptyRecord(date);
  const levels = rec.levels;

  useEffect(() => {
    const next = {};
    for (const l of levels) next[l.levelId] = l.reported;
    setCounts(next);
    setErrs({});
    tokenRef.current = null;
    // `record` and not `levels`: the array is rebuilt on every render by the normaliser's
    // caller, whereas the record object changes exactly when a new answer arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record]);

  /*
    The countdown, and everything it decides.

    `deadlineAt` is `Date.now()` at the moment the answer arrived plus the server's
    `remaining_seconds` — a duration anchored to this device, never the server's instant read on
    a clock this device did not set (see normaliseDailyRecord). `useCountdown()` recomputes from
    it every second rather than decrementing, so a tab that was backgrounded shows the right
    number the instant it is looked at again.

    A day with no saved record has no window yet: the twenty-four hours begin at the first save,
    so `deadlineAt` is null, `left` is 0 and `clock` is the empty string — and the screen prints
    the promise without a clock beside it rather than `બાકી સમય: ૦૦:૦૦:૦૦`.
  */
  const left = useCountdown(rec.deadlineAt);
  const clock = formatCountdown(left, gu);
  const ranOut = rec.deadlineAt !== null && left <= 0;
  const locked = !rec.editable || ranOut;

  /*
    Has he moved anything since the record arrived?

    The `!== undefined` half is not defensive noise. A record arrives, renders, and the effect
    above seeds `counts` on the commit AFTER it — so for exactly one frame every level reads
    `undefined`, which is not equal to its reported figure. Without this the note under the form
    would flash `સેવ કર્યા પછી ગુણ ગણાશે.` for a frame on every single load, which is a sentence
    about something he has not done yet.
  */
  const dirty = useMemo(
    () => levels.some((l) => counts[l.levelId] !== undefined && counts[l.levelId] !== l.reported),
    [levels, counts]
  );

  // Every other day the server says is still open. Three at most: this is a way back to last
  // night, not a second history page, and a wall of chips on a 320px screen is a wall.
  const otherOpen = openDays.days.filter((d) => d !== date).slice(0, 3);

  const setCount = (levelId) => (ev) => {
    // `Number(...)`, never `gu()`. The option's VALUE is the Latin digit string and its TEXT is
    // the Gujarati one; the house rule is that Gujarati numerals are display only and never a
    // value sent to, compared in or parsed from the database.
    const n = Number(ev.target.value);
    setCounts((s) => ({ ...s, [levelId]: Number.isFinite(n) ? Math.trunc(n) : 0 }));
    if (errs[`level-${levelId}`]) setErrs((s) => ({ ...s, [`level-${levelId}`]: undefined }));
    // A different set of counts is a different intention. See tokenRef above.
    tokenRef.current = null;
  };

  async function submit(ev) {
    ev.preventDefault();

    const e = validateDaily({ date, today, levels, counts });
    setErrs(e);
    if (Object.keys(e).length) return;

    if (!tokenRef.current) tokenRef.current = newClientToken();

    /*
      Sent even when the countdown has just reached zero and the button is on its way to being
      disabled — the requirement's boundary case. The client's clock is not the authority; the
      server validates the window and its refusal is what closes the day here. `save()` re-reads
      the record on every failure precisely so that answer lands on screen.
    */
    const payload = countsPayload(
      levels.map((l) => ({ levelId: l.levelId, reported: counts[l.levelId] ?? l.reported }))
    );

    const { ok } = await save(payload, tokenRef.current);
    if (ok) {
      tokenRef.current = null;
      // Saving a day is what opens its window, so the row of other open days is now stale.
      openDays.refresh();
    }
  }

  /*
    The success sentence, and when it is allowed to be on screen.

    `!dirty` is the part worth stating: a યુવક who saves and then moves a dropdown is looking at
    a form that no longer matches what was saved, and a line still saying it is saved would be
    the screen contradicting itself. The requirement's own words, and the day's own word — a
    save on another day is not "આજનો".
  */
  const showSaved = savedAt > 0 && !dirty && !saveError;
  const savedMessage = date === today
    ? 'તમારો આજનો ડેટા સાચવાઈ ગયો છે.'
    : 'તમારો ડેટા સાચવાઈ ગયો છે.';

  return (
    <div className="daily-wrap">
      <header className="site-header">
        <h1>આજની પ્રગતિ</h1>
        <p>{dayLabel(date, today, yesterday)}</p>
        <div className="rule" />
      </header>

      <div className="daily-inner">
        <form onSubmit={submit} noValidate>
          {/*
            The app's first <input type="date">, and it is measured rather than assumed.

            <TextField> gives it the same label, the same 48px control box and the same reserved
            message slot as every other field in the app; daily-activity.css then removes
            Chrome's intrinsic sizing (`appearance: none`, an explicit `min-height`, an explicit
            `line-height`) and paints the app's own gold caret in place of the native indicator,
            which is a dark glyph invisible on a dark field. See the long note in that file.

            `max` is today and there is no `min`: a day that has not happened has nothing to
            record, while the earliest day a યુવક has is not something this page can know without
            inventing it.
          */}
          <TextField
            id="daily-date"
            label="તારીખ"
            hint="બીજા દિવસની નોંધ પણ જોઈ શકો છો."
            error={errs.date}
            type="date"
            value={date}
            max={today}
            onChange={(ev) => {
              setDate(ev.target.value);
              if (errs.date) setErrs((s) => ({ ...s, date: undefined }));
            }}
            disabled={saving}
          />

          {/*
            The other days whose window is still open.

            Shown only when there is one, and never as a list of days he has NOT filled in — the
            function answers which records are still editable, which is an invitation and not an
            audit. Without this the twenty-four hours are a promise nothing on the screen keeps:
            he would have to guess a date into the picker to find out that last night is still
            his.
          */}
          {otherOpen.length > 0 && (
            <div className="daily-open">
              <p className="daily-open-label">આ દિવસો પણ ખુલ્લા છે</p>
              <div className="daily-open-days">
                {otherOpen.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className="daily-open-day"
                    onClick={() => setDate(d)}
                    disabled={saving}
                  >
                    {dayLabel(d, today, yesterday)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {loading && <Dots />}

          {error && !loading && <Notice text={error} onRetry={retry} />}

          {!loading && !error && levels.length === 0 && (
            /*
              Nothing to fill in. Phrased forward and without blame: either 0034 is not migrated
              yet, or the સંચાલક has not opened this day's levels — neither is anything a યુવક
              did, and neither is worth a stack trace on his screen.
            */
            <p className="daily-empty">આ નોંધ હમણાં ખૂલી નથી. થોડી વાર પછી ફરી જુઓ.</p>
          )}

          {!loading && !error && levels.length > 0 && (
            <>
              {/*
                The window, in the two states it has.

                Open: the requirement's own sentence, and the clock under it when there is one.
                A day never saved has no clock — the twenty-four hours start at the first save —
                and prints the promise alone rather than a zeroed timer.

                Locked: calm, and phrased as what the day IS rather than as what he may no
                longer do. Nothing here says નિષ્ફળ, nothing is red, and the figures below stay
                exactly where they were so the day still reads as a record rather than as a door
                that shut.
              */}
              {/* The same plain `.notice` in both states, deliberately. `.notice.warn` is the
                  app's amber and it is reserved for the one thing on this page that is
                  genuinely a difficulty — a save the server would not take. Neither an open
                  window nor a closed one is a difficulty: one is the ordinary state of today
                  and the other is the ordinary state of the day before last. Which of the two
                  he is looking at is said by the sentence and by the controls being disabled,
                  which is enough, and colouring a normal state would spend the app's only
                  attention-getting ink on something that does not need it. */}
              <div className="notice daily-window">
                {locked ? (
                  <p>આ દિવસની નોંધ હવે વાંચી શકાય છે.</p>
                ) : (
                  <>
                    <p>તમારી માહિતી ૨૪ કલાક સુધી સુધારી શકો છો.</p>
                    {clock && (
                      <p className="daily-clock">
                        બાકી સમય: <span className="daily-clock-value">{clock}</span>
                      </p>
                    )}
                  </>
                )}
              </div>

              {levels.map((l) => {
                const chosen = counts[l.levelId] ?? l.reported;

                /*
                  A level whose maximum has not arrived gets no dropdown.

                  §7 says the bound is the સંચાલક's setting and that nothing is hardcoded, so
                  there is no range to fall back to — inventing one would silently cap a યુવક at
                  a number nobody chose, and would do it invisibly. What the record holds is
                  shown as text instead, with one line saying the limit is not set yet. The count
                  is still sent on save, unchanged, so nothing is lost by the level being
                  read-only for a while.
                */
                if (l.max === null) {
                  return (
                    <div className="daily-level is-fixed" key={l.levelId}>
                      <p className="daily-fixed-label">{l.label}</p>
                      <p className="daily-fixed-value">{gu(chosen)}</p>
                      <p className="daily-fixed-note">આ લેવલની મર્યાદા હજી ગોઠવાઈ નથી.</p>
                    </div>
                  );
                }

                /*
                  The ceiling. The સંચાલક's maximum, or the figure already saved when that is
                  the larger — which is not a wider range invented here but the record's own
                  number: a maximum lowered after a save must not make the screen show a smaller
                  count than the server holds.
                */
                const top = Math.max(l.max, l.reported);

                return (
                  <div className="daily-level" key={l.levelId}>
                    <SelectField
                      id={`daily-level-${l.levelId}`}
                      label={
                        <>
                          <span className="daily-level-name">{l.label}</span>
                          {/* The `+૦` rule. A level that earned nothing gets no pill: a zero
                              beside it would read as a mark against a day that earned nothing
                              simply because the morning had already earned it (§18). */}
                          {l.points !== 0 && (
                            <span className="daily-level-points">{signed(l.points)}</span>
                          )}
                        </>
                      }
                      hint={levelHint(l.recorded, chosen)}
                      error={errs[`level-${l.levelId}`]}
                      value={String(chosen)}
                      onChange={setCount(l.levelId)}
                      disabled={saving || locked}
                    >
                      {optionRange(top).map((n) => (
                        // value: the Latin digits the database is given. text: the Gujarati
                        // digits a યુવક reads. They are never the same string.
                        <option key={n} value={String(n)}>
                          {gu(n)}
                        </option>
                      ))}
                    </SelectField>
                  </div>
                );
              })}

              {/*
                One reserved line, above the button, holding the one thing that has to be said
                before it is pressed — that a changed count is scored when it is saved and not
                before. Its height is reserved whether it is filled or not, exactly as
                <Field>'s message slot is, so moving a dropdown cannot move the button under a
                thumb already travelling towards it.
              */}
              <p className="daily-note">{dirty && !locked ? 'સેવ કર્યા પછી ગુણ ગણાશે.' : ''}</p>

              <button className="btn" type="submit" disabled={saving || locked}>
                {saving ? 'સેવ થાય છે…' : 'ડેટા સેવ કરો'}
              </button>
            </>
          )}
        </form>

        {/*
          What happened, said once, under the button that caused it.

          `role="status"` and `aria-live="polite"`, the same choice <Field> makes and for the
          reason stated there: a polite region announces when he pauses instead of interrupting
          mid-word. Below the button rather than above it, so neither sentence can move the
          control a thumb is already reaching for.
        */}
        <div className="daily-result" role="status" aria-live="polite">
          {saveError && <div className="notice warn">{saveError}</div>}
          {showSaved && <div className="notice">{savedMessage}</div>}
        </div>

        {/*
          What the day is worth, as the server last computed it.

          Every figure is read, none is derived — see the contract above and §3 of the
          architecture. The whole block is absent when the day has earned nothing, for the same
          reason /history draws no band at ૦ / ૦: a total of ૦ under a heading called ગુણ is a
          confident zero about a day that may simply not have been saved yet.
        */}
        {!loading && !error && rec.total !== 0 && (
          <section className="daily-summary">
            <h2 className="daily-head">ગુણ</h2>

            <ul className="daily-sum-list">
              {/* Only the levels that earned. A `+૦` line is the same misleading zero. */}
              {levels
                .filter((l) => l.points !== 0)
                .map((l) => (
                  <li className="daily-sum-row" key={l.levelId}>
                    <span className="daily-sum-name">{l.label}</span>
                    <span className="daily-sum-value">{signed(l.points)}</span>
                  </li>
                ))}

              {/* And only when there is one. `બોનસ +૦` under a total is the same figure said
                  twice, one of which is a zero — the refusal LevelTotals() makes in
                  History.jsx. */}
              {rec.bonus !== 0 && (
                <li className="daily-sum-row">
                  <span className="daily-sum-name">બોનસ</span>
                  <span className="daily-sum-value">{signed(rec.bonus)}</span>
                </li>
              )}
            </ul>

            <div className="daily-grand">
              <span className="daily-sum-name">કુલ</span>
              <span className="daily-grand-value">{gu(rec.total)}</span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
