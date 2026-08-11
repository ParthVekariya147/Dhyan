import { useEffect, useState } from 'react';

export default function BackToTop() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(scrollY > 800);
    addEventListener('scroll', onScroll, { passive: true });
    return () => removeEventListener('scroll', onScroll);
  }, []);

  return (
    <button
      id="top"
      className={show ? 'show' : ''}
      title="ઉપર જાઓ"
      aria-label="ઉપર જાઓ"
      onClick={() => scrollTo({ top: 0, behavior: 'smooth' })}
    >
      ↑
    </button>
  );
}
