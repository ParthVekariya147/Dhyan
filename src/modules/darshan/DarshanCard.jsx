import { useEffect, useRef } from 'react';

/**
 * One દર્શન scene: a picture, its number, its વર્ણન.
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
export default function DarshanCard({ item, onOpen }) {
  const ref = useRef(null);

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

  return (
    <article className="card" ref={ref}>
      <div
        className="frame"
        onClick={() => onOpen(item)}
        role="button"
        tabIndex={0}
        aria-label={`દ્રશ્ય ${item.n} મોટું જુઓ`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen(item);
          }
        }}
      >
        <img src={item.url} alt={item.t} loading="lazy" decoding="async" />
      </div>
      <div className="cap">
        <span className="txt">{item.t}</span>
        <span className="num">{item.n}</span>
      </div>
    </article>
  );
}
