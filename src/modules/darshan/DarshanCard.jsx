import { useEffect, useRef } from 'react';

const srcset = (variants) => variants.map((v) => `${v.url} ${v.w}w`).join(', ');

/**
 * The feed is capped at 1100px with 14px gutters, so a card image is never wider than
 * ~1072 CSS px; below that it is full-bleed. The browser combines this with the device
 * pixel ratio to pick from srcset, so a 412px phone at DPR 2 asks for ~824px and gets
 * the 960w file rather than the full 1400w one.
 */
const SIZES = '(max-width: 1100px) 100vw, 1072px';

/**
 * One દર્શન scene.
 *
 * Two details are load-bearing:
 *  - real file URLs, not data-URIs. This is what lets the browser honour
 *    `loading="lazy"`; in the original page everything was inlined, so nothing
 *    could be deferred.
 *  - explicit width/height, so the box is reserved before the image arrives and
 *    cumulative layout shift stays at zero.
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
        <picture>
          <source type="image/avif" srcSet={srcset(item.avif)} sizes={SIZES} />
          <source type="image/webp" srcSet={srcset(item.webp)} sizes={SIZES} />
          <img
            src={item.jpeg.at(-1).url}
            srcSet={srcset(item.jpeg)}
            sizes={SIZES}
            alt={item.t}
            width={item.w}
            height={item.h}
            loading="lazy"
            decoding="async"
          />
        </picture>
      </div>
      <div className="cap">
        <span className="txt">{item.t}</span>
        <span className="num">{item.n}</span>
      </div>
    </article>
  );
}
