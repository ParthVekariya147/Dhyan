import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLevels } from '../../lib/useSettings';
import { useScenes } from '../../lib/useScenes';
/*
  One import for the whole of લેવલ ૪, including the status vocabulary — src/lib/level4.js
  re-exports it from shared/domain/level4.js precisely so these screens never reach past it.
*/
import { L4_ACTIVITY_STATUS, L4_PREPARING_GU, useLevel4 } from '../../lib/level4';
import { JOURNEY_PAGE, usePageSpec } from '../../lib/journey';
import { gu } from '../../lib/scenes';
import PageIntro from '../../components/PageIntro';
import ProgressRing from '../levels/ProgressRing';
/*
  The ring, the bar, the panels and the list rhythm all live in the levels module's
  stylesheet, and ProgressRing is imported from there too — a component brought over
  without its styles would render a ring with no ring. levels.css is loaded rather than
  copied because these two screens are the same visual language, not merely a similar one;
  level4.css below holds only what is new here (the cards and the attempt panels).
*/
import '../levels/levels.css';
import './level4.css';

/** This screen is લેવલ ૪ and nothing else, so the number is a constant, not a prop (§37). */
const LEVEL = 4;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * PAGE CONTRACT — લેવલ ૪, the કસોટી list (/level/4)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Purpose        The front door of લેવલ ૪: which કસોટીઓ the સંચાલક has published, which one
 *                is open, and what each of them covers. A container, not a test.
 *
 * Input          useLevel4() — the published configuration, this યુવક's status per કસોટી,
 *                and the gate. useScenes() only for the printed numbers in a card's range.
 * Visible        A ring counting finished કસોટીઓ, the instruction, and one card per કસોટી
 *                with its code, title, range, item count and state.
 * Actions        Open a કસોટી that is not locked. Open the દર્શન of one waiting for
 *                revision. Go back to લેવલ ૩ or મુખપૃષ્ઠ.
 * Persisted      Nothing. Nothing on this page writes; the attempt is made one page in.
 * Completion     Every published કસોટી COMPLETED → લેવલ ૪ is finished, and says so.
 * Next           /level/4/:activityId — whichever કસોટી is open. There is no single 'આગળ'
 *                here on purpose: the list *is* the choice, and it is a choice of one.
 * Previous       /level/3 — the level લેવલ ૪ is earned at and returned to every morning.
 * Excluded       Images, વર્ણન, ticks (all of those belong to the two pages behind this
 *                one), the સંચાલક's configuration controls, and any hard-coded ૪.૧/૪.૨ —
 *                the number of કસોટીઓ is data, and nothing here asks what a code is.
 * Loading        Three dots under a navigable bar.
 * Locked         The gate, in the સંચાલક's own number, with લેવલ ૩ as the way on.
 * Empty          Nothing published → the shared 'હજુ તૈયાર થઈ રહ્યું છે' sentence.
 * Error          One Gujarati line from src/lib/level4.js and a ફરી પ્રયાસ કરો button.
 * Source of truth  The published લેવલ ૪ configuration for the ladder and the gate;
 *                  useScenes() for printed numbers; shared/domain/journey.js for wording.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * લેવલ ૪ — the container (§11, decision #1 in LEVEL4.md §0).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this replaced, and why it is a different shape
 * ────────────────────────────────────────────────────────────────────────────
 *
 * લેવલ ૪ used to be લેવલ ૩ with the વર્ણન hidden behind 'જવાબ જુઓ' — one flat list of every
 * દ્રશ્ય, ticked for the day and cleared at midnight like every other day. It is now a
 * ladder of કસોટીઓ the સંચાલક composes: ૪.૧, ૪.૨, … each one a set of દ્રશ્યો, each opened
 * by finishing the one before it, and each **permanently** finished once passed (decision
 * #2 — midnight never takes a કસોટી back). The day is still scored underneath, by
 * `level4_submit`, so the સંચાલક's dashboard reads exactly what it always read.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What is deliberately absent
 * ────────────────────────────────────────────────────────────────────────────
 *
 * * **No Supabase call of its own.** Everything on the યુવક side of લેવલ ૪ goes through
 *   src/lib/level4.js, which is the only module that speaks to the RPCs. This page reads
 *   `useLevel4()` and renders it; there is no second path to the same numbers to drift.
 * * **No hard-coded activity.** Nothing here asks whether a code is '4.1'. The order is
 *   `position`, the lock is "everything before me is done", and both arrive as data — a
 *   સંચાલક who publishes eleven કસોટીઓ needs no edit here (§6 rule 2).
 * * **No total typed anywhere** (§6 rule 1). The ring's denominator is the count of
 *   published કસોટીઓ; a card's range is read off the દર્શન collection itself.
 * * **Nothing red, and no count of what is missing** (§1 rule 4). A locked card says what
 *   opens it, never how far away it is.
 */
export default function Level4Page() {
  const { levels } = useLevels();
  const { scenes, loading: scenesLoading } = useScenes();
  const { loading, error, retry, config, activities, gateOpen, gateThreshold, allComplete } =
    useLevel4();

  /*
    id → the number the યુવક reads on the દ્રશ્ય, and nothing else.

    The cards show a range ("દ્રશ્ય ૧–૩૦"), and a range is made of the numbers he actually
    sees, so the effective collection is consulted for those numbers only. It comes from
    useScenes() — the same list the whole યુવક app renders, overlay and both gates applied,
    and now sequenced by `withDisplayIndex()` — so a range here can never describe દ્રશ્યો a
    યુવક cannot see, and can never name a number that appears nowhere else.

    `s.displayIndex`, not `s.n ?? s.index` (ORDERING.md §4). The old map printed the stored
    number, so a કસોટી of the first thirty દ્રશ્યો read "દ્રશ્ય ૧–૩૧" the moment the સંચાલક
    withheld one of them — a range wider than its own contents, describing a number the
    યુવક would never find in the કસોટી. Every number on this page and inside that કસોટી now
    comes from the one sequence.
  */
  const numberOf = useMemo(
    () => new Map(scenes.map((s) => [s.id, s.displayIndex])),
    [scenes]
  );

  // The name the સંચાલક chose (§36). What the level *does* is never his to change (§37),
  // which is why only the name comes from settings.
  const name = levels.find((l) => l.levelId === LEVEL)?.name ?? '';

  // The level's description, from the same kind of place as its name (§36) — see
  // shared/domain/journey.js. Never null, so every state below can print it.
  const spec = usePageSpec(JOURNEY_PAGE.LEVEL4);

  if (loading || scenesLoading) {
    return (
      <div className="level-wrap">
        <Level4Bar />
        <div className="spinner-page"><span className="dot" /><span className="dot" /><span className="dot" /></div>
      </div>
    );
  }

  /*
    A read that did not come back is quiet, and never an error the યુવક has to solve
    (§1 rule 4). Nothing of his is at stake — no attempt is in flight and no કસોટી is lost
    — so this says what happened in one line and offers the one useful action.

    The sentence is `error` itself: src/lib/level4.js turns every refusal into Gujarati at
    the one place that can tell them apart, so no Postgres string can reach a યુવક and no
    screen has to guess which failure it was looking at.
  */
  if (error) {
    return (
      <div className="level-wrap">
        <Level4Bar />
        <section className="level-empty">
          <p>{error}</p>
          <button type="button" className="btn-quiet btn-inline" onClick={retry}>
            ફરી પ્રયાસ કરો
          </button>
        </section>
      </div>
    );
  }

  /*
    No published configuration — a calm state, not an error (§20).

    Asked before the gate, deliberately. With nothing published there is no `require_gate`
    and no `gate_threshold` to speak from, and telling a યુવક to go and complete ૮૦ at
    લેવલ ૩ when the real answer is "the સંચાલક has not composed લેવલ ૪ yet" would be a
    promise the app cannot keep.

    The sentence is the shared one, so this page, the કસોટી and the દર્શન screen all say it
    in exactly the same words — three different phrasings of "not ready yet" would read as
    three different situations.
  */
  if (!config || !activities.length) {
    return (
      <div className="level-wrap">
        <Level4Bar />
        <section className="level-empty">
          <p>{L4_PREPARING_GU}</p>
          <Link to="/darshan" className="btn-quiet btn-inline">દર્શન જુઓ</Link>
        </section>
      </div>
    );
  }

  /*
    The gate (§7, decision #3).

    The threshold is the published configuration's own `gate_threshold`, printed rather
    than assumed: the સંચાલક may move it, and a page that hard-coded ૮૦ would go on
    promising the old number the day he did. The default reproduces exactly what લેવલ ૪
    always did, so nothing changes for a યુવક until somebody deliberately changes it.

    An invitation, not a rebuke (§1 rule 4) — it says what opens the level, never how far
    away he is, never how many days he has taken. A યુવક who typed /level/4 gets this same
    invitation rather than a redirect home, which would answer a question he did not ask.

    Shown only to a યુવક who has nothing here yet (0012). A closed gate above કસોટીઓ he has
    already passed is a different situation and gets a different page: the list, with what he
    earned still open and still repeatable, and the invitation moved to a line above it. This
    whole screen in that case would be the app telling him લેવલ ૪ is not his — over a number
    the સંચાલક moved after he had climbed it.
  */
  const earned = activities.some((a) => a.status === L4_ACTIVITY_STATUS.COMPLETED);

  if (!gateOpen && !earned) {
    return (
      <div className="level-wrap">
        <Level4Bar />
        <section className="level-locked">
          <div className="locked-mark" aria-hidden="true">🔒</div>
          <h2>{name || 'ફક્ત નંબર'}</h2>
          <p className="locked-line">
            લેવલ ૩ માં {gu(gateThreshold)} પૂરાં કરો, પછી આ ખૂલશે
          </p>
          <p className="locked-sub">
            એક જ દિવસમાં {gu(gateThreshold)} દ્રશ્યો — પછી આ લેવલ કાયમ ખુલ્લું રહેશે.
          </p>
          <Link to="/level/3" className="btn-gold btn-inline">લેવલ ૩ શરૂ કરો</Link>
        </section>
      </div>
    );
  }

  const done = activities.filter((a) => a.status === L4_ACTIVITY_STATUS.COMPLETED).length;

  return (
    <div className="level-wrap">
      <Level4Bar />

      <header className="level-head">
        <p className="level-eyebrow">લેવલ {gu(LEVEL)}</p>
        <h1>{name}</h1>

        {/*
          The same ring, counting something else — and the difference is worth naming.

          §10's ring is *today*: it empties at midnight and fills again tomorrow. This one
          is the ladder, and it only ever goes up (decision #2). They cannot be confused on
          screen because they are never on screen together: the home page and લેવલ ૩ show
          the day, and this page shows લેવલ ૪'s કસોટીઓ. The denominator is the count of
          કસોટીઓ the સંચાલક published, never a literal (§6 rule 1).
        */}
        <ProgressRing
          score={done}
          total={activities.length}
          label="પૂરી થયેલી કસોટીઓ"
          sub="એક કસોટી પૂરી થાય એટલે પછીની ખૂલે છે. પૂરી થયેલી કસોટી કાયમ પૂરી રહે છે — અને જેટલી વાર કરવી હોય એટલી વાર કરી શકાય."
        />

        {/*
          What લેવલ ૪ is, before he opens a કસોટી and finds a page of bare numbers.

          The sentence that used to be typed here — "દરેક કસોટીમાં ફક્ત નંબર દેખાશે…" — is now
          the કસોટી page's own instruction, where it belongs; this one describes the ladder:
          one opens the next, and a finished કસોટી stays finished. 'આમાં આ નથી' behind the
          closed line says the pictures are one page further in, not missing.
        */}
        <PageIntro spec={spec} />

        {/*
          The gate, closed above કસોટીઓ he has already passed (0012).

          Reachable one way only: the સંચાલક raised `gate_threshold` past where this યુવક
          stands — `progress` is never lowered, so nothing he does can shut this himself. What
          he keeps is on screen below, open and repeatable; what this line describes is only
          the કસોટીઓ still ahead. Said as the invitation the locked page says, in the
          configuration's own number — never as something he lost, because he did not lose it.
        */}
        {!gateOpen && (
          <p className="level-note l4-banner">
            લેવલ ૩ માં {gu(gateThreshold)} પૂરાં કરો, પછી હવે પછીની કસોટીઓ ખૂલશે. પૂરી થયેલી
            કસોટીઓ તમારી છે — જેટલી વાર કરવી હોય એટલી વાર કરી શકો.
          </p>
        )}
      </header>

      <ol className="l4-list">
        {activities.map((a, i) => (
          <ActivityCard
            key={a.id}
            activity={a}
            /*
              The કસોટી a locked card is waiting for. Read off the list rather than
              computed from the code, so it stays right however the સંચાલક numbers or
              reorders them (§6 rule 2).
            */
            previous={activities[i - 1] ?? null}
            range={rangeOf(a.sceneIds, numberOf)}
            /* Why a card is shut, when ક્રમ is not the reason — see lockLine in the card. */
            gateClosed={!gateOpen}
          />
        ))}
      </ol>

      {/* ફક્ત આનંદ (§1 rule 4) — the only thing said at the end is thanks. */}
      {allComplete && (
        <p className="level-foot" aria-live="polite">
          લેવલ {gu(LEVEL)} ની બધી કસોટીઓ પૂરી થઈ. જય સ્વામિનારાયણ 🙏
        </p>
      )}
    </div>
  );
}

/**
 * The span a કસોટી covers — "દ્રશ્ય ૩૧–૬૦".
 *
 * Read off the activity's own દ્રશ્યો, never written as a literal and never derived from how
 * many items it holds: `from` and `to` are the smallest and largest **display** numbers its
 * ids resolve to. So ૪.૨ composed of the second thirty દ્રશ્યો says ૩૧–૬૦, the same numbers
 * its કસોટી prints — a local ૧–૩૦ here would be a second numbering of the same દ્રશ્યો
 * (decision #1).
 *
 * Built from the numbers the collection actually has, so a દ્રશ્ય withdrawn since the
 * સંચાલક composed this કસોટી is left out of the range rather than printed as a hole —
 * the same rule inOrder() applies in scenes.js. `count` is the activity's own item count
 * and is never compared with a total (§6 rule 1).
 */
function rangeOf(sceneIds, numberOf) {
  const ns = (sceneIds ?? []).map((id) => numberOf.get(id)).filter((n) => Number.isFinite(n));
  if (!ns.length) return null;
  return { from: Math.min(...ns), to: Math.max(...ns), count: ns.length };
}

/**
 * The five states, in Gujarati (§11).
 *
 * Keyed off the enum rather than off strings typed here, so a state renamed in
 * shared/domain/level4.js is a build error and not a card that silently renders nothing.
 * None of the five is styled as a warning — a કસોટી waiting to open and a કસોટી
 * waiting to be revised are both ordinary, blameless places to be (§1 rule 4).
 */
const STATE = {
  [L4_ACTIVITY_STATUS.LOCKED]: { label: 'હવે પછી', action: null, tone: 'is-waiting' },
  [L4_ACTIVITY_STATUS.AVAILABLE]: { label: 'તૈયાર છે', action: 'શરૂ કરો', tone: 'is-open' },
  [L4_ACTIVITY_STATUS.IN_PROGRESS]: { label: 'ચાલુ છે', action: 'ચાલુ રાખો', tone: 'is-open' },
  [L4_ACTIVITY_STATUS.REVISION_REQUIRED]: {
    label: 'ફરી દર્શન કરીએ',
    action: 'ફરી કરીએ',
    tone: 'is-open',
  },
  /*
    'ફરી કસોટી આપો', not 'ફરી જુઓ'. The old word was the honest description of a page he could
    only look at; since the કસોટી may be answered again — as often as he likes, with the pass
    already his and nothing at stake — the card should say what the tap actually does. A
    યુવક who wants the pictures instead has the second link below (§16), so neither journey
    is hidden behind the other.
  */
  [L4_ACTIVITY_STATUS.COMPLETED]: {
    label: 'પૂરું થયું ✓',
    action: 'ફરી કસોટી આપો',
    tone: 'is-done',
  },
};

/**
 * One કસોટી.
 *
 * A locked card is a `<div>`, not a `<Link>` — the સાધના is walked in order (§1 rule 2,
 * §23), and a card that cannot be entered must not be tappable, or the tap goes to a page
 * that can only say no. It still says what opens it, in the voice the home page and લેવલ ૩
 * already use for લેવલ ૪'s lock: what to do next, never what was missed.
 */
function ActivityCard({ activity, previous, range, gateClosed }) {
  const state = STATE[activity.status] ?? STATE[L4_ACTIVITY_STATUS.LOCKED];
  const locked = activity.status === L4_ACTIVITY_STATUS.LOCKED;
  /*
    Why this card is shut, in its own words.

    ક્રમ is the ordinary reason and is named by the કસોટી before it. A closed gate is the
    other one, and it can now appear *below* finished કસોટીઓ (0012) — where "લેવલ ૪.૩ પૂરું
    થાય, પછી આ ખૂલશે" would be plainly untrue, since ૪.૩ is sitting right above it marked
    પૂરું થયું. The gate is asked first for exactly that case.
  */
  const lockLine = gateClosed
    ? 'લેવલ ૩ પૂરું થાય, પછી આ ખૂલશે'
    : previous
      ? `લેવલ ${gu(previous.code)} પૂરું થાય, પછી આ ખૂલશે`
      : 'આગળની કસોટી પૂરી થાય, પછી આ ખૂલશે';

  const body = (
    <>
      <span className="l4-top">
        <span className="l4-code">લેવલ {gu(activity.code)}</span>
        <span className={`l4-state ${state.tone}`}>{state.label}</span>
      </span>

      {activity.title && <span className="l4-title">{activity.title}</span>}

      {range && (
        <span className="l4-range">
          દ્રશ્ય {gu(range.from)}–{gu(range.to)} · {gu(range.count)} દ્રશ્યો
        </span>
      )}

      {activity.description && <span className="l4-desc">{activity.description}</span>}

      {locked ? (
        <span className="l4-lock">{lockLine}</span>
      ) : (
        <span className="l4-go">{state.action} →</span>
      )}
    </>
  );

  return (
    <li>
      {locked ? (
        <div className="l4-card is-locked">{body}</div>
      ) : (
        <Link to={`/level/4/${activity.id}`} className="l4-card">{body}</Link>
      )}

      {/*
        The second door, where it helps — and it helps in exactly two places.

        A કસોટી waiting to be revised gets its દર્શન one tap away, rather than making the
        યુવક open the test to find the way back to the pictures (§16). A finished one gets
        it for the opposite reason: the card's own action is now 'ફરી કસોટી આપો', so without
        this line the only thing a યુવક could do with a passed કસોટી is sit it again — and
        going back to look at the દર્શન he has earned is the gentler half of repeating, not
        a lesser one. Two named journeys, neither hidden inside the other.

        Everywhere else this link is absent on purpose. AVAILABLE and IN_PROGRESS cards lead
        to the કસોટી, which carries [દર્શન ફરી જુઓ] itself; a LOCKED card offers nothing at
        all, because there is nothing yet to revise.
      */}
      {(activity.status === L4_ACTIVITY_STATUS.REVISION_REQUIRED ||
        activity.status === L4_ACTIVITY_STATUS.COMPLETED) && (
        <Link className="l4-aside linklike" to={`/level/4/${activity.id}/revision`}>
          દર્શન ફરી જુઓ
        </Link>
      )}
    </li>
  );
}

/**
 * લેવલ ૨ stays one tap away, exactly as it does at લેવલ ૩: a યુવક who cannot place a
 * number should be able to go and look rather than sit stuck. Nothing records that he went
 * — this is the level's front page, not an attempt.
 */
function Level4Bar() {
  return (
    <header className="level-bar">
      <Link className="linklike" to="/">મુખપૃષ્ઠ</Link>
      <Link className="linklike" to="/darshan">દર્શન જુઓ</Link>
      {/*
        The way back to લેવલ ૩, matching the way forward that લેવલ ૩ now carries.

        It is the level this one is earned at and the level a યુવક returns to every morning
        (§9 clears the day there, never here), so it is not a back button — it is the other
        half of the same climb. Always shown: લેવલ ૩ is open to everyone, always, so there
        is no state in which this link could turn him away.
      */}
      <Link className="linklike" to="/level/3">લેવલ ૩</Link>
    </header>
  );
}
