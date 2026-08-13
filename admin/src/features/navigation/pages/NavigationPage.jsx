import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { useAdminAuth } from '../../../lib/adminAuth';
import { getMobileNav, updateMobileNav } from '../services/navigationService';
import { AsyncBlock, FormSkeleton } from '../../../components/StateBlocks';
import { PageHeader, StatusBadge } from '../../../components/StatCard';
import ConfirmDialog from '../../../components/ConfirmDialog';
import NavItemRow from '../components/NavItemRow';
import MobilePreview from '../components/MobilePreview';
import {
  DEFAULT_MOBILE_NAV,
  MOBILE_NAV_MAX,
  MOBILE_NAV_MIN,
  navRegistryEntry,
  reorder,
  toStoredMobileNav,
  validateMobileNav,
} from '../../../../../shared/domain/navigation.js';
import { saveError } from '../../../lib/errors';
import '../navigation.css';

/**
 * §9 — what stands at the bottom of a યુવક's phone, and in what order.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this is a page and not three fields on the Settings screen
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The four buttons on the bar are the whole app as far as a યુવક is concerned: what he can
 * reach in one thumb-press is what the app *is*. Editing that is not filling in a field, it
 * is arranging a list — nine rows, each with an order, a word, a picture and two switches,
 * with rules about how many may be shown at once and one row that may never be switched off.
 * That does not fit under a Save button shared with the maintenance message, and it needs a
 * preview, which nothing else on the Settings page does.
 *
 * It writes `settings/nav`, its own row beside `app`, `levels` and `journey` —
 * shared/domain/navigation.js explains at length why a list does not belong in the row four
 * yuvak hooks patch.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * On the permission (§35)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The route is gated on `settings.read`, like Levels, Video and Settings, and for the reason
 * AdminShell's NAV table gives: the permission a section names is the one governing the data
 * it *reads*, because that is what decides whether the page can say anything true. Saving
 * needs `settings.update`, which SUPER_ADMIN and ADMIN hold and CONTENT_MANAGER, COORDINATOR
 * and VIEWER do not. The check that matters is the RLS policy on `settings` (0004_rbac.sql)
 * and the trigger in 0019; this page is only where both become visible.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this page cannot do
 * ────────────────────────────────────────────────────────────────────────────
 *
 * It cannot invent a destination, and that is the single rule the whole domain file is built
 * around: a row may choose among the registry's routes, never name one, so `Goes to` is text
 * on every row and an input on none. It cannot add a destination either — the nine below are
 * the nine the app has routes for, and a tenth arrives by shipping a route and a registry
 * entry together, not by typing into a panel. And it cannot switch on ક્રમાંક or સેટિંગ:
 * those two have no route in this build, the validator refuses them, the trigger refuses
 * them, and the leaderboard is a separate piece of work in any case.
 */
export default function NavigationPage() {
  const state = useAsync(() => getMobileNav(), []);
  const { can } = useAdminAuth();

  /**
   * Disabled, not hidden — the pattern every settings screen in this panel uses. A VIEWER
   * reaches this page and is entitled to read which four buttons a યુવક has; hiding the
   * controls would answer "why is દર્શન not on the bar?" with a blank screen. What he must
   * not be offered is a Save the policy will refuse after he has dragged nine rows around.
   */
  const mayEdit = can('settings.update');

  const [items, setItems] = useState([]);
  /*
    The saved shape of the list, as the string that would have been written for it.

    Compared against the same projection of the working list, so "dirty" means *the row would
    change* rather than "something was touched". Dragging a row down and back is not an edit,
    and neither is typing a character and deleting it — but both leave a `touched` flag set
    for ever, and a Save that is enabled after a no-op writes a settings row and files a
    SETTINGS_UPDATED for a change nobody made (§41).
  */
  const [baseline, setBaseline] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState('');
  // Nothing is marked wrong until something has been changed. A page that opens with a red
  // notice is complaining about the stored configuration, which the સંચાલક did not just do
  // (§31) — and the stored one is by definition one the resolver accepted.
  const [touched, setTouched] = useState(false);
  // 'save' | 'restore' | null. One dialog, two questions: ConfirmDialog labels itself with a
  // fixed element id, so two of them mounted at once would put a duplicate id in the
  // document and the second dialog's accessible name would be whichever the browser found
  // first.
  const [confirm, setConfirm] = useState(null);
  // What the ↑/↓ buttons announce. A visual reorder is invisible to a screen reader: the row
  // moves, focus stays on the button that moved it, and nothing is spoken — so the keyboard
  // path would be operable and still unusable.
  const [announce, setAnnounce] = useState('');

  useEffect(() => {
    if (!state.data) return;
    setItems(state.data.map((i) => ({ ...i })));
    setBaseline(JSON.stringify(toStoredMobileNav(state.data)));
    setTouched(false);
    setErr('');
    setAnnounce('');
  }, [state.data]);

  const patch = (key, field, value) => {
    // A "Saved." that survives the next keystroke is a lie about the form in front of him.
    setMsg(null);
    setErr('');
    setTouched(true);
    setItems((list) => list.map((i) => (i.key === key ? { ...i, [field]: value } : i)));
  };

  /**
   * ────────────────────────────────────────────────────────────────────────────
   * The one move function, called by the mouse and by the keyboard
   * ────────────────────────────────────────────────────────────────────────────
   *
   * Both paths end here, and this ends at the shared `reorder()`. That is not tidiness: the
   * domain file documents the bug it holds — splicing the item out before computing the
   * destination shifts every index after the source, so a downward move lands one row short —
   * and a bug you fix twice, once for the drag and once for the arrows, is a bug that comes
   * back on whichever path was not being looked at. It is also tested without a browser in
   * scripts/test-navigation.mjs, which nothing here could be.
   *
   * `sortOrder` is deliberately not recomputed. Array position is the truth from the moment
   * he starts dragging, and toStoredMobileNav() renumbers 1..n from it on the way out — which
   * is the one place array position is allowed to decide an order, exactly as the domain file
   * says. Renumbering here as well would be a second answer to that question.
   */
  const move = (from, to) => {
    if (to < 0 || to >= items.length || from === to) return;
    setMsg(null);
    setErr('');
    setTouched(true);
    setItems((list) => reorder(list, from, to));
    const name = navRegistryEntry(items[from]?.key)?.label || items[from]?.key || '';
    setAnnounce(`${name} moved to position ${to + 1} of ${items.length}.`);
  };

  /*
    ────────────────────────────────────────────────────────────────────────────
    Drag and drop, on the platform's own API
    ────────────────────────────────────────────────────────────────────────────

    Native HTML5 drag-and-drop rather than dnd-kit or react-beautiful-dnd. This project's
    dependency list is React, react-router and supabase-js, and the panel is code-split so
    hard that verify-admin-separation.mjs asserts the entry chunk stays under 60 KB — a
    drag library for one screen of nine rows would be the largest thing in the panel that is
    not the SDK, downloaded by everyone who opens this page to do something the browser has
    shipped since 2011.

    The source index is held in a ref as well as in dataTransfer. dataTransfer is the correct
    channel and is read on drop as the fallback, but its payload is only readable inside a
    real drop event and it is a string; the ref is what makes the drag survive a re-render of
    the list, which happens on every dragover because `overIndex` is state.

    `setData` is called even though the ref makes it redundant: Firefox refuses to start a
    drag at all unless the dragstart handler sets something, so without it the handle would
    simply not drag in one of the two browsers a સંચાલક is likely to have.
  */
  const dragFrom = useRef(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  const onDragStart = (index, e) => {
    dragFrom.current = index;
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const onDragOver = (index, e) => {
    // Without preventDefault the element is not a drop target at all — the browser's default
    // for dragover is "you cannot drop here", so the drop event never fires and the row
    // springs back with no explanation.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overIndex !== index) setOverIndex(index);
  };

  const onDrop = (index, e) => {
    e.preventDefault();
    const raw = dragFrom.current;
    const from = Number.isInteger(raw) ? raw : Number(e.dataTransfer.getData('text/plain'));
    clearDrag();
    if (Number.isInteger(from)) move(from, index);
  };

  const clearDrag = () => {
    dragFrom.current = null;
    setDragIndex(null);
    setOverIndex(null);
  };

  /*
    The same shared rule the save runs, evaluated as he edits so the message arrives with the
    change that caused it — and evaluated on `toStoredMobileNav(items)` rather than on `items`
    themselves, because that is the list that would actually be written: it renumbers, trims
    the labels and substitutes the registry's values for anything unusable. Checking the
    working copy instead would refuse things the save would have accepted.

    Display only. save() validates again and is the authority, and the database trigger (0019)
    is the guarantee. Three checks of one rule, all reading the same function, so none of them
    can drift into being a second answer.
  */
  const draft = items.length ? toStoredMobileNav(items) : [];
  const check = items.length ? validateMobileNav(draft) : { ok: true };
  const liveError = err || (touched && !check.ok ? check.gu : '');

  const dirty = items.length > 0 && JSON.stringify(draft) !== baseline;
  const shown = items.filter((i) => i.visible && i.enabled);

  /** The bar he is about to save, read back as words. The preview draws it; this is the same
   *  fact in a form that survives being read out loud. */
  const barOrder = shown.map((i) => i.label).join(' - ');

  async function save() {
    /*
      Validated before anything is written, with the shared rule and not a check of this
      page's own. A list this panel accepted and resolveMobileNavConfig() then replaced
      wholesale with the defaults would leave the સંચાલક looking at his arrangement here
      while every યુવક had the built-in four — the two-answers-to-one-question fault the
      domain file exists to prevent. The service validates once more and the trigger refuses
      independently of both.
    */
    const v = validateMobileNav(toStoredMobileNav(items));
    if (!v.ok) {
      setErr(v.gu);
      setTouched(true);
      setConfirm(null);
      return;
    }
    setErr('');
    setBusy(true);
    try {
      await updateMobileNav(items);
      // Audited by the `audit_settings` trigger (0004_rbac.sql), not from here — and as one
      // entry, because this is one write.
      setMsg({ tone: 'ok', text: 'Saved - this is the bar every user has now.' });
      state.retry();
    } catch (e) {
      /*
        §31 — a failed save leaves the arrangement exactly where it is and offers the same
        button again. Nothing is reset and nothing is retried on its own: this reaches 2,000
        phones and is not something to repeat without being asked.

        `navInvalid` is the service's own refusal, which already carries the domain's
        sentence naming the rule and the number. Everything else goes through saveError(),
        which is what surfaces the database trigger's version of those same sentences.
      */
      setMsg({ tone: 'danger', text: e?.navInvalid ? e.message : saveError(e) });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  /**
   * Restore Default — the built-in four, written straight to the row.
   *
   * DEFAULT_MOBILE_NAV is the same list in three roles by design: what an unconfigured
   * project gets, what the resolver falls back to when the row is damaged, and what this
   * button writes. Writing it rather than only loading it into the form is the point: what he
   * wants at this moment is for the app to be back to the built-in bar, and a form that
   * quietly filled itself in and waited for a second press would leave the old configuration
   * live for as long as it took him to notice.
   */
  async function restore() {
    setErr('');
    setBusy(true);
    try {
      await updateMobileNav(DEFAULT_MOBILE_NAV);
      setMsg({ tone: 'ok', text: 'Restored - users now have the built-in four buttons.' });
      state.retry();
    } catch (e) {
      setMsg({ tone: 'danger', text: e?.navInvalid ? e.message : saveError(e) });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Navigation"
        sub="The buttons at the bottom of a phone - which ones, in what order, under what word"
      />

      <AsyncBlock state={state} onRetry={state.retry} skeleton={<FormSkeleton fields={5} />}>
        <>
          {!mayEdit && (
            <div className="notice notice-warn" role="status">
              You can read the navigation configuration, but changing it needs the{' '}
              <strong>settings.update</strong> permission. The controls are shown so you can
              see what is in force.
            </div>
          )}

          <div className="navcfg-layout">
            <div className="card navcfg-main">
              <div style={cardHead}>
                <h2 style={{ marginBottom: 0 }}>The bottom bar</h2>
                <StatusBadge tone={check.ok ? 'ok' : 'danger'}>
                  {shown.length} of {items.length} shown
                </StatusBadge>
                {/* The dirty state as a word, not as a coloured dot. It is the answer to
                    "have I saved this?", which is the question a page with nine editable
                    rows and one Save button raises every time it is left alone. */}
                {dirty && <StatusBadge tone="warn">Unsaved changes</StatusBadge>}
              </div>

              <p className="card-note" style={{ marginTop: 0, marginBottom: 'var(--sp-4)' }}>
                Drag a row by its handle, or use the arrows, to change the order. Between{' '}
                {MOBILE_NAV_MIN} and {MOBILE_NAV_MAX} buttons may be shown at once - five cells
                are 64px each on a 320px phone, and six are under the size of a thumb.
              </p>

              {/* The keyboard's reorder, spoken. Visually hidden because the list itself is
                  the visible feedback; `polite` so it waits for a gap rather than cutting
                  across whatever is being read. */}
              <p className="sr-only" role="status" aria-live="polite">
                {announce}
              </p>

              <ul className="navcfg-rows">
                {items.map((item, i) => (
                  <NavItemRow
                    key={item.key}
                    item={item}
                    index={i}
                    total={items.length}
                    mayEdit={mayEdit}
                    busy={busy}
                    isDragging={dragIndex === i}
                    isOver={overIndex === i && dragIndex !== null && dragIndex !== i}
                    onDragStart={onDragStart}
                    onDragOver={onDragOver}
                    onDrop={onDrop}
                    onDragEnd={clearDrag}
                    onMove={move}
                    onPatch={patch}
                  />
                ))}
              </ul>

              {barOrder && (
                <p className="card-note" style={{ marginTop: 'var(--sp-4)' }}>
                  Bar after saving: <strong>{barOrder}</strong>
                </p>
              )}

              {/* A rule about the list as a whole - too many shown, મુખપૃષ્ઠ switched off, a
                  duplicate key - cannot be pinned to one row, so it is stated once above the
                  button it would refuse. */}
              {liveError && (
                <div className="notice notice-danger" role="alert" style={{ marginTop: 'var(--sp-4)' }}>
                  {liveError}
                </div>
              )}

              <div className="form-actions">
                <button
                  className={`btn${busy ? ' is-busy' : ''}`}
                  type="button"
                  onClick={() => setConfirm('save')}
                  disabled={busy || !mayEdit || !dirty}
                >
                  {busy ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  className="btn btn-quiet"
                  type="button"
                  onClick={() => setConfirm('restore')}
                  disabled={busy || !mayEdit}
                >
                  Restore default
                </button>
                {msg && (
                  <span
                    className={`save-state ${msg.tone === 'ok' ? 'is-ok' : 'is-error'}`}
                    role={msg.tone === 'ok' ? 'status' : 'alert'}
                  >
                    {msg.text}
                  </span>
                )}
                {/* §31 — a failed save must offer the way out of it on the spot. The second
                    attempt skips the dialog: it was already confirmed, and asking twice for
                    one decision teaches him to click through it. */}
                {msg?.tone === 'danger' && (
                  <button className="btn btn-quiet btn-sm" type="button" onClick={save} disabled={busy}>
                    Try again
                  </button>
                )}
                {!dirty && !msg && (
                  <span className="hint">Nothing has changed yet.</span>
                )}
              </div>

              <p className="card-note">
                What is decided here: which destinations are on the bar, in what order, under
                what word and with which picture. Where each button goes is fixed by the app
                and shown on its row. The rest of the app's structure - which levels exist and
                what opens Level 4 - is on the <Link to="/levels">Levels</Link> page.
              </p>
            </div>

            {/* The preview is handed the working list, not the saved one. That is the whole
                mechanism: one array lives in this component, the rows edit it and the phone
                draws it, so there is no second copy to keep in step and no moment at which
                the two disagree. */}
            <aside className="navcfg-side">
              <MobilePreview items={items} />
            </aside>
          </div>

          <ConfirmDialog
            open={confirm !== null}
            title={confirm === 'restore' ? 'Restore the built-in bar?' : 'Save the navigation bar?'}
            body={
              confirm === 'restore'
                ? `This replaces the whole arrangement below - the order, the names you have typed and which items are switched on - with the built-in four: ${DEFAULT_MOBILE_NAV.map(
                    (d) => navRegistryEntry(d.key)?.label
                  ).join(' - ')}. It applies to every user immediately and cannot be undone from here.`
                : `This change will apply immediately for all users: ${
                    barOrder || 'no buttons'
                  }. The bar is the only way around the app on a phone, so anything not on it is out of reach until it goes back.`
            }
            confirmLabel={confirm === 'restore' ? 'Restore default' : 'Save changes'}
            danger={confirm === 'restore'}
            busy={busy}
            onConfirm={confirm === 'restore' ? restore : save}
            onCancel={() => setConfirm(null)}
          />
        </>
      </AsyncBlock>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Layout constants.
 *
 * The one shape admin.css has no class for, at module scope rather than as an inline
 * literal so React is not handed a fresh style object on every keystroke in a label field —
 * and there are nine of those fields. Every value is a token: nothing here may invent a
 * colour, a radius or a gap (admin.css, "HOW TO USE THIS FILE").
 * ------------------------------------------------------------------------- */

/** Card title with its badges beside it. `wrap` is what keeps the badges off the title at
 *  320px instead of squeezing both. */
const cardHead = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  flexWrap: 'wrap',
  marginBottom: 'var(--sp-2)',
};
