import { useCallback, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLevels } from '../../lib/useSettings';
import { useScenes } from '../../lib/useScenes';
import { useDailyProgress } from '../../lib/progress';
import { gu } from '../../lib/scenes';
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
      <LevelBar />

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
          §9, said out loud. The absence of a 'પૂરું કરો' button is only reassuring if the
          યુવક knows why it is absent.
        */}
        <p className="level-note">
          જે ટિક કરો તે તરત સચવાય છે — એપ્લિકેશન બંધ કરો તો પણ કંઈ જતું નથી. રાત્રે ૧૨ વાગ્યે
          આજની ટિક ખાલી થશે અને આજનું પરિણામ કાયમ સચવાયેલું રહેશે.
        </p>

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
      */}
      <ol className="tick-list">
        {scenes.map((s) => (
          <TickRow
            key={s.id}
            id={s.id}
            n={s.n ?? s.index}
            text={s.t}
            level={LEVEL}
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
    </div>
  );
}

function LevelBar() {
  return (
    <header className="level-bar">
      <Link className="linklike" to="/">મુખપૃષ્ઠ</Link>
      {/*
        લેવલ ૨ is the memory support this level removes (§1 rule 1), and it stays one tap
        away on purpose: a યુવક who cannot place a number should be able to go and look,
        not sit stuck. Nothing records that he went.
      */}
      <Link className="linklike" to="/darshan">દર્શન જુઓ</Link>
    </header>
  );
}
