import { useEffect } from 'react';
import { gu } from '../../lib/scenes';
import { useImageRetry } from '../../lib/useImageRetry';

/**
 * The enlarged view of one દ્રશ્ય.
 *
 * It asks the CDN for a wider encode than the card did (`fullUrl`), because enlarging the
 * card's own file would be visibly soft. That is a different URL, so it is a second fetch —
 * but only for the scene actually opened, and the card's file stays valid and cached.
 *
 * `item` is always an entry from useScenes(), whichever screen opened it — the દર્શન feed
 * or લેવલ ૪'s પુનરાવર્તન — so its caption reads `displayIndex` (ORDERING.md §4) and the
 * enlarged દ્રશ્ય is called by the same number as the card behind it.
 */
export default function Lightbox({ item, onClose }) {
  /*
    The likeliest of all of them to be refused, and the worst place for it. `fullUrl` is the
    ૨૫૬૦-wide encode, asked for at the moment a યુવક deliberately taps to see a દ્રશ્ય
    closely — and it is a fresh URL, so it cannot be served from the card's cache. A 429 here
    is a black screen over a દર્શન he asked for. See src/lib/useImageRetry.js.
  */
  const { attempt, onError } = useImageRetry();

  useEffect(() => {
    if (!item) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [item, onClose]);

  return (
    <div className={`lb${item ? ' on' : ''}`} onClick={onClose}>
      {item && (
        <>
          {/*
            `data-full-image` marks this as "an enlarged દ્રશ્ય, asked for at the full width".
            scripts/verify-loading.mjs finds the enlarged image by that attribute rather than
            by class name, so the same assertion covers this overlay and લેવલ ૨'s fullscreen
            viewer alike. Nothing about the behaviour of this component changes.
          */}
          <img
            key={`${item.id}-${attempt}`}
            data-full-image=""
            src={item.fullUrl || item.url}
            alt={item.t}
            decoding="async"
            /* Load-bearing: lh3 throttles per referrer — see driveImageUrl in shared/domain/drive.js. */
            referrerPolicy="no-referrer"
            onError={onError}
          />
          <div className="lb-cap">
            {gu(item.displayIndex)}.&nbsp; {item.t}
          </div>
        </>
      )}
    </div>
  );
}
