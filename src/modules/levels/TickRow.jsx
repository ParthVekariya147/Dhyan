import { memo } from 'react';
import { gu } from '../../lib/scenes';

/**
 * One દ્રશ્ય in the list — the whole of લેવલ ૩ and લેવલ ૪, repeated N times.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this is `memo`'d, and why that is the performance decision that mattered
 * ────────────────────────────────────────────────────────────────────────────
 *
 * લેવલ ૩ renders ~109 rows and a યુવક ticks every one of them in a sitting. Without memo,
 * each tick re-renders all 109 rows — ~11,800 row renders across a session, on a phone,
 * for 109 boxes. With it, a tick changes `ticked` on exactly one row and React reconciles
 * exactly one.
 *
 * That is why the callbacks arrive as stable props (`onToggle(id)`, `onReveal(id)`) rather
 * than as inline arrows: an arrow rebuilt on the parent's render is a new prop, and memo
 * would compare false on every row and buy nothing.
 *
 * **Not virtualised, deliberately.** ~109 rows of text and a checkbox is a smaller DOM
 * than the દર્શન feed already ships, and a windowing library would cost a dependency
 * (forbidden here), break the browser's own find-in-page, and — the one that decides it —
 * break scroll position when a row's height changes as a વર્ણન is revealed at લેવલ ૪. The
 * mobile answer is `content-visibility: auto` in levels.css instead: the browser skips
 * layout and paint for rows outside the viewport and un-skips them on scroll, which is
 * virtualisation done by the engine, with no code, no dependency and no lost ક્રમ.
 *
 * ક્રમ કદી તૂટે નહીં (§1 rule 2): the row knows its printed number and renders it, and the
 * list that renders these is never shuffled or filtered into a different order.
 */
function TickRow({ id, n, text, ticked, revealed, level, onToggle, onReveal }) {
  const showText = level === 3 || revealed;

  return (
    <li className={`tick-row${ticked ? ' is-on' : ''}`}>
      {/*
        The whole row is the label, so the tap target is the row and not a 26px box —
        §14 asks for controls a thumb can hit. The real <input> stays in the DOM and keeps
        its keyboard behaviour and accessible name; only its painting is replaced.
      */}
      <label className="tick-main">
        <span className="tick-n">{gu(n)}</span>

        <span className="tick-body">
          {showText ? (
            <span className="tick-text">{text}</span>
          ) : (
            /*
              લેવલ ૪ — ફક્ત નંબર. The વર્ણન is deliberately absent until asked for; this
              placeholder holds the row's shape so the list does not jump as answers are
              revealed one by one.
            */
            <span className="tick-blank" aria-hidden="true" />
          )}
        </span>

        <input
          type="checkbox"
          checked={ticked}
          onChange={() => onToggle(id)}
          aria-label={`દ્રશ્ય ${gu(n)}`}
        />
        <span className="tick-box" aria-hidden="true">{ticked ? '✓' : ''}</span>
      </label>

      {/*
        'જવાબ જુઓ' (§7) — and ticking stays available afterwards, with no mark, no smaller
        credit and no note that the answer was seen. §1 rule 4: the app never scores a
        યુવક down for needing help remembering. It disappears once revealed because it has
        nothing left to do, not as a penalty.
      */}
      {level === 4 && !revealed && (
        <button type="button" className="tick-reveal" onClick={() => onReveal(id)}>
          જવાબ જુઓ
        </button>
      )}
    </li>
  );
}

export default memo(TickRow);
