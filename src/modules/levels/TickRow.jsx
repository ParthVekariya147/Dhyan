import { memo } from 'react';
import { gu } from '../../lib/scenes';

/**
 * One દ્રશ્ય in લેવલ ૩'s list — વર્ણન and a tick box, repeated N times.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * It used to serve લેવલ ૪ as well, and no longer does
 * ────────────────────────────────────────────────────────────────────────────
 *
 * લેવલ ૪ was once this same row with the વર્ણન hidden behind a 'જવાબ જુઓ' button. It is now
 * a container of સંચાલક-configured કસોટીઓ, and its test screen shows the index number and a
 * checkbox and nothing else — no વર્ણન, revealed or otherwise (§12, §13). That screen
 * therefore has its own row in src/modules/level4/ActivityTestPage.jsx, which takes no prop
 * that could carry an answer, rather than this one with its text prop left undefined. The
 * absence is the point of that screen, and a prop that *could* be passed is how it would
 * quietly come back.
 *
 * So `revealed`, `onReveal` and `level` are gone from here along with the reveal button.
 * What that page kept is this file's `.tick-row` classes, so the `content-visibility` work
 * in levels.css serves both lists.
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
 * That is why the callback arrives as a stable prop (`onToggle(id)`) rather than as an
 * inline arrow: an arrow rebuilt on the parent's render is a new prop, and memo would
 * compare false on every row and buy nothing.
 *
 * **Not virtualised, deliberately.** ~109 rows of text and a checkbox is a smaller DOM
 * than the દર્શન feed already ships, and a windowing library would cost a dependency
 * (forbidden here) and break the browser's own find-in-page. The mobile answer is
 * `content-visibility: auto` in levels.css instead: the browser skips layout and paint for
 * rows outside the viewport and un-skips them on scroll, which is virtualisation done by
 * the engine, with no code, no dependency and no lost ક્રમ.
 *
 * ક્રમ કદી તૂટે નહીં (§1 rule 2): the row knows its number and renders it, and the list that
 * renders these is never shuffled or filtered into a different order.
 *
 * `n` is the **display** number — useScenes()'s `displayIndex`, a continuous ૧…N over the
 * દ્રશ્યો that survive both gates (ORDERING.md §4), not the number printed inside the
 * artwork. The row does not know the difference and must not: it is handed one number and
 * prints it, in Gujarati numerals, in both places a યુવક can read it — the badge and the
 * checkbox's accessible name, which is the one that would otherwise quietly stay in Latin
 * digits and read a different sequence to a screen reader than the screen shows.
 */
function TickRow({ id, n, text, ticked, onToggle }) {
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
          <span className="tick-text">{text}</span>
        </span>

        <input
          type="checkbox"
          checked={ticked}
          onChange={() => onToggle(id)}
          aria-label={`દ્રશ્ય ${gu(n)}`}
        />
        <span className="tick-box" aria-hidden="true">{ticked ? '✓' : ''}</span>
      </label>
    </li>
  );
}

export default memo(TickRow);
