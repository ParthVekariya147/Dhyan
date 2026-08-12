import { useEffect } from 'react';

/**
 * The enlarged view of one દ્રશ્ય.
 *
 * It asks the CDN for a wider encode than the card did (`fullUrl`), because enlarging the
 * card's own file would be visibly soft. That is a different URL, so it is a second fetch —
 * but only for the scene actually opened, and the card's file stays valid and cached.
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
            {item.n}.&nbsp; {item.t}
          </div>
        </>
      )}
    </div>
  );
}
