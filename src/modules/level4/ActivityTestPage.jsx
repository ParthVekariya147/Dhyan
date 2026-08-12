import { memo, useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useScenes } from '../../lib/useScenes';
/*
  One import for the whole of લેવલ ૪. `guLevel4Error` is how a refusal from the RPC becomes
  a Gujarati sentence — the identifiers (`level4_locked`, `level4_gate_closed`, …) are told
  apart there, once, so no screen has to guess and no Postgres string can reach a યુવક.
*/
import { L4_ACTIVITY_STATUS, guLevel4Error, submitAttempt, useLevel4 } from '../../lib/level4';
import { gu } from '../../lib/scenes';
/* The row rhythm, the ring-less head, the panels and — the one that matters on a phone —
   the `content-visibility` list technique are all already solved in the levels module's
   stylesheet. See NumberRow below for why the row itself is not TickRow. */
import '../levels/levels.css';
import './level4.css';

/**
 * લેવલ ૪ — the memory test (§12–§16). The most careful screen in the app.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * There is no answer on this page. Not hidden — absent.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This is the whole point of the screen, and it is the one thing a later edit will undo by
 * accident, so it is written down here and enforced in three places rather than trusted:
 *
 *   1. **The hook.** src/lib/level4.js exports `useLevel4Activity()`, which hands back the
 *      full દર્શન entries for a કસોટી — image, વર્ણન and all. That hook belongs to
 *      RevisionPage. This page uses `useLevel4()` instead, which carries `sceneIds` and
 *      nothing else. The answers are not fetched, not merely unread.
 *   2. **The projection.** The printed numbers have to come from somewhere, and the only
 *      place they exist is the દર્શન collection. `numbering()` below reduces that
 *      collection to `id → number` at the boundary, and every line under it works with
 *      `{ id, n }` pairs. No expression in this file names `t`, `url`, `imageUrl` or
 *      `driveId` — the same way LevelPage genuinely never touches `s.url`, so not one
 *      image byte is requested by this screen.
 *   3. **The row.** NumberRow takes an id and a number. It has no prop that could carry a
 *      વર્ણન, so there is nothing to accidentally pass it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What a tick means, and what a submit means
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A tick is "આ દ્રશ્ય મને યાદ છે" (§13). Nothing is checked against anything and nothing is
 * revealed: the app has no way to know what he pictured and does not pretend to. Passing is
 * therefore "every દ્રશ્ય of this કસોટી is ticked" (§15) and nothing else — there is no
 * correctness comparison anywhere in લેવલ ૪.
 *
 * So 'પૂરું કરો' appears only at ૧૦૦% (§14). Below that there is no button and no count of
 * what is missing (§1 rule 4) — there is an invitation to go and look at the દર્શન again,
 * which is not a penalty and is not recorded as one.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Where the state lives (§33)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The in-flight ticks are component state and are deliberately not persisted. What survives
 * a refresh is the કસોટી's *status*, which is the server's (`useLevel4()`), and that is
 * the right split: a half-finished attempt is not a thing worth resuming — the yuvak simply
 * begins again — while a કસોટી that is COMPLETED is his forever (decision #2) and must
 * survive a refresh, a new phone and midnight alike.
 */
export default function ActivityTestPage() {
  const { activityId } = useParams();
  const { loading, error, retry, config, activities, gateOpen, gateThreshold } = useLevel4();
  const { scenes, loading: scenesLoading } = useScenes();

  // The ticks of the attempt being made right now. See §33 above.
  const [checked, setChecked] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  /** The reply to the one submit this page makes: `{ passed, nextActivityId }`. */
  const [outcome, setOutcome] = useState(null);
  /** A submit that never landed, as one Gujarati sentence. Never a code, never red. */
  const [sendError, setSendError] = useState(null);

  /*
    'હવે પછીની કસોટી' navigates from /level/4/<a> to /level/4/<b> — the same route with a
    different param, so React keeps this component mounted and only the param changes. The
    ticks and the result of the કસોટી just finished would otherwise carry straight over
    into the next one, which is the worst possible bug on this particular screen. Reset
    during render on the change itself (React's own pattern for this) rather than in an
    effect, so the next કસોટી is never painted once with the previous one's answer panel.
  */
  const [openId, setOpenId] = useState(activityId);
  if (openId !== activityId) {
    setOpenId(activityId);
    setChecked(new Set());
    setOutcome(null);
    setSendError(null);
  }

  const activity = activities.find((a) => a.id === activityId) ?? null;

  /*
    The whole of what this screen knows about a દ્રશ્ય: its id, and the number printed on it.

    Ordered by the કસોટી's own `sceneIds`, which the RPC returns in the order the સંચાલક
    arranged (§26) — ક્રમ કદી તૂટે નહીં (§1 rule 2), and it is his ક્રમ here, not the
    collection's. An id the collection no longer has (a દ્રશ્ય withdrawn since this
    કસોટી was published) is dropped rather than rendered as a numberless hole, exactly as
    inOrder() drops it in scenes.js.
  */
  const items = useMemo(() => {
    if (!activity) return [];
    const numberOf = numbering(scenes);
    return (activity.sceneIds ?? [])
      .map((id) => ({ id, n: numberOf.get(id) }))
      .filter((it) => Number.isFinite(it.n));
  }, [activity, scenes]);

  // Stable, so memo on the rows is worth having: a tick re-renders one row, not all of them.
  const onToggle = useCallback((id) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onSubmit = useCallback(async () => {
    setSending(true);
    setSendError(null);
    try {
      // The only write this screen makes, and it is not ours: src/lib/level4.js owns every
      // RPC on the યુવક side. `level4_submit` re-checks the gate, the lock and the item set
      // server-side — this page's ૧૦૦% is a courtesy, never the authority (§37).
      setOutcome(await submitAttempt(activityId, [...checked]));
      /*
        Re-read rather than patch. The attempt has changed a status — this કસોટી's, and
        possibly the next one's, which has just opened — and the authority on that is the
        server, not the reply. `retry()` is useLevel4()'s refresh for exactly this
        (src/lib/level4.js), so the list a યુવક returns to is the list the database holds.
      */
      retry();
    } catch (e) {
      // Nothing is lost: the ticks are still on screen and still his to send. Said in the
      // module's own words — a state, not a mistake he made (§1 rule 4).
      setSendError(guLevel4Error(e));
    } finally {
      setSending(false);
    }
  }, [activityId, checked, retry]);

  // ---------------------------------------------------------------- after the attempt

  /*
    Asked before every other state, and that order is load-bearing.

    The submit above ends with `retry()`, which puts useLevel4() back into `loading` while
    it re-reads. If the spinner below were asked first, the moment a યુવક finished a કસોટી
    would be a spinner thrown over the words 'પૂરું થયું' — the one screen in the app where
    a flicker costs something. What he was told stays on screen while the refresh happens
    behind it. `activities` survives a refresh, so `activity` is still here to render.
  */
  if (activity && outcome) {
    /*
      ફક્ત આનંદ (§1 rule 4). The reply is not a mark out of anything and is never phrased as
      one: it either says the કસોટી is done, or it says the દર્શન are worth another look.
      `passed` is the server's word, and it is the only field of the reply that reaches the
      screen — `selectedCount` and `requiredCount` come back so the RPC can be reasoned
      about, not so a યુવક can be told he was three short (§16).
    */
    if (outcome.passed) {
      return (
        <Frame code={activity.code}>
          <section className="l4-panel">
            <div className="l4-mark" aria-hidden="true">🙏</div>
            <h2>લેવલ {gu(activity.code)} પૂરું થયું</h2>
            <p className="l4-panel-line">
              આ કસોટી હવે કાયમ પૂરી ગણાશે. જય સ્વામિનારાયણ.
            </p>
            {outcome.nextActivityId ? (
              <Link to={`/level/4/${outcome.nextActivityId}`} className="btn-gold btn-inline">
                હવે પછીની કસોટી
              </Link>
            ) : (
              <Link to="/level/4" className="btn-gold btn-inline">લેવલ ૪ ની યાદી</Link>
            )}
          </section>
        </Frame>
      );
    }

    /*
      Not everything came to mind — and this is the screen §16 cares most about.

      No count, no list of which ones, no red, no word that reads as a failure. Going back
      to the દર્શન is the ordinary next step of the સાધના, so it is offered as the main
      action and dressed as one.
    */
    return (
      <Frame code={activity.code}>
        <section className="l4-panel">
          <div className="l4-mark" aria-hidden="true">🪔</div>
          <h2>દર્શન ફરી જોઈ લઈએ</h2>
          <p className="l4-panel-line">
            થોડાં દ્રશ્યો ફરી જોઈ લો, પછી અહીં પાછા આવો. જેટલી વાર જોવું હોય એટલી વાર જોઈ શકાય —
            કંઈ ગુમાવ્યું નથી.
          </p>
          <Link to={`/level/4/${activity.id}/revision`} className="btn-gold btn-inline">
            દર્શન ફરી જુઓ
          </Link>
        </section>
      </Frame>
    );
  }

  // ---------------------------------------------------------------- states

  if (loading || scenesLoading) {
    return (
      <Frame>
        <div className="spinner-page"><span className="dot" /><span className="dot" /><span className="dot" /></div>
      </Frame>
    );
  }

  if (error) {
    return (
      <Frame>
        {/* The sentence is `error` itself — src/lib/level4.js has already chosen the words. */}
        <section className="level-empty">
          <p>{error}</p>
          <button type="button" className="btn-quiet btn-inline" onClick={retry}>ફરી પ્રયાસ કરો</button>
        </section>
      </Frame>
    );
  }

  /*
    Reached by typing, by a stale link, or by opening a કસોટી the સંચાલક has since
    republished. Calm, and it leads somewhere (§1: never a dead end) — the list of
    કસોટીઓ that do exist is one tap away.
  */
  if (!config || !activity) {
    return (
      <Frame>
        <section className="level-empty">
          <p>આ કસોટી અત્યારે નથી. લેવલ ૪ ની યાદી અહીં છે.</p>
          <Link to="/level/4" className="btn-quiet btn-inline">લેવલ ૪</Link>
        </section>
      </Frame>
    );
  }

  // The gate, said in the configuration's own words — never a literal (decision #3).
  if (!gateOpen) {
    return (
      <Frame>
        <section className="level-locked">
          <div className="locked-mark" aria-hidden="true">🔒</div>
          <h2>લેવલ {gu(activity.code)}</h2>
          <p className="locked-line">લેવલ ૩ માં {gu(gateThreshold)} પૂરાં કરો, પછી આ ખૂલશે</p>
          <Link to="/level/3" className="btn-gold btn-inline">લેવલ ૩ શરૂ કરો</Link>
        </section>
      </Frame>
    );
  }

  /*
    A કસોટી whose turn has not come. The invitation names the one that opens it, so the
    યુવક leaves this page knowing what to do — never how far behind he is (§1 rule 4, §23).
  */
  if (activity.status === L4_ACTIVITY_STATUS.LOCKED) {
    const previous = previousOf(activities, activity);
    return (
      <Frame>
        <section className="level-locked">
          <div className="locked-mark" aria-hidden="true">🔒</div>
          <h2>લેવલ {gu(activity.code)}</h2>
          <p className="locked-line">
            {previous
              ? `લેવલ ${gu(previous.code)} પૂરું થાય, પછી આ ખૂલશે`
              : 'આગળની કસોટી પૂરી થાય, પછી આ ખૂલશે'}
          </p>
          <Link to="/level/4" className="btn-gold btn-inline">લેવલ ૪ ની યાદી</Link>
        </section>
      </Frame>
    );
  }

  // ---------------------------------------------------------------- the test

  const all = items.length > 0 && checked.size >= items.length;

  return (
    <Frame code={activity.code}>
      <header className="level-head">
        <p className="level-eyebrow">લેવલ {gu(activity.code)}</p>
        <h1>{activity.title || 'ફક્ત નંબર'}</h1>
        <p className="level-note">
          ફક્ત નંબર જુઓ. દ્રશ્ય મનમાં આવે તો ટિક કરો. અહીં કંઈ સાચું-ખોટું નથી — જે યાદ છે તે
          તમે જ જાણો છો.
        </p>

        {/*
          Already his, and saying so plainly. Decision #2: a કસોટી once passed is never
          taken back, so this visit is practice — offered warmly, with nothing at stake.
        */}
        {activity.status === L4_ACTIVITY_STATUS.COMPLETED && (
          <p className="level-note l4-banner">
            આ કસોટી પૂરી થઈ ગઈ છે અને કાયમ પૂરી રહેશે. ફરી કરવી હોય તો ખુશીથી કરો.
          </p>
        )}
      </header>

      {/*
        Numbers and boxes. Nothing else exists on this list — see the note at the top of
        the file, and NumberRow below.
      */}
      <ol className="tick-list">
        {items.map((it) => (
          <NumberRow
            key={it.id}
            id={it.id}
            n={it.n}
            ticked={checked.has(it.id)}
            onToggle={onToggle}
          />
        ))}
      </ol>

      {/*
        A count of what is done, in the same words લેવલ ૩ uses at the foot of its list. Not
        a count of what is missing and not a target (§1 rule 4) — and `items.length` is the
        કસોટી's own item count, never a total typed here (§6 rule 1).
      */}
      <p className="level-foot" aria-live="polite">
        ટિક થયેલાં: {gu(checked.size)} / {gu(items.length)}
      </p>

      {/*
        §14 — the button exists only at ૧૦૦%.

        લેવલ ૩ deliberately has no 'પૂરું કરો' because every tick there is already saved and
        there is nothing to submit. Here there is: an attempt is one event, written once by
        `level4_submit`, and until it is sent nothing has happened. So the button appears —
        and only when it can honestly be pressed.

        Sticky, because the last box a યુવક ticks is not always the last one in the list, and
        a button that appeared silently four screens below him would never be found.
      */}
      <div className="l4-actions" aria-live="polite">
        {all ? (
          <button type="button" className="btn-gold btn-inline" onClick={onSubmit} disabled={sending}>
            {sending ? 'મોકલાય છે…' : 'પૂરું કરો'}
          </button>
        ) : (
          <Link to={`/level/4/${activity.id}/revision`} className="btn-quiet btn-inline">
            દર્શન ફરી જુઓ
          </Link>
        )}
      </div>

      {sendError && (
        <p className="level-note level-sync">
          {sendError} તમારી ટિક અહીં જ છે.{' '}
          <button type="button" className="linklike" onClick={onSubmit} disabled={sending}>
            ફરી મોકલો
          </button>
        </p>
      )}
    </Frame>
  );
}

/**
 * The દર્શન collection, reduced to the only thing this screen is allowed to know.
 *
 * Deliberately *not* imported from Level4Page, which computes the same map: this file has
 * to be readable on its own as a file that never touches scene content, and an import from
 * a page that renders titles and descriptions is exactly the door a future edit walks
 * through. Four lines of duplication is a cheap price for that.
 */
const numbering = (scenes) => new Map(scenes.map((s) => [s.id, s.n ?? s.index]));

/** The કસોટી immediately before this one, by published position — never by code (§6 rule 2). */
function previousOf(activities, activity) {
  const i = activities.findIndex((a) => a.id === activity.id);
  return i > 0 ? activities[i - 1] : null;
}

/**
 * One line of the test: a number and a box.
 *
 * **Not TickRow**, and that is the point. TickRow takes a `text` prop and renders a
 * 'જવાબ જુઓ' button — it is built to be able to show the answer, which is precisely what
 * this screen must not be able to do. A row with no prop for a વર્ણન cannot be given one by
 * mistake. It wears TickRow's classes, so the two lists look and feel identical and the
 * `content-visibility` work in levels.css serves this one too.
 *
 * `memo` for the same reason TickRow has it: a કસોટી of thirty rows is ticked thirty
 * times, and without it that is nine hundred row renders on a phone instead of thirty.
 */
const NumberRow = memo(function NumberRow({ id, n, ticked, onToggle }) {
  return (
    <li className={`tick-row${ticked ? ' is-on' : ''}`}>
      {/* The whole row is the label, so the tap target is the row and not a 26px box (§14). */}
      <label className="tick-main">
        <span className="tick-n">{gu(n)}</span>
        {/* Holds the row's shape, and holds nothing else. */}
        <span className="tick-body" aria-hidden="true" />
        <input
          type="checkbox"
          checked={ticked}
          onChange={() => onToggle(id)}
          aria-label={`દ્રશ્ય ${gu(n)}`}
        />
        <span className="tick-box" aria-hidden="true">{ticked ? '✓' : ''}</span>
      </label>
    </li>
  );
});

/**
 * The page frame.
 *
 * The bar carries one link, back to the list — and deliberately *not* 'દર્શન જુઓ'. લેવલ ૩
 * keeps the pictures one tap away because nothing there is being attempted; here an attempt
 * is in progress and the way to the pictures is [દર્શન ફરી જુઓ], which is the same journey
 * said honestly and counted as revision (§16). Two doors to the same room, one of them
 * unlabelled, would only make the honest one look like a punishment.
 */
function Frame({ code, children }) {
  return (
    <div className="level-wrap">
      <header className="level-bar">
        <Link className="linklike" to="/level/4">← લેવલ ૪</Link>
        {code && <span className="l4-crumb">લેવલ {gu(code)}</span>}
      </header>
      {children}
    </div>
  );
}
