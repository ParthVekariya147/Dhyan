import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, guError } from '../lib/auth';
/* લેવલ ૧'s description, from the same specification every other level reads its own. */
import { JOURNEY_PAGE, usePageSpec } from '../lib/journey';
import PageIntro from '../components/PageIntro';
import '../styles/forms.css';
import './entry-gate.css';

/**
 * §5 — the entry gate, and લેવલ ૧ of the સાધના. The two questions are asked after the
 * first login; the app cannot be entered until both answers are Yes.
 *
 * §6 — what follows is not the home menu but લેવલ ૨. The whole of લેવલ ૧ is: watch the
 * વિડિયો, answer the two questions, go on to દર્શન. Both modes below end on the same
 * button pointing at /darshan, because it is the same step either way.
 *
 * The spec is explicit that the app CANNOT actually verify a like or a comment — that
 * would need YouTube API permission plus Google login, judged too heavy. So this runs
 * on trust. Both answers are recorded so the સંચાલક can see who said Yes.
 *
 * `replay` is the same page for a yuvak who has already passed. It used to hide the two
 * questions entirely, which left him staring at a bare video with no sign that the app
 * had ever recorded anything from him — and no way to correct an answer. So the same
 * two boxes are shown, ticked from what is stored against his profile, and he may change
 * them. What is asked once is the entry, not the questions: passing the gate is not
 * re-run here, so unticking a box cannot lock him back out (see `saveGateAnswers`).
 *
 * The YouTube link comes from settings/app, so the સંચાલક can change it without a
 * redeploy. Until it is set, the page explains rather than showing an error — and the
 * questions still render, because a missing link must not be the thing that keeps a
 * yuvak out of the app.
 *
 * This page used to be the one screen written in English, on the reasoning that the
 * વિડિયો and its two questions are English and half a page in each language reads worse
 * than either. It read worse in practice: a યુવક arrives here straight from નોંધણી, which
 * is Gujarati, and met a screen he could not read at the exact moment he is being asked
 * to answer something. So it is Gujarati like every other screen. `lang="gu"` comes from
 * index.html and is not overridden here, and a failed write is explained by the same
 * `guError` the લોગિન and નોંધણી pages use rather than by a second table of this page's
 * own.
 */

export default function EntryGate({ videoId, replay = false }) {
  const { profile, saveGateAnswers, logout } = useAuth();
  // લેવલ ૧'s description, from the same place every other level reads its own (§36).
  const spec = usePageSpec(JOURNEY_PAGE.LEVEL1);
  const nav = useNavigate();

  const [liked, setLiked] = useState(false);
  const [commented, setCommented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(0);

  const ready = liked && commented;

  /**
   * On a return visit the boxes start from what was recorded, not from false.
   *
   * Keyed on the stored values rather than run once: `profile` arrives from Supabase and
   * is replaced after every save, and a mount that happened before the row landed would
   * otherwise leave both boxes empty next to answers the સંચાલક can already see.
   */
  useEffect(() => {
    if (!replay) return;
    setLiked(Boolean(profile?.like_answer));
    setCommented(Boolean(profile?.comment_answer));
  }, [replay, profile?.like_answer, profile?.comment_answer]);

  /** Clears the "saved" tick a few seconds after it appears, so it never reads as stale. */
  const savedTimer = useRef(null);
  useEffect(() => () => clearTimeout(savedTimer.current), []);

  /**
   * લેવલ ૧ in the history, and the three decisions inside one line of code.
   *
   * **What counts.** Both answers being Yes, and nothing else. There is no watch event here
   * to record: the વિડિયો is a bare `<iframe>` and this app has never loaded YouTube's
   * player API, deliberately — §5 says outright that verifying a like or a comment was
   * judged too heavy, and measuring playback would be the same weight for the same kind of
   * claim. So the honest signal is the one the page already has, and this records that
   * rather than inventing a watch it cannot see. A page *load* is explicitly not it (§5 of
   * the brief: "Do not create fake completions from page loads") — arriving here records
   * nothing at all.
   *
   * **One row per visit, not per tap.** The token is minted once for the life of this
   * component, so a યુવક on a return visit who unticks and reticks a box sends three
   * requests and creates one attempt: `activity_submit` recognises the token and hands back
   * the row it already wrote. Coming back this evening is a new mount, a new token, and
   * genuinely a second વાર.
   *
   * **It never blocks the gate.** The promise is not awaited and its rejection is swallowed,
   * which is the same shape and the same argument as `markRevision()` on RevisionPage: the
   * thing that matters here is `saveGateAnswers`, and a યુવક must not be held at the door —
   * or worse, turned back — because a history row could not be filed. The cost is admitted:
   * a submission lost to a dead connection is lost, and the day will read one વાર short.
   * That is the right trade for a record that no permission and no unlock depends on.
   *
   * **Imported dynamically, and that is not a style choice.** This page is one of the three
   * `src/App.jsx` loads eagerly — it is the પ્રવેશદ્વાર, so it must paint on the first visit
   * without waiting for a second chunk — which means a static import here would put
   * src/lib/activity.js and the whole of shared/domain/points.js into the entry bundle that
   * every યુવક downloads before anything renders. `verify:separation` holds that chunk to a
   * measured threshold for exactly this reason, and the module is not needed until the moment
   * both boxes are ticked, which is at the earliest several seconds of વિડિયો away. Nothing
   * is awaited on the render path and the import resolves from cache after the first call.
   */
  const visitToken = useRef(null);
  const recordLevel1 = (next) => {
    if (!next.liked || !next.commented) return;
    import('../lib/activity')
      .then(({ ACTIVITY_KEY, newToken, recordActivity }) => {
        if (!visitToken.current) visitToken.current = newToken();
        return recordActivity(ACTIVITY_KEY.VIDEO, visitToken.current);
      })
      .catch(() => {});
  };

  /**
   * First pass through the gate: both answers, then straight on to લેવલ ૨.
   *
   * §5/§6 — this used to land on the home page, which broke the one sequence the spec
   * actually describes: વિડિયો → the two questions → દર્શન. Dropping a yuvak on the home
   * menu at that exact moment asks him to find લેવલ ૨ himself, on the first visit, when
   * he has least idea what the levels are. He can still reach home from there; what he
   * cannot do is guess that answering two questions was supposed to lead somewhere.
   *
   * The navigation is inside the `try`, after the await, deliberately: a level is only
   * finished once the write that records it has come back. If `saveGateAnswers` throws,
   * this line never runs, the catch below explains it, and the same tap retries. There is
   * no timer here — a setTimeout would move on whether or not the write ever landed.
   */
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await saveGateAnswers({ liked, commented });
      // After the write that matters has come back, and before the navigation, so the
      // request is started while this component is still mounted. Not awaited: see
      // recordLevel1().
      recordLevel1({ liked, commented });
      nav('/darshan', { replace: true });
    } catch (e) {
      // §1 — never a dead end. The ticks stay where they are and the button comes back,
      // so the same tap retries rather than sending him to the login screen.
      setError(guError(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * A change on a return visit, written as it is made.
   *
   * Two boxes is at most two writes a visit, so there is nothing to batch — and a Save
   * button would be worse than useless here: the boxes come up already ticked, so a
   * yuvak who never presses it cannot tell whether his correction was kept.
   */
  async function change(next) {
    setLiked(next.liked);
    setCommented(next.commented);
    setBusy(true);
    setError(null);
    try {
      await saveGateAnswers(next);
      recordLevel1(next);
      setSavedAt(Date.now());
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSavedAt(0), 2600);
    } catch (e) {
      // The tick stays visible and the message says what happened; toggling again is
      // the retry. Reverting it under his finger would look like the app refusing him.
      setError(guError(e));
    } finally {
      setBusy(false);
    }
  }

  const onLiked = (v) =>
    replay ? change({ liked: v, commented }) : setLiked(v);
  const onCommented = (v) =>
    replay ? change({ liked, commented: v }) : setCommented(v);

  return (
    <div className="auth-wrap gate-wrap">
      <div className="auth-card">
        <h1 className="auth-title">{replay ? 'વિડિયો દર્શન' : 'સ્વાગત છે'}</h1>
        <p className="auth-sub">
          જય સ્વામિનારાયણ{profile?.name ? `, ${profile.name}` : ''}<br />
          {replay
            ? 'આ વિડિયો તમે ગમે ત્યારે ફરી જોઈ શકો છો'
            : 'ધ્યાન શરૂ કરતાં પહેલાં આ વિડિયો જુઓ'}
        </p>

        {/*
          The same instruction block લેવલ ૨, ૩ and ૪ carry. લેવલ ૧ had a description written
          for it — with an English half, written for this page specifically — and no way to
          read it; the entry existed and nothing put it on screen.

          `compact` on the replay pass: a યુવક who has already answered both questions and
          come back only to watch again does not need the page explained a second time, and
          the line above it already says what this visit is.
        */}
        <PageIntro spec={spec} compact={replay} />

        {videoId ? (
          <div className="gate-video">
            <div className="video-frame">
              {/*
                §14 — on a phone, "watch this video" means the player's own full-screen
                button has to work. It was not working, and the cause was here rather
                than in the CSS: `fullscreen` is missing from the permission list.

                `allowFullScreen` and `allow="fullscreen"` are supposed to be equivalent
                — the HTML spec folds the legacy attribute into the frame's container
                policy — but the fold is only dependable while `allow` is ABSENT. Once
                `allow` is written out, as it is here, older Chromium, Android WebView
                (which is what an installed PWA gets on a good number of phones) and
                WebKit have all shipped versions that read the written list as the whole
                policy and drop fullscreen from it. Inside a cross-origin frame that
                leaves the button either dead or hidden. Both spellings are kept: the
                token for the engines that read the list, the attribute for anything old
                enough to predate permission policy.

                `playsinline=1` STAYS, and is not the problem. It is an iOS-only switch
                and it does not touch Android, where this was reported. On iOS, dropping
                it would not "enable" full-screen — it would force it: the first tap on
                play would be handed straight to the native full-screen player, the yuvak
                would never see this page again until he backed out, backing out would
                end playback, and he would return to a gate whose two questions he never
                read. Inline is what keeps the video and the questions on one screen, and
                the full-screen button still reaches the native player when he asks for
                it. Layout is solved in entry-gate.css, not by removing this.

                Nothing in this URL selects a resolution and nothing may — YouTube picks
                the stream from the real viewport and the connection.
              */}
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`}
                title="વર્ણી ધ્યાન"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
            <a
              className="btn btn-quiet gate-open"
              href={`https://www.youtube.com/watch?v=${videoId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              યુટ્યુબ પર ખોલો
            </a>
          </div>
        ) : (
          <div className="notice warn">
            વિડિયોની કડી હજી મુકાઈ નથી. સંચાલક કડી મૂકે એટલે અહીં વિડિયો દેખાશે.
          </div>
        )}

        <div className="gate-qs">
          <p className="gate-qs-head">
            {replay ? 'તમારા જવાબ' : 'બંને પ્રશ્નોના જવાબ આપો (યુટ્યુબ માટે છે)'}
          </p>

          <label className="gate-q">
            <input
              type="checkbox"
              checked={liked}
              onChange={(e) => onLiked(e.target.checked)}
            />
            <span>આ વિડિયોને તમે લાઈક કર્યો છે?</span>
          </label>

          <label className="gate-q">
            <input
              type="checkbox"
              checked={commented}
              onChange={(e) => onCommented(e.target.checked)}
            />
            <span>આ વિડિયો પર તમે સારી કોમેન્ટ લખી છે?</span>
          </label>

          {/*
            One line, one job. It used to be three different notes stacked under the
            boxes at three different sizes; there is only ever one thing worth saying.
          */}
          <p className="gate-note" role="status" aria-live="polite">
            {error
              ? <span className="is-bad">{error}</span>
              : replay
                ? savedAt
                  ? <span className="is-good">જવાબ સચવાઈ ગયો</span>
                  : 'જવાબ બદલવો હોય તો ટિક કરો કે ટિક કાઢી નાખો, એ તરત સચવાઈ જશે.'
                : ready
                  ? 'આભાર. હવે તમે લેવલ ૨ પર જઈ શકશો.'
                  : 'બંને જવાબ "હા" થાય એટલે લેવલ ૨ પર જવાશે.'}
          </p>
        </div>

        {/*
          One button, in the same place in both modes, and it always means the same thing:
          on to લેવલ ૨.

          The replay button used to read "Back to home", which made this page a cul-de-sac
          off the home menu — the yuvak came here for the વિડિયો and the only way on was
          the way he came in. It is the same step of the same sequence whether he is seeing
          it for the first time or the fiftieth, so it points the same way.

          Not gated on the two boxes in replay: the gate is passed and `gate_passed_at` is
          never re-stamped, so unticking a box records a corrected answer without taking
          લેવલ ૨ away again. On the first pass `ready` still holds the button, because
          there both answers are the thing being asked for.
        */}
        {replay ? (
          /*
            One button, and only one. There is deliberately no "Back to home" beside it:
            the end of લેવલ ૧ is the start of લેવલ ૨, and offering the way out at the exact
            moment the sequence continues is what made this page a cul-de-sac before.
            A yuvak who came only to re-watch the વિડિયો leaves by the browser's back
            gesture, or forward through લેવલ ૨ to લેવલ ૩, whose LevelBar carries મુખપૃષ્ઠ.
            (/darshan itself carries no મુખપૃષ્ઠ — see DarshanPage.jsx, where the same
            rule keeps the foot of the દર્શન to exactly two ways on.)
          */
          <button className="btn" type="button" onClick={() => nav('/darshan')}>
            આગળ - લેવલ ૨: દર્શન
          </button>
        ) : (
          <>
            <button className="btn" type="button" onClick={submit} disabled={!ready || busy}>
              {busy ? 'સચવાય છે…' : 'આગળ - લેવલ ૨: દર્શન'}
            </button>

            <p className="auth-alt">
              <button className="linklike" type="button" onClick={logout}>
                બીજા ખાતાથી લોગિન કરો
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
