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
}) {
  const reg = navRegistryEntry(item.key);
  // The registry's own word for this destination, used as the row's identity in the heading
  // and in every accessible name. Not `item.label`: that is the સંચાલક's wording and he is
  // in the middle of changing it, so an aria-label built from it would rename the button
  // that moves the row while he types into the row.
  const name = reg?.label || item.key;

  const locked = item.key === NAV_REQUIRED_KEY;
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
          The destination, as text. Never an input, and this is the one rule
          shared/domain/navigation.js is built around: a stored row may choose among
          destinations, it may never name one. `settings` is writable through PostgREST by
          anyone holding settings.update, so if a typed route were honoured, one request would
          put an arbitrary path - or an off-site URL - under a button 2,000 people press
          without reading. The resolver takes the route from the registry and ignores whatever
          the row carries, so a field here would not be dangerous so much as a lie: it would
          accept typing that changed nothing.
        */}
        <div className="field navcfg-f-route">
          <span className="navcfg-route-label">Goes to</span>
          <code className="navcfg-route">{item.route}</code>
          <span className="hint">Fixed by the app - it cannot be pointed somewhere else.</span>
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
    </li>
  );
}
