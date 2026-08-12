import { useId, useState } from 'react';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * ONE FIELD, USED BY BOTH AUTH PAGES (§2, §17, §18, §20)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * લોગિન and નોંધણી each used to build their own field markup. They drifted, as two copies
 * of the same idea do: નોંધણી grew a hint-or-error slot and લોગિન did not, so a Gujarati
 * message appearing on લોગિન pushed the button down under a thumb already moving, while
 * the same message on નોંધણી did not. Both pages now render THIS, so a change to how a
 * field looks or behaves is one change and cannot land on one page only.
 *
 * The layout contract, which is what stops the jumping:
 *
 *   label      one line, always present
 *   control    one height (--control-h), always the same, on every page
 *   message    ONE reserved slot holding the hint OR the error — never both, never
 *              nothing. Its height is reserved in CSS whether it is filled or not, so
 *              typing into a bad field and watching the error clear moves no pixel.
 *
 * Accessibility is not decoration here: the message slot is the field's
 * `aria-describedby` in both its states, so a screen reader announces the hint before the
 * યુવક types and the correction after he does, without a second live region.
 */

/**
 * The frame — label, control, message slot.
 *
 * `children` is the control itself rather than a set of props, so a field can hold an
 * <input>, a <select> or the password pair below without this component needing to know
 * which. What it guarantees is the geometry, and the geometry is the same for all three.
 */
export function Field({ id, label, hint, error, children }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {/*
        `role="status"` and not `role="alert"`: an alert interrupts a screen reader
        mid-word, which for a message that appears as he types is closer to shouting than
        to helping. The polite live region announces it when he pauses.
      */}
      <p className="field-msg" id={`${id}-msg`} role="status" aria-live="polite">
        {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
      </p>
    </div>
  );
}

/** A plain text field. Every extra prop lands on the <input>, including inputMode. */
export function TextField({ id, label, hint, error, ...props }) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        className={error ? 'bad' : ''}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={`${id}-msg`}
        {...props}
      />
    </Field>
  );
}

/** A <select>. Same frame, same height, same message slot as everything else. */
export function SelectField({ id, label, hint, error, children, ...props }) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <select
        id={id}
        className={error ? 'bad' : ''}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={`${id}-msg`}
        {...props}
      >
        {children}
      </select>
    </Field>
  );
}

const EyeIcon = ({ off }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
    <circle cx="12" cy="12" r="2.8" />
    {off && <path d="M4 20 20 4" />}
  </svg>
);

/**
 * A password field with a visibility toggle (§17).
 *
 * A yuvak typing a password on a phone keyboard cannot see what he typed, and the two
 * places that matters most are exactly these two pages: choosing a password he will need
 * again, and typing one that has just been rejected. Both are cases where "try again"
 * without being able to look is the whole problem.
 *
 * `tabIndex={-1}` keeps the toggle out of the tab order deliberately. Tabbing from the
 * password field must reach the submit button — that is the whole point of a form on a
 * phone keyboard, whose "go" key follows the same order — and a control that only reveals
 * text the યુવક just typed does not need to be tabbed to. It stays reachable by tap and by
 * screen reader, which is where it is actually used.
 *
 * The type flips between `password` and `text` rather than using `-webkit-text-security`,
 * because the latter silently does nothing on Firefox Android.
 */
export function PasswordField({ id, label, hint, error, ...props }) {
  const [show, setShow] = useState(false);
  // Unique per instance, so the two password fields that could one day sit on one page
  // cannot end up sharing a label association.
  const toggleId = useId();

  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <div className="input-wrap">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          className={error ? 'bad' : ''}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={`${id}-msg`}
          {...props}
        />
        <button
          id={toggleId}
          type="button"
          className="input-toggle"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'પાસવર્ડ છુપાવો' : 'પાસવર્ડ બતાવો'}
          aria-pressed={show}
          tabIndex={-1}
          disabled={props.disabled}
        >
          <EyeIcon off={show} />
        </button>
      </div>
    </Field>
  );
}
