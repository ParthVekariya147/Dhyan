import {
  NAV_ICONS,
  NAV_LABEL_MAX,
  NAV_REQUIRED_KEY,
  navRegistryEntry,
} from '../../../../../shared/domain/navigation.js';
import { StatusBadge } from '../../../components/StatCard';

/**
 * One item of the bottom bar, as a row he can move, rename, re-icon and switch off.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Two ways to move a row, and both of them are the point
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The handle at the left starts an HTML5 drag; the ↑ and ↓ buttons at the right move the row
 * one place. They are not a fallback and a primary — they are the same operation reached by
 * the two input devices this panel actually meets, and both call the page's `move()`, which
 * calls the shared `reorder()`. The failure that argues for it is small and permanent:
 * dragging is unreachable from a keyboard, and on a touch screen the browser claims the
 * gesture for scrolling long before an element sees `dragstart` — so a phone or a tablet, on
 * which this panel is explicitly expected to work at 320px, would have had a reorder screen
 * whose only control could not be operated.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why the handle is draggable and the row is not
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `draggable` on the <li> is the shorter version and it breaks the row's own inputs: inside a
 * draggable ancestor a browser treats a press-and-move over a text field as the start of a
 * drag rather than as a selection, so the સંચાલક could no longer select the label he was
 * trying to edit. Making only the handle the drag *source* leaves every control in the row
 * behaving like a control; the <li> stays the drop *target*, which is what makes the whole
 * row a place you can let go of something.
 */
export default function NavItemRow({
  item,
  index,
  total,
  mayEdit,
  busy,
  isDragging,
  isOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMove,
  onPatch,
  onEdit,
  onDuplicate,
  onDelete,
}) {
  const reg = navRegistryEntry(item.key);
  const custom = item.isCustom === true;
  /*
    The word this row is called by, in its heading and in every accessible name.

    For a built-in it is the REGISTRY's, not `item.label`: that is the સંચાલક's wording and he
    may be in the middle of changing it, so an aria-label built from it would rename the button
    that moves the row while he types into the row.

    A custom item has no registry word, so its own label is the only name it has — and the
    renaming-while-typing problem is real there too. It is accepted rather than solved: the
    alternative is naming the row by its key, and "Move custom:btn-3 up" is a worse accessible
    name than one that briefly lags a keystroke.
  */
  const name = reg?.label || String(item.label || '').trim() || item.key;

  // Only a registry key can be the required one. A custom button pointing at `/` does not
  // become the way home - see the §8 note in nav_config_error() (0028) for why that is the
  // guarantee rather than an omission.
  const locked = !custom && item.key === NAV_REQUIRED_KEY;
  const notReady = !item.ready;
  // One switch for both checkboxes, because both of them are ways of taking a destination off
  // the screen and the two reasons for refusing that are the two below.
  const switchesDisabled = !mayEdit || busy || locked || notReady;

  const labelLen = String(item.label || '').trim().length;
  const inBar = item.visible && item.enabled;

  return (
    <li
      className={`navcfg-row${isDragging ? ' is-dragging' : ''}${isOver ? ' is-over' : ''}${
        inBar ? '' : ' is-off'
      }`}
      onDragOver={(e) => onDragOver(index, e)}
      onDrop={(e) => onDrop(index, e)}
      onDragEnd={onDragEnd}
      aria-label={`Position ${index + 1} of ${total}: ${name}`}
    >
      <div className="navcfg-rowhead">
        {/*
          The drag source. `aria-hidden` with no tab stop is correct here rather than lazy:
          a focusable handle would put a control in the tab order that a keyboard cannot
          operate at all, which is worse than no control — the ↑/↓ buttons below are the
          keyboard's way to do this, and they carry real accessible names.
        */}
        <span
          className="navcfg-handle"
          draggable={mayEdit && !busy}
          onDragStart={(e) => onDragStart(index, e)}
          title="Drag to reorder"
          aria-hidden="true"
        >
          ⠿
        </span>

        <span className="navcfg-pos mono" aria-hidden="true">
          {index + 1}
        </span>

        <span className="navcfg-name">
          <strong>{name}</strong>
          {/* The key, because it is what the audit trail names and what survives a rename of
              the label - so it is the string to quote when asking why a bar changed. */}
          <span className="navcfg-key mono">{item.key}</span>
        </span>

        {/* Which kind of item this is, said in a word rather than left to be inferred from
            which controls the row happens to have. It is the answer to "why can I delete that
            one and not this one", and a સંચાલક should not have to work that out by trying. */}
        <StatusBadge tone={custom ? 'info' : 'off'}>{custom ? 'Custom' : 'Built-in'}</StatusBadge>

        <StatusBadge tone={notReady ? 'off' : inBar ? 'ok' : 'warn'}>
          {notReady ? 'Not built yet' : inBar ? 'In the bar' : 'Hidden'}
        </StatusBadge>

        {/*
          The keyboard's half of the reordering. Disabled at the ends rather than wrapping:
          a list where ↑ on the first row sends it to the bottom is a list that reorders
          itself when somebody holds a key down.
        */}
        <span className="navcfg-move-group">
          <button
            className="icon-btn navcfg-move"
            type="button"
            onClick={() => onMove(index, index - 1)}
            disabled={!mayEdit || busy || index === 0}
            aria-label={`Move ${name} up`}
          >
            <span aria-hidden="true">↑</span>
          </button>
          <button
            className="icon-btn navcfg-move"
            type="button"
            onClick={() => onMove(index, index + 1)}
            disabled={!mayEdit || busy || index === total - 1}
            aria-label={`Move ${name} down`}
          >
            <span aria-hidden="true">↓</span>
          </button>
        </span>
      </div>

      {/*
        The two reasons a row's switches will not move, stated on the row rather than only
        thrown back at him after a refused save. A checkbox that is greyed out with no
        sentence beside it is a bug report waiting to be filed.
      */}
      {notReady && (
        <p className="hint navcfg-why">
          This page does not exist in the app yet, so it cannot be put in the bar - a button
          that navigates nowhere is worse than a missing one. It is listed here so you can see
          it coming. Points and the leaderboard are a separate piece of work and switching
          this on belongs to it.
        </p>
      )}
      {locked && (
        <p className="hint navcfg-why">
          This is the way back from every other page - on a phone there is no sidebar and no
          browser chrome behind it - so it cannot be hidden or switched off. Its name, icon
          and position are yours.
        </p>
      )}

      <div className="navcfg-controls">
        <div className="field navcfg-f-icon">
          <label htmlFor={`nav-icon-${item.key}`}>Icon</label>
          {/*
            A closed list, and a <select> is how that is said in a form. The domain file is
            blunt about the alternative: a typed icon name becomes a component lookup or a
            URL, which is markup injection with extra steps. The names describe the drawing
            and not the destination on purpose, so a different picture on a button does not
            mean a different button.
          */}
          <select
            id={`nav-icon-${item.key}`}
            value={item.icon}
            onChange={(e) => onPatch(item.key, 'icon', e.target.value)}
            disabled={!mayEdit || busy}
          >
            {NAV_ICONS.map((ic) => (
              <option key={ic} value={ic}>
                {ic}
              </option>
            ))}
          </select>
        </div>

        <div className="field navcfg-f-label">
          <label htmlFor={`nav-label-${item.key}`}>Name under the icon</label>
          <input
            id={`nav-label-${item.key}`}
            type="text"
            value={item.label}
            maxLength={NAV_LABEL_MAX}
            onChange={(e) => onPatch(item.key, 'label', e.target.value)}
            disabled={!mayEdit || busy}
            aria-describedby={`nav-label-help-${item.key}`}
            placeholder={reg?.label || ''}
          />
          <span className="hint" id={`nav-label-help-${item.key}`}>
            {/* The counter is the limit made visible rather than announced only on refusal:
                maxLength has already stopped the typing, and a keyboard that stops with no
                explanation reads as a broken field. Same pattern as the Settings page's
                ticked-row word. */}
            <span className="mono">
              {labelLen}/{NAV_LABEL_MAX}
            </span>{' '}
            characters, in Gujarati - it sits under the icon on a 320px phone. Leave it empty
            to fall back to <strong>{reg?.label}</strong>.
          </span>
        </div>

        {/*
          The destination, as text on every row and as an input on none.

          On a BUILT-IN it is fixed outright: the key names the destination, and the resolver
          takes the route from NAV_REGISTRY while ignoring whatever the row carries - so a
          field here would not be dangerous so much as a lie, accepting typing that changed
          nothing. The way to point a button somewhere else is to make a custom one.

          On a CUSTOM item it is chosen, but chosen in the dialog and from a list: NAV_ROUTES
          is closed, and a control in which every choice is already valid is the shape of "the
          route must exist" that cannot be typed around. `settings` is writable through
          PostgREST by anyone holding settings.update, so a free-text destination anywhere in
          this panel would be a promise the panel cannot keep - what keeps it is that both the
          resolver and the trigger look the value up rather than honouring it.
        */}
        <div className="field navcfg-f-route">
          <span className="navcfg-route-label">Goes to</span>
          <code className="navcfg-route">{item.route}</code>
          <span className="hint">
            {custom
              ? 'Chosen from the pages this app has - change it with Edit.'
              : 'Fixed by the app - it cannot be pointed somewhere else.'}
          </span>
        </div>

        <div className="field navcfg-f-switch">
          <label className="check" htmlFor={`nav-vis-${item.key}`}>
            <input
              id={`nav-vis-${item.key}`}
              type="checkbox"
              checked={item.visible}
              onChange={(e) => onPatch(item.key, 'visible', e.target.checked)}
              disabled={switchesDisabled}
            />
            Visible
          </label>
          <label className="check" htmlFor={`nav-en-${item.key}`}>
            <input
              id={`nav-en-${item.key}`}
              type="checkbox"
              checked={item.enabled}
              onChange={(e) => onPatch(item.key, 'enabled', e.target.checked)}
              disabled={switchesDisabled}
            />
            Enabled
          </label>
          {/* Two switches and one outcome, so the difference is said once, here. Both have
              to be on for a button to exist; either one off keeps the row in the list with
              its name, icon and position remembered for the day it goes back. */}
          <span className="hint">Both must be on for the button to appear.</span>
        </div>
      </div>

      {/*
        ────────────────────────────────────────────────────────────────────────
        What can be done to the row as a whole - and only on a custom one
        ────────────────────────────────────────────────────────────────────────

        Edit, Duplicate and Delete exist for custom items and for no built-in, and the reason
        is not symmetry for its own sake:

          * Edit changes the DESTINATION, which a built-in has no version of - its key is its
            destination. Its word, picture and position are already editable in the row above.
          * Duplicate is offered on both, and is on the page rather than here (see
            NavigationPage) precisely because copying a BUILT-IN is the useful half: "the same
            page, under a second word, further along the bar" is a thing only a custom item
            can express.
          * Delete is refused on a built-in because deleting one would not remove a page, it
            would remove the panel's only way of ever showing that page again - the item would
            come back on the next load as a switched-off row, so the button would appear to do
            nothing. Hiding is what a built-in has instead, and it is the same outcome with a
            memory of the name and position.
      */}
      {custom && (
        <div className="navcfg-actions">
          <button
            className="btn btn-quiet btn-sm"
            type="button"
            onClick={() => onEdit(item.key)}
            disabled={!mayEdit || busy}
          >
            Edit
          </button>
          <button
            className="btn btn-quiet btn-sm"
            type="button"
            onClick={() => onDuplicate(item.key)}
            disabled={!mayEdit || busy}
          >
            Duplicate
          </button>
          {/* Danger styling and a confirmation behind it (§57), because this is the one
              control on the page that destroys something rather than switching it off. What
              it destroys is the configuration and nothing else: the page it opened is a file
              in src/pages and is untouched by any of this. */}
          <button
            className="btn btn-danger btn-sm"
            type="button"
            onClick={() => onDelete(item.key)}
            disabled={!mayEdit || busy}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}
