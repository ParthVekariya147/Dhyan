import { useRef } from 'react';

/**
 * Horizontal swipe for the fullscreen દર્શન viewer.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What the browser is told, and what is left to us
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The element wearing these handlers also carries `touch-action: pan-y pinch-zoom`
 * (gallery.css). That one declaration does most of the work and it is the reason nothing
 * below ever calls `preventDefault()`: the browser keeps vertical panning and pinch-zoom
 * for itself and hands us the horizontal axis. When it *does* decide to take over — a
 * pinch, an iOS edge-back — it fires `pointercancel`, which is the multi-touch guard
 * arriving for free and at exactly the right moment.
 *
 * `preventDefault()` on a touch-derived `pointermove` is not cancelable anyway; calling it
 * produces console noise and changes nothing.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why the drag is painted straight onto the node
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `pointermove` fires at the display's refresh rate. A `setState` per move would re-render
 * a component holding a ૨૫૬૦-wide `<img>` sixty times a second on a phone. Writing
 * `style.transform` directly keeps the whole drag on the compositor and off React.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The thresholds, and why each one exists
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A યુવક scrolling a દર્શન and a યુવક moving to the next દ્રશ્ય start the same way, so the
 * gesture has to decide which it is before it does anything:
 *
 *  - AXIS_SLOP     nothing is decided inside 12px. Under that, a finger is still resting.
 *  - AXIS_RATIO    horizontal must beat vertical by 1.2× to claim the gesture. A diagonal
 *                  drag reads as vertical intent, and vertical intent is the browser's.
 *  - commit        15% of the stage, floored at 40px and capped at 72px — 48px at 320px
 *                  wide, 64.5px at 430px. A deliberate movement, not a twitch (§6).
 *  - FLICK         a fast short throw commits anyway: that is what a flick *is*, and
 *                  requiring 64px of travel from it feels broken.
 *  - TAP_SLOP      under 8px with no axis ever claimed, it was a tap — which is how the
 *                  controls are brought back when they have faded (§19).
 *
 * `END_RESIST` is the answer to "no wraparound" (§4, §5). Past the last દ્રશ્ય the picture
 * leans and springs back rather than doing nothing at all: a gesture that produces no
 * response whatsoever reads as a broken app, not as a boundary.
 */
const TAP_SLOP = 8;
const AXIS_SLOP = 12;
const AXIS_RATIO = 1.2;
const FLICK_SPEED = 0.45; // px per ms
const FLICK_MIN_PX = 24;
const COMMIT_MIN_PX = 40;
const COMMIT_MAX_PX = 72;
const COMMIT_FRACTION = 0.15;
const END_RESIST = 0.28;
const SPRING_MS = 180;

export function useSwipe({ onNext, onPrev, onTap, atStart, atEnd }) {
  const el = useRef(null);
  /*
    A Set of live pointer ids rather than a counter. `pointerup` for a finger whose gesture
    we already abandoned must not resurrect it, and `pointercancel` can arrive for either
    finger of a pinch in either order — a counter cannot tell those apart.
  */
  const live = useRef(new Set());
  const gesture = useRef(null);
  const spring = useRef(null);

  const paint = (dx) => {
    if (!el.current) return;
    el.current.style.transform = dx ? `translate3d(${dx}px, 0, 0)` : '';
  };

  const settle = (commit) => {
    const s = gesture.current;
    gesture.current = null;

    if (el.current) {
      el.current.style.transition = `transform ${SPRING_MS}ms ease-out`;
      paint(0);
      clearTimeout(spring.current);
      spring.current = setTimeout(() => {
        if (el.current) el.current.style.transition = '';
      }, SPRING_MS + 20);
    }

    if (!s || !commit) return;

    // A tap: no axis was ever claimed and the finger barely moved.
    if (s.axis === null && Math.abs(s.dx) < TAP_SLOP) {
      onTap?.();
      return;
    }
    if (s.axis !== 'x') return;

    const width = el.current?.getBoundingClientRect().width || window.innerWidth || 360;
    const need = Math.min(COMMIT_MAX_PX, Math.max(COMMIT_MIN_PX, width * COMMIT_FRACTION));
    const dt = Math.max(1, s.t1 - s.t0);
    const flick = Math.abs(s.dx) / dt >= FLICK_SPEED && Math.abs(s.dx) > FLICK_MIN_PX;

    if (s.dx <= -need || (flick && s.dx < 0)) onNext();
    else if (s.dx >= need || (flick && s.dx > 0)) onPrev();
  };

  const onPointerDown = (e) => {
    live.current.add(e.pointerId);
    // A second finger is a pinch. Abandon the gesture rather than interpreting half of it.
    if (live.current.size > 1) {
      settle(false);
      return;
    }
    if (!e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    /*
      A control inside the stage — ફરી પ્રયત્ન કરો on a દ્રશ્ય the CDN refused — is a button
      being pressed, not a દર્શન being swiped. Left to the gesture it would work, but only
      by accident; naming it here means a control can be put in the stage without wondering.
    */
    if (typeof e.target?.closest === 'function' && e.target.closest('button')) return;

    clearTimeout(spring.current);
    if (el.current) el.current.style.transition = '';

    gesture.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      t0: e.timeStamp,
      t1: e.timeStamp,
      dx: 0,
      axis: null,
    };
  };

  const onPointerMove = (e) => {
    const s = gesture.current;
    if (!s || s.id !== e.pointerId || live.current.size > 1) return;

    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;

    if (s.axis === null) {
      if (Math.abs(dx) < AXIS_SLOP && Math.abs(dy) < AXIS_SLOP) return;
      if (Math.abs(dx) <= Math.abs(dy) * AXIS_RATIO) {
        /*
          Vertical intent, which belongs to the browser. Release the capture and drop the
          gesture rather than sitting on a scroll or a pull-to-refresh the યુવક asked for.
        */
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        gesture.current = null;
        return;
      }
      s.axis = 'x';
      /*
        The capture is taken HERE and not on pointerdown, and that is load-bearing.

        A captured pointer retargets the derived mouse events too, so `click` is delivered to
        the capturing element rather than to whatever was actually pressed — capturing on
        pointerdown made every button inside the stage unclickable, ફરી પ્રયત્ન કરો included.
        Claiming it at the moment the gesture is recognised leaves a plain press a plain
        press, and still keeps the finger's remaining movement ours once it is a swipe.
      */
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }

    s.dx = dx;
    s.t1 = e.timeStamp;

    const pushing = (dx > 0 && atStart) || (dx < 0 && atEnd);
    paint(dx * (pushing ? END_RESIST : 1));
  };

  const onPointerUp = (e) => {
    live.current.delete(e.pointerId);
    if (gesture.current?.id === e.pointerId) settle(true);
  };

  const onPointerCancel = (e) => {
    live.current.delete(e.pointerId);
    if (gesture.current?.id === e.pointerId) settle(false);
  };

  return {
    ref: el,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture: onPointerCancel,
    },
  };
}
