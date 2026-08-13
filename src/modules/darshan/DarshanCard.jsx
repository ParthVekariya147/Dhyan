import { useCallback, useEffect, useRef, useState } from 'react';
import { gu } from '../../lib/scenes';
import { useImageRetry } from '../../lib/useImageRetry';

/**
 * One દર્શન scene: a picture, its number, its વર્ણન.
 *
 * The number is `item.displayIndex` — useScenes()'s continuous ૧…N (ORDERING.md §4), not
 * `item.n`, which is the number printed inside the artwork and skips wherever the સંચાલક has
 * withheld a દ્રશ્ય. લેવલ ૨ is where a યુવક first meets these numbers and it is where he
 * learns the ક્રમ, so this card and લેવલ ૩'s row and લેવલ ૪'s કસોટી must all say the same
 * one; a feed that counted ૧૦૫, ૧૦૭, ૧૦૮ would teach him a sequence no other screen keeps.
 * Through `gu()`, like every number a યુવક reads.
 *
 * The image is one `<img src>` pointing at Google's image CDN, and that is the whole of it —
 * no `<picture>`, no `srcset`, no format negotiation. The URL itself carries the width and
 * the encoding (see driveImageUrl), so the work an encoder used to do happens at Google's
 * end on request.
 *
 * Two details are load-bearing:
 *  - `loading="lazy"`, which works because the src is a real URL. In the original page every
 *    image was base64-inlined, so nothing could be deferred and the browser pulled 25 MB
 *    before painting.
 *  - the frame reserves its box by aspect ratio in CSS (`--darshan-ratio`) rather than by
 *    width/height attributes. Nothing here measures a remote file, and a box reserved before
 *    the bytes arrive is what holds cumulative layout shift at zero.
 */

/*
  The hook stops after `max`; the card has to know the same number to know when the retries
  are spent. Stated once and passed in — the same discipline GalleryImage.jsx follows, and
  for the same reason: a 3 written here that silently disagrees the day the hook's default
  changes.
*/
const RETRIES = 3;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * Why the feed needs a dead state at all
 * ────────────────────────────────────────────────────────────────────────────
 *
 * lh3 answers 429 to a burst, and the feed IS a burst: six cards mount together, so the
 * throttle takes several at once. The hook's three retries span roughly five seconds, and a
 * throttle window can outlast that — after which the browser will never ask again, and the
 * card sat for the rest of the visit as a broken-image glyph with the વર્ણન spilling over it.
 * Meanwhile the fullscreen viewer, opened a minute later as one lone request, loaded the very
 * same દ્રશ્ય perfectly — which is exactly how the fault was reported: "the gallery shows it,
 * the feed does not".
 *
 * So a દ્રશ્ય whose retries are spent gets what the gallery already has: it says so, quietly,
 * and offers ફરી પ્રયત્ન કરો. And because the natural gesture on a feed is scrolling rather
 * than pressing, a dead card also retries **by itself when it re-enters the viewport** — a
 * યુવક who scrolled past a throttled patch and came back gets the picture without being asked
 * to do anything. Re-*enters* is the guard that keeps that from becoming a hammer: a dead
 * card sitting on screen does not loop; it must leave and come back, which paces the retry to
 * the યુવક's own movement.
 */
export default function DarshanCard({ item, onOpen }) {
  const ref = useRef(null);
  /*
    `round` is CardImage's key: bumping it is a fresh mount, a fresh useImageRetry, and a
    fresh set of attempts for this one દ્રશ્ય. `deadRound` remembers which round died, so
    `dead` goes false the moment a new round begins and the frame's tap is the gallery again.
  */
  const [round, setRound] = useState(0);
  const [deadRound, setDeadRound] = useState(-1);
  const dead = deadRound === round;

  const onDead = useCallback(() => setDeadRound(round), [round]);

  const retry = useCallback(() => setRound((r) => r + 1), []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /*
    The scroll-back revival. Armed only while dead, and it fires on RE-entry: the card must
    actually leave the viewport before a return grants the fresh round. Without the `away`
    latch a dead card sitting on screen would retry, die, retry — a phone quietly hammering
    lh3 on mobile data. Paced by the યુવક's own scrolling, it asks again exactly when he
    comes back to look, which is the moment the answer matters and the moment the burst that
    caused the 429 is most likely to be over.
  */
  useEffect(() => {
    if (!dead) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    let away = false;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) away = true;
          else if (away) retry();
        }
      },
      { threshold: 0.05 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [dead, retry]);

  return (
    <article className="card" ref={ref}>
      {/*
        `data-scene-id` is how the fullscreen viewer finds its way back: on close it returns
        focus to the exact card that opened it, and a click-opened frame does not reliably
        leave itself as document.activeElement to be remembered.
      */}
      <div
        className="frame"
        data-scene-id={item.id}
        onClick={(e) => {
          /*
            A dead frame's tap is the retry, not the gallery. Opening fullscreen on a દ્રશ્ય
            the feed could not fetch would only show the same યુવક the same failure larger;
            asking again is what he means by tapping the card that says ફરી પ્રયત્ન કરો.
          */
          if (dead) {
            e.stopPropagation();
            retry();
            return;
          }
          onOpen(item);
        }}
        role="button"
        tabIndex={0}
        aria-label={dead ? `દ્રશ્ય ${gu(item.displayIndex)} ફરી પ્રયત્ન કરો` : `દ્રશ્ય ${gu(item.displayIndex)} મોટું જુઓ`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (dead) retry();
            else onOpen(item);
          }
        }}
      >
        <CardImage key={round} item={item} onDead={onDead} />
      </div>
      <div className="cap">
        <span className="txt">{item.t}</span>
        <span className="num">{gu(item.displayIndex)}</span>
      </div>
    </article>
  );
}

/**
 * The picture inside one card, and its whole failure story.
 *
 * Split out of DarshanCard for the reason GalleryImage is split out of GalleryViewer, and it
 * is load-bearing rather than tidy: `useImageRetry`'s attempt counter lives in the hook
 * instance and never resets. The correct way to reset a hook instance is to end it — the
 * card renders this with `key={round}`, so granting a દ્રશ્ય a fresh chance is a fresh
 * mount, a fresh hook, and attempts back at zero.
 *
 * `dead` is reported upward through an effect — never from render, which would be a
 * setState-during-render loop between parent and child.
 */
function CardImage({ item, onDead }) {
  const { attempt, onError } = useImageRetry({ max: RETRIES });
  const [failures, setFailures] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef(null);

  const dead = failures > RETRIES;

  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) setLoaded(true);
  }, [attempt]);

  useEffect(() => {
    if (dead) onDead?.();
  }, [dead, onDead]);

  return (
    <>
      {!dead && (
        <img
          key={attempt}
          ref={imgRef}
          src={item.url}
          alt={item.t}
          loading="lazy"
          decoding="async"
          /* Load-bearing: lh3 throttles per referrer — see driveImageUrl in shared/domain/drive.js. */
          referrerPolicy="no-referrer"
          style={{ visibility: loaded ? 'visible' : 'hidden' }}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setFailures((f) => f + 1);
            onError();
          }}
        />
      )}

      {dead && (
        <div className="frame-fail" role="status">
          <p>આ દ્રશ્ય અત્યારે આવ્યું નહીં.</p>
          <span className="frame-fail-hint">ફરી પ્રયત્ન કરો</span>
        </div>
      )}
    </>
  );
}
