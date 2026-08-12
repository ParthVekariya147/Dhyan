import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useLevels } from '../../lib/useSettings';
import { useScenes } from '../../lib/useScenes';
import { useDailyProgress } from '../../lib/progress';
import { LEVEL4_UNLOCK_THRESHOLD } from '../../lib/constants';
import { gu } from '../../lib/scenes';
import ProgressRing from './ProgressRing';
import TickRow from './TickRow';
import './levels.css';

/**
 * લેવલ ૩ (વર્ણન યાદી) અને લેવલ ૪ (ફક્ત નંબર) — §7, the heart of the સાધના.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * One component for two levels
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The two screens differ in exactly one thing — whether the વર્ણન is on screen from the
 * start or waits behind 'જવાબ જુઓ'. Everything else is identical and must stay identical:
 * the same 1 → N order, the same tick, the same ring, the same day, the same row in
 * `progress`. Writing them twice would be writing the midnight reset twice, the flush
 * twice and the ક્રમ twice, and the first divergence between the copies would be a bug
 * nobody could see. §1 rule 1 describes them as one ladder with one rung removed, and this
 * is that, expressed once.
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
 *   this works.
 * * **No sorting, no filtering, no "hide the ones you've done".** ક્રમ કદી તૂટે નહીં
 *   (§1 rule 2): 1 → N, always, at every level, on every visit.
 * * **Nothing red, nothing scolding, no count of what is missing** (§1 rule 4). An
 *   unticked દ્રશ્ય is simply not ticked yet.
 * * **No streaks** (§10). Not a word on this page counts consecutive days.
 */
export default function LevelPage({ level }) {
  const { profile } = useAuth();
  const { levels } = useLevels();
  const { scenes, total, loading } = useScenes();
  const P = useDailyProgress();

  // લેવલ ૪'s answers, revealed one at a time and never remembered: tomorrow the same
  // number should ask the same question. Component state, so it also resets on leaving.
  const [revealed, setRevealed] = useState(() => new Set());

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

  const onToggle = useCallback((id) => toggle(level, id), [toggle, level]);
  const onReveal = useCallback((id) => setRevealed((prev) => new Set(prev).add(id)), []);

  // The name the સંચાલક chose (§36); the *behaviour* is never his to change (§37), which
  // is why `level` arrives from the route and the name only from settings.
  const name = levels.find((l) => l.levelId === level)?.name ?? '';
  const score = level === 4 ? P.score4 : P.score3;
  const carried = level === 4 ? P.carried4 : P.carried3;
  const ticked = level === 4 ? P.ticked4 : P.ticked3;

  // ---------------------------------------------------------------- the lock (§7)
  /*
    Read, never written. `profiles.level4_unlocked` is set by the AFTER trigger on
    `public.progress` in supabase/migrations/0008_level4_unlock.sql — this page's only part
    in it is writing the day's level3_score, which progress.js does. A યુવક who reaches
    /level/4 by typing the URL gets this same invitation rather than a redirect: bouncing
    him back to the home page would answer a question he did not ask.
  */
  if (level === 4 && !profile?.level4_unlocked) {
    return (
      <div className="level-wrap">
        <LevelBar />
        <section className="level-locked">
          <div className="locked-mark" aria-hidden="true">🔒</div>
          <h2>{name || 'ફક્ત નંબર'}</h2>
          {/*
            An invitation, not a rebuke (§1 rule 4). It says what opens the level — never
            how far away he is, never how many days he has taken, never that he failed
            today. The number is the shared constant the database rule mirrors, so the
            promise printed here and the trigger that keeps it cannot drift apart.
          */}
          <p className="locked-line">
            લેવલ ૩ માં {gu(LEVEL4_UNLOCK_THRESHOLD)} પૂરાં કરો, પછી આ ખૂલશે
          </p>
          <p className="locked-sub">એક જ દિવસમાં {gu(LEVEL4_UNLOCK_THRESHOLD)} દ્રશ્યો — પછી આ લેવલ કાયમ ખુલ્લું રહેશે.</p>
          <Link to="/level/3" className="btn-gold btn-inline">લેવલ ૩ શરૂ કરો</Link>
        </section>
      </div>
    );
  }

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

  const complete = score >= total;

  return (
    <div className="level-wrap">
      <LevelBar />

      <header className="level-head">
        <p className="level-eyebrow">લેવલ {gu(level)}</p>
        <h1>{name}</h1>
        <ProgressRing
          score={score}
          total={total}
          label="આજની પ્રગતિ"
          sub={
            level === 3
              ? 'વર્ણન વાંચો, દ્રશ્ય મનમાં લાવો, પછી ટિક કરો.'
              : 'ફક્ત નંબર જુઓ. દ્રશ્ય મનમાં આવે તો ટિક કરો.'
          }
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
        {carried > 0 && (
          <p className="level-note level-carried">
            આજનાં {gu(carried)} દ્રશ્યો બીજેથી ગણતરીમાં લેવાયાં છે. અહીં એ ટિક થયેલાં નહીં દેખાય,
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
            level={level}
            ticked={ticked.has(s.id)}
            revealed={level === 4 && revealed.has(s.id)}
            onToggle={onToggle}
            onReveal={onReveal}
          />
        ))}
      </ol>

      {/* ફક્ત આનંદ (§1 rule 4) — the only thing said at the end is thanks. */}
      <p className="level-foot" aria-live="polite">
        {complete
          ? `આજનું ધ્યાન સંપૂર્ણ — ${gu(score)} દ્રશ્યો. જય સ્વામિનારાયણ 🙏`
          : `આજ સુધી ટિક: ${gu(score)} / ${gu(total)}`}
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
