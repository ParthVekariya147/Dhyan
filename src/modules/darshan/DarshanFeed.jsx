import { useCallback, useEffect, useRef, useState } from 'react';
import DarshanCard from './DarshanCard';
import Lightbox from './Lightbox';
import './darshan.css';

const BATCH = 10;

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
