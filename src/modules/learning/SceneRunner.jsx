import { useCallback, useEffect, useRef, useState } from 'react';
import SceneImage, { ScenePreload } from './SceneImage';
import { gu, sceneById } from '../../lib/scenes';

/**
 * The sequential scene viewer shared by દર્શન, ઓળખ and બાકી દર્શન.
 *
 * One scene fills the screen at a time. That is the product asking for it (§7, §17 —
 * focused presentation, attention on one scene) and it is also what keeps the network
 * honest: exactly one image is on screen and exactly one more is fetched ahead, so
 * reaching scene 4 has cost four images, never a hundred (§25).
 */
export default function SceneRunner({
  ids,
  title,
  hint,
  showCheckbox = false,
  isTicked,
  onToggle,
  onFinish,
  finishLabel,
}) {
  const [i, setI] = useState(0);
  const liveRef = useRef(null);

  const total = ids.length;
  const clamped = Math.min(i, Math.max(0, total - 1));
  const scene = sceneById(ids[clamped]);
  const nextScene = sceneById(ids[clamped + 1]);
  const atEnd = clamped >= total - 1;

  const go = useCallback(
    (delta) => setI((cur) => Math.min(Math.max(cur + delta, 0), Math.max(0, total - 1))),
    [total]
  );

  const toggle = useCallback(() => {
    if (showCheckbox && scene) onToggle(scene.id);
  }, [showCheckbox, scene, onToggle]);

  // Keyboard navigation (§31). Space ticks; the arrows move. Ignored while the focus is
  // inside a control that wants those keys for itself.
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === ' ' && showCheckbox) { e.preventDefault(); toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, toggle, showCheckbox]);

  if (!total) {
    return (
      <div className="stage-empty">
        <p>અહીં હમણાં કંઈ બાકી નથી.</p>
        <button className="btn-gold" type="button" onClick={onFinish}>{finishLabel}</button>
      </div>
    );
  }
  if (!scene) return null;

  const ticked = showCheckbox && isTicked(scene.id);

  return (
    <section className="runner">
      <header className="runner-head">
        <h2>{title}</h2>
        <p className="runner-count" ref={liveRef} aria-live="polite">
          {gu(clamped + 1)} / {gu(total)}
        </p>
        <div className="runner-track" aria-hidden="true">
          <span style={{ width: `${((clamped + 1) / total) * 100}%` }} />
        </div>
      </header>

      {hint && <p className="runner-hint">{hint}</p>}

      {/*
        The scene is keyed so React remounts it on navigation. Without the key it would
        reuse the same <img> and the previous scene would linger, visibly, until the new
        file decoded — on a slow connection that reads as the wrong picture.
      */}
      <article className="scene" key={scene.id}>
        <div className="scene-frame">
          <SceneImage scene={scene} eager />
        </div>

        {/*
          વર્ણન and ક્રમ are rendered here because the artwork does not contain them —
          the masters are plain 3840×2160 pictures and the text lives in the સંચાલક's
          sheet. Without this the yuvak would have nothing to memorise.
        */}
        <div className="scene-cap">
          <span className="scene-txt">{scene.t}</span>
          <span className="scene-num">{gu(scene.index)}</span>
        </div>
      </article>

      {showCheckbox && (
        <label className={`remember${ticked ? ' is-on' : ''}`}>
          <input
            type="checkbox"
            checked={ticked}
            onChange={() => onToggle(scene.id)}
          />
          <span className="remember-box" aria-hidden="true">{ticked ? '✓' : ''}</span>
          <span className="remember-label">મને આ દર્શન યાદ છે</span>
        </label>
      )}

      <nav className="runner-nav">
        <button type="button" className="btn-quiet" onClick={() => go(-1)} disabled={clamped === 0}>
          પાછળ
        </button>
        {atEnd ? (
          <button type="button" className="btn-gold" onClick={onFinish}>{finishLabel}</button>
        ) : (
          <button type="button" className="btn-gold" onClick={() => go(1)}>આગળ</button>
        )}
      </nav>

      {/* Only the next one. Never the whole collection. */}
      <ScenePreload scene={nextScene} />
    </section>
  );
}
