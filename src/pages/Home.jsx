import { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useLevels } from '../lib/useSettings';
import { useLevel4Gate } from '../lib/level4';
import { JOURNEY_PAGE, specForLevel, useJourney, usePageSpec } from '../lib/journey';
import { gu } from '../lib/constants';
import PageIntro from '../components/PageIntro';
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
 *
 * લેવલ ૪'s destination is the પ્રવૃત્તિ list (LEVEL4.md decision #1), not a flat list of
 * દ્રશ્યો any more. The path did not change, so nothing here did: /level/4 is the level's
 * front door either way, and what is behind it is App.jsx's business and not this page's.
 */
const LEVEL_CODE = {
  1: { to: '/welcome', ready: true },
  2: { to: '/darshan', ready: true },
  3: { to: '/level/3', ready: true },
  4: { to: '/level/4', ready: true, earned: true },
};

/**
 * ────────────────────────────────────────────────────────────────────────────
 * PAGE CONTRACT — મુખપૃષ્ઠ (/)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Purpose        Show a યુવક his whole સાધના at once: the four levels, what each one is,
 *                which are open, and what opens the one that is not.
 *
 * Input          useLevels() (which levels the સંચાલક offers, and their names),
 *                useJourney() (what each level is, in one line), useLevel4Gate() (the
 *                gate, in the સંચાલક's own number), HomeRing (today's progress).
 * Visible        Today's ring, one primary way in (લેવલ ૧), one tile per offered level
 *                carrying its number, name, one-line description and — for લેવલ ૪ — what
 *                opens it, and the સંચાલક પેનલ link for whoever has one.
 * Actions        Open a level. Log out. Open the panel.
 * Persisted      Nothing. This page writes nothing at all.
 * Completion     None — the મુખપૃષ્ઠ is not a level and nothing here is finished.
 * Next           /welcome — લેવલ ૧, and that is what the primary button says.
 * Previous       None. This is the top of the journey.
 * Excluded       દર્શન images, વર્ણન, ticks, કસોટીઓ, anything scolding, and any count of
 *                what is missing (§1 rule 4, §10 — no streaks).
 * Loading        Nothing blocks: the level list falls back to the four of §7 and the ring
 *                holds an em dash until its chunk lands, so the page never renders blank.
 * Error / empty  A settings row that is absent, unreadable or damaged resolves to the
 *                default levels rather than to an empty home page.
 * Source of truth  settings['levels'] for names and availability; src/App.jsx for whether
 *                  a route exists (LEVEL_CODE below); the published લેવલ ૪ configuration
 *                  for the gate; shared/domain/journey.js for what each level *is*.
 *
 * ────────────────────────────────────────────────────────────────────────────
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

  /*
    The gate લેવલ ૪ actually enforces, in the સંચાલક's own number (decision #3).

    `profile.level4_unlocked` used to answer this, and it still exists and is still true —
    but it answers 0008's *default* question ("૮૦ in a single day?"), which stopped being
    the only question the day the threshold became configuration. A યુવક whose સંચાલક set
    ૫૦ would have been told to do ૮૦ while the level was already open to him.

    Until the answer arrives `ready` is false and no invitation is printed at all. Half a
    second with no line under the tile is a smaller wrong than half a second with the wrong
    number under it, and the tile is tappable throughout either way.
  */
  const gate = useLevel4Gate();

  /*
    What each level *is*, in one line under its name.

    A tile used to carry a name and nothing else — 'વર્ણન યાદી', 'ફક્ત નંબર' — which tells a
    યુવક who has not been there yet almost nothing, and tells him least on the day he most
    needs it: his first. The names are the સંચાલક's (§36) and stay his; the description
    comes from shared/domain/journey.js, where the same sentence is used by the level's own
    page, so a tile and the page behind it can never describe the level differently.
  */
  const { journey } = useJourney();

  // મુખપૃષ્ઠ's own description — the same source every level page reads its own from, so the
  // home page and the panel can never describe the સાધના differently (§36).
  const spec = usePageSpec(JOURNEY_PAGE.HOME);

  return (
    <div className="home-wrap">
      <header className="site-header">
        <h1>જય સ્વામિનારાયણ</h1>
        <p>{profile?.name}</p>
        <div className="rule" />
      </header>

      <div className="home-inner">
        {/*
          The same "આ પેજમાં મારે શું કરવાનું છે?" every other page carries, on the page a
          યુવક lands on first.

          It was the one page with a description written for it in shared/domain/journey.js
          and no way to read it: the entry existed, the panel could edit it, and nothing put
          it on screen. So the screen that has to explain the whole સાધના explained nothing,
          while લેવલ ૨, ૩ and ૪ each explained themselves.
        */}
        <PageIntro spec={spec} />

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
          <Suspense fallback={<><div className="ring-num">-</div><div className="ring-label">આજની પ્રગતિ</div></>}>
            <HomeRing />
          </Suspense>
        </div>

        {/*
          The way in is લેવલ ૧, and only લેવલ ૧.

          This used to open /learn — the older self-contained journey, which is a second
          ladder with its own stages and its own progress row. Having two entry points meant
          what a યુવક's ધ્યાન consisted of depended on which button he happened to press, and
          the one the page pushed hardest was the one the levels of §7 do not describe. So
          the primary button starts the same climb the tiles below continue: લેવલ ૧ વિડિયો
          and the two questions, then લેવલ ૨ દર્શન, then ૩.

          The destination is read out of LEVEL_CODE rather than written again here. A second
          copy of '/welcome' is a second thing to remember to change, and the day લેવલ ૧ moves
          this button would quietly keep pointing at where it used to be.
        */}
        <Link to={LEVEL_CODE[1].to} className="level-btn is-primary">
          <span className="level-name">ધ્યાન શરૂ કરો</span>
          <span className="level-soon">વિડિયો દર્શનથી શરૂ</span>
        </Link>

        <div className="level-grid">
          {shown.map((l) => {
            const code = LEVEL_CODE[l.levelId];
            /*
              The gate is described here and decided on the level's own page.

              It used to be decided here too — a locked લેવલ ૪ was rendered as an untappable
              tile. That is no longer honest: since LEVEL4.md decision #3 the gate belongs to
              the published લેવલ ૪ configuration (`require_gate`, `gate_threshold`), and a
              સંચાલક who turns it off would leave a યુવક looking at a tile he cannot press
              for a level that is in fact open to him. So the tile stays tappable and this
              line is a description, not an enforcement.

              Four things must all hold before it is printed, and each removes a way of
              saying something untrue: the level must be the earned one, the answer must
              have arrived, a configuration must be published (with none there is no
              threshold to name), the gate must be required, and it must not already be
              open. Behind the tile, Level4Page shows the same invitation in the same words.
              Nothing is granted by tapping: `level4_submit` re-checks the gate server-side
              on every attempt (§37).
            */
            const locked =
              code.earned && gate.ready && gate.published && gate.requireGate && !gate.gateOpen;
            const disabled = !code.ready;
            /*
              What this level is, in one line. Never null for a level the code has a page
              for, and LEVEL_CODE has already dropped the ones it does not — but read
              defensively all the same: a missing sentence must cost a યુવક a line of help,
              never the tile itself.
            */
            const spec = specForLevel(l.levelId, journey);
            const body = (
              <>
                <span className="level-n">લેવલ {gu(l.levelId)}</span>
                <span className="level-name">{l.name}</span>
                {/*
                  The description sits under the name and above the lock, so a tile reads
                  in the order the questions are asked: what is this, and may I open it.
                */}
                {spec?.short && <span className="level-short">{spec.short}</span>}
                {/*
                  An invitation, never a rebuke (§1 rule 4, §10). It says what opens the
                  level, not what the યુવક has failed to do, and there is no count of days,
                  no "you were close", nothing that could read as a missed target.

                  The number comes from the constant the database rule mirrors, so the
                  promise on screen and the rule that keeps it cannot drift apart.
                */}
                {locked && (
                  <span className="level-lock">
                    લેવલ ૩ માં {gu(gate.gateThreshold)} પૂરાં કરો, પછી આ ખૂલશે
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
          {/* <div className="level-btn is-off small">મારો ઈતિહાસ<span className="level-soon">હવે પછી</span></div> */}
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
