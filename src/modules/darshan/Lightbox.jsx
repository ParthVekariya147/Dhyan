import { useEffect } from 'react';
import { gu } from '../../lib/scenes';

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
          <img src={item.fullUrl || item.url} alt={item.t} decoding="async" />
          <div className="lb-cap">
            {gu(item.displayIndex)}.&nbsp; {item.t}
          </div>
        </>
      )}
    </div>
  );
}
