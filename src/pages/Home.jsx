import { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useLevels } from '../lib/useSettings';
import { LEVEL4_UNLOCK_THRESHOLD, gu } from '../lib/constants';
import '../styles/forms.css';
import './home.css';

/**
 * The પ્રગતિ ચક્ર, split out and loaded on demand.
 *
 * App.jsx imports this page eagerly — it is where a યુવક lands after signing in — and the
 * ring needs useScenes() for its denominator (§62: the total is counted, never typed).
 * useScenes() pulls in content/darshan.json, which describes every image variant of every
 * દ્રશ્ય and has no business in the bundle downloaded to reach the login screen. So the
 * ring arrives in its own chunk, a moment after the page.
 */
const HomeRing = lazy(() => import('../modules/levels/HomeRing'));

/**
 * What each level *is* — the half of a level that is code, not configuration.
 *
 * The સંચાલક panel decides whether a level is offered, what it is called and where it
 * sits in the list. It cannot decide where a level goes or whether the app can show it
 * yet: §37 keeps a level's behaviour out of the settings document, and `ready` is not an
 * opinion anybody may hold — it is whether a route exists in src/App.jsx. So the two
 * halves are joined here, by levelId, and a stored level the code does not recognise is
 * simply not rendered rather than rendered as a button that goes nowhere.
 *
 * લેવલ ૧ points at /welcome, which is where the વિડિયો already lives. It was once marked
 * not-ready against a /level/1 route that does not exist, so the one thing a યુવક could
 * not do after passing the પ્રવેશદ્વાર was watch the વિડિયો again — the page redirected him
 * home. The gate's questions are asked once; the વિડિયો is not.
 *
 * `earned` marks the level whose availability is not the સંચાલક's to give (§7) — see
 * supabase/migrations/0008_level4_unlock.sql.
 */
const LEVEL_CODE = {
  1: { to: '/welcome', ready: true },
  2: { to: '/darshan', ready: true },
  3: { to: '/level/3', ready: true },
  4: { to: '/level/4', ready: true, earned: true },
};

/**
 * §6 — યુવકનું મુખપૃષ્ઠ. Phase 1 lands here after the gate.
 *
 * The progress ring, yesterday's result, best score and total days arrive with
 * Levels 3–4 in Phase 3; the level buttons are laid out now so the shape is right.
 */
export default function Home() {
  const { profile, isAdmin, logout } = useAuth();

  /*
    The list the સંચાલક saved (§36), not a literal. useLevels() hands back the four levels
    of §7 whenever the row is absent, unreadable or damaged, so this is never empty — the
    only thing configuration can do is take a level off the list or rename it, never leave
    a યુવક looking at nothing.

    Levels the app has no screen for are dropped here rather than in the shared resolver:
    which routes exist is a fact about this build, and the panel has no business knowing it.
  */
  const { levels } = useLevels();
  const shown = levels.filter((l) => l.enabled && LEVEL_CODE[l.levelId]);

  return (
    <div className="home-wrap">
      <header className="site-header">
        <h1>જય સ્વામિનારાયણ</h1>
        <p>{profile?.name}</p>
        <div className="rule" />
      </header>

      <div className="home-inner">
        <div className="ring-card">
          {/*
            The real fraction, at last — તબક્કો ૩ brought it.

            The denominator is still not a literal and never becomes one (§62): it is
            useScenes()'s `total`, counted from the દર્શન that passed both gates, so the
            day દ્રશ્ય ૧૦૧–૧૦૯ get their વર્ણન this ring counts out of 109 by itself.

            The fallback is the em dash this card showed before the ring existed, so the
            layout does not jump while the chunk arrives — and a યુવક on a slow connection
            sees the page, not a spinner (§14).
          */}
          <Suspense fallback={<><div className="ring-num">—</div><div className="ring-label">આજની પ્રગતિ</div></>}>
            <HomeRing />
          </Suspense>
        </div>

        {/*
          The guided journey: વિડિયો → દર્શન → ઓળખ → પરિણામ → બાકી દર્શન → સ્મૃતિ દર્શન.
          It resumes at whatever stage the yuvak left off, so this one entry point is
          correct on every visit.
        */}
        <Link to="/learn" className="level-btn is-primary">
          <span className="level-name">ધ્યાન શરૂ કરો</span>
          <span className="level-soon">વિડિયો દર્શનથી શરૂ</span>
        </Link>

        <div className="level-grid">
          {shown.map((l) => {
            const code = LEVEL_CODE[l.levelId];
            /*
              લેવલ ૪ opens at ૮૦ ticks in one day at લેવલ ૩ and then stays open for good
              (§7). The flag is read, never written, from here: it is set by a trigger on
              the row that records the day's score, so what this page shows is derived from
              the same data the સંચાલક's dashboard reads.
            */
            const locked = code.earned && !profile?.level4_unlocked;
            const disabled = !code.ready || locked;
            const body = (
              <>
                <span className="level-n">લેવલ {gu(l.levelId)}</span>
                <span className="level-name">{l.name}</span>
                {/*
                  An invitation, never a rebuke (§1 rule 4, §10). It says what opens the
                  level, not what the યુવક has failed to do, and there is no count of days,
                  no "you were close", nothing that could read as a missed target.

                  The number comes from the constant the database rule mirrors, so the
                  promise on screen and the rule that keeps it cannot drift apart.
                */}
                {locked && (
                  <span className="level-lock">
                    લેવલ ૩ માં {gu(LEVEL4_UNLOCK_THRESHOLD)} પૂરાં કરો, પછી આ ખૂલશે
                  </span>
                )}
                {!code.ready && !locked && <span className="level-soon">હવે પછી</span>}
              </>
            );
            return disabled ? (
              <div key={l.levelId} className="level-btn is-off">{body}</div>
            ) : (
              <Link key={l.levelId} to={code.to} className="level-btn">{body}</Link>
            );
          })}
        </div>

        <div className="home-actions">
          <div className="level-btn is-off small">મારો ઈતિહાસ<span className="level-soon">હવે પછી</span></div>
          {/*
            The સંચાલક પેનલ is a separate application served from /admin, so this is a plain
            <a> and not a <Link>: react-router owns this app's routes, and the panel is not
            one of them — a client-side navigation would find no route and bounce home.

            Not rendering it for a yuvak is courtesy, not security. Anyone may type the URL;
            what stops him is the panel's own guard and, behind that, firestore.rules, which
            answer permission-denied to every query a non-સંચાલક makes (§65).
          */}
          {isAdmin && (
            <a href="/admin" className="level-btn small">
              ડેશબોર્ડ<span className="level-soon">સંચાલક પેનલ</span>
            </a>
          )}
        </div>

        <p className="auth-alt">
          <button className="linklike" type="button" onClick={logout}>લોગ આઉટ</button>
        </p>
      </div>
    </div>
  );
}
