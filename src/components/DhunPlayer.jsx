import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useSettings } from '../lib/useSettings';
import { clampVolume, pickDhun, readDhunList, readDhunPref, writeDhunPref } from '../lib/dhun';
import { DHUN_AUTOPLAY_KEY, resolveDhunAutoplay } from '../../shared/domain/settings.js';
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
 *
 * ── Who starts it ───────────────────────────────────────────────────────────
 *
 * "ધીમેથી શરૂ થાય" is the સંચાલક's to switch off (settings['app'].dhunAutoplay). Two
 * questions are being answered here and they must not be collapsed into one:
 *
 *   may playback begin unasked?   the સંચાલક's, read from settings on every visit → `allowed`
 *   does this yuvak want it?      his own, remembered on his phone → `pref.on`
 *
 * With autoplay off the deck is unchanged in every visible respect — the button, the two
 * names, the slider are all still there — and the only difference is that the first play()
 * has to come from his finger. Because the element is `preload="none"`, that is also the
 * first moment the MP3 is fetched at all, which is what makes this a setting about mobile
 * data (§14) and not merely about silence. The button says "લોડ કરો" while that is true.
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
  /* The whole corner — panel and both buttons. What counts as "outside" is measured against
     this, so a tap anywhere in the deck (choosing a ધૂન, dragging the volume) is inside. */
  const deck = useRef(null);

  const [pref, setPref] = useState(readDhunPref);
  // `playing` is never set by an intention — only by the element's own play/pause events.
  // That is the difference between a toggle that says what is happening and one that says
  // what was asked for, and with autoplay policies those two disagree constantly.
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [open, setOpen] = useState(false);

  /**
   * Has this yuvak asked for the dhun *on this visit*?
   *
   * Session state, never written to localStorage, and that is the point rather than an
   * oversight. `pref.on` is the remembered answer to "do I want music" and survives reloads;
   * this is the answer to "has a tap happened since the page opened", which must not. With
   * the સંચાલક's autoplay off, a persisted arm would mean the first tap in January turns the
   * setting off for that phone forever — the switch would decay into a one-time prompt.
   *
   * It only ever goes true, and only from a control the yuvak pressed. Nothing sets it back:
   * pausing is `pref.on: false`, and re-arming a track already in the browser's cache would
   * be asking him to fetch what he has.
   */
  const [armed, setArmed] = useState(false);

  const list = readDhunList(settings);
  const track = pickDhun(list, pref.id);

  /**
   * The સંચાલક's switch, and the gate every path to play() below passes through.
   *
   * `allowed` false means one thing precisely: playback may not *begin on its own*. The deck
   * is still drawn, both names are still listed, the volume still moves — §8 gave the yuvak
   * the corner button and a settings row does not take it back. What it takes back is the
   * unasked-for start, and with `preload="none"` on the element that is also the whole of the
   * download (see the note over DHUN_AUTOPLAY_KEY): no play(), no bytes.
   *
   * No `loading` guard is needed in front of this, and the reason is worth stating because it
   * looks like an omission. Before the settings row arrives `settings` is null, so
   * resolveDhunAutoplay() returns its default of on — but `list` is empty from the same null,
   * so `track` is null, and every effect below returns on `!track`. The two facts arrive in
   * the same object and cannot disagree; there is no window in which this reads `on` against
   * a track it could act on.
   */
  const autoplay = resolveDhunAutoplay(settings?.[DHUN_AUTOPLAY_KEY]).on;
  const allowed = autoplay || armed;

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

    // `!allowed` sits with the two conditions it belongs beside rather than in a guard of its
    // own: all three are "not now", and the element is paused for each of them. It is the only
    // one of the three that is somebody else's decision, which changes nothing here — the deck
    // has never needed to know *why* it is quiet.
    if (!pref.on || silentRoute || !allowed) {
      el.pause();
      return;
    }

    el.volume = pref.volume;
    const started = el.play();
    if (started?.catch) started.catch(() => setBlocked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pref.on, track?.id, silentRoute, allowed]);

  /**
   * He asked for the dhun on a previous visit; the browser is holding it back until he
   * touches something. So the first touch anywhere starts it — no banner, no "click to
   * enable audio" dialog in the middle of a screen meant for ધ્યાન (§1: no friction, and
   * nothing that reads as a failure). If he does not want it, the corner button is right
   * there and turning it off is remembered.
   */
  useEffect(() => {
    // `allowed` here too, and it is not belt-and-braces. `blocked` outlives the state that set
    // it: a yuvak who armed the deck, was refused by the browser, then reloaded onto a visit
    // where the સંચાલક's autoplay is off would otherwise have his first touch anywhere on the
    // screen start the music — the resume listener is global, and the one thing this setting
    // must never allow is a start he did not ask for.
    if (!blocked || !pref.on || playing || !track || silentRoute || !allowed) return;
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
  }, [blocked, pref.on, playing, track?.id, silentRoute, allowed]);

  /**
   * How the panel closes: Escape, or a touch anywhere that is not the panel.
   *
   * Escape was the only way, and on a phone there is no Escape — so once the list was open
   * it stayed open, floating over every screen the yuvak moved to, until he happened to find
   * the ⋯ again. A panel that can only be dismissed by the control that opened it is a panel
   * most people will simply leave on.
   *
   * `pointerdown` and not `click`, because the panel should be gone by the time the yuvak's
   * finger lifts on whatever he was actually reaching for — waiting for `click` leaves it on
   * screen through the whole press, and on a tap that starts a scroll no click ever arrives.
   *
   * Capture phase, so a handler somewhere below that stops propagation cannot leave the
   * panel stranded open. Nothing here consumes the event: this only reads where it landed,
   * so the tap still does whatever it was going to do.
   *
   * Anything inside `deck` is use, not dismissal — that is the whole of the yuvak's ask:
   * picking a ધૂન, dragging the volume, and the ⋯ itself, which closes through its own
   * toggle rather than through this. The listener is only attached while the panel is open,
   * so a closed deck costs nothing on the દર્શન feed's scroll.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    const onDown = (e) => {
      if (!deck.current?.contains(e.target)) setOpen(false);
    };
    addEventListener('keydown', onKey);
    addEventListener('pointerdown', onDown, true);
    return () => {
      removeEventListener('keydown', onKey);
      removeEventListener('pointerdown', onDown, true);
    };
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
    // The arm and the play() are the same press, which is what makes this button the "load"
    // control when autoplay is off. Nothing extra had to be built for that: with
    // `preload="none"` the fetch *is* the play() call, so a button that starts the dhun and a
    // button that downloads it are one button, and the yuvak's gesture is wrapped around both
    // — exactly what every mobile autoplay policy is waiting for.
    setArmed(true);
    setPref((p) => ({ ...p, on: true }));
    if (el) {
      el.volume = pref.volume;
      el.play()?.catch(() => setBlocked(true));
    }
  };

  const choose = (d) => {
    setBlocked(false);
    // Picking a ધૂન by name is asking for it. Arming here as well as in toggle() is what keeps
    // the panel usable with autoplay off — otherwise the two names would be a choice that
    // silently did nothing until he found the button underneath them.
    setArmed(true);
    setPref((p) => ({ ...p, id: d.id, on: true }));
  };

  /**
   * What the corner button is offering, in words.
   *
   * Three states, not two, and the third is the whole feature: with the સંચાલક's autoplay off
   * and no tap yet, nothing has been fetched, so "શરૂ કરો" would be promising an instant start
   * for a press that has to cross the network first. Saying "લોડ કરો" is the honest name for
   * what the press does, and it stops being the label the moment the file is in hand — after
   * one tap `allowed` is true for the rest of the visit and this reverts to the ordinary pair.
   */
  const label = playing ? 'ધૂન બંધ કરો' : allowed ? 'ધૂન શરૂ કરો' : 'ધૂન લોડ કરો';

  return (
    <div className="dhun" ref={deck}>
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
            {playing ? 'બંધ કરો' : allowed ? 'શરૂ કરો' : 'લોડ કરો'}
          </button>
        </div>
      )}

      <div className="dhun-corner">
        <button
          type="button"
          className={`dhun-btn ${playing ? 'is-playing' : ''}`}
          onClick={toggle}
          title={label}
          aria-label={label}
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
