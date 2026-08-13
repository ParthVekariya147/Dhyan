import { useEffect, useRef, useState } from 'react';
import { useImageRetry } from '../../lib/useImageRetry';

/**
 * One દ્રશ્ય's picture inside the fullscreen viewer, and everything that can go wrong with it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this is its own component — the load-bearing reason
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `useImageRetry`'s attempt counter lives in the hook instance and never resets. Had the
 * hook been called once by GalleryViewer, three CDN refusals on દ્રશ્ય ૫ would leave
 * દ્રશ્યો ૬…૧૦૯ with **zero** retries for the rest of the visit — a યુવક who hit one bad
 * moment of throttling would spend the rest of his દર્શન looking at blank frames.
 *
 * The correct way to reset a hook instance is to end it. GalleryViewer renders this with
 * `key={item.id}:{nonce}`, so every navigation and every ફરી-પ્રયાસ is a fresh mount, a
 * fresh hook, and attempts back at zero. That is also why the retry state is not lifted:
 * lifting it would take the reset with it.
 *
 * `useImageRetry` itself is untouched. It is shared with the દર્શન feed and with લેવલ ૪'s
 * પુનરાવર્તન, and this feature has no business changing the behaviour of either.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `ready` means settled, not succeeded
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `onReady(loaded)` fires when the picture has arrived **or** when it is never going to. The
 * slideshow arms its dwell from it, and a દ્રશ્ય the CDN refuses must not stop the
 * slideshow on itself for ever. The argument says which of the two it was, so the viewer can
 * hold its controls on screen over a દ્રશ્ય that failed.
 */

/*
  The hook stops after `max`, so this component has to know the same number to know when to
  stop hoping and offer the button instead. Stated once and passed in, rather than a 3
  written here that silently disagrees the day the hook's default changes.
*/
const RETRIES = 3;

export default function GalleryImage({ item, onReady, onRetry }) {
  const { attempt, onError } = useImageRetry({ max: RETRIES });
  const [failures, setFailures] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef(null);

  // The first request plus `RETRIES` more. Past that the cause is not transient.
  const dead = failures > RETRIES;

  /*
    A preloaded દ્રશ્ય can already be complete before React attaches `onLoad`, and then the
    `load` event never fires at all — the skeleton would sit for ever over a picture that is
    already there. The neighbour preload in GalleryViewer creates exactly this case on every
    Next, so it is checked rather than assumed.
  */
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) setLoaded(true);
  }, [attempt]);

  useEffect(() => {
    if (loaded || dead) onReady?.(loaded);
  }, [loaded, dead, onReady]);

  return (
    <>
      {/*
        `data-full-image` marks this as "an enlarged દ્રશ્ય, asked for at the full width".
        scripts/verify-loading.mjs finds it by that attribute rather than by class name,
        because what it asserts is the URL an enlarged દ્રશ્ય requests — not which component
        happened to draw it. લેવલ ૪'s Lightbox carries the same attribute.

        `visibility` and not an unmount while loading: the element has to stay in the DOM so
        `complete` / `naturalWidth` above remain readable, and so the delivery suite can find
        it mid-load.
      */}
      <img
        key={attempt}
        ref={imgRef}
        className="gv-img"
        data-full-image=""
        src={item.fullUrl || item.url}
        alt={item.t}
        decoding="async"
        fetchPriority="high"
        /* Load-bearing: lh3 throttles per referrer — see driveImageUrl in shared/domain/drive.js. */
        referrerPolicy="no-referrer"
        draggable="false"
        style={{ visibility: loaded ? 'visible' : 'hidden' }}
        onLoad={() => setLoaded(true)}
        onError={(e) => {
          setFailures((f) => f + 1);
          onError(e);
        }}
      />

      {/* A skeleton inside the stage, never a blocking application spinner (§17). */}
      {!loaded && !dead && <div className="gv-skel" role="status" aria-label="દ્રશ્ય આવી રહ્યું છે" />}

      {dead && (
        <div className="gv-fail" role="alert">
          <p>આ દ્રશ્ય અત્યારે આવ્યું નહીં.</p>
          {/* Retries this one દ્રશ્ય only. The rest of the દર્શન is untouched (§18). */}
          <button type="button" className="gv-btn" onClick={onRetry}>
            ફરી પ્રયત્ન કરો
          </button>
        </div>
      )}
    </>
  );
}
