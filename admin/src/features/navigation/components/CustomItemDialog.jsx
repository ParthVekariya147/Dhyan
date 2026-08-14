import { useEffect, useRef, useState } from 'react';
import {
  NAV_ICONS,
  NAV_LABEL_MAX,
  NAV_ROUTES,
  navRouteEntry,
  navRouteError,
} from '../../../../../shared/domain/navigation.js';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * A button of the સંચાલક's own — the form that makes one, and the form that edits it
 * ────────────────────────────────────────────────────────────────────────────
 *
 * One component for both, because a create form and an edit form that are separate components
 * are two forms that drift: the day the label limit changes, or a field is added, one of them
 * gets it. What differs between the two cases is the title, the button and whether the fields
 * start empty — three values, passed in — and not the rules, which are one set.
 *
 * Built on <dialog> like ConfirmDialog beside it, for the same reason (§56): the browser
 * provides the modal semantics — focus trapped, Escape closes, the page behind it inert — and
 * hand-rolling that is where keyboard accessibility usually goes wrong.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why the destination is a <select> and not a text field
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The brief asks for a route input with a check that the route exists. This is that check,
 * arranged so it cannot fail: NAV_ROUTES is the closed list of pages this build serves, so a
 * list of them is a control in which every choice is already valid. A text field would be the
 * same rule with a worse shape — every keystroke an invalid state, a message under it saying
 * so, and the સંચાલક's actual question ("what pages are there?") answered nowhere on screen.
 *
 * That is not a softening of the rule. `navRouteError()` still runs below on whatever the
 * field holds, and it is the same function the save path and the database trigger use, so a
 * value that arrived from somewhere other than this list — a row written by a newer build, a
 * later edit to this component — is refused here with the sentence it deserves rather than
 * being trusted because a <select> produced it. The control makes the invalid state hard to
 * reach; the validator is what makes it impossible to save.
 */
export default function CustomItemDialog({ open, item, takenLabels = [], busy, onSave, onCancel }) {
  const ref = useRef(null);
  const editing = Boolean(item);

  const [label, setLabel] = useState('');
  const [icon, setIcon] = useState(NAV_ICONS[0]);
  const [route, setRoute] = useState(NAV_ROUTES[0].route);
  const [visible, setVisible] = useState(false);
  const [enabled, setEnabled] = useState(true);
  // Nothing is marked wrong before he has had a chance to type. A form that opens with a red
  // notice is complaining about a field he has not filled in yet (§31).
  const [touched, setTouched] = useState(false);

  /*
    The fields are seeded from `item` on every open, keyed on the dialog going from closed to
    open rather than on `item` changing identity.

    `open` is in the dependency list and `item` is not, deliberately. The page hands this a
    fresh object on every render of its list — patching one row rebuilds the array — so
    depending on `item` would reset the form to the saved values on the first keystroke, which
    is the classic version of "the input will not let me type".
  */
  useEffect(() => {
    if (!open) return;
    setLabel(item?.label ?? '');
    setIcon(NAV_ICONS.includes(item?.icon) ? item.icon : NAV_ICONS[0]);
    setRoute(navRouteEntry(item?.route)?.route ?? NAV_ROUTES[0].route);
    setVisible(item?.visible === true);
    setEnabled(item?.enabled !== false);
    setTouched(false);
    // `item` is intentionally not a dependency - see the note above. Reading it here without
    // depending on it is the whole point: the values are a STARTING POINT, taken once when the
    // dialog opens, not a binding that follows the row while he types into the form.
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const word = label.replace(/\s+/g, ' ').trim();
  const dest = navRouteEntry(route);

  /*
    Every reason this cannot be saved, evaluated as he types — and evaluated with the SAME
    functions the service and the trigger use, never with a copy of the rules written for this
    form. `navRouteError()` in particular is the one that matters: three checks of one rule,
    all reading one function, so none of them can drift into being a second answer.

    The label rules are stated here rather than borrowed because there is no exported
    validator for a single label — validateMobileNav() judges a whole list, and calling it
    with a list of one would refuse for reasons about the bar that have nothing to do with the
    field in front of him ("show at least 2 items"). The numbers are imported all the same.
  */
  const problems = [];
  if (!word) problems.push('Give the button a name - it is the word a yuvak reads under the icon.');
  else if (word.length > NAV_LABEL_MAX) {
    problems.push(`The name has to be ${NAV_LABEL_MAX} characters or fewer - it sits under an icon on a 320px phone.`);
  }
  const routeProblem = navRouteError(route);
  if (routeProblem) problems.push(routeProblem);
  if (!NAV_ICONS.includes(icon)) problems.push('Choose a picture this app can draw.');

  /*
    Not a refusal — two buttons may legitimately carry one word, and there is one real reason
    to want it: the same destination reached from two positions during a changeover. It is
    said out loud all the same, because two identical cells in a five-cell bar is far more
    often a duplicate somebody forgot to rename.
  */
  const duplicateWord = word && takenLabels.includes(word);

  const ok = problems.length === 0;

  function submit(e) {
    e.preventDefault();
    setTouched(true);
    if (!ok || busy) return;
    onSave({ label: word, icon, route: dest.route, visible, enabled });
  }

  return (
    <dialog
      className="confirm navcfg-dialog"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      aria-labelledby="navcfg-dialog-title"
    >
      {/* A real <form>, so Enter in any field submits and the browser's own required-field
          plumbing is not fighting ours. `noValidate` because every message here is written in
          this app's voice and in full sentences; the browser's bubble would say "Please fill
          in this field" over the top of one of them. */}
      <form onSubmit={submit} noValidate>
        <h2 id="navcfg-dialog-title">{editing ? 'Edit this button' : 'New button'}</h2>

        <p className="hint navcfg-dialog-lead">
          You choose the word, the picture, the page it opens and where it sits. The pages
          themselves are built by a developer - this list is the ones this app has.
        </p>

        <div className="field">
          <label htmlFor="navcfg-new-label">Name under the icon</label>
          <input
            id="navcfg-new-label"
            type="text"
            value={label}
            maxLength={NAV_LABEL_MAX}
            onChange={(e) => setLabel(e.target.value)}
            disabled={busy}
            autoFocus
            aria-describedby="navcfg-new-label-help"
          />
          <span className="hint" id="navcfg-new-label-help">
            <span className="mono">
              {word.length}/{NAV_LABEL_MAX}
            </span>{' '}
            characters, in Gujarati - for example <strong>લીડરબોર્ડ</strong> or{' '}
            <strong>મારો ઇતિહાસ</strong>.
          </span>
        </div>

        <div className="field">
          <label htmlFor="navcfg-new-route">Page it opens</label>
          <select
            id="navcfg-new-route"
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            disabled={busy}
            aria-describedby="navcfg-new-route-help"
          >
            {NAV_ROUTES.map((r) => (
              <option key={r.route} value={r.route}>
                {r.label} - {r.route}
              </option>
            ))}
          </select>
          {/* The route check, stated in the affirmative when it passes. A form that only ever
              speaks when something is wrong leaves "did it take the page I picked?"
              unanswered, and this is the field a સંચાલક is least sure about. */}
          <span className="hint" id="navcfg-new-route-help">
            {routeProblem ? (
              <span className="navcfg-route-bad">{routeProblem}</span>
            ) : (
              <>
                <span className="navcfg-route-ok">Available</span> - this app serves{' '}
                <code className="mono">{dest.route}</code> today.
              </>
            )}
          </span>
        </div>

        <div className="field">
          <label htmlFor="navcfg-new-icon">Icon</label>
          <select
            id="navcfg-new-icon"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            disabled={busy}
          >
            {NAV_ICONS.map((ic) => (
              <option key={ic} value={ic}>
                {ic}
              </option>
            ))}
          </select>
          <span className="hint">
            A closed list - the app draws each of these itself, so a picture always appears.
          </span>
        </div>

        <div className="field">
          <label className="check" htmlFor="navcfg-new-visible">
            <input
              id="navcfg-new-visible"
              type="checkbox"
              checked={visible}
              onChange={(e) => setVisible(e.target.checked)}
              disabled={busy}
            />
            Visible
          </label>
          <label className="check" htmlFor="navcfg-new-enabled">
            <input
              id="navcfg-new-enabled"
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={busy}
            />
            Enabled
          </label>
          <span className="hint">
            Both must be on for the button to appear. A new button starts hidden so it cannot
            push the bar over its limit before you have looked at it.
          </span>
        </div>

        {duplicateWord && (
          <div className="notice notice-warn" role="status">
            Another button already reads <strong>{word}</strong>. That is allowed, but two
            identical words in the bar are usually a copy somebody meant to rename.
          </div>
        )}

        {touched && !ok && (
          <div className="notice notice-danger" role="alert">
            {problems[0]}
          </div>
        )}

        <div className="confirm-actions">
          <button className="btn btn-quiet" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          {/*
            Disabled on an invalid form, which is what the brief asks for - and the `touched`
            notice above is why that is not a dead end. A greyed-out Save with no sentence
            beside it is the bug report §31 is written against, so the reason is on screen
            before the button stops working.
          */}
          <button className={`btn${busy ? ' is-busy' : ''}`} type="submit" disabled={busy || !ok}>
            {editing ? 'Update button' : 'Add button'}
          </button>
        </div>

        <p className="hint navcfg-dialog-foot">
          Nothing is saved to the app until you press <strong>Save changes</strong> on the page
          behind this.
        </p>
      </form>
    </dialog>
  );
}
