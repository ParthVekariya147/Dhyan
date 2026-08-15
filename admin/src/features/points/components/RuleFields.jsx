import { POINT_MAX, POINT_MIN } from '../../../../../shared/domain/points.js';
import { StatusBadge } from '../../../components/StatCard';

/**
 * The controls every card on the Point Management page is built from.
 *
 * Extracted for the reason PointsCard extracted its own `PointField`: there are two dozen number
 * boxes on this page and one per લેવલ ૪ કસોટી, and two dozen copies of the same nine attributes
 * is where a `type="text"` or a missing `inputMode` eventually creeps into one of them.
 *
 * **No font-size, ever, on an input in this file.** admin.css gives every field 16px under
 * `pointer: coarse` for one reason: below that, iOS Safari zooms the page on focus and never
 * zooms back out, which leaves a સંચાલક stranded at 1.3x on a page full of numbers.
 */

/**
 * One number box, bounded and labelled.
 *
 * `value` is always a **string**, and an empty box stays an empty box. A number-typed state
 * forces a decision about what "" means on every keystroke, and the answer JavaScript gives -
 * `Number('')` is 0 - is a value these fields must not invent: 0 is a real, honoured value here
 * ("practised but worth nothing"), so coercing a half-typed box into it would silently save a
 * level as free.
 *
 * `blankMeans` is the one thing this box says beyond its own hint, and it earns the line: on the
 * fixed levels an empty box is an error, while on a per-activity price it means "use the
 * default". Those are opposite meanings for the same empty box, and a સંચાલક cannot be expected
 * to infer which from the column it is in.
 */
export function NumberField({
  id,
  label,
  /** For a box in a table cell, where the column heading is the label a sighted reader uses and
   *  a screen reader would otherwise announce an input with no name at all (§56). */
  ariaLabel,
  hint,
  value,
  onChange,
  disabled = false,
  min = POINT_MIN,
  max = POINT_MAX,
  placeholder,
  invalid = false,
  style,
  compact = false,
}) {
  return (
    <div className={`field${invalid ? ' is-invalid' : ''}`} style={style || (compact ? tightField : numField)}>
      {label && <label htmlFor={id}>{label}</label>}
      <input
        id={id}
        type="number"
        inputMode="numeric"
        /* `null` means "this field has no ceiling in SQL" - the rule version is the only one -
           and a max attribute invented for it would be a bound the panel enforces and the
           database does not, which is the one disagreement a rules screen may not have. */
        min={min ?? undefined}
        max={max ?? undefined}
        step={1}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={invalid ? 'true' : undefined}
        aria-describedby={hint ? `${id}-help` : undefined}
      />
      {hint && (
        <span className="hint" id={`${id}-help`}>
          {hint}
        </span>
      )}
    </div>
  );
}

/**
 * One on/off row, with the consequence of each state written beside it rather than implied.
 *
 * `.check` gives the row a tap-tall hit area, so the label and the box are one target big enough
 * for a thumb rather than a 16px square.
 */
export function OnOffField({ id, label, checked, onChange, disabled = false, onHint, offHint, style }) {
  return (
    <div className="field" style={style || checkField}>
      <label className="check" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          aria-describedby={onHint || offHint ? `${id}-help` : undefined}
        />
        {label}
      </label>
      {(onHint || offHint) && (
        <span className="hint" id={`${id}-help`}>
          {checked ? onHint : offHint}
        </span>
      )}
    </div>
  );
}

/**
 * A section of the rule set: a title, the state it is in as a word, and what it does.
 *
 * The badge is a word first and a colour second (§43) - the tone only repeats what the word
 * already says, so the state is still readable to somebody who cannot tell the tints apart.
 */
export function RuleCard({ title, badge, badgeTone = 'off', intro, children, id }) {
  return (
    <section className="card" id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <div style={cardHead}>
        <h2 id={id ? `${id}-title` : undefined} style={noMargin}>
          {title}
        </h2>
        {badge && <StatusBadge tone={badgeTone}>{badge}</StatusBadge>}
      </div>
      {intro && (
        <p className="card-note" style={cardIntro}>
          {intro}
        </p>
      )}
      {children}
    </section>
  );
}

/** The rule that refused, beside the field it refused. One line, `role="alert"`. */
export function RuleError({ children }) {
  if (!children) return null;
  return (
    <p className="field-error" role="alert" style={errorLine}>
      <span aria-hidden="true">⚠</span> {children}
    </p>
  );
}

/* ---------------------------------------------------------------------------
 * Layout constants — module scope, so a keystroke in a number box does not allocate a fresh
 * style object per field. Tokens only; admin.css owns every value and this file adds none.
 * ------------------------------------------------------------------------- */

/** Shrinkable, but never below a width where five digits and the spinner still fit. */
export const numField = { marginBottom: 'var(--sp-3)', flex: '0 1 190px' };

/** The in-table variant: no bottom margin, and as narrow as a price can honestly be. */
export const tightField = { marginBottom: 0, flex: '0 1 120px', minWidth: '96px' };

/**
 * The on/off row, and the one constant on this page that has to be allowed to shrink.
 *
 * It used to say `flex: '0 0 auto'`, which reads like "take the width you need" and actually
 * means "take the width you need and refuse to give any of it back". A flex item with a basis of
 * `auto` and no width sizes to its own max-content, and a shrink factor of 0 makes that a floor
 * as well as a starting point - so `OnOffField`, which puts a full sentence of `.hint` under the
 * checkbox, measured 553px inside a 332px card on a 390px phone and pushed the whole of /points
 * 193px sideways. At 320px it was 258px over. `controlRow` wrapping did not help and could not:
 * wrapping moves an item onto a line of its own, it does not make an unshrinkable item narrower.
 *
 * `0 1 auto` keeps the sizing - the row is still as wide as its content wants when there is room,
 * which is what stops a two-word switch stretching across a desktop card - and adds the one thing
 * that was missing, permission to shrink. `.field` in admin.css already declares `min-width: 0`,
 * so the shrinking is not floored at the hint's longest word either: the sentence simply wraps,
 * which is what a sentence is for.
 */
export const checkField = { marginBottom: 'var(--sp-3)', flex: '0 1 auto' };

/** A row of controls. `flex-wrap` with per-field bases is what makes this survive a 320px
 *  screen without a media query: fields drop to their own line in the order they are in.
 *
 *  The wrapping only ever solves half the problem, and it is worth saying which half. It decides
 *  how many fields share a line; it has nothing to say about how wide any one of them is. A field
 *  wider than the card on its own is still wider than the card once it is alone on its line, and
 *  the page overflows exactly as far as before - see `checkField` above for the version of that
 *  bug this file actually shipped. Every constant used in here therefore has a shrink factor of
 *  1, and none of them may go back to `0 0 auto` for a field that can hold a sentence. */
export const controlRow = { display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'flex-start' };

export const cardHead = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  flexWrap: 'wrap',
  marginBottom: 'var(--sp-2)',
};

export const noMargin = { marginBottom: 0 };

export const cardIntro = { marginTop: 0, marginBottom: 'var(--sp-4)' };

export const errorLine = { marginTop: 'var(--sp-3)' };
