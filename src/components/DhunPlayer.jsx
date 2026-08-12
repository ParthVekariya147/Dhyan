import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useSettings } from '../lib/useSettings';
import { clampVolume, pickDhun, readDhunList, readDhunPref, writeDhunPref } from '../lib/dhun';
import './dhun.css';

/**
 * §8 — the ધૂન that plays while the yuvak sits with the ૧૦૮ દ્રશ્યો.
 *
 * "ધૂન ધીમેથી શરૂ થાય, ખૂણામાં એક બટન એને બંધ/ચાલુ કરે, અને સળંગ વાગ્યા કરે જેથી ધ્યાન તૂટે નહીં."
 * Three requirements, and the third is why this component is mounted in App.jsx *outside*
 * <Routes> rather than on the દર્શન page: a component that unmounts takes its <audio> with
 * it, so the dhun would stop the moment the yuvak moved from દર્શન to the home page — the
 * exact break §8 is written to prevent. One element, one lifetime, the whole session.
 *
 * Scrolling never touches it either. The old page's only fixed-position behaviour was a
 * scroll listener; this has none, so 108 images going past changes nothing about playback.
 *
 * The corner panel also carries what §8 asks for on the દર્શન page — both dhun names,
 * play/stop and a volume slider. Putting it in the floating panel rather than in the દર્શન
 * header means it is reachable from every screen and never scrolls away, and it keeps the
 * દર્શન feed the uninterrupted reading surface it is meant to be.
 */
/**
 * The three corner icons, drawn rather than typed.
 *
 * They were '♪', '❚❚' and '⋯' — literal characters, and that is the problem: a character is
 * drawn by whichever installed font claims it, and the app's own font stack falls through to
 * Shruti on Windows (see the note over --font-gu in index.css). The play/pause pair came out
 * as two different weights on two different machines, and '⋯' (midline horizontal ellipsis)
 * is missing often enough to land in a fallback face at a different size from the button
 * beside it. Icons a control's meaning depends on should not be a font lookup.
 *
 * Sized in attributes and coloured by `currentColor`, the same way src/components/NavArrow.jsx
 * is, so each one inherits the state its button is in and needs nothing from the stylesheet
 * to be the right size.
 */
const NoteIcon = () => (
  <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M9 18V5l11-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="17" cy="16" r="3" />
  </svg>
);

const PauseIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false">
    <rect x="6.5" y="5" width="4" height="14" rx="1.6" />
    <rect x="13.5" y="5" width="4" height="14" rx="1.6" />
  </svg>
);

const MoreIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false">
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
);

export default function DhunPlayer() {
  const { user, unconfigured } = useAuth();

  // Nothing before sign-in. A yuvak on the login screen has not "entered the app" (§8), and
  // settings/app is readable only by the signed-in (0001_init.sql:245) — asking for it here
  // would be a guaranteed-empty round trip on the slowest, most impatient screen there is.
  if (unconfigured || !user) return null;

  return <DhunDeck />;
}

function DhunDeck() {
  const { settings } = useSettings();
  const { pathname } = useLocation();
  const audio = useRef(null);

  const [pref, setPref] = useState(readDhunPref);
  // `playing` is never set by an intention — only by the element's own play/pause events.
  // That is the difference between a toggle that says what is happening and one that says
  // what was asked for, and with autoplay policies those two disagree constantly.
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [open, setOpen] = useState(false);

  const list = readDhunList(settings);
  const track = pickDhun(list, pref.id);

  /**
   * The પ્રવેશદ્વાર plays the Varni Dhyan video (§5). A dhun underneath it is two things
   * talking at once, so it is paused there and resumes on the way out — paused, not turned
   * off, so the yuvak's choice is not quietly rewritten by a page he passed through.
   *
   * Honest limitation: this only knows about routes. A video *stage* inside /learn is
   * owned by that module and is not visible from out here; the corner button remains the
   * yuvak's answer for that.
   */
  const silentRoute = pathname === '/welcome';

  // Remembered on the phone and nowhere else (§6, §13). See src/lib/dhun.js.
  useEffect(() => writeDhunPref(pref), [pref]);

  useEffect(() => {
    if (audio.current) audio.current.volume = pref.volume;
  }, [pref.volume, track?.id]);

  /**
   * Intent → element. The rejected promise is the whole point of the `.catch`: every mobile
   * browser refuses audio that no gesture asked for, and an unhandled rejection here is how
   * an app ends up drawing a "playing" button over silence. On refusal `playing` simply
   * never becomes true — the element never fired `play` — so the button keeps showing the
   * truth, and `blocked` arms the one-touch resume below.
   */
  useEffect(() => {
    const el = audio.current;
    if (!el || !track) return;

    if (!pref.on || silentRoute) {
      el.pause();
      return;
    }

    el.volume = pref.volume;
    const started = el.play();
    if (started?.catch) started.catch(() => setBlocked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pref.on, track?.id, silentRoute]);

  /**
   * He asked for the dhun on a previous visit; the browser is holding it back until he
   * touches something. So the first touch anywhere starts it — no banner, no "click to
   * enable audio" dialog in the middle of a screen meant for ધ્યાન (§1: no friction, and
   * nothing that reads as a failure). If he does not want it, the corner button is right
   * there and turning it off is remembered.
   */
  useEffect(() => {
    if (!blocked || !pref.on || playing || !track || silentRoute) return;
    const el = audio.current;
    // `?.` on the result too: play() is specified to return a promise, but it did not
    // always, and a TypeError thrown from a global pointerdown listener would break far
    // more than the music.
    const resume = () => el?.play()?.then(() => setBlocked(false))?.catch(() => {});
    addEventListener('pointerdown', resume, { once: true, passive: true });
    addEventListener('keydown', resume, { once: true });
    return () => {
      removeEventListener('pointerdown', resume);
      removeEventListener('keydown', resume);
    };
  }, [blocked, pref.on, playing, track?.id, silentRoute]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open]);

  // No dhun uploaded yet — and PLAN.md §12 says that is today's state. Nothing is drawn:
  // a dead button that explains a missing file is the સંચાલક's problem showing up on the
  // yuvak's screen.
  if (!track) return null;

  /**
   * The button acts on the element directly, and updates the remembered intent alongside.
   *
   * Flipping `pref.on` alone is not enough, and the reason is the blocked case: after a
   * refused autoplay the stored intent is already `on: true` while nothing is playing, so a
   * state flip would either be a no-op (same value, effect never re-runs) or would turn the
   * dhun *off* in answer to a tap on a button that says "start". Calling play() here also
   * puts the request inside the yuvak's own gesture, which is precisely what every autoplay
   * policy is waiting for — so this path is the one that reliably works.
   */
  const toggle = () => {
    const el = audio.current;
    if (playing) {
      el?.pause();
      setPref((p) => ({ ...p, on: false }));
      return;
    }
    setBlocked(false);
    setPref((p) => ({ ...p, on: true }));
    if (el) {
      el.volume = pref.volume;
      el.play()?.catch(() => setBlocked(true));
    }
  };

  const choose = (d) => {
    setBlocked(false);
    setPref((p) => ({ ...p, id: d.id, on: true }));
  };

  return (
    <div className="dhun">
      {/*
        preload="none", deliberately. This element exists on every screen for every one of
        ~2,000 yuvaks on mobile data, and `metadata` or `auto` would fetch part or all of an
        MP3 on every page view — including for the yuvak who has the dhun turned off and for
        the one whose browser is about to refuse to play it anyway (§14, PLAN.md §2.2). The
        bytes are requested when play() is actually called and not one moment earlier. Once
        fetched they stay: the object name is immutable and served with a one-year
        cache-control (0007_dhun_storage.sql), so a daily yuvak downloads the dhun once.

        `loop` is §8's "સળંગ વાગ્યા કરે" — the meditation must not be broken by silence at the
        end of the track.
      */}
      <audio
        ref={audio}
        src={track.url}
        loop
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        // A file that will not load is not something the yuvak can act on, so it is not
        // announced. The button falls back to its "start" face and the app carries on.
        onError={() => setPlaying(false)}
      />

      {open && (
        <div className="dhun-panel" role="group" aria-label="ધૂન">
          <p className="dhun-title">ધૂન</p>

          {list.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`dhun-choice ${d.id === track.id ? 'is-on' : ''}`}
              aria-pressed={d.id === track.id}
              onClick={() => choose(d)}
            >
              {d.name}
            </button>
          ))}

          <label className="dhun-vol">
            <span>અવાજ</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={pref.volume}
              aria-label="અવાજ"
              onChange={(e) => setPref((p) => ({ ...p, volume: clampVolume(e.target.value) }))}
            />
          </label>

          <button type="button" className="dhun-choice dhun-wide" onClick={toggle}>
            {playing ? 'બંધ કરો' : 'શરૂ કરો'}
          </button>
        </div>
      )}

      <div className="dhun-corner">
        <button
          type="button"
          className={`dhun-btn ${playing ? 'is-playing' : ''}`}
          onClick={toggle}
          title={playing ? 'ધૂન બંધ કરો' : 'ધૂન શરૂ કરો'}
          aria-label={playing ? 'ધૂન બંધ કરો' : 'ધૂન શરૂ કરો'}
          aria-pressed={playing}
        >
          {playing ? <PauseIcon /> : <NoteIcon />}
        </button>

        <button
          type="button"
          className={`dhun-more ${open ? 'is-open' : ''}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title="ધૂન પસંદ કરો"
          aria-label="ધૂન પસંદ કરો"
        >
          <MoreIcon />
        </button>
      </div>
    </div>
  );
}
