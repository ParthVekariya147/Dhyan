import { useEffect } from 'react';

/**
 * The lightbox always loads the native-width encode via `item.full`, never a
 * downscaled variant stretched back up. The card may well have loaded a 640w or
 * 960w file; enlarging that would be visibly soft, so the full-resolution version
 * is requested explicitly here.
 *
 * That file is usually already warm in cache after the first open, and the card's
 * variant stays valid — nothing is discarded.
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
          <picture>
            <source type="image/avif" srcSet={item.full.avif} />
            <source type="image/webp" srcSet={item.full.webp} />
            <img src={item.full.jpeg} alt={item.t} width={item.w} height={item.h} />
          </picture>
          <div className="lb-cap">
            {item.n}.&nbsp; {item.t}
          </div>
        </>
      )}
    </div>
  );
}
