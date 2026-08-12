import { gu } from '../../lib/scenes';

/**
 * પ્રગતિ ચક્ર (§10).
 *
 * Shows **one** level's score, never both — §10 is explicit: લેવલ ૩'s ring until લેવલ ૪
 * opens, લેવલ ૪'s after. Both scores are stored separately (`progress.level3_score` and
 * `level4_score`) so the સંચાલક's dashboard and a future ઈતિહાસ page can show both; the
 * યુવક in the middle of his ધ્યાન sees the one he is doing.
 *
 * **The denominator is passed in and is never a literal (§62.)** It is `total` from
 * useScenes(), which is the count of દ્રશ્યો that survived both gates — the સંચાલક's
 * overlay and "has an image and a વર્ણન". The day દ્રશ્ય ૧૦૧–૧૦૯ get their વર્ણન the ring
 * counts out of 109 by itself, with no edit here.
 *
 * Nothing in it is red or empty-as-rebuke (§1 rule 4): the untravelled part of the ring is
 * the same faint gold as every other quiet edge in the app, so a ring at ૩/૧૦૮ reads as a
 * ધ્યાન begun, not as ૧૦૫ missed.
 */
export default function ProgressRing({ score, total, label, sub }) {
  const R = 54;
  const C = 2 * Math.PI * R;
  // Guarded rather than assumed: `total` is 0 for the width of the first paint, and
  // 0/0 would paint NaN into the dash offset and blank the ring.
  const done = total > 0 ? Math.min(1, Math.max(0, score / total)) : 0;

  return (
    <div className="progress-ring">
      <svg viewBox="0 0 128 128" className="ring-svg" aria-hidden="true">
        <circle className="ring-track" cx="64" cy="64" r={R} />
        <circle
          className="ring-fill"
          cx="64"
          cy="64"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - done)}
        />
      </svg>

      {/*
        The figure is announced, the ring is not: a screen reader that read both would say
        the number twice. `aria-live` so each tick is spoken as it lands — the tick and the
        ring moving are one event to a યુવક and must be one event to a reader too.
      */}
      <div className="ring-body" aria-live="polite">
        <div className="ring-score">
          {gu(score)}
          <span className="ring-of">/{gu(total)}</span>
        </div>
        <div className="ring-label">{label}</div>
      </div>
      {sub && <p className="ring-sub">{sub}</p>}
    </div>
  );
}
