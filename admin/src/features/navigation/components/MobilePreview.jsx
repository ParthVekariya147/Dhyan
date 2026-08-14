import { MOBILE_NAV_MAX, MOBILE_NAV_MIN } from '../../../../../shared/domain/navigation.js';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * The bar as a યુવક will see it, drawn from what is on the form and not from what is saved
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Everything on this page is an abstraction of one concrete thing: four or five little
 * buttons at the bottom of a phone. A સંચાલક arranging rows in a list is not being asked
 * "what should the bar look like", he is being asked to hold the answer in his head while he
 * edits the question. This is the answer, on screen, changing with every keystroke.
 *
 * It is a pure function of the props: the page owns the working list and hands it down, so
 * there is no state here to fall out of step and nothing to reconcile after a save. That is
 * the whole of "the preview updates before Save" — not an effect that copies the form into a
 * second list, which is the version that eventually shows the previous keystroke.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why these icons are drawn here, again, instead of being imported
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The યુવક app draws the same glyphs in src/components/NavIcon.jsx, and importing that
 * file would be the obvious way to guarantee the preview matches the product. It is
 * forbidden, and by the rule that is the reason the two applications exist: AdminShell.jsx
 * states it at the top — §8, no shared UI components between the panel and the app — and
 * scripts/verify-admin-separation.mjs executes it, failing the build the moment anything
 * under src/ and anything under admin/ import each other. A preview that made the panel a
 * dependency of the app it configures would have to ship the yuvak's stylesheet, its tokens
 * and whatever NavIcon grows next, into a console that is deliberately a different product.
 *
 * So the duplication is deliberate and it is bounded: the *names* are shared, from
 * NAV_ICONS, and they are the part that has to agree — an icon the સંચાલક picks and the app
 * cannot draw would render as an empty cell on the phone, which is why the domain file makes
 * NAV_ICONS a closed list. What is duplicated is a set of path strings whose only job is to be
 * recognisable in a 44px square, and if a glyph here drifts from the app's, the cost is a
 * preview that flatters a slightly different drawing - not a bar that fails to render.
 */

/*
  One shape per NAV_ICONS name, keyed by that name and nothing else. Stroked rather than
  filled so a single `currentColor` carries both the active and the inactive cell, and drawn
  on a 24-unit grid so the whole set scales from the 20px in the preview to whatever a later
  layout asks for without a second copy at a second size.

  A missing key renders nothing rather than throwing: this is fed from a stored row that the
  resolver has already had its say about, and a preview that white-screens the page over an
  unknown icon name would take the panel down at exactly the moment it is needed to fix it.
*/
const GLYPHS = {
  home: <path d="M3.4 11.3 12 4.2l8.6 7.1M5.9 10v9.8h12.2V10" />,
  play: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M10.2 8.4 16 12l-5.8 3.6Z" />
    </>
  ),
  // દર્શન is looking, so it is an eye rather than a picture frame - the label under it is
  // already the word, and two nouns in one cell is one too many.
  darshan: (
    <>
      <path d="M2.8 12S6.4 6.6 12 6.6 21.2 12 21.2 12 17.6 17.4 12 17.4 2.8 12 2.8 12Z" />
      <circle cx="12" cy="12" r="2.7" />
    </>
  ),
  list: (
    <>
      <path d="M9.2 7h11M9.2 12h11M9.2 17h11" />
      <circle cx="5" cy="7" r="1.1" />
      <circle cx="5" cy="12" r="1.1" />
      <circle cx="5" cy="17" r="1.1" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8.4" r="3.6" />
      <path d="M4.8 20c0-3.6 3.2-5.6 7.2-5.6s7.2 2 7.2 5.6" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.9v2.6M12 18.5v2.6M2.9 12h2.6M18.5 12h2.6M5.4 5.4l1.9 1.9M16.7 16.7l1.9 1.9M18.6 5.4l-1.9 1.9M7.3 16.7l-1.9 1.9" />
    </>
  ),
  trophy: (
    <>
      <path d="M7.8 4h8.4v4.6a4.2 4.2 0 0 1-8.4 0Z" />
      <path d="M7.8 5.6H5.2a2.6 2.6 0 0 0 2.6 3.9M16.2 5.6h2.6a2.6 2.6 0 0 1-2.6 3.9" />
      <path d="M12 12.8V16M8.6 20h6.8M9.6 20c0-2.2 1-2.9 2.4-2.9s2.4.7 2.4 2.9" />
    </>
  ),
  star: <path d="m12 3.7 2.6 5.3 5.8.9-4.2 4 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4 5.8-.9Z" />,
  book: (
    <>
      <path d="M4 5.4h5.4A2.6 2.6 0 0 1 12 8v11a2.3 2.3 0 0 0-2.3-1.7H4Z" />
      <path d="M20 5.4h-5.4A2.6 2.6 0 0 0 12 8v11a2.3 2.3 0 0 1 2.3-1.7H20Z" />
    </>
  ),
  // The four that came with custom buttons. Duplicated from src/components/NavIcon.jsx for
  // the reason stated at the top of this file - the panel may not import the app's
  // components - and the duplication is bounded to path strings whose only job is to be
  // recognisable in a 44px square.
  chart: (
    <>
      <path d="M3.8 20.2h16.4" />
      <path d="M7.4 20.2v-5.8M12 20.2V7.4M16.6 20.2v-9" />
    </>
  ),
  users: (
    <>
      <circle cx="9.4" cy="8.3" r="3.4" />
      <path d="M3.3 20.3a6.1 6.1 0 0 1 12.2 0" />
      <path d="M16.1 5.3a3.4 3.4 0 0 1 0 6M17.5 14.4a5.5 5.5 0 0 1 3.2 5.9" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.8" />
      <path d="M12 11.2v5.4" />
      <circle cx="12" cy="7.9" r="0.95" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.8" />
      <path d="M9.5 9.5a2.6 2.6 0 0 1 5.1.6c0 1.7-2.6 2.2-2.6 4" />
      <circle cx="12" cy="17.1" r="0.95" />
    </>
  ),
};

function PreviewIcon({ name }) {
  return (
    <svg
      className="navcfg-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[name] || null}
    </svg>
  );
}

/**
 * @param items the panel's working list — every configured item, hidden ones included, in
 *   the order the rows are currently in. Filtering is this component's job precisely because
 *   "what is in the bar" is the question it exists to answer.
 */
export default function MobilePreview({ items = [] }) {
  /*
    Exactly the app's own rule: `visible && enabled`, in list order.

    Both flags, not one. resolveMobileNav() filters on both because they are two different
    switches — an item may be present and shown and still `enabled: false`, which draws
    nothing at all — and a preview that honoured only `visible` would show a button the phone
    will not have. The order is the array's, because the page renumbers `sortOrder` from the
    array on save (toStoredMobileNav does it); sorting by the stale numbers here would draw
    the bar as it was before the last drag.
  */
  const bar = items.filter((i) => i.visible && i.enabled);
  const n = bar.length;

  const tooMany = n > MOBILE_NAV_MAX;
  const tooFew = n < MOBILE_NAV_MIN;

  return (
    <div className="navcfg-preview">
      <div className="navcfg-preview-head">
        <h3>What a yuvak will see</h3>
        <p className="hint">
          This is the bar as the app draws it - the Gujarati word under each icon is what he
          reads. It follows what is on this page, not what is saved, so you can look before
          you commit.
        </p>
      </div>

      {/* The frame is decoration and says so: everything inside it is a picture of another
          application's screen, and a screen reader reading out five Gujarati words with no
          way to act on them would be describing something that is not here yet. The count
          and the warnings below are the accessible version of this, in words. */}
      <div className="navcfg-phone" aria-hidden="true">
        <div className="navcfg-screen">
          <span className="navcfg-screen-line" />
          <span className="navcfg-screen-line is-short" />
          <span className="navcfg-screen-line" />
        </div>

        <div className={`navcfg-bar${tooMany ? ' is-over' : ''}`}>
          {n === 0 ? (
            <span className="navcfg-bar-empty">No buttons</span>
          ) : (
            bar.map((item, i) => (
              <span
                key={item.key}
                /* The first cell reads as the active one, which is what a phone opening on
                   the first destination actually looks like. It is presentation only -
                   nothing here decides where the app opens. */
                className={`navcfg-cell${i === 0 ? ' is-active' : ''}`}
              >
                <PreviewIcon name={item.icon} />
                <span className="navcfg-cell-label">{item.label}</span>
              </span>
            ))
          )}
        </div>
      </div>

      {/*
        The count in words, always — not only when something is wrong.

        A preview that renders five cells and says nothing is asking the સંચાલક to count
        them, and at 320px five cells are 64px wide each, which is the width at which
        "is that five or six?" is a real question. Saying the number is also the only part of
        this component a screen reader gets, the frame above being aria-hidden.
      */}
      <p className={`navcfg-count${tooMany || tooFew ? ' is-bad' : ''}`} role="status">
        <span className="mono">{n}</span> {n === 1 ? 'button' : 'buttons'} in the bar
        {tooMany && (
          <>
            {' '}
            - that is more than {MOBILE_NAV_MAX}. The bar cannot be saved like this: at 320px
            the cells fall under the 44px a thumb needs and the Gujarati labels start
            clipping.
          </>
        )}
        {tooFew && (
          <>
            {' '}
            - fewer than {MOBILE_NAV_MIN}. One button is not a navigation bar, and none is
            64px of a phone's screen spent saying nothing.
          </>
        )}
        {!tooMany && !tooFew && n === MOBILE_NAV_MAX && ' - the bar is full.'}
      </p>
    </div>
  );
}
