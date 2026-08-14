import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLevels } from '../../lib/useSettings';
import { useScenes } from '../../lib/useScenes';
import { useDailyProgress } from '../../lib/progress';
import { useLevel4Gate } from '../../lib/level4';
/*
  The પુનરાવર્તન in progress — the ticks, saved by themselves, and the revisions behind them
  (0035). See the long note above the submit section for what changed and why, and
  src/lib/level3.js for the division of labour between this and useDailyProgress().
*/
import { useLevel3Session } from '../../lib/level3';
/* નોંધાવો — the fallback path, used only where 0035 has not been applied. */
import { ACTIVITY_KEY, newToken, submitActivity } from '../../lib/activity';
/* The two outcome words, from the module both this page and મારી પ્રગતિ render them with —
   one wording for one fact, and never `નિષ્ફળ` (§1 rule 4). */
import { STATUS_LABEL } from '../../lib/history';
import { JOURNEY_PAGE, usePageSpec } from '../../lib/journey';
/* The two things this page says when something is finished — a day of ધ્યાન, and the day
   લેવલ ૪ is earned. Both live with the app's other finishing moments so they read as one
   voice (shared/domain/milestones.js). */
import { dayComplete, levelUnlocked } from '../../lib/milestones';
import { gu } from '../../lib/scenes';
import PageIntro from '../../components/PageIntro';
import NavArrow from '../../components/NavArrow';
import ProgressRing from './ProgressRing';
import TickRow from './TickRow';
import './levels.css';

/**
 * This page is લેવલ ૩ and nothing else, so the number is a constant and not a prop.
 *
 * It was a prop while one component served both લેવલ ૩ and લેવલ ૪ — see below. It is read
 * in three places that all mean the same thing: the day bucket a tick lands in
 * (`progress.toggle`), the row in the સંચાલક's level list this page is named by (§36), and
 * TickRow's decision to show the વર્ણન. Named rather than written as `3` three times, so
 * those three stay one fact.
 */
const LEVEL = 3;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * PAGE CONTRACT — લેવલ ૩, વર્ણન યાદી (/level/3)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Purpose        The daily સાધના. A યુવક reads each વર્ણન, brings the દ્રશ્ય to mind, and
 *                ticks it. This is the level where the picture goes away.
 *
 * Input          useScenes() (number + વર્ણન), useDailyProgress() (today's ticks),
 *                useLevel4Gate() (what opens લેવલ ૪, in the સંચાલક's own number).
 * Visible        Today's ring, the instruction, and 1 → N rows of number + વર્ણન + tick.
 * Actions        Tick and untick. નોંધાવો, which records the day's answer as an attempt.
 *                Look at the દર્શન. Go on to લેવલ ૪ once it is open.
 * Persisted      `progress` — today's ticks and today's score, written to the phone at
 *                once and flushed to Postgres within the minute. `activity_attempts` —
 *                one append-only row per નોંધાવો, written by the server and never by this
 *                page. The two are independent: the score does not wait on a submission and
 *                a submission does not change the score.
 * Completion     None, and deliberately: this level is done again every day. Crossing the
 *                configured threshold **in a single day** opens લેવલ ૪ permanently.
 * Next           /level/4 — and only once the gate is open. A link to a locked level is an
 *                invitation to be turned away.
 * Previous       /darshan — લેવલ ૨, which is also the 'દર્શન કરો' door in the bar.
 * Excluded       The image (§1 rule 1 — `s.url` is never touched here, so not one image
 *                byte is requested), right-and-wrong, sorting or filtering, streaks, and
 *                any count of what is missing.
 * Loading        Three dots under the bar, with the bar already navigable.
 * Empty          No વર્ણન published yet → said plainly, with 'દર્શન કરો' as the way on.
 * Error          A failed flush is quiet: the ticks are on the phone, it retries by itself,
 *                and 'અત્યારે મોકલો' is offered for whoever would rather not wait.
 * Source of truth  દર્શન collection for the વર્ણન; `progress` for the day; the published
 *                  લેવલ ૪ configuration for the gate; shared/domain/journey.js for the
 *                  words a યુવક reads.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * લેવલ ૩ — વર્ણન યાદી (§7), the heart of the સાધના.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * It used to be two levels, and is now one
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This component served લેવલ ૩ and લેવલ ૪ from one body, because the two screens differed
 * in exactly one thing — whether the વર્ણન was on screen from the start or waited behind
 * 'જવાબ જુઓ' — and writing them twice would have been writing the midnight reset twice,
 * the flush twice and the ક્રમ twice.
 *
 * That is no longer what લેવલ ૪ is (LEVEL4.md decision #1). લેવલ ૪ is a container of
 * પ્રવૃત્તિઓ the સંચાલક composes — ૪.૧, ૪.૨, … each opened by finishing the one before it,
 * each permanently finished once passed, each attempted once and submitted rather than
 * ticked through a day. Its flat 1 → N list and its 'જવાબ જુઓ' reveal are gone, and with
 * them the reason these two were ever one file. લેવલ ૪ now lives in src/modules/level4/.
 *
 * What has *not* changed is anything on this page: the same 1 → N order, the same tick,
 * the same ring, the same day, the same row in `progress`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What is deliberately absent
 * ────────────────────────────────────────────────────────────────────────────
 *
 * * **No image.** લેવલ ૩ is the stage where the picture goes away (§1 rule 1). Nothing on
 *   this page touches `s.url`, so no image byte is even requested — the removal is real,
 *   not a CSS trick.
 * * **નોંધાવો is not a save button**, and the distinction is the whole of §9.
 *
 *   This page had no button at all, and the reason given was sound: each tick is already on
 *   the phone and the day's score is already on its way, so a button whose only job is to
 *   promise that would be a lie about how this works. **That is still true and nothing about
 *   it has changed** — closing the app mid-way still loses nothing, and a યુવક who never
 *   presses નોંધાવો still has his full day counted, still opens લેવલ ૪ at the threshold, and
 *   still appears on the સંચાલક's dashboard exactly as before.
 *
 *   What the button does is a different thing: it takes a *reading* of the day and keeps it,
 *   with its own ક્રમાંક and the દ્રશ્યો it held. A day's score is one number that moves all
 *   day; an attempt is a sentence about a moment — ૮૨/૧૦૮ at eleven o'clock, ૯૬ at four —
 *   and §7 asks for the second without giving up the first. So the two live side by side and
 *   neither waits on the other.
 *
 *   (લેવલ ૪'s 'પૂરું કરો' is a third thing again: there, the attempt is the only record of
 *   anything, and until it is sent nothing has happened at all.)
 * * **No sorting, no filtering, no "hide the ones you've done".** ક્રમ કદી તૂટે નહીં
 *   (§1 rule 2): 1 → N, always, at every level, on every visit.
 * * **Nothing red, nothing scolding, no count of what is missing** (§1 rule 4). An
 *   unticked દ્રશ્ય is simply not ticked yet.
 * * **No streaks** (§10). Not a word on this page counts consecutive days.
 */
export default function LevelPage() {
  const { levels } = useLevels();
  const { scenes, total, loading } = useScenes();
  const P = useDailyProgress();
  const L = useLevel3Session();

  /*
    ────────────────────────────────────────────────────────────────────────────
    Two sources, one of which is a fallback — and why both are still mounted
    ────────────────────────────────────────────────────────────────────────────

    `L.available` is false in exactly one situation: 0035 has not been applied to this project,
    so PostgREST answers 404 for every function in it. The page then behaves precisely as it did
    before — `useDailyProgress()` for the ticks, `submitActivity()` for નોંધાવો — because a
    યુવક must never be shown an error about a migration, and a bundle that shipped before the
    database caught up is an ordinary hour in a deploy, not a fault.

    Where 0035 *is* applied, the session owns the boxes and `useDailyProgress()` is kept only for
    what it has always been for: it is still mounted, still reads one row, and is still what the
    fallback needs. It costs a single select and starts no traffic while its outbox is empty.
  */
  const live = L.available;
  const ticked = live ? L.ticked : P.ticked3;
  const prune = live ? L.prune : P.prune;

  const validIds = useMemo(() => new Set(scenes.map((s) => s.id)), [scenes]);

  /*
    A tick for a દ્રશ્ય the સંચાલક has since withdrawn must stop counting, or the ring reads
    out of a collection that is no longer on screen. Done here rather than in progress.js
    because the current list is useScenes()'s to know (§62) — prune() compares before it
    writes, so this effect is a no-op on every render but the one that matters.
  */
  const settled = live ? L.ready : P.ready;
  useEffect(() => {
    if (!loading && settled) prune(validIds);
  }, [loading, settled, validIds, prune]);

  const toggleSession = L.toggle;
  const toggleDay = P.toggle;
  const onToggle = useCallback(
    (id) => (live ? toggleSession(id) : toggleDay(LEVEL, id)),
    [live, toggleSession, toggleDay]
  );

  // The name the સંચાલક chose (§36); the *behaviour* is never his to change (§37), which
  // is why only the name comes from settings.
  const name = levels.find((l) => l.levelId === LEVEL)?.name ?? '';

  /*
    What this level is *for*, in the same place the name comes from — configuration, with
    the code's own wording underneath it. The two are the same kind of thing: the સંચાલક may
    rename લેવલ ૩ and may rephrase its instruction, and neither changes what the page does
    (§36 / §37). `spec` is never null, so the description is on screen from the first paint.
  */
  const spec = usePageSpec(JOURNEY_PAGE.LEVEL3);

  /*
    લેવલ ૪'s gate, so this page can show where the day's work leads (LEVEL4.md decision #3).

    `P.score3` is counted in as well as the server's answer, and the local half is what
    makes the door open the moment it is earned rather than at the next flush: the gate is
    derived from the `progress` row, and that row is up to 60 seconds behind the phone by
    design (progress.js §12). Reading only the server would leave a યુવક who has just ticked
    his threshold looking at the invitation he has this second satisfied — the one moment on
    this page where being right a minute later is worse than being right now.

    It cannot over-promise: the local half only ever *offers* the door. `level4_gate_open()`
    decides on arrival and `level4_submit` re-checks it on every attempt (§37), so the worst
    case is a યુવક who taps through and is shown the same invitation on the other side.
  */
  /*
    ────────────────────────────────────────────────────────────────────────────
    0035 — the door now opens on a **finished** પુનરાવર્તન, and that is the point
    ────────────────────────────────────────────────────────────────────────────

    `L.today.scenes` is the day's distinct દ્રશ્યો counted from finished પુનરાવર્તન only, so the
    invitation appears when the work has actually been recorded and not merely ticked. That is
    the deliberate change: "લેવલ ૪ પર જવા માટે હંમેશા ડેટા સેવ કરવો પડે", so the data is always
    there and always real. A યુવક with unsaved ticks is offered નોંધાવો instead of the door —
    see the submit section — rather than being told he has failed at anything (§1 rule 4).

    Still not an over-promise, and now for a better reason than before. The old local half was
    `P.score3`, a phone-side count that could be up to a minute ahead of the row the gate reads.
    This one is the server's own answer to the same question the gate asks — distinct દ્રશ્યો for
    the day — and `level3_commit()` writes `progress.level3_score` from that identical count in
    the same transaction that records the પુનરાવર્તન. `level4_gate_open()` still decides on
    arrival and `level4_submit` still re-checks on every attempt (§37).

    The fallback keeps `P.score3` exactly as it was, because where 0035 is absent so is
    everything above.
  */
  const gate = useLevel4Gate();
  const earnedToday = live ? L.today.scenes : P.score3;
  const level4Open =
    gate.ready &&
    gate.published &&
    (!gate.requireGate || gate.gateOpen || earnedToday >= gate.gateThreshold);

  /* What is said the day the threshold is crossed — from shared/domain/milestones.js, with
     every other finishing moment in the app. The level number is passed in rather than
     written into the sentence: લેવલ ૪ is what this page opens today, and the wording should
     not have to be found and edited the day that changes. */
  const unlocked = levelUnlocked(gu(LEVEL + 1));

  // ---------------------------------------------------------------- નોંધાવો
  /*
    One attempt is one *answer*, and the token is what tells an answer from a retry.

    `signature` is the ticked set, sorted and joined — a value that is equal whenever the
    answer is the same, which is precisely the question idempotency has to ask. Sorted because
    a Set has no order and the same ૮૨ દ્રશ્યો must not look like a different answer for having
    been ticked in a different sequence.

    From it, one rule, and both halves of it are load-bearing:

      the answer changed since the last send  →  mint a new token. This is attempt #2, and it
                                                 must not be swallowed as a retry of #1.
      the answer is the same                  →  keep the token. A second press, a timed-out
                                                 request the browser replayed, a યુવક who was
                                                 not sure the first one landed: all of them
                                                 reach `activity_submit` carrying the token it
                                                 has already seen, and it returns the original
                                                 result without writing anything.

    The consequence worth stating: pressing નોંધાવો twice without changing a tick records one
    attempt, not two. That is the honest reading — nothing about the day changed between the
    presses — and it is what makes the button safe to press on a signal that gives no feedback.

    Held in refs rather than state because neither value is rendered and a re-render for them
    would be a re-render of a list ૧૦૯ rows long.
  */
  const signature = useMemo(() => [...P.ticked3].sort().join(','), [P.ticked3]);
  const tokenRef = useRef(null);
  const sentSigRef = useRef(null);

  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [saveError, setSaveError] = useState(null);

  const onLegacySubmit = useCallback(async () => {
    if (saving) return;
    if (sentSigRef.current !== signature || !tokenRef.current) tokenRef.current = newToken();

    setSaving(true);
    setSaveError(null);
    try {
      const res = await submitActivity({
        activity: ACTIVITY_KEY.REVISION,
        selected: [...P.ticked3],
        // The total comes from useScenes(), never a literal (§62), and never from the ring —
        // `P.score3` carries the load-time floor, which is a score and not a count of what
        // this કસોટી asked for.
        total,
        token: tokenRef.current,
      });
      sentSigRef.current = signature;
      setOutcome(res);
    } catch (err) {
      // `err.gu` is already a Gujarati sentence (src/lib/activity.js). Never red, never
      // phrased as his mistake, and the ticks are untouched either way — nothing was lost by
      // this failing, which is what the wording says.
      setSaveError(err?.gu || 'ફરી પ્રયત્ન કરો.');
    } finally {
      setSaving(false);
    }
  }, [saving, signature, P.ticked3, total]);

  /*
    Where 0035 is live the button no longer needs a token, a signature or a retry rule, and it
    is worth saying why all three moved rather than merely disappeared. They are still the
    defence; they are simply the database's now. `level3_finalize()` answers a repeated token
    with the attempt it already wrote, refuses to make a second પુનરાવર્તન out of an emptied
    draft, and keys the award on the attempt id — three defences in that order, none of which
    React can be trusted with (§7). The page mints one id per press and lets the server decide
    what it means.
  */
  const onSubmit = live ? L.finalize : onLegacySubmit;
  const busy = live ? L.busy : saving;
  const problem = live ? L.error : saveError;

  // ---------------------------------------------------------------- states
  if (loading || !settled) {
    return (
      <div className="level-wrap">
        <LevelBar />
        <div className="spinner-page"><span className="dot" /><span className="dot" /><span className="dot" /></div>
      </div>
    );
  }

  if (!total) {
    // §12 — the વર્ણન are the સંચાલક's to supply, and until they arrive there is nothing
    // to bring to mind. Said plainly, with no suggestion that the યુવક did anything wrong.
    return (
      <div className="level-wrap">
        <LevelBar />
        <section className="level-empty">
          <p>દર્શન હજુ તૈયાર થઈ રહ્યાં છે. થોડા વખતમાં અહીં આવશે.</p>
          <Link to="/darshan" className="btn-quiet btn-inline">દર્શન કરો</Link>
        </section>
      </div>
    );
  }

  /*
    ────────────────────────────────────────────────────────────────────────────
    Three numbers that must never be added to one another (§10)
    ────────────────────────────────────────────────────────────────────────────

      current   what is ticked right now. A session, and it goes back to ૦ every time a
                પુનરાવર્તન is finished. This is what the ring shows.
      today     the day's finished work — how many દ્રશ્યો, across how many પુનરાવર્તન.
      total     every પુનરાવર્તન he has ever finished, and what the ledger paid for them.

    The requirement is emphatic that the first must never be printed as the third: a યુવક who has
    ticked ૩૦ this minute and earned ૧૨૦ over the week must see both numbers and neither in the
    other's place. So they are three separate lines and no expression on this page adds one to
    another.
  */
  const current = live ? L.ticks : P.score3;
  const complete = current >= total;

  return (
    <div className="level-wrap">
      <LevelBar level4={level4Open} />

      <header className="level-head">
        <p className="level-eyebrow">લેવલ {gu(LEVEL)}</p>
        <h1>{name}</h1>
        <ProgressRing
          score={current}
          total={total}
          label={live ? 'વર્તમાન રિવિઝન' : 'આજની પ્રગતિ'}
          sub="વર્ણન વાંચો, દ્રશ્ય મનમાં લાવો, પછી ટિક કરો."
        />

        {/*
          The autosave, said in one quiet line and never as an error (§28, §1 rule 4).

          Three states and no fourth. 'saved' is the resting state after a tick has landed and is
          the whole of the reassurance a યુવક needs that he may close the app: it is the answer
          to the complaint this work began with. The failing state says what is true — the ticks
          are on the phone, it is retrying by itself — because level3.js does retry by itself,
          with a widening gap, and nothing is lost by the wait.
        */}
        {live && L.saveState !== 'idle' && (
          <p className={`level-note level-autosave is-${L.saveState}`} aria-live="polite">
            {L.saveState === 'saving' && 'સેવ થઈ રહ્યું છે…'}
            {L.saveState === 'saved' && '✓ ડેટા સેવ થયો'}
            {L.saveState === 'error' && 'ડેટા સેવ થઈ શક્યો નથી - ફરી પ્રયાસ થઈ રહ્યો છે.'}
          </p>
        )}

        {/*
          What this page is, in the યુવક's own words — and §9 said out loud.

          It used to be this one sentence typed here: "જે ટિક કરો તે તરત સચવાય છે… રાત્રે ૧૨
          વાગ્યે આજની ટિક ખાલી થશે". That sentence is still the middle of the instruction —
          the absence of a 'પૂરું કરો' button is only reassuring if he knows why it is absent
          — but it now comes from shared/domain/journey.js along with the two things it never
          said: that there is no picture here **on purpose**, and what he is meant to do
          instead. Behind the one closed line under it are 'આમાં આ નથી' and what opens લેવલ ૪.
        */}
        <PageIntro spec={spec} />

        {/*
          `P.carried3` is deliberately NOT rendered.

          There was a note here — "આજનાં N દ્રશ્યો બીજેથી ગણતરીમાં લેવાયાં છે" — for the one
          state where the ring and the boxes honestly disagree: today's score arrived partly
          from another phone, or from storage this browser cleared. The reasoning was that
          explaining it beats hiding it.

          The સંચાલક's answer is that it should not be on screen at all: it is a sentence
          about how the app syncs, addressed to a યુવક who is here to do his ધ્યાન, and on the
          rare morning it appears it raises a question he had not asked. The ring is still
          right — `P.carried3` is still counted into `P.score3` and still opens લેવલ ૪ — and
          nothing about the day's arithmetic changed with this line's removal. Only the
          explanation is gone.
        */}

        {/*
          Quiet, and never an error (§1 rule 4). The ticks are on the phone and the write
          retries by itself — on the next minute, on `online`, on the next visit. The
          button is there for the યુવક who would rather not wait.
        */}
        {!live && P.syncError && (
          <p className="level-note level-sync">
            તમારું ધ્યાન ફોનમાં સચવાયેલું છે. થોડી વારમાં આપોઆપ મોકલાઈ જશે.{' '}
            <button type="button" className="linklike" onClick={P.retry} disabled={P.saving}>
              અત્યારે મોકલો
            </button>
          </p>
        )}
      </header>

      {/*
        The list. Rendered whole — see TickRow for why this is not virtualised and how
        `content-visibility` does the same job in levels.css.

        `s.displayIndex` and not `s.n ?? s.index` (ORDERING.md §4). The stored number is the
        one printed inside the artwork and it keeps a hole where the સંચાલક has withheld a
        દ્રશ્ય — a યુવક reading "…૧૦૫, ૧૦૭…" down this list is being asked to hold a ક્રમ
        that is not the ક્રમ he is shown. `displayIndex` is the continuous ૧…N useScenes()
        derives over exactly the દ્રશ્યો in this array, and it is the same number he will
        see on the દર્શન card and in લેવલ ૪'s કસોટી. No `.sort()` here and none needed:
        the list arrives in canonical order.
      */}
      <ol className="tick-list">
        {scenes.map((s) => (
          <TickRow
            key={s.id}
            id={s.id}
            n={s.displayIndex}
            text={s.t}
            ticked={ticked.has(s.id)}
            onToggle={onToggle}
          />
        ))}
      </ol>

      {/* ફક્ત આનંદ (§1 rule 4) — the only thing said at the end is thanks, and now one line
          pointing at tomorrow, because લેવલ ૩ is the level a યુવક comes back to every morning
          and a full stop here reads as a thing finished rather than a thing kept up. The
          wording is shared/domain/milestones.js, with the app's five other such moments. */}
      <p className="level-foot" aria-live="polite">
        {complete ? dayComplete(gu(current)) : `આ રિવિઝનમાં: ${gu(current)} / ${gu(total)}`}
      </p>

      {/*
        ────────────────────────────────────────────────────────────────────────
        The pace rule, said before he is measured by it (§27)
        ────────────────────────────────────────────────────────────────────────

        Shown only when the સંચાલક has actually set one, and phrased as what this પુનરાવર્તન
        will count for rather than as a warning about what it will not. `eligibleTicks` is the
        server's own arithmetic read back — this page multiplies nothing (§19) — and the line is
        absent entirely while every તિક counts, because a યુવક doing his સાધના at a normal pace
        should never learn that a rule exists.
      */}
      {live && L.eligibleTicks !== null && L.eligibleTicks < current && (
        <p className="level-note level-pace" aria-live="polite">
          અત્યારે {gu(L.eligibleTicks)} ગણતરીમાં લેવાશે. થોડો વધુ સમય આપો, બાકીનાં પણ ગણાશે.
        </p>
      )}

      {/*
        ────────────────────────────────────────────────────────────────────────
        નોંધાવો — taking a reading of the day
        ────────────────────────────────────────────────────────────────────────

        Placed after the list and after the day's line, because that is where a યુવક is when
        he has finished going through it. Before the લેવલ ૪ door, because recording the day is
        part of this level and the door is the way out of it.

        Three states and no fourth, in the wording §31 asks for by name:

          idle     નોંધાવો, with the day's figure under it so he can see what he is recording
          saving   સાચવીએ છીએ… — the button is disabled, and this is the whole of the
                   defence a યુવક sees. The defence that matters is the token above him.
          settled  either 'તમારી આજની નોંધ સચવાઈ ગઈ' with the attempt's own ક્રમાંક, or
                   ફરી પ્રયત્ન કરો — and in the failing case the reassurance that nothing
                   was lost, which
                   is true: the ticks are on the phone and the day's score never went near
                   this button.

        The result line names the attempt number because that number is the point of the
        feature — 'પ્રયાસ ૨' is what tells this reading from this morning's. It is the
        server's number, from the row it wrote, and is never counted here (§30).
      */}
      <section className="level-submit">
        <button
          type="button"
          className="btn-gold btn-inline"
          onClick={onSubmit}
          disabled={busy || (live && current === 0)}
        >
          {busy ? 'સાચવીએ છીએ…' : 'ડેટા નોંધાવો'}
        </button>

        {/*
          ફરી શરૂ કરો — and it is not a delete button, which is the whole of §3 and §11.

          Pressing it finishes what is on screen into its own પુનરાવર્તન, with its own number and
          its own ગુણ, and only then clears the boxes. `level3_reset()` is `level3_finalize()`
          with a different name for that reason: there is no code path anywhere that removes an
          attempt or lowers a total. The line under it says so, because a યુવક about to clear a
          hundred ticks deserves to be told what happens to them.

          Absent when there is nothing ticked, because a reset that clears nothing is a button
          that does nothing.
        */}
        {live && current > 0 && (
          <button
            type="button"
            className="btn-quiet btn-inline"
            onClick={L.reset}
            disabled={busy}
          >
            ફરી શરૂ કરો
          </button>
        )}

        <p className="level-note" aria-live="polite">
          {problem
            ? problem
            : live
              ? (L.outcome?.saved
                ? `આ રિવિઝન નોંધાઈ ગયું. આજે ${gu(L.today.revisions)} રિવિઝન.`
                : `ટિક પૂરી થાય એટલે નોંધાવો. અત્યારે ${gu(current)} / ${gu(total)}`)
              : outcome
                ? `પ્રયાસ ${gu(outcome.attemptNumber)} - ${gu(outcome.completedItems)} / ${gu(outcome.totalItems)} - ${STATUS_LABEL[outcome.status]}`
                : `આજની ટિક નોંધીને રાખો. ${gu(P.score3)} / ${gu(total)}`}
        </p>

        {/*
          Said only when it actually happened. The award is 0 both when the સંચાલક has not
          switched points on and when the pace rule earned nothing yet, and in neither case is
          there anything to announce — a '+૦ ગુણ' would be the app drawing attention to a number
          that means nothing to him. The figure is the server's: this line reports it and never
          computes it (§19).
        */}
        {live
          ? L.outcome?.awarded > 0 && (
            <p className="level-note level-points">+{gu(L.outcome.awarded)} ગુણ</p>
          )
          : outcome?.pointsAwarded > 0 && (
            <p className="level-note level-points">+{gu(outcome.pointsAwarded)} ગુણ</p>
          )}

        {!live && outcome && !saveError && (
          <p className="level-note">તમારી આજની નોંધ સચવાઈ ગઈ.</p>
        )}

        {problem && (
          <p className="level-note">
            તમારી ટિક ફોનમાં એમ ને એમ જ છે. કંઈ ખોવાયું નથી.
          </p>
        )}

        {/*
          ──────────────────────────────────────────────────────────────────────
          The two figures §10 insists are different things
          ──────────────────────────────────────────────────────────────────────

          Above this line everything is about the પુનરાવર્તન on screen. Below it, everything is
          history: what today's finished પુનરાવર્તન came to, and what લેવલ ૩ has earned him
          altogether. Both come from the server and neither is added to the ring.

          This is the answer to the complaint that resetting looked like losing: a યુવક who
          clears a hundred ticks watches the ring go to ૦ and the total underneath it stay
          exactly where it was.
        */}
        {live && L.total.revisions > 0 && (
          <div className="level3-history">
            <p className="level-note">
              આજે: {gu(L.today.ticks)} ટિક - {gu(L.today.revisions)} રિવિઝન
              {L.today.points > 0 && ` - ${gu(L.today.points)} ગુણ`}
            </p>
            <p className="level-note level3-total">
              કુલ લેવલ {gu(LEVEL)} ગુણ: {gu(L.total.points)}
            </p>

            {/* §27's list, today only — the whole history is /history's to render. */}
            {L.revisions.length > 0 && (
              <ul className="level3-revisions">
                {L.revisions.map((r) => (
                  <li key={r.n}>
                    રિવિઝન {gu(r.n)} - {gu(r.ticks)} ટિક
                    {r.points > 0 && ` - +${gu(r.points)} ગુણ`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/*
        ────────────────────────────────────────────────────────────────────────
        The way on to લેવલ ૪ — the door at the end of this level
        ────────────────────────────────────────────────────────────────────────

        લેવલ ૩ is where લેવલ ૪ is earned, and until now nothing on this page said so. A યુવક
        who did the work here had to go back to મુખપૃષ્ઠ and find the tile to discover what
        it bought him. The end of the list is where he *is* when he finishes, so the door
        belongs here.

        Two states, and never a third. Open: an invitation onward. Not open: the same
        sentence મુખપૃષ્ઠ and Level4Page print, in the સંચાલક's own number — what opens the
        level, never how far away he is, never a count of what is missing (§1 rule 4, §10).
        Before the gate is known, and when no configuration is published, this renders
        nothing at all rather than a promise that might be withdrawn.
      */}
      {gate.published && (
        level4Open ? (
          <section className="level-next">
            {/*
              The one moment on this page worth marking.

              લેવલ ૩ has no 'પૂરું કરો' and no result screen — every tick saves itself and the
              day rolls over at midnight — so crossing the threshold would otherwise pass
              without a word, and the only sign would be a new button appearing quietly at
              the foot of a long list. Named plainly here: what he has done, and what it
              opened. Said once, without a count and without a comparison to anyone.
            */}
            <p className="level-next-line">{unlocked.title}</p>
            <p className="level-note">{unlocked.line}</p>
            <p className="level-note">{unlocked.grow}</p>
            {/*
              `P.retry()` on the way out, and it is not decoration.

              The gate is read from `progress`, and a tick is a localStorage write that
              reaches Postgres on the next flush (progress.js §12). A યુવક who crosses the
              threshold and taps straight through would otherwise arrive at લેવલ ૪ a moment
              before the row that opens it, and be shown the invitation he has just earned.
              This asks progress.js to send the day now; navigation never waits on it, and
              Level4Page re-reads the gate on mount either way.
            */}
            <Link to="/level/4" className="btn-gold btn-inline" onClick={() => (live ? L.flush() : P.retry())}>
              લેવલ ૪ પર જાઓ<NavArrow />
            </Link>
          </section>
        ) : gate.requireGate ? (
          <section className="level-next">
            {/*
              ────────────────────────────────────────────────────────────────
              0035 — the door needs the work *recorded*, not merely ticked
              ────────────────────────────────────────────────────────────────

              A યુવક who has ticked past the threshold but not pressed ડેટા નોંધાવો is one press
              away, and the honest thing to show him is the press rather than the gate sentence
              he has in fact already satisfied. That is also the decision behind the whole
              change: લેવલ ૪ opens on saved data, so the data is always there and always real.

              Said as the next step and never as a refusal (§1 rule 4) — nothing here tells him
              he fell short, how far he is, or how many days it has taken.
            */}
            {live && current >= gate.gateThreshold ? (
              <p className="level-next-line">
                ડેટા નોંધાવો, પછી લેવલ {gu(LEVEL + 1)} ખૂલશે
              </p>
            ) : (
              <>
                <p className="level-next-line">
                  લેવલ ૩ માં {gu(gate.gateThreshold)} પૂરાં કરો, પછી લેવલ ૪ ખૂલશે
                </p>
                <p className="level-note">
                  એક જ દિવસમાં {gu(gate.gateThreshold)} દ્રશ્યો યાદ કરો - પછી એ લેવલ કાયમ માટે ખુલ્લું રહેશે.
                </p>
              </>
            )}
            {/*
              The way back to the દર્શન, at the end of the list rather than only at the top.

              A યુવક who has read this far and not reached the number is at the exact point
              where the useful next step is to go and look again — and the only link to the
              pictures was in the bar he scrolled past a hundred rows ago. Offered as an
              ordinary part of the સાધના, never as a remedy for failing: nothing here says he
              fell short, how far he is, or how many days it has taken (§1 rule 4). There is
              no attempt to redo, because nothing was submitted — the ticks are already saved
              and tomorrow simply starts again.
            */}
            <Link to="/darshan" className="btn-gold btn-inline">ફરી દર્શન કરો</Link>
          </section>
        ) : null
      )}
    </div>
  );
}

/**
 * @param {{ level4: boolean }} props `level4` adds the shortcut to લેવલ ૪, which is shown
 *   only once it is open — a link to a locked level is an invitation to be turned away.
 */
function LevelBar({ level4 = false }) {
  return (
    <header className="level-bar">
      <Link className="linklike" to="/">મુખપૃષ્ઠ</Link>
      {/*
        લેવલ ૨ is the memory support this level removes (§1 rule 1), and it stays one tap
        away on purpose: a યુવક who cannot place a number should be able to go and look,
        not sit stuck. Nothing records that he went.
      */}
      <Link className="linklike" to="/darshan">દર્શન કરો</Link>
      {level4 && <Link className="linklike" to="/level/4">લેવલ ૪</Link>}
    </header>
  );
}
