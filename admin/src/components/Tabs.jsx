import { useRef } from 'react';

/**
 * §54, §56 — one tab strip, for the pages that hold two lists of different people.
 *
 * The panel had no tab component at all until /users had to show યુવકો and સંચાલકો side by
 * side. Two lists, one section: they answer the same question ("who is in this system, and
 * what state is their account in") about two populations that since 0038 live in two
 * different tables, and splitting them into two sidebar entries would have put a section in
 * the menu that four of the five roles may not open.
 *
 * What this component is NOT: a router. It reports which tab was chosen and renders nothing
 * of its own beyond the strip — the page decides what that means, which for /users means
 * writing it into the query string so a refresh, the back button and a shared link all land
 * on the same tab. A component that owned the URL would have to know about react-router, and
 * every other future caller would inherit that whether it wanted it or not.
 *
 * ── Activation is manual, deliberately ──────────────────────────────────────
 *
 * WAI-ARIA allows either: automatic (an arrow key moves focus *and* selects) or manual (an
 * arrow key moves focus; Enter, Space or a click selects). Manual is right here because
 * selecting has consequences — it pushes a history entry and starts a database read — and
 * with automatic activation a keyboard user walking from one end of the strip to the other
 * would fire both for every tab he passed through. A <button> already activates on Enter and
 * Space without any handler of ours, so manual activation is one keydown handler that only
 * ever moves focus.
 *
 * ── Only the selected tab is in the focus order ─────────────────────────────
 *
 * `tabIndex` is 0 on the selected tab and -1 on the rest, which is what makes the whole strip
 * one Tab stop: Tab reaches the tab strip, the arrow keys move inside it, and Tab again
 * leaves it for the panel below. A strip where every tab is a separate Tab stop is the
 * failure this rule exists to prevent — the keyboard user pays one press per tab to get past
 * a control he was not using.
 *
 * Props
 * -----
 *   tabs      [{ id, label, hint? }] — `id` is what `value` and onChange speak in, and it is
 *             the same string the page puts in the URL. Callers filter this list by
 *             permission before passing it: a tab that must not exist must not be rendered
 *             at all, not rendered disabled (that still announces it).
 *   value     the selected `id`.
 *   onChange  (id) => void. Fired on click/Enter/Space, never on a bare arrow key.
 *   label     the accessible name of the strip itself, e.g. "User groups". Required —
 *             "tab list" with no name tells a screen reader nothing about what it switches.
 *   idBase    prefix for the generated element ids, so two strips on one page cannot collide.
 */
export default function Tabs({ tabs, value, onChange, label, idBase = 'tabs' }) {
  // One ref per tab button, so the arrow keys can move focus without the DOM being queried
  // by selector. Written on every render rather than kept in state: React re-runs the ref
  // callbacks when the list changes, and a stale node here would silently swallow a keypress.
  const refs = useRef([]);

  // The selected index, or 0 when `value` names a tab that is not on offer — which is a real
  // state, not a defensive one: the page falls back to the first tab when a URL asks for a
  // tab the role may not see, and this must agree with what it renders.
  const selected = Math.max(0, tabs.findIndex((t) => t.id === value));

  const focusAt = (i) => {
    const n = tabs.length;
    if (!n) return;
    // Wraps at both ends — Right on the last tab reaches the first — which is what the
    // pattern asks for and what a person trying it expects.
    refs.current[((i % n) + n) % n]?.focus();
  };

  /**
   * Arrow keys, Home and End. Left/Right rather than Up/Down because this strip is
   * horizontal; the panel is written left-to-right throughout, so no RTL mirroring is
   * attempted here — it would be a rule with nothing to apply it to and no way to test it.
   *
   * preventDefault only on the keys actually handled, so Tab, Shift+Tab and every shortcut
   * the browser owns still work inside the strip.
   */
  const onKeyDown = (e) => {
    const next =
      e.key === 'ArrowRight' ? selected + 1
      : e.key === 'ArrowLeft' ? selected - 1
      : e.key === 'Home' ? 0
      : e.key === 'End' ? tabs.length - 1
      : null;
    if (next === null) return;
    e.preventDefault();
    focusAt(next);
  };

  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t, i) => {
        const isSelected = i === selected;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={tabElementId(idBase, t.id)}
            className={`tab${isSelected ? ' is-selected' : ''}`}
            aria-selected={isSelected}
            aria-controls={panelElementId(idBase, t.id)}
            tabIndex={isSelected ? 0 : -1}
            ref={(el) => { refs.current[i] = el; }}
            onClick={() => !isSelected && onChange(t.id)}
          >
            {t.label}
            {/* A count or a short qualifier beside the word. Inside the button on purpose:
                it is part of what the tab is, so a screen reader should read it with the
                label rather than find it orphaned somewhere near it. */}
            {t.hint != null && <span className="tab-hint">{t.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The region a tab controls.
 *
 * Rendered by the page rather than by Tabs, because the page owns the content and passing
 * whole subtrees through a `tabs` array would mean every panel on the page is built on every
 * render regardless of which one is showing.
 *
 * The unselected panel is not rendered at all rather than hidden with CSS. Two reasons, and
 * the second is the one that matters: a hidden panel that is still mounted keeps its
 * subscriptions and its state, and here each panel owns a query — the સંચાલક list would keep
 * re-reading itself while the યુવક table is on screen. `hidden` on a mounted panel would also
 * leave its controls in the DOM for a screen reader's element list to find.
 *
 * `tabIndex={0}` because the panel holds no focusable content of its own in the shortest
 * case (an empty state is text): without it, Tab out of the strip skips straight past the
 * thing the strip just switched to.
 */
export function TabPanel({ idBase = 'tabs', id, children }) {
  return (
    <div
      role="tabpanel"
      id={panelElementId(idBase, id)}
      aria-labelledby={tabElementId(idBase, id)}
      className="tabpanel"
      tabIndex={0}
    >
      {children}
    </div>
  );
}

/* One spelling of each id, used by both halves — aria-controls and aria-labelledby have to
   point at elements that exist, and two independently assembled template strings are how
   that quietly stops being true. */
const tabElementId = (base, id) => `${base}-tab-${id}`;
const panelElementId = (base, id) => `${base}-panel-${id}`;
