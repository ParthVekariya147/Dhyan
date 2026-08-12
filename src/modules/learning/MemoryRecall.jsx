import { useCallback, useEffect, useState } from 'react';
import { gu } from '../../lib/scenes';
import NavArrow from '../../components/NavArrow';

/**
 * Stage 5 — સ્મૃતિ દર્શન (§18, §19).
 *
 * The learning direction reverses here: earlier the picture led to the વર્ણન, now a
 * bare number has to summon both from memory.
 *
 * This screen therefore renders the number and nothing else. It receives `indexes` —
 * plain integers — and never touches the scene records, so there is no image url in
 * this component's props, no alt text, no blurred or hidden preview, and no request on
 * the network while the yuvak sits here (§25, §36). The answer cannot leak because it
 * was never sent.
 *
 * §19 is explicit that a reveal must not be added unless asked for. There is none.
 */
export default function MemoryRecall({ indexes, onFinish }) {
  const [i, setI] = useState(0);
  const total = indexes.length;
  const cur = Math.min(i, Math.max(0, total - 1));
  const atEnd = cur >= total - 1;

  const go = useCallback(
    (d) => setI((c) => Math.min(Math.max(c + d, 0), Math.max(0, total - 1))),
    [total]
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'BUTTON') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  if (!total) {
    return (
      <div className="stage-empty">
        <p>સ્મૃતિ દર્શન માટે કંઈ બાકી નથી.</p>
        <button className="btn-gold" type="button" onClick={onFinish}>પૂર્ણ કરો</button>
      </div>
    );
  }

  return (
    <section className="stage stage-recall">
      <header className="runner-head">
        <h2>સ્મૃતિ દર્શન</h2>
        <p className="runner-count" aria-live="polite">{gu(cur + 1)} / {gu(total)}</p>
        <div className="runner-track" aria-hidden="true">
          <span style={{ width: `${((cur + 1) / total) * 100}%` }} />
        </div>
      </header>

      <div className="recall-card">
        <div className="recall-num">{gu(indexes[cur])}</div>
        <p className="recall-ask">આ ક્રમનું દર્શન મનમાં લાવો</p>
      </div>

      <p className="runner-hint recall-hint">
        ચિત્ર અને એનું વર્ણન શાંતિથી સ્મરણમાં લાવો, પછી આગળ વધો.
      </p>

      <nav className="runner-nav">
        <button type="button" className="btn-quiet" onClick={() => go(-1)} disabled={cur === 0}>
          <NavArrow dir="back" />પાછળ
        </button>
        {atEnd ? (
          <button type="button" className="btn-gold" onClick={onFinish}>પૂર્ણ કરો</button>
        ) : (
          <button type="button" className="btn-gold" onClick={() => go(1)}>આગળ<NavArrow /></button>
        )}
      </nav>
    </section>
  );
}
