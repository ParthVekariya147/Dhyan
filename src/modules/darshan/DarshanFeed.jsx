import { useCallback, useEffect, useRef, useState } from 'react';
import DarshanCard from './DarshanCard';
import GalleryViewer from './GalleryViewer';
import { useViewingSpeed } from '../../lib/useViewingSpeed';
import './darshan.css';

/**
 * Six, not ten — because of Google's rate limit rather than because of weight.
 *
 * lh3.googleusercontent.com answers 429 to a client that asks for too much of it too
 * quickly, and mounting a batch is exactly what fires those requests: `loading="lazy"`
 * defers the cards still far below, but on a fast scroll the browser's own threshold sweeps
 * in and pulls most of a batch at once. Ten together is enough to trip it; six leaves the
 * same headroom with one more observer trigger, which costs nothing a યુવક can perceive
 * because the sentinel still fires a full 900px before the end of the list.
 *
 * This is a smaller lever than it looks, and it is not the fix on its own — the throttle is
 * about the rate of requests, and the browser, not this number, decides the true
 * concurrency. What actually recovers a refused દર્શન is the retry in
 * src/lib/useImageRetry.js. This just asks for the refusal less often.
 */
const BATCH = 6;

/**
 * Renders scenes in batches as the reader approaches the end of the list.
 *
 * The original page had this same idea but it could not work: with every image
 * base64-inlined in the HTML, the browser downloaded all 25 MB before painting,
 * so batching only delayed DOM insertion. Now that each card points at a real
 * file, mounting a batch is what actually triggers those network requests.
 */
export default function DarshanFeed({ items, onComplete }) {
  const [count, setCount] = useState(BATCH);
  /*
    A position in `items`, not the item itself.

    The viewer walks the whole ક્રમ from wherever the યુવક tapped, so what it needs is an
    index — and `items` is the full collection even though only `count` cards are mounted,
    which is exactly why navigation can reach દ્રશ્ય ૧૦૯ from a feed that has rendered six.
    -1 is closed.
  */
  const [openAt, setOpenAt] = useState(-1);
  const sentinelRef = useRef(null);

  /*
    Read HERE, at the feed, and not inside the viewer.

    The viewer is mounted on open and unmounted on close — that is what clears its timers and
    listeners — so a settings read inside it would be one request per tap on a દ્રશ્ય. Read
    once for the visit and handed down, opening the gallery a hundred times asks the server
    nothing. Same rule the collection itself follows: the viewer is *given* what it needs.
    useViewingSpeed() calls useSlideshow() internally, so that argument is unchanged and the
    number of requests is unchanged with it — the યુવક's half of the answer costs no request
    at all, because it comes off the device.

    ──────────────────────────────────────────────────────────────────────────
    A default and an override, in that order
    ──────────────────────────────────────────────────────────────────────────

    There are two answers to "how long does a દ્રશ્ય stay on screen" and they are not in
    competition. settings['app'].slideshow is the સંચાલક's: one number for the whole સંઘ,
    which is what a યુવક who has never opened સેટિંગ gets, on every device, for ever. The
    યુવક's own choice — four named presets or a typed 2-30 seconds, on /settings — replaces it
    on his phone from the moment he picks one until he picks another or asks for the default
    back. useViewingSpeed() joins the two, so the precedence is stated once rather than
    re-derived by every screen that wants a dwell (shared/domain/viewing-speed.js).
  */
  const { seconds: viewingSeconds } = useViewingSpeed();

  const done = count >= items.length;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || done) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setCount((c) => Math.min(c + BATCH, items.length));
        }
      },
      { rootMargin: '900px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [done, items.length]);

  /*
    ──────────────────────────────────────────────────────────────────────────
    One દર્શન, finished — the only thing this level has ever recorded
    ──────────────────────────────────────────────────────────────────────────

    This page's contract said "Persisted: nothing", three times over, and it was right to.
    What follows is the smallest thing that can make §6's "દર્શન: ૫ વાર પૂર્ણ" true, and it is
    written to keep as much of that property as possible: the feed still stores nothing, still
    scores nothing, still unlocks nothing, and still cannot fail in a way a યુવક can see. It
    calls back, and the page above it decides what that is worth.

    **The signal is the same `done` the sentinel already computes**, watched a second time with
    a different question. The observer above asks "is the end within 900px" — that is a
    prefetch, and it is true long before he has looked at anything. This one asks "is the end
    actually on screen, half of it at least", which is a thing that cannot be true unless he
    scrolled the whole collection past his eyes. A page load can never satisfy it while there
    is more than a screenful of દર્શન, and that is precisely the failure the brief forbids
    ("Do not create fake completions from page loads").

    The admitted edge: a collection short enough to fit on one screen is complete the moment it
    paints. There is no dishonest reading available there — every દ્રશ્ય genuinely is in front
    of him — and inventing a dwell timer to manufacture one would be the app asserting
    something it does not know, which is the reasoning shared/domain/journey.js already gives
    for not counting these at all.

    Fires **once per mount**. Leaving the page and coming back is a new mount and a genuinely
    second દર્શન; scrolling up and back down within one visit is not, and the ref is what tells
    those apart. `onComplete` is optional, so a caller that wants the old behaviour — a feed
    that records nothing whatsoever — gets it by passing nothing.
  */
  const completedRef = useRef(false);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !done || !items.length || !onComplete || completedRef.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || completedRef.current) return;
        completedRef.current = true;
        io.disconnect();
        onComplete();
      },
      { threshold: 0.5 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [done, items.length, onComplete]);

  /*
    Looked up by id rather than by identity: `items` is rebuilt whenever useScenes()'s
    overlay resolves, so the object a card is holding need not be the object in the current
    array. DarshanCard's `onOpen(item)` contract is unchanged.
  */
  const open = useCallback(
    (item) => {
      const i = items.findIndex((s) => s.id === item.id);
      if (i >= 0) setOpenAt(i);
    },
    [items]
  );
  const close = useCallback(() => setOpenAt(-1), []);

  return (
    <>
      <main className="feed">
        {/*
          Keyed by id, not by the printed number. Stable identity is the id and never the
          position or the number (§3): the સંચાલક can renumber a દ્રશ્ય from the panel, and
          `scenes_index_unique` only constrains the rows he has actually touched — an
          overridden number can still collide with an untouched scene's manifest number,
          which as a key would drop one of the two cards.
        */}
        {items.slice(0, count).map((item) => (
          <DarshanCard key={item.id} item={item} onOpen={open} />
        ))}
      </main>

      <div className="sentinel" ref={sentinelRef}>
        {done ? (
          '- દર્શન પૂરાં થયાં -'
        ) : (
          <>
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </>
        )}
      </div>

      {/*
        Mounted only while open, and that is the contract rather than a detail: unmount is
        what clears the slideshow timer, the keyboard listener, the gesture and the preloads,
        so opening and closing a hundred times leaks nothing (§36). It also means there is no
        transparent layer left over the feed to swallow a tap on the next card.
      */}
      {openAt >= 0 && (
        <GalleryViewer
          items={items}
          startIndex={openAt}
          onClose={close}
          /*
            Seconds → milliseconds, at the same boundary as before: the one place between the
            setting and the `setTimeout` that consumes it. Both halves of the setting are
            stored in seconds — the unit the સંચાલક types, and the unit the યુવક's 2-30 bound
            is written in — because a stored 8 that something later read as milliseconds is a
            slideshow nobody would notice was broken, and a stored 8000 read as seconds is a
            two-and-a-quarter-hour one. Never NaN and never 0: resolveViewingSpeed() has
            already guaranteed a finite value inside its bounds, which is what keeps a damaged
            preference from becoming a timer that fires immediately.
          */
          autoIntervalMs={viewingSeconds * 1000}
        />
      )}
    </>
  );
}
