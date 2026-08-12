import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import '../styles/forms.css';
import './entry-gate.css';

/**
 * §5 — the entry gate. The two questions are asked after the first login; the app
 * cannot be entered until both answers are Yes.
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
 * This page's wording is English while the rest of the app is still Gujarati, so it
 * carries its own `lang` — index.html declares `lang="gu"` for the document, and a
 * screen reader left on that setting reads English words with Gujarati pronunciation
 * rules. The attribute is the only thing that switches the voice back.
 */

/**
 * This page's own wording for a failed write.
 *
 * `guError` from lib/auth is shared with the લોગિન and નોંધણી pages and answers in
 * Gujarati; calling it here would drop one Gujarati line into an otherwise English
 * page, at the one moment the yuvak most needs to read it. Only two things can fail
 * here — the network, or the profiles update itself — so this is a short mapping and
 * not a second copy of the shared table.
 */
function gateError(e) {
  const msg = String(e?.message || '');
  if (msg.includes('Failed to fetch')) return 'Network problem. Please try again.';
  if (e?.status === 429) return 'Too many attempts. Please wait a moment, then try again.';
  return 'Your answer could not be saved. Please try again.';
}

export default function EntryGate({ videoId, replay = false }) {
  const { profile, saveGateAnswers, logout } = useAuth();
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

  /** First pass through the gate: both answers, then home. */
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await saveGateAnswers({ liked, commented });
      nav('/', { replace: true });
    } catch (e) {
      // §1 — never a dead end. The ticks stay where they are and the button comes back,
      // so the same tap retries rather than sending him to the login screen.
      setError(gateError(e));
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
      setSavedAt(Date.now());
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSavedAt(0), 2600);
    } catch (e) {
      // The tick stays visible and the message says what happened; toggling again is
      // the retry. Reverting it under his finger would look like the app refusing him.
      setError(gateError(e));
    } finally {
      setBusy(false);
    }
  }

  const onLiked = (v) =>
    replay ? change({ liked: v, commented }) : setLiked(v);
  const onCommented = (v) =>
    replay ? change({ liked, commented: v }) : setCommented(v);

  return (
    <div className="auth-wrap gate-wrap" lang="en">
      <div className="auth-card">
        <h1 className="auth-title">{replay ? 'Video Darshan' : 'Welcome'}</h1>
        <p className="auth-sub">
          {/* A salutation, not a sentence — it is transliterated rather than translated. */}
          Jay Swaminarayan{profile?.name ? `, ${profile.name}` : ''} —<br />
          {replay
            ? 'You can watch this video again whenever you like'
            : 'Please watch this video before you begin your dhyan'}
        </p>

        {videoId ? (
          <div className="gate-video">
            <div className="video-frame">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`}
                title="Varni Dhyan"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
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
              Open on YouTube
            </a>
          </div>
        ) : (
          <div className="notice warn">
            The video link has not been set yet. This page will work once the admin adds it.
          </div>
        )}

        <div className="gate-qs">
          <p className="gate-qs-head">
            {replay ? 'Your answers' : 'Please answer both questions'}
          </p>

          <label className="gate-q">
            <input
              type="checkbox"
              checked={liked}
              onChange={(e) => onLiked(e.target.checked)}
            />
            <span>Have you liked this video?</span>
          </label>

          <label className="gate-q">
            <input
              type="checkbox"
              checked={commented}
              onChange={(e) => onCommented(e.target.checked)}
            />
            <span>Have you written a good comment on this video?</span>
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
                  ? <span className="is-good">Answer saved</span>
                  : 'To change an answer, just tick or untick — it saves straight away.'
                : ready
                  ? 'Thank you. You can continue now.'
                  : 'You can continue once both answers are Yes.'}
          </p>
        </div>

        {replay ? (
          <button className="btn" type="button" onClick={() => nav('/', { replace: true })}>
            Back to home
          </button>
        ) : (
          <>
            <button className="btn" type="button" onClick={submit} disabled={!ready || busy}>
              {busy ? 'Saving…' : 'Continue'}
            </button>

            <p className="auth-alt">
              <button className="linklike" type="button" onClick={logout}>
                Sign in with a different account
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
