import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useScenes } from '../../lib/useScenes';
/*
  One import for the whole of લેવલ ૪. `guLevel4Error` is how a refusal from the RPC becomes
  a Gujarati sentence — the identifiers (`level4_locked`, `level4_gate_closed`, …) are told
  apart there, once, so no screen has to guess and no Postgres string can reach a યુવક.
*/
import {
  L4_ACTIVITY_STATUS,
  guLevel4Error,
  newClientToken,
  submitAttempt,
  useLevel4,
} from '../../lib/level4';
/*
  The page's description — text only, and that is worth stating on this screen of all of
  them. shared/domain/journey.js holds sentences; it holds no દ્રશ્ય, no વર્ણન and no way to
  reach one. Importing it here cannot become the door that puts an answer on this page.
*/
import { JOURNEY_PAGE, usePageSpec } from '../../lib/journey';
/* The two things this screen says once an attempt is in: shared/domain/milestones.js holds
   every finishing moment in the app, so these two read as the same voice as લેવલ ૩'s and
   the home ladder's. Sentences only — the same rule as the journey import above. */
import { passedActivity, shortAttempt } from '../../lib/milestones';
import { gu } from '../../lib/scenes';
/* Text, and text only — the same rule as the journey import above. `useTickWord()` returns
   one configured string for the whole list; there is no scene in it and no way to ask it
   for one. */
import { useTickWord } from '../../lib/useSettings';
import PageIntro from '../../components/PageIntro';
import NavArrow from '../../components/NavArrow';
/* The row rhythm, the ring-less head, the panels and — the one that matters on a phone —
   the `content-visibility` list technique are all already solved in the levels module's
   stylesheet. See NumberRow below for why the row itself is not TickRow. */
import '../levels/levels.css';
import './level4.css';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * PAGE CONTRACT — લેવલ ૪, one કસોટી (/level/4/:activityId)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Purpose        Test whether a યુવક can bring each દ્રશ્ય of this કસોટી to mind from its
 *                number alone. He has already seen the pictures at લેવલ ૨ and, if he has
 *                been here before, at this કસોટી's own પુનરાવર્તન.
 *
 * Input          useLevel4() — this કસોટી's `sceneIds`, its status, and the gate.
 *                useScenes() — for the printed number of each id, and nothing else.
 * Visible        The કસોટી's code and title, the instruction, and one row per item:
 *                **number and checkbox**. Then the tick count, and one action.
 * Actions        Tick, untick, submit once the કસોટી's own mark is reached, record a
 *                half-attempt below it, or go and look at the દર્શન again.
 * Persisted      One row per attempt via `level4_submit`, and — if the mark was reached —
 *                this કસોટી marked COMPLETED, permanently. The in-flight ticks are NOT
 *                persisted: a half-finished attempt is not a thing worth resuming.
 * Completion     `level4_required_count()` items ticked — the mark the સંચાલક set for this
 *                કસોટી, which is every item unless he said otherwise (0016) — and the
 *                submit acknowledged. The server re-checks the gate, the lock, the item set
 *                and the mark; this page's arithmetic is a courtesy, never the authority.
 * Attempts       **No limit** (0017, restoring 0012). Any કસોટી that is not LOCKED may be
 *                sat as often as the યુવક likes, passed or not, and a pass is never revoked
 *                by a later attempt that falls short.
 * Next           Passed → the next કસોટી, or the લેવલ ૪ list if this was the last.
 *                Not passed → this કસોટી's પુનરાવર્તન, /level/4/:activityId/revision.
 * Previous       /level/4 — the કસોટી list.
 * Excluded       **The image. The title. The વર્ણન. The answer.** Not hidden — absent, and
 *                enforced in three places (see below). Also excluded: any count of what is
 *                missing, any red, any word that reads as a failure, and a 'દર્શન કરો' link
 *                in the bar — the honest door is [ફરી દર્શન કરો] and there is only one.
 * Loading        Three dots inside the frame, with the way back to the list still there.
 * Error          A submit that never landed: one Gujarati line, the ticks left on screen,
 *                and 'ફરી મોકલો'. Nothing of his is lost.
 * Empty          Unknown or withdrawn કસોટી → a calm line and the list, one tap away.
 * Source of truth  The published લેવલ ૪ configuration for the item set and the order;
 *                  `level4_submit` for whether an attempt passed; shared/domain/journey.js
 *                  for the words — text only, never content.
 *
 * ────────────────────────────────────────────────────────────────────────────
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
 * reaching this કસોટી's mark — `level4_required_count()`, which is every દ્રશ્ય unless the
 * સંચાલક set a smaller number (0016). There is no correctness comparison anywhere in લેવલ ૪;
 * a tick is never wrong, there is only ground covered and ground not yet covered.
 *
 * So 'પૂરું કરો' appears when the mark is reached and not before. Below it, the invitation to
 * go and look at the દર્શન again is the first thing offered, because that is the ordinary
 * next step of the સાધના and not a penalty. Beside it, quietly, 'આટલું નોંધાવો' records the
 * half-attempt: the કસોટી stays open, nothing is marked wrong, and the only difference is
 * that `level4_attempts` remembers he sat down and tried. There is still no count of what is
 * missing anywhere on this screen (§1 rule 4), before the attempt or after it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A finished કસોટી is still a કસોટી (0017)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * COMPLETED does not close this page: the boxes come up empty again, the button behaves the
 * same way, and `level4_submit` accepts the attempt however many times it is sent. There is
 * no attempt limit in the database and none here. An attempt that falls short on a કસોટી
 * already passed does not un-pass it — step 8 of that function never demotes a COMPLETED row,
 * and `completed_at` still records the first pass.
 *
 * This rule has been reversed twice; the history is in 0017's header, and that file is the
 * one place to read before changing it again. What has held throughout is the other half:
 * nothing can *withdraw* a pass — not the સંચાલક raising the લેવલ ૪ gate past where this યુવક
 * stands (0014), not a reorder that puts something unfinished in front of it (0012).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Historical note — the rule 0016 briefly held
 * ────────────────────────────────────────────────────────────────────────────
 *
 * For one afternoon a કસોટી got a single submission, spent by passing it. Under that rule a
 * કસોટી he had **not** passed could still be sat as often as it took. Nothing was used up by
 * falling short, and that was the whole of why it was safe: "one submission ever" would
 * turn a single misremembered દ્રશ્ય into લેવલ ૪ closed forever, with no સંચાલક reset in this
 * system to rescue anyone from it.
 *
 * It was reversed because the સંચાલક saw it on the screen — "ફરી આપવાની નથી" under a finished
 * કસોટી — and decided that closing a ધ્યાન a યુવક wants to repeat is not what this સાધના is
 * for. `level4_already_passed` no longer exists in `level4_submit`; the Gujarati sentence for
 * it is kept in src/lib/level4.js against a stale deployment, and nothing raises it.
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
  /*
    The word a ticked row carries, from settings/app (§36 — a word a યુવક reads is the
    સંચાલક's). One string for the whole list and never a per-દ્રશ્ય value; see the note over
    the <ol> below for how it reaches a row without becoming a prop, and the rules in
    shared/domain/settings.js for why it cannot say anything about the દ્રશ્ય behind it.

    Not waited on: '' until the row lands, which is a row exactly as it is today. Nothing on
    this screen is missing without it, so it never delays a paint.
  */
  const { tickWord } = useTickWord();

  // The ticks of the attempt being made right now. See §33 above.
  const [checked, setChecked] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  /** The reply to the one submit this page makes: `{ passed, nextActivityId }`. */
  const [outcome, setOutcome] = useState(null);
  /** A submit that never landed, as one Gujarati sentence. Never a code, never red. */
  const [sendError, setSendError] = useState(null);
  /**
   * The idempotency key for the answer currently being sent (0025). A ref and not state,
   * deliberately: it must not cause a render, and it must be readable synchronously by the
   * second tap that arrives before React has processed the first. See onSubmit().
   */
  const tokenRef = useRef(null);

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

  // What this screen is for, in the words a યુવક reads (shared/domain/journey.js). Text
  // only: this hook fetches sentences, never a દ્રશ્ય.
  const spec = usePageSpec(JOURNEY_PAGE.LEVEL4_TEST);

  /*
    The whole of what this screen knows about a દ્રશ્ય: its id, and the number a યુવક reads
    on it — `displayIndex`, looked up by id, never counted off this list (see numbering()).

    Ordered by the કસોટી's own `sceneIds`, which the RPC returns in the order the સંચાલક
    arranged (§26) — ક્રમ કદી તૂટે નહીં (§1 rule 2), and it is his ક્રમ here, not the
    collection's. So the two are separate facts and stay separate: the *order* is the
    activity's, the *number* is the collection's.

    An id the collection no longer has (a દ્રશ્ય withdrawn since this કસોટી was published)
    has no `displayIndex` and is dropped rather than rendered as a numberless hole, exactly
    as inOrder() drops it in scenes.js — and src/lib/level4.js has already dropped it from
    `required` server-side, so nothing here re-opens a hole the sequence has closed.
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
    /*
      §31/0025 — the key for THIS answer, minted once and held until the server has accepted it.

      `disabled={sending}` above is a courtesy and is not the guarantee: it does not survive a
      second tap that lands in the same frame, a `fetch` the browser retries after a lost
      response, or the યુવક pressing નોંધાવો again because nothing appeared to happen on a weak
      signal. All three arrive at `level4_submit` carrying this same token, and 0025 records the
      first and replays it to the rest — so his history says he sat the કસોટી once, because he
      did.

      Cleared in the success path and NOT in the failure path, which is the whole distinction:
      a failure means the answer has not been recorded and the next press is still the same
      submission, while a success means the next press is a new sitting — and 0017 is explicit
      that he may have one. Two tabs hold two refs and so submit twice; that is correct, because
      two deliberate presses in two tabs are two attempts, and nothing about them is lost or
      double-counted (the day's score is counted, not incremented, and the ledger pays once).
    */
    if (!tokenRef.current) tokenRef.current = newClientToken();
    try {
      // The only write this screen makes, and it is not ours: src/lib/level4.js owns every
      // RPC on the યુવક side. `level4_submit` re-checks the gate, the lock and the item set
      // server-side — this page's ૧૦૦% is a courtesy, never the authority (§37).
      setOutcome(await submitAttempt(activityId, [...checked], tokenRef.current));
      tokenRef.current = null;
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
      /* The words come from shared/domain/milestones.js, where all six of the app's
         finishing moments are written together so they congratulate a યુવક in one voice.
         `line` is said here because this is the moment it becomes true, and because a યુવક
         who comes back tomorrow looking for the કસોટી should have been told once, warmly,
         rather than meeting a closed door and wondering (0016). `grow` is the sentence that
         keeps the screen from reading as an ending. */
      const words = passedActivity(gu(activity.code));
      return (
        <Frame code={activity.code}>
          <section className="l4-panel">
            <div className="l4-mark" aria-hidden="true">🙏</div>
            <h2>{words.title}</h2>
            <p className="l4-panel-line">{words.line}</p>
            <p className="l4-panel-grow">{words.grow}</p>
            {outcome.nextActivityId ? (
              <Link to={`/level/4/${outcome.nextActivityId}`} className="btn-gold btn-inline">
                હવે પછીની કસોટી<NavArrow />
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

      Written to the same three-part shape and the same warmth as the panel above it — same
      file, deliberately adjacent, so neither can be softened or hardened without the other
      being read. It is the same યુવક on the same સાધના, and the app has no opinion about the
      difference between these two screens.
    */
    const words = shortAttempt();
    return (
      <Frame code={activity.code}>
        <section className="l4-panel">
          <div className="l4-mark" aria-hidden="true">🪔</div>
          <h2>{words.title}</h2>
          <p className="l4-panel-line">{words.line}</p>
          <p className="l4-panel-grow">{words.grow}</p>
          <Link to={`/level/4/${activity.id}/revision`} className="btn-gold btn-inline">
            ફરી દર્શન કરો
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
          <button type="button" className="btn-quiet btn-inline" onClick={retry}>ફરી પ્રયત્ન કરો</button>
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
          <p>આ કસોટી અત્યારે મળતી નથી. લેવલ ૪ ની યાદી અહીં છે.</p>
          <Link to="/level/4" className="btn-quiet btn-inline">લેવલ ૪</Link>
        </section>
      </Frame>
    );
  }

  /*
    The gate, said in the configuration's own words — never a literal (decision #3).

    Not asked of a કસોટી he has already passed (0012). `gateOpen` can go from true to false
    under a યુવક who has climbed several of these — the સંચાલક raises `gate_threshold` — and
    this screen is where that would hurt most: a card marked પૂરું થયું, tapped, answering
    with a તાળું. What he earned stays open and stays repeatable; the gate governs only the
    કસોટીઓ still ahead, which arrive here as LOCKED and are handled just below.
  */
  if (!gateOpen && activity.status !== L4_ACTIVITY_STATUS.COMPLETED) {
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
              : 'આ પહેલાંની કસોટી પૂરી થાય, પછી આ ખૂલશે'}
          </p>
          <Link to="/level/4" className="btn-gold btn-inline">લેવલ ૪ ની યાદી</Link>
        </section>
      </Frame>
    );
  }

  // ---------------------------------------------------------------- the test

  /*
    Whether the mark has been reached (0016) — not whether everything is ticked.

    `requiredCount` arrives from the server already clamped to what the કસોટી holds, so this
    can never ask for more boxes than exist. The `min` is belt-and-braces for a payload from
    an older database that did not send the field at all, where normaliseActivity() has
    already defaulted it to the item count.
  */
  const needed = Math.min(activity.requiredCount || items.length, items.length);
  const enough = items.length > 0 && checked.size >= needed;

  return (
    <Frame code={activity.code}>
      <header className="level-head">
        <p className="level-eyebrow">લેવલ {gu(activity.code)}</p>
        <h1>{activity.title || 'ફક્ત નંબર'}</h1>
        {/*
          The instruction, and on this screen it is doing real work.

          A યુવક who opens a કસોટી and finds thirty bare numbers has a fair question — where
          did the pictures go — and until now the answer was one line typed here. It is now
          the shared description, which says the same thing and then says the part that line
          could not: **ચિત્ર કે વર્ણન બતાવવામાં આવશે નહીં** is deliberate, all thirty must be
          ticked before 'પૂરું કરો' appears, and going back to the દર્શન is an ordinary step
          rather than a penalty (§16).

          `spec` carries sentences and nothing else — see the import note at the top. There
          is no field on it that could hold a વર્ણન, so the rule this file is built around
          survives having a description on the page.
        */}
        <PageIntro spec={spec} />

        {/*
          The mark, said once, before he starts (0016).

          Only when it is below the કસોટી's own size — "ટિક થયેલાં: ૦ / ૨૭" already tells him
          how many there are, and repeating that as a target would add nothing. When the
          સંચાલક has set a lower mark it has to be said, or a યુવક who reaches it sees
          'પૂરું કરો' appear with boxes still empty and cannot tell whether that is right.

          Said as what is needed, never as what is missing (§1 rule 4).
        */}
        {activity.requiredCount > 0 && activity.requiredCount < items.length && (
          <p className="level-note l4-banner">
            આ કસોટી પૂરી કરવા માટે ઓછામાં ઓછી {gu(activity.requiredCount)} ટિક જરૂરી છે. જે લીલા
            ખરેખર યાદ આવે એની જ ટિક કરજો.
          </p>
        )}

        {/*
          Already his, and saying so plainly (0017).

          A કસોટી once passed is never taken back, and it may be sat again as often as he
          likes — so this visit is practice, with nothing at stake and nothing to lose. Said
          warmly and once, because a યુવક who opens a finished કસોટી and finds the boxes empty
          again would otherwise wonder whether his pass had been forgotten.
        */}
        {activity.status === L4_ACTIVITY_STATUS.COMPLETED && (
          <p className="level-note l4-banner">
            આ કસોટી તમે પૂરી કરી લીધી છે. ફરી આપવી હોય તો જેટલી વાર મન થાય એટલી વાર આપી શકશો -
            કોઈ મર્યાદા નથી. પૂરી થયેલી કસોટી કાયમ તમારી જ રહેશે, ફરી આપો તો પણ.
          </p>
        )}
      </header>

      {/*
        Numbers and boxes. Nothing else exists on this list — see the note at the top of
        the file, and NumberRow below.

        The one thing that has been added to a row since is `--tick-word`, and it is set
        here, on the list, rather than passed down: one string from settings/app, inherited
        by all of them, rendered by CSS only when a row is ticked (levels.css). NumberRow
        below still takes no prop that could carry text — which is the invariant this whole
        file is built around, and the reason the word arrives this way instead.

        `JSON.stringify` because the property's value is a CSS <string> and has to arrive
        quoted: it wraps the word in double quotes and escapes any the સંચાલક typed inside
        it. resolveTickWord() has already collapsed the whitespace, so nothing here can
        become a newline — which in a CSS string is not a line break but an escape for the
        letter 'n'.

        `undefined` rather than an empty declaration when there is no word: the property
        stays unset, the CSS falls back to "" and no pseudo-element is generated at all.
      */}
      <ol
        className="tick-list"
        style={tickWord ? { '--tick-word': JSON.stringify(tickWord) } : undefined}
      >
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
        §14 — 'પૂરું કરો' still exists only at ૧૦૦%, and it is still the only thing that
        finishes a કસોટી.

        લેવલ ૩ deliberately has no 'પૂરું કરો' because every tick there is already saved and
        there is nothing to submit. Here there is: an attempt is one event, written once by
        `level4_submit`, and until it is sent nothing has happened.

        Below ૧૦૦% there are now two doors instead of one. The દર્શન remain the first of
        them — going back to look is the ordinary next step of the સાધના and is dressed as
        such (§16). Beside it, quietly, is the half-attempt: `level4_submit` records it,
        `passed` comes back false, and the કસોટી stays exactly as open as it was. That is
        worth having for one reason only — an attempt that fell short is a real event of his
        સાધના, and until now it left no trace at all: he simply could not press anything, so
        `level4_attempts` remembered the days he succeeded and none of the days he sat down
        and tried. The history is his record, and a record with only the good days in it is
        not one.

        What it is careful not to become is a failure. It is never the gold button, it is
        never the only door, its word is 'નોંધાવો' and not 'મોકલો', and what comes back is
        §16's 'દર્શન ફરી જોઈ લઈએ' panel — no count, no list of which ones, nothing red.
        Nothing anywhere in લેવલ ૪ compares answers, and a recorded half-attempt does not
        start.

        With nothing ticked there is nothing to record, so only the દર્શન are offered — an
        empty attempt is not a moment of the સાધના, it is a page he opened and left.

        Sticky, because the last box a યુવક ticks is not always the last one in the list, and
        a button that appeared silently four screens below him would never be found.
      */}
      <div className="l4-actions" aria-live="polite">
        {enough ? (
          <button type="button" className="btn-gold btn-inline" onClick={onSubmit} disabled={sending}>
            {sending ? 'મોકલાય છે…' : 'પૂરું કરો'}
          </button>
        ) : (
          <>
            <Link to={`/level/4/${activity.id}/revision`} className="btn-gold btn-inline">
              ફરી દર્શન કરો
            </Link>
            {checked.size > 0 && (
              <button
                type="button"
                className="btn-quiet btn-inline"
                onClick={onSubmit}
                disabled={sending}
              >
                {sending ? 'નોંધાય છે…' : 'આટલું નોંધાવો'}
              </button>
            )}
          </>
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
 * **`id → number`, and it stays `id → number`.** That is the property, not the
 * implementation: the collection reaching this file carries `t`, `url`, `fullUrl` and
 * `driveId`, and this one expression is the boundary at which all of them are thrown away.
 * Everything below the call site works with `{ id, n }` pairs, so there is no answer left in
 * the file to leak — rule 3 (LEVEL4.md §6) is enforced by the shape, not by discipline.
 *
 * The number is now `displayIndex` rather than `s.n ?? s.index` (ORDERING.md §4) — the same
 * continuous ૧…N useScenes() puts on every screen, so a દ્રશ્ય the યુવક ticked as ૩૧ at
 * લેવલ ૩ is ૩૧ here too. Note what this is *not*: it is not the item's position in the
 * કસોટી. ૪.૨ composed of the second thirty દ્રશ્યો prints ૩૧…૬૦, because the number is
 * looked up by `id` in the sequenced collection and never counted off the activity's own
 * list. A local ૧…N would be a second numbering of the same દ્રશ્યો, which is the very thing
 * decision #1 exists to prevent.
 *
 * Deliberately *not* imported from Level4Page, which computes the same map: this file has
 * to be readable on its own as a file that never touches scene content, and an import from
 * a page that renders titles and descriptions is exactly the door a future edit walks
 * through. One line of duplication is a cheap price for that.
 */
const numbering = (scenes) => new Map(scenes.map((s) => [s.id, s.displayIndex]));

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
 * The bar carries one link, back to the list — and deliberately *not* 'દર્શન કરો'. લેવલ ૩
 * keeps the pictures one tap away because nothing there is being attempted; here an attempt
 * is in progress and the way to the pictures is [ફરી દર્શન કરો], which is the same journey
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
