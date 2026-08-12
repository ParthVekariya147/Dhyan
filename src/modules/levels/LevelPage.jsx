import { useCallback, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLevels } from '../../lib/useSettings';
import { useScenes } from '../../lib/useScenes';
import { useDailyProgress } from '../../lib/progress';
import { useLevel4Gate } from '../../lib/level4';
import { JOURNEY_PAGE, usePageSpec } from '../../lib/journey';
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
 * Actions        Tick and untick. Look at the દર્શન. Go on to લેવલ ૪ once it is open.
 * Persisted      `progress` — today's ticks and today's score, written to the phone at
 *                once and flushed to Postgres within the minute.
 * Completion     None, and deliberately: this level is done again every day. Crossing the
 *                configured threshold **in a single day** opens લેવલ ૪ permanently.
 * Next           /level/4 — and only once the gate is open. A link to a locked level is an
 *                invitation to be turned away.
 * Previous       /darshan — લેવલ ૨, which is also the 'દર્શન જુઓ' door in the bar.
 * Excluded       The image (§1 rule 1 — `s.url` is never touched here, so not one image
 *                byte is requested), right-and-wrong, sorting or filtering, a 'પૂરું કરો'
 *                button, streaks, and any count of what is missing.
 * Loading        Three dots under the bar, with the bar already navigable.
 * Empty          No વર્ણન published yet → said plainly, with 'દર્શન જુઓ' as the way on.
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
 * * **No 'પૂરું કરો' button** (§9). There is nothing to submit: each tick is already
 *   saved to the phone and the day's score is already on its way. Closing the app mid-way
 *   loses nothing, so a button whose only job is to promise that would be a lie about how
 *   this works. (લેવલ ૪ does have one, and for the opposite reason: an attempt there is a
 *   single event that has not happened until it is sent.)
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

  const { prune, toggle } = P;
  const validIds = useMemo(() => new Set(scenes.map((s) => s.id)), [scenes]);

  /*
    A tick for a દ્રશ્ય the સંચાલક has since withdrawn must stop counting, or the ring reads
    out of a collection that is no longer on screen. Done here rather than in progress.js
    because the current list is useScenes()'s to know (§62) — prune() compares before it
    writes, so this effect is a no-op on every render but the one that matters.
  */
  useEffect(() => {
    if (!loading && P.ready) prune(validIds);
  }, [loading, P.ready, validIds, prune]);

  const onToggle = useCallback((id) => toggle(LEVEL, id), [toggle]);

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
  const gate = useLevel4Gate();
  const level4Open =
    gate.ready &&
    gate.published &&
    (!gate.requireGate || gate.gateOpen || P.score3 >= gate.gateThreshold);

  // ---------------------------------------------------------------- states
  if (loading || !P.ready) {
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
          <Link to="/darshan" className="btn-quiet btn-inline">દર્શન જુઓ</Link>
        </section>
      </div>
    );
  }

  const complete = P.score3 >= total;

  return (
    <div className="level-wrap">
      <LevelBar level4={level4Open} />

      <header className="level-head">
        <p className="level-eyebrow">લેવલ {gu(LEVEL)}</p>
        <h1>{name}</h1>
        <ProgressRing
          score={P.score3}
          total={total}
          label="આજની પ્રગતિ"
          sub="વર્ણન વાંચો, દ્રશ્ય મનમાં લાવો, પછી ટિક કરો."
        />

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
          The one state where the ring and the boxes honestly disagree: today's score
          arrived partly from somewhere else (another phone, or storage this browser
          cleared). Explained rather than hidden — a ring reading ૫૦ above fifty empty
          boxes with no word about it is the confusion §1 asks us not to create.
        */}
        {P.carried3 > 0 && (
          <p className="level-note level-carried">
            આજનાં {gu(P.carried3)} દ્રશ્યો બીજેથી ગણતરીમાં લેવાયાં છે. અહીં એ ટિક થયેલાં નહીં દેખાય,
            પણ ગણતરીમાં છે.
          </p>
        )}

        {/*
          Quiet, and never an error (§1 rule 4). The ticks are on the phone and the write
          retries by itself — on the next minute, on `online`, on the next visit. The
          button is there for the યુવક who would rather not wait.
        */}
        {P.syncError && (
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
            ticked={P.ticked3.has(s.id)}
            onToggle={onToggle}
          />
        ))}
      </ol>

      {/* ફક્ત આનંદ (§1 rule 4) — the only thing said at the end is thanks. */}
      <p className="level-foot" aria-live="polite">
        {complete
          ? `આજનું ધ્યાન સંપૂર્ણ — ${gu(P.score3)} દ્રશ્યો. જય સ્વામિનારાયણ 🙏`
          : `આજ સુધી ટિક: ${gu(P.score3)} / ${gu(total)}`}
      </p>

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
            <p className="level-next-line">
              અભિનંદન — આગળના લેવલ માટે જરૂરી યાદશક્તિની ચકાસણી તમે પૂરી કરી છે.
            </p>
            <p className="level-note">લેવલ ૪ હવે તમારા માટે કાયમ ખુલ્લું છે.</p>
            {/*
              `P.retry()` on the way out, and it is not decoration.

              The gate is read from `progress`, and a tick is a localStorage write that
              reaches Postgres on the next flush (progress.js §12). A યુવક who crosses the
              threshold and taps straight through would otherwise arrive at લેવલ ૪ a moment
              before the row that opens it, and be shown the invitation he has just earned.
              This asks progress.js to send the day now; navigation never waits on it, and
              Level4Page re-reads the gate on mount either way.
            */}
            <Link to="/level/4" className="btn-gold btn-inline" onClick={() => P.retry()}>
              લેવલ ૪ પર જાઓ<NavArrow />
            </Link>
          </section>
        ) : gate.requireGate ? (
          <section className="level-next">
            <p className="level-next-line">
              લેવલ ૩ માં {gu(gate.gateThreshold)} પૂરાં કરો, પછી લેવલ ૪ ખૂલશે
            </p>
            <p className="level-note">
              એક જ દિવસમાં {gu(gate.gateThreshold)} દ્રશ્યો — પછી એ લેવલ કાયમ ખુલ્લું રહેશે.
            </p>
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
            <Link to="/darshan" className="btn-gold btn-inline">દર્શન ફરી જુઓ</Link>
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
      <Link className="linklike" to="/darshan">દર્શન જુઓ</Link>
      {level4 && <Link className="linklike" to="/level/4">લેવલ ૪</Link>}
    </header>
  );
}
