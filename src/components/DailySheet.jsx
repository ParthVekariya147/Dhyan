import { useEffect, useRef, useState } from 'react';
import DailyLevelField from './DailyLevelField';
import { gu } from '../lib/constants';
import { todayIST } from '../lib/daily';
import {
  emptyRecord,
  formatCountdown,
  levelKey,
  useCountdown,
  useDailyDraft,
  useDailyRecord,
} from '../lib/dailyRecord';
/*
  Three stylesheets, and all three are load-bearing.

  Vite ships a chunk's CSS with the chunk, so a class defined in a stylesheet this chunk has not
  imported is simply *absent* — the trap src/modules/level4/RevisionPage.jsx explains at length
  and which has already produced a blank screen twice in this app. This component is drawn from
  the ક્રમાંક chunk and borrows `.field` and its geometry, `.btn`, `.btn-quiet`, `.notice` and
  `.spinner-page` from forms.css, and every `.daily-*` rule from daily-activity.css, which is
  /daily's stylesheet and is imported here so that the sheet and the page cannot drift into two
  different-looking versions of one form.
*/
import '../styles/forms.css';
import '../pages/daily-activity.css';
import './daily-prompt.css';

/**
 * "આજે તમે શું કર્યું?" — today's record, asked on ક્રમાંક.
 *
 * The heavy half of the pair. <DailyPrompt /> is the gate: it reads the સંચાલક's two switches
 * and imports this lazily, so a project that has the prompt switched off never fetches this
 * chunk, never reads the day's record, and pays one small settings read for the whole feature.
 * The same division InstallPrompt/InstallSheet make, for the same reason.
 *
 * `autoOpen` arrives as a prop rather than being read here, so the gate is the single place the
 * stored row is turned into a decision and the two halves cannot disagree about what it said.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why the board is where this is asked
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ક્રમાંક is the one screen a યુવક opens because he wants to know where he stands, and standing
 * anywhere at all is a function of what he has been paid for. Until today is written down, the
 * board he is reading is a board without his day on it — so the honest moment to ask is the
 * moment he asks about the ranking, and not a notification, a badge, or a page he has to
 * remember to visit.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * When it opens itself, and when it waits to be asked
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **The app has seen something today, and the day is not written down yet** → the sheet opens on
 * its own, unless the સંચાલક has turned `autoOpen` off. There is a real question to put and the
 * answers are already filled in; he confirms two dropdowns and it is done.
 *
 * **The app has seen nothing** → it does NOT open. A sheet in front of a board, asking a યુવક to
 * account for a day the app has no evidence of, is an interruption that starts from zero and
 * reads as an accusation of having done nothing. The button at the foot of the board is there
 * instead, for the યુવક who did his ધ્યાન away from the phone and wants to say so.
 *
 * **Already saved** → it does not open either, and the button stays, because the twenty-four
 * hour window means a saved day is still his to correct.
 *
 * "પછી" closes it for this visit and it asks again the next time he opens the board — until the
 * day is saved, or the window closes on its own. Nothing is remembered on the handset: a
 * dismissal kept in localStorage would be a second, weaker copy of "is this day written down
 * yet", which the server already answers on every open.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * §27, widened by exactly one route, deliberately
 * ────────────────────────────────────────────────────────────────────────────
 *
 * src/lib/dailyRecord.js says these hooks are "the `/daily` route only", because the મુખપૃષ્ઠ
 * must not pay for reads it does not render. ક્રમાંક is now the second route, and it earns it
 * the same way /daily does: it is somewhere a યુવક **goes**, not something he is handed on the
 * way in. The મુખપૃષ્ઠ, the level pages and the bottom bar are unchanged and must stay that way.
 *
 * One read, not two: `useOpenDays()` is deliberately NOT called here. Yesterday's still-open
 * window belongs on the page that can navigate to it, and this sheet asks about today only.
 */
export default function DailySheet({ autoOpen, onSaved }) {
  const today = todayIST();
  const { loading, error, record, retry, save, saving, saveError } = useDailyRecord(today);

  const rec = record ?? emptyRecord(today);
  const levels = rec.levels;
  const draft = useDailyDraft(record);
  const [errs, setErrs] = useState({});
  const [open, setOpen] = useState(false);

  const left = useCountdown(rec.deadlineAt);
  const clock = formatCountdown(left, gu);
  const ranOut = rec.deadlineAt !== null && left <= 0;
  const locked = !rec.editable || ranOut;

  /*
    The one automatic opening, and it happens at most once per visit to this page.

    The ref is what makes "once" true rather than "whenever the conditions hold": `record`
    changes identity on every retry and on the answer to every save, and without the latch a
    save that failed would re-open a sheet the યુવક had already put down — over and over, on the
    page he came here to read.

    Four conditions. `autoOpen` is the સંચાલક's, and the other three are facts about the data:
    the day is not written down yet, its window is still open, and **the app actually saw
    something**. That last one is what keeps this from being an interruption — with no evidence
    there is no question worth putting, and the button below is the way in for the યુવક who
    wants to answer anyway.

    Only the first is a setting, deliberately. Whether to interrupt somebody is a decision about
    a સંઘ; whether there is anything to interrupt him about is not, and a switch that let a
    સંચાલક put an empty form in front of every યુવક every evening would be a switch for doing
    the one thing this design refuses.
  */
  const askedRef = useRef(false);
  useEffect(() => {
    if (askedRef.current || loading || error || !record || !autoOpen) return;
    if (record.saved || !record.editable || !appSawSomething(record)) return;
    askedRef.current = true;
    setOpen(true);
  }, [record, loading, error, autoOpen]);

  /*
    Focus moves into the sheet when it opens, and this is the whole of its dialog behaviour.

    Not a `<dialog>` and not a focus trap: the sheet is dismissible, everything behind it is
    still a legitimate thing to read, and a half-built trap tells assistive software something
    untrue — the same argument Leaderboard.jsx makes for using plain buttons with `aria-pressed`
    rather than a `role="tablist"` it does not fully implement. `role="dialog"` with
    `aria-modal="false"` is what this actually is: a panel that appeared, with a name.
  */
  const headingRef = useRef(null);
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);

  async function submit(ev) {
    ev.preventDefault();

    const counts = {};
    for (const l of levels) counts[levelKey(l)] = draft.rowFor(l).value;

    const bad = {};
    for (const l of levels) {
      const n = counts[levelKey(l)];
      if (!Number.isInteger(n) || n < 0) bad[levelKey(l)] = 'સંખ્યા પસંદ કરો.';
    }
    setErrs(bad);
    if (Object.keys(bad).length) return;

    const { ok } = await save(draft.payload(), draft.token());
    if (ok) {
      draft.clearToken();
      setOpen(false);
      // The board is now out of date — saving a day is what changes the ranking he came here to
      // look at, and leaving yesterday's numbers on screen under a sheet that has just closed
      // would be the page contradicting the thing it had just accepted.
      onSaved?.();
    }
  }

  /*
    The way in when the sheet did not open itself, and the way back in after it was put down.

    Drawn once the record has arrived and there is something to edit, and NOT while the window
    is closed — a button that opens a form nothing can be typed into is a promise the sheet then
    breaks. It sits at the foot of the board because that is where a યુવક is when he has finished
    reading it, and because a control at the top would be a second thing competing with the
    heading of the page he actually asked for.
  */
  const button =
    loading || error || locked || levels.length === 0 || open ? null : (
      <button type="button" className="dp-open btn btn-quiet" onClick={() => setOpen(true)}>
        {rec.saved ? 'આજની નોંધ સુધારો' : 'આજની નોંધ ઉમેરો'}
      </button>
    );

  if (!open) return button;

  return (
    <div className="dp-scrim" role="presentation">
      <section className="dp-sheet" role="dialog" aria-modal="false" aria-labelledby="dp-title">
        <h2 className="dp-title" id="dp-title" tabIndex={-1} ref={headingRef}>
          આજે તમે શું કર્યું?
        </h2>
        <p className="dp-sub">
          એપ્લિકેશને જે જોયું એ ભરેલું છે. ફોન વગર કર્યું હોય તો આંકડો વધારી શકો છો.
        </p>

        <form onSubmit={submit} noValidate>
          {loading && (
            <div className="spinner-page">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          )}

          {error && !loading && (
            <div className="notice">
              <p>{error}</p>
              <button type="button" className="btn btn-quiet" onClick={retry}>
                ફરી પ્રયત્ન કરો
              </button>
            </div>
          )}

          {!loading && !error && levels.length === 0 && (
            <p className="daily-empty">આ નોંધ હમણાં ખૂલી નથી. થોડી વાર પછી ફરી જુઓ.</p>
          )}

          {!loading && !error && levels.length > 0 && (
            <>
              {/* The window, in one line. The page has room for the promise and the clock as
                  two sentences; a sheet over a board does not, and the clock is the half that
                  is actually changing. A day never saved has no clock at all — the twenty-four
                  hours begin at the first save — and prints the promise alone rather than a
                  zeroed timer. */}
              <p className="dp-window">
                {locked
                  ? 'આ દિવસની નોંધ હવે વાંચી શકાય છે.'
                  : clock
                    ? `સુધારવા માટે બાકી: ${clock}`
                    : 'સેવ કર્યા પછી ૨૪ કલાક સુધી સુધારી શકશો.'}
              </p>

              {levels.map((l) => (
                <DailyLevelField
                  key={levelKey(l)}
                  level={l}
                  row={draft.rowFor(l)}
                  draft={draft}
                  error={errs[levelKey(l)]}
                  disabled={saving || locked}
                />
              ))}

              {/* The same reserved line /daily carries, and reserved here for the same reason:
                  changing a count must not move the button under a thumb already travelling
                  towards it. */}
              <p className="daily-note">{draft.dirty && !locked ? 'સેવ કર્યા પછી ગુણ ગણાશે.' : ''}</p>

              <div className="dp-actions">
                <button className="btn" type="submit" disabled={saving || locked}>
                  {saving ? 'સેવ થાય છે…' : 'ડેટા સેવ કરો'}
                </button>
                {/* Always reachable, and never disabled while a save is in flight: a યુવક whose
                    request is hanging on a weak signal must still be able to put the sheet down
                    and read the board he came for (§1 - never a dead end). It closes the sheet
                    and leaves the button below, so putting it down is never losing the way back
                    to it. */}
                <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
                  પછી
                </button>
              </div>
            </>
          )}

          <div className="dp-result" role="status" aria-live="polite">
            {saveError && <div className="notice warn">{saveError}</div>}
          </div>
        </form>
      </section>
    </div>
  );
}

/**
 * Whether the app has seen anything today — which is what decides between opening the sheet and
 * waiting to be asked.
 *
 * `recorded` and not `reported`: the question is what the APP observed, and `reported` falls
 * back to `recorded` in the normaliser, so a day with a saved record would answer this the same
 * way whatever the app had actually seen. Exported so the page that owns the routing decision
 * reads it from the same place the sheet does.
 */
export const appSawSomething = (record) =>
  Boolean(record?.levels?.some((l) => l.recorded > 0));
