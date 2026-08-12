import { useCallback, useEffect, useRef, useState } from 'react';
import DarshanCard from './DarshanCard';
import Lightbox from './Lightbox';
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
export default function DarshanFeed({ items }) {
  const [count, setCount] = useState(BATCH);
  const [active, setActive] = useState(null);
  const sentinelRef = useRef(null);

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

  const open = useCallback((item) => setActive(item), []);
  const close = useCallback(() => setActive(null), []);

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
          '— દર્શન સંપૂર્ણ —'
        ) : (
          <>
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </>
        )}
      </div>

      <Lightbox item={active} onClose={close} />
    </>
  );
}
