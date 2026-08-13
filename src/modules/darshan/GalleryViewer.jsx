import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import GalleryImage from './GalleryImage';
import { useSwipe } from './useSwipe';
import { gu } from '../../lib/scenes';
import './gallery.css';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * COMPONENT CONTRACT — the fullscreen દર્શન viewer
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Purpose     A યુવક taps one દ્રશ્ય in લેવલ ૨ and then looks through the whole ક્રમ without
 *             leaving the picture: the artwork at the widest encode there is, its number,
 *             its વર્ણન, and an આપોઆપ he starts himself.
 *
 * Props       items          the sequenced collection from useScenes(), in canonical order.
 *                            Navigation walks THIS array and nothing is re-sorted here
 *                            (ORDERING.md §8 rule 4).
 *             startIndex     0-based position in `items`. A seed, read once at mount.
 *             onClose        () => void
 *             total          denominator of "૧૨ / ૧૦૯". Defaults to items.length, which is
 *                            right for /darshan because useScenes() hands the whole
 *                            collection. A screen showing a SUBSET must pass the global
 *                            total or it would print "૩૧ / ૮".
 *             autoIntervalMs the આપોઆપ dwell. The સંચાલક's, out of settings['app'] via
 *                            useSlideshow() — read by DarshanFeed and passed down, never read
 *                            here: this component is mounted and unmounted on every open and
 *                            close, so a settings read inside it would be a request per tap.
 *
 * Always on   The foot's number and its ⓘ વર્ણન control are on screen from first paint to
 *             last. Nothing fades them, nothing conditions them, and the વર્ણન panel opens
 *             ABOVE them rather than in place of them. લેવલ ૨ teaches the number alongside
 *             the picture, so the number is furniture — the long note further down says why
 *             the idle fade that used to be here was deleted rather than tuned.
 *
 * Persisted   Nothing, on purpose. This is a viewing surface: it does not tick, does not
 *             score, does not complete લેવલ ૨ and does not unlock લેવલ ૩. લેવલ ૨ records
 *             nothing (DarshanPage.jsx's contract) and this must not become the exception.
 *
 * State       All of it local (§35). Nothing about an open gallery belongs in app state.
 *
 * Lifetime    **Mounted only while open.** DarshanFeed renders it behind `openAt >= 0`, so
 *             unmount *is* the cleanup: every timer, listener, gesture and preload lives in
 *             this subtree and dies with it. Opening and closing a hundred times leaks
 *             nothing, and while closed there is no transparent layer left over the feed to
 *             swallow a tap on the next card.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The number is `item.displayIndex` — the one derivation (ORDERING.md §4), the same number
 * the card behind it prints, the same one લેવલ ૩'s rows and લેવલ ૪'s કસોટી use. Never `n`,
 * never `index`, and never the array position: a સંચાલક who withholds one દ્રશ્ય must not
 * make this counter disagree with every other screen.
 *
 * The picture is `fullUrl` — the ૨૫૬૦-wide encode, the widest variant shared/domain/drive.js
 * produces. `object-fit: contain` against a full-viewport stage, so the whole artwork is
 * visible at its own aspect ratio: nothing cropped, nothing stretched, nothing upscaled by
 * CSS to look like resolution it does not have (§15, §23).
 */

/**
 * The fallback dwell, used only when no interval is passed in.
 *
 * The real number is the સંચાલક's — settings['app'].value.slideshow.seconds, resolved by
 * shared/domain/settings.js and handed down by DarshanFeed. This constant exists so the
 * component is complete on its own for any other caller, and it is deliberately the same six
 * seconds as DEFAULT_SLIDESHOW: two literals meant to be one number are two literals that
 * will eventually differ.
 */
const AUTO_MS = 6000;

export default function GalleryViewer({
  items,
  startIndex,
  onClose,
  total,
  autoIntervalMs = AUTO_MS,
  label = 'દર્શન - મોટું દ્રશ્ય',
}) {
  const [index, setIndex] = useState(startIndex);
  const [descOpen, setDescOpen] = useState(false);
  /*
    `false`, and nothing but the button and Space ever sets it true. લેવલ ૨ is where a યુવક
    learns the picture and the ક્રમ; a slideshow that started itself the moment he tapped
    would take the દ્રશ્ય away from him before he had looked at it (§8).
  */
  const [isAuto, setIsAuto] = useState(false);
  const [ready, setReady] = useState(false);
  /* True when the દ્રશ્ય on screen is the one the CDN would not serve. */
  const [loadError, setLoadError] = useState(false);
  /* Bumped by ફરી પ્રયત્ન કરો. Part of GalleryImage's key, so a retry is a fresh mount. */
  const [nonce, setNonce] = useState(0);

  const rootRef = useRef(null);

  const item = items[index];
  const count = total ?? items.length;
  const atStart = index <= 0;
  const atEnd = index >= items.length - 1;
  /*
    isLearnable already requires a વર્ણન, so in practice this is always true. If it ever
    stops holding, the ⓘ control is **disabled and still there** rather than removed: the
    foot must have the same shape on every દ્રશ્ય, because a row that gains and loses a
    control as a યુવક walks the ક્રમ moves the two things beside it under his thumb. No
    "વર્ણન ઉપલબ્ધ નથી" message either — the app has never had one.
  */
  const hasDesc = !!item?.t;

  // ── navigation ────────────────────────────────────────────────────────────
  /*
    The position is mirrored in a ref, and `step` walks the ref rather than the state.

    Two things need that. React batches, so a યુવક drumming on › — or a held-down arrow key
    repeating — would otherwise fire several handlers that all read the same rendered
    `index` and all compute the same `index + 1`: ten presses, one દ્રશ્ય. The ref advances
    synchronously, so ten presses are ten દ્રશ્યો.

    And clamping *before* the state is touched is what keeps `ready` honest at the two ends.
    A press of ‹ on દ્રશ્ય ૧ must be a no-op in every respect: setting `ready` false there
    would disarm the slideshow's dwell for a picture that never changed and never fires a
    fresh load event, and આપોઆપ would simply stop.
  */
  const indexRef = useRef(startIndex);

  const step = useCallback(
    (delta) => {
      const next = Math.min(Math.max(indexRef.current + delta, 0), items.length - 1);
      if (next === indexRef.current) return;
      indexRef.current = next;
      setIndex(next);
      // The dwell counts from the moment the NEXT picture is on screen, not from this one.
      setReady(false);
      setLoadError(false);
    },
    [items.length]
  );

  // No wraparound in either direction (§4, §5) — reaching the end of the ક્રમ is the end of it.
  const goNext = useCallback(() => step(1), [step]);
  const goPrev = useCallback(() => step(-1), [step]);

  const handleReady = useCallback((loaded) => {
    setReady(true);
    setLoadError(!loaded);
  }, []);
  const handleRetry = useCallback(() => {
    setLoadError(false);
    setNonce((n) => n + 1);
  }, []);

  // ── browser / hardware back closes the gallery, it does not leave લેવલ ૨ ──
  /*
    Through react-router's own navigate(), never a raw history.pushState().
    react-router 7 keeps its position in `history.state.idx` and computes the next index as
    `getIndex() + 1`; an entry pushed behind its back carries no `idx`, so the next real
    navigation from that entry computes NaN and the history stack is corrupt from then on.

    `preventScrollReset` is what returns the યુવક to the દર્શન exactly where he left it
    rather than to the top of ૧૦૯ cards (§24).

    `armed` exists because the pushed state does not arrive until the router re-renders:
    without it, the watcher below would see "no gvOpen" on the very first render and close
    the gallery a frame after opening it.
  */
  const navigate = useNavigate();
  const location = useLocation();
  const armed = useRef(false);
  const closing = useRef(false);

  useEffect(() => {
    navigate('.', { state: { ...location.state, gvOpen: true }, preventScrollReset: true });
    // Mount only. Re-running this on every location change would push an entry per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (location.state?.gvOpen) {
      armed.current = true;
      return;
    }
    if (armed.current && !closing.current) {
      closing.current = true;
      onClose();
    }
  }, [location, onClose]);

  const requestClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    // Consume our own entry so Back does not land on a gallery that is no longer there.
    if (armed.current) navigate(-1);
    onClose();
  }, [navigate, onClose]);

  // ── keyboard, alive only while the gallery is (§7) ────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          goNext();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          goPrev();
          break;
        case 'Escape':
          e.preventDefault();
          requestClose();
          break;
        case ' ':
        case 'Spacebar':
          /*
            A focused <button> already answers Space with a click of its own. Claiming it
            here would fire twice, or fire આપોઆપ when the યુવક meant to press ‹.
          */
          if (t && typeof t.closest === 'function' && t.closest('button')) return;
          e.preventDefault();
          setIsAuto((a) => !a);
          break;
        default:
          break;
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [goNext, goPrev, requestClose]);

  // ── the page underneath must not scroll while this is over it ─────────────
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // ── focus: into the dialog on open, back to the card on close ─────────────
  useEffect(() => {
    const opener = document.activeElement;
    const openerId = items[startIndex]?.id;
    /*
      The dialog itself takes focus, not the ✕ inside it.

      Focus a button and the browser gives Space to that button — so opening on ✕ would make
      Space close the દર્શન, and opening on ‹ would make it step backwards, when Space is
      specified as play/pause (§7). Parked on the dialog, Space means આપોઆપ from the first
      moment; once a યુવક has tabbed to a control, Space activates that control, which is
      what a screen-reader user expects and is not ours to override.
    */
    rootRef.current?.focus();

    return () => {
      const back =
        (opener && opener.isConnected && opener !== document.body && opener) ||
        (openerId && document.querySelector(`[data-scene-id="${CSS.escape(openerId)}"]`));
      back?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── આપોઆપ ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuto) return undefined;
    /*
      It stops at the last દ્રશ્ય and does not loop back to ૧. The point of લેવલ ૨ is a
      sequence with an end; restarting it silently would erase the one moment that tells a
      યુવક he has seen all of it (§10).
    */
    if (atEnd) {
      setIsAuto(false);
      return undefined;
    }
    // Armed from `ready`, so on a slow connection the dwell is six seconds of LOOKING
    // rather than six seconds of skeleton.
    if (!ready) return undefined;

    const id = setTimeout(goNext, autoIntervalMs);
    return () => clearTimeout(id);
  }, [isAuto, atEnd, ready, goNext, autoIntervalMs]);

  /*
    ── there is no idle fade, and that is a decision rather than an omission ──

    An earlier draft of this viewer faded the arrows, the counter and the whole foot after
    four seconds of stillness, and brought them back on a touch. It is the conventional
    gallery behaviour and it was wrong here, for a reason particular to લેવલ ૨.

    લેવલ ૨ asks a યુવક to hold three things together — the picture, its વર્ણન and its number.
    The number is not decoration on top of the artwork, it is half of what he is here to
    learn, and a UI that takes it away whenever he stops moving is taking away the lesson at
    exactly the moment he has settled down to study it. Worse, it does so silently: nothing
    tells him the number is still there behind a timer, so a યુવક who looks up from a
    દ્રશ્ય after a few seconds sees a screen that has quietly forgotten what he was on.

    So the controls are simply always on. They are translucent and out of the way, the
    picture still owns the whole viewport behind them, and what he sees when he glances down
    is the same thing every time. Predictable beats clever on a screen somebody is
    memorising.

    The practical dividend is a component with no timer, no wake path, no `:focus-visible`
    escape hatch and no "is it hidden right now?" branch in the Tab handler — four things
    that could disagree with each other, deleted.
  */

  // ── preload: N+1, then N−1, and never the collection (§16) ────────────────
  const requested = useRef(new Set());
  const held = useRef([]);

  useEffect(() => {
    if (!ready) return undefined;
    // Data Saver is an explicit statement about bytes and is honoured as one.
    if (navigator.connection?.saveData) return undefined;

    const near = [items[index + 1], items[index - 1]].filter(Boolean);

    /*
      Staggered, and low priority. A w2560 encode is a few hundred KB, and useImageRetry's
      whole docblock is about lh3 answering 429 to a burst — the fastest way to break the
      દ્રશ્ય he IS looking at is to ask for two more beside it. N−1 is nearly always a cache
      hit because he just came from it; it costs one genuinely cold request per visit, on
      the first open.
    */
    const timers = near.map((scene, k) =>
      setTimeout(
        () => {
          const url = scene.fullUrl || scene.url;
          if (!url || requested.current.has(url)) return;
          requested.current.add(url);

          const img = new Image();
          img.decoding = 'async';
          img.fetchPriority = 'low';
          // Same cache key as GalleryImage's render, or the preload buys nothing — and out
          // of lh3's per-referrer quota bucket like every other lh3 request (drive.js).
          img.referrerPolicy = 'no-referrer';
          img.src = url;
          /*
            Held so the request is not abandoned to the collector mid-flight — and held in a
            short ring, because keeping ૧૦૯ decoded ૨૫૬૦-wide bitmaps alive is its own kind
            of leak.
          */
          held.current.push(img);
          if (held.current.length > 4) held.current.shift();
        },
        k === 0 ? 0 : 600
      )
    );

    return () => timers.forEach(clearTimeout);
  }, [ready, index, items]);

  // ── swipe ─────────────────────────────────────────────────────────────────
  const swipe = useSwipe({
    onNext: goNext,
    onPrev: goPrev,
    /*
      No `onTap`. With nothing hidden there is nothing for a tap to reveal, and a tap that
      quietly did something else — advance, close, toggle આપોઆપ — is the kind of surprise a
      યુવક cannot undo. The hook still recognises the tap and still declines to treat it as a
      swipe, which is the part that matters: §13's "do not navigate on tiny movements".
    */
    atStart,
    atEnd,
  });

  // ── keep Tab inside the dialog ────────────────────────────────────────────
  const onRootKeyDown = (e) => {
    if (e.key !== 'Tab') return;
    const list = [...rootRef.current.querySelectorAll('button:not([disabled])')].filter(
      (el) => el.getClientRects().length > 0
    );
    if (list.length < 2) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!item) return null;

  const number = gu(item.displayIndex ?? index + 1);

  return (
    <div
      className="gv"
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onRootKeyDown}
    >
      {/*
        The stage is the whole viewport and every control is positioned OVER it, so the
        picture never loses height to a toolbar — which is what makes landscape work without
        a second layout (§21).
      */}
      <div className="gv-stage" ref={swipe.ref} {...swipe.handlers}>
        <GalleryImage
          key={`${item.id}:${nonce}`}
          item={item}
          onReady={handleReady}
          onRetry={handleRetry}
        />
      </div>

      <div className="gv-chrome">
        <div className="gv-top">
          <button
            type="button"
            className="gv-icon gv-close"
            aria-label="દર્શન બંધ કરો"
            onClick={requestClose}
          >
            <span aria-hidden="true">✕</span>
          </button>
          {/* The authoritative number over the count of what is actually shown (§31). */}
          <span className="gv-count" aria-live="polite">
            {number} / {gu(count)}
          </span>
        </div>

        <button
          type="button"
          className="gv-icon gv-nav gv-prev"
          aria-label="પાછલું દ્રશ્ય"
          disabled={atStart}
          onClick={goPrev}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <button
          type="button"
          className="gv-icon gv-nav gv-next"
          aria-label="આગળનું દ્રશ્ય"
          disabled={atEnd}
          onClick={goNext}
        >
          <span aria-hidden="true">›</span>
        </button>

        <div className="gv-bottom">
          {/*
            The વર્ણન, in full and verbatim — the stored text, never rewritten, summarised or
            translated (§12). Everything here is derived from items[index] on every render, so
            nothing of દ્રશ્ય ૧૨ can linger over દ્રશ્ય ૧૩ (§14): walking the ક્રમ with the
            panel open swaps the text under it rather than closing it.

            It sits ABOVE the row below and never in place of it. §9 is explicit and it is the
            requirement this whole foot is arranged around — opening the વર્ણન must not cost a
            યુવક sight of which દ્રશ્ય he is reading about.
          */}
          {descOpen && hasDesc && (
            <div className="gv-desc" id="gv-desc" role="region" aria-label="વર્ણન">
              {item.t}
            </div>
          )}

          {/*
            ── the permanent row: the number, and the way to the વર્ણન ──

            Both of these are always rendered. Not while the controls are awake, not while the
            panel is closed, not only when the દ્રશ્ય has a વર્ણન — always. There is no
            condition anywhere in this component under which this row is absent, and that is
            the point of it: લેવલ ૨ is where a યુવક learns the number alongside the picture,
            so the number is furniture, not a hint that comes and goes.

            The number is `item.displayIndex` — the one derivation (ORDERING.md §4), the same
            number the card behind it prints and the same one લેવલ ૩'s rows and લેવલ ૪'s કસોટી
            use. It is deliberately NOT the "૫ / ૧૦૯" in the corner: that is a position in the
            collection as it stands today, this is the દ્રશ્ય's own printed number, and when a
            સંચાલક withholds one દ્રશ્ય the two stop matching. Showing both, marked differently,
            is how a યુવક can tell which is which.
          */}
          <div className="gv-meta">
            <span className="gv-num" aria-label={`દ્રશ્ય નંબર ${number}`}>
              <span className="gv-num-h" aria-hidden="true">
                #
              </span>
              {number}
            </span>

            <button
              type="button"
              className="gv-desc-btn"
              /*
                `descOpen && hasDesc`, not `descOpen`. A યુવક who walks the ક્રમ with the
                panel open onto a દ્રશ્ય that has no વર્ણન would otherwise leave a disabled
                control announcing itself as expanded over a panel that is not there — the
                one state where the two could disagree.
              */
              aria-expanded={descOpen && hasDesc}
              aria-controls="gv-desc"
              aria-label={descOpen ? 'વર્ણન બંધ કરો' : 'વર્ણન બતાવો'}
              /*
                Disabled, never removed. A control that vanishes on the one દ્રશ્ય without a
                વર્ણન would move the number and the આપોઆપ button under the યુવક's thumb
                mid-ક્રમ; disabled keeps the foot the same shape on all ૧૦૯ (§10).
              */
              disabled={!hasDesc}
              onClick={() => {
                // Reading while the picture changes underneath is the wrong kind of
                // surprise, and a silent resume afterwards is worse. He restarts it himself.
                if (!descOpen) setIsAuto(false);
                setDescOpen((o) => !o);
              }}
            >
              <span className="gv-desc-i" aria-hidden="true">
                ⓘ
              </span>
              <span>વર્ણન</span>
            </button>
          </div>

          {/* The only primary control at the foot, exactly as specified. */}
          <button
            type="button"
            className={`gv-btn gv-auto${isAuto ? ' on' : ''}`}
            aria-label={isAuto ? 'આપોઆપ બંધ કરો' : 'આપોઆપ ચાલુ કરો'}
            aria-pressed={isAuto}
            onClick={() => setIsAuto((a) => !a)}
          >
            <span aria-hidden="true">{isAuto ? '⏸' : '▶'}</span>
            <span>આપોઆપ</span>
          </button>
        </div>
      </div>
    </div>
  );
}
