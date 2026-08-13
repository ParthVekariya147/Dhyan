/**
 * ────────────────────────────────────────────────────────────────────────────
 * The ten drawings a bottom-bar button may carry.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * One inline SVG per name in NAV_ICONS (shared/domain/navigation.js). Nothing here is
 * fetched and nothing here is evaluated, and both halves of that are requirements rather
 * than preferences:
 *
 *   * **Nothing fetched.** This app is a PWA in standalone mode (vite.config.js) and §14
 *     asks it to work on slow networks. An icon font or a sprite sheet is a request the
 *     app makes in order to draw its own chrome — so on the visit where that request is
 *     slow the bar renders five empty boxes, and on the visit where it fails it renders
 *     five empty boxes forever. The workbox glob precaches CSS and JS, and these drawings
 *     are JS.
 *   * **Nothing evaluated.** The name arrives from a jsonb row that anyone holding
 *     `settings.update` can write. It is a key into the object below and can never be
 *     anything else — never a component lookup, never a URL, never markup. That is the same
 *     argument the closed NAV_ICONS list makes in the shared module, enforced here at the
 *     point where a name would otherwise become a drawing.
 *
 * The names describe the picture and not the destination — 'grid', not 'level4' — because
 * the whole point of making the icon configurable is that a સંચાલક may want a different
 * picture on a button without moving where it goes.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why they are drawn as strokes, at this weight, at this size
 * ────────────────────────────────────────────────────────────────────────────
 *
 * 24x24 with `stroke="currentColor"` and `fill="none"` means one thing: the icon is the
 * colour of the text under it, in every state, without a single rule in bottom-nav.css
 * having to know an icon exists. An active item changes `color` and the drawing follows;
 * a filled icon would need its own `fill` rule for each state and would eventually be the
 * one that got missed.
 *
 * 1.7 is the stroke weight, and it is a compromise measured against the dark palette: on
 * #100d0a a 1.5px gold hairline at 24px reads as grey on a bright phone screen outdoors,
 * and 2px next to a 12.5px Gujarati label makes the picture shout over the word. The whole
 * set shares it, because two weights in one bar is two icon sets in one bar.
 */
import { NAV_ICONS } from '../../shared/domain/navigation.js';

/**
 * The drawings themselves — the inside of the <svg>, nothing else.
 *
 * Keyed by the exact strings in NAV_ICONS. The assertion under this object is what keeps
 * the two lists honest: the shared module is the one that a panel offers to a સંચાલક, and
 * an icon he can pick and this app cannot draw is a button with a blank square on it.
 */
const PATHS = {
  // A roof and a door. One path, so the door is part of the outline rather than a second
  // shape that can drift out of alignment at a fractional device pixel ratio.
  home: <path d="M3.6 10.4 12 3.4l8.4 7v8.2a1.4 1.4 0 0 1-1.4 1.4h-4.2v-6.2H9.2V21H5a1.4 1.4 0 0 1-1.4-1.4Z" />,
  // લેવલ ૧ is a video, so this is the universal play disc rather than a film strip: it is
  // the one shape a યુવક who has never used this app already knows means "watch".
  play: (
    <>
      <circle cx="12" cy="12" r="8.8" />
      <path d="M10.2 8.2 16 12l-5.8 3.8Z" />
    </>
  ),
  // દર્શન is *seeing*. An eye, not a photograph — the level is not a gallery of files, it
  // is the act the level is named for.
  darshan: (
    <>
      <path d="M2 12s3.7-6.2 10-6.2S22 12 22 12s-3.7 6.2-10 6.2S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.9" />
    </>
  ),
  // A bulleted list — પુનરાવર્તન is a list of વર્ણન that a યુવક ticks his way down.
  list: (
    <>
      <path d="M8.6 6.4h11.8M8.6 12h11.8M8.6 17.6h11.8" />
      <circle cx="4.3" cy="6.4" r="1.05" />
      <circle cx="4.3" cy="12" r="1.05" />
      <circle cx="4.3" cy="17.6" r="1.05" />
    </>
  ),
  // Four tiles. લેવલ ૪ is a container of પ્રવૃત્તિઓ, and this is what that container looks
  // like on its own front page.
  grid: (
    <>
      <rect x="3.4" y="3.4" width="7.2" height="7.2" rx="1.7" />
      <rect x="13.4" y="3.4" width="7.2" height="7.2" rx="1.7" />
      <rect x="3.4" y="13.4" width="7.2" height="7.2" rx="1.7" />
      <rect x="13.4" y="13.4" width="7.2" height="7.2" rx="1.7" />
    </>
  ),
  // Head and shoulders. The arc is open at the bottom so the shape reads at 24px without
  // the shoulders closing into a solid lump against the label beneath.
  person: (
    <>
      <circle cx="12" cy="8.1" r="3.7" />
      <path d="M4.9 20.6a7.1 7.1 0 0 1 14.2 0" />
    </>
  ),
  // A gear: a hub, a rim, and eight teeth on the diagonals and axes. Drawn as separate
  // strokes rather than as one toothed outline because a hand-written 8-tooth polygon is
  // a list of forty coordinates that nobody can correct later without redrawing it.
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <circle cx="12" cy="12" r="7" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.64 5.64 7.05 7.05M16.95 16.95l1.41 1.41M18.36 5.64 16.95 7.05M7.05 16.95 5.64 18.36" />
    </>
  ),
  // A cup with two handles and a base. ક્રમાંક is not built (NAV_REGISTRY marks it
  // `ready: false`), and this is drawn anyway so that the day it ships nothing about the
  // bar has to change.
  trophy: (
    <>
      <path d="M7.6 3.8h8.8v5a4.4 4.4 0 0 1-8.8 0Z" />
      <path d="M7.6 5.4H4.8v1.2a3.3 3.3 0 0 0 2.9 3.2M16.4 5.4h2.8v1.2a3.3 3.3 0 0 1-2.9 3.2" />
      <path d="M12 13.2v3.4M8.4 20.4h7.2l-.8-3.8H9.2Z" />
    </>
  ),
  star: <path d="m12 3.6 2.65 5.35 5.9.86-4.27 4.16 1.01 5.87L12 17.03l-5.29 2.77 1.01-5.87L3.45 9.8l5.9-.86Z" />,
  // An open book, spine down the middle. Two mirrored paths rather than one, so the gutter
  // stays a gap at every size instead of closing into a single blob.
  book: (
    <>
      <path d="M4 4.8h4.9A3 3 0 0 1 11.9 7.8v11.6a2.6 2.6 0 0 0-2.6-2.4H4Z" />
      <path d="M20 4.8h-4.9a3 3 0 0 0-3 3v11.6a2.6 2.6 0 0 1 2.6-2.4H20Z" />
    </>
  ),
};

/*
  The set this file draws and the set the panel offers must be the same set.

  A missing name here is not a rendering bug that shows up in review — it is a blank square
  on a યુવક's phone, weeks after a સંચાલક picked a perfectly legal icon from a list that
  promised it. The check runs at module evaluation in every build, so a name added to
  NAV_ICONS without a drawing fails the first time anything imports this file rather than
  the first time somebody chooses it.

  Only in development. In production the resolver has already replaced any unknown icon with
  the registry's own, and `fallback` below catches whatever reaches this anyway — so the
  honest failure mode for a yuvak is the wrong picture, never a page that will not render.
*/
if (import.meta.env.DEV) {
  const missing = NAV_ICONS.filter((name) => !PATHS[name]);
  if (missing.length) {
    console.error(
      `NavIcon: NAV_ICONS names an icon this app cannot draw — ${missing.join(', ')}. ` +
        'Add it to PATHS in src/components/NavIcon.jsx.'
    );
  }
}

/**
 * One bar-button icon.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * An unknown name draws 'home' rather than nothing — the second belt
 * ────────────────────────────────────────────────────────────────────────────
 *
 * resolveMobileNav() already guarantees this prop is one of NAV_ICONS: an icon the row
 * does not recognise is replaced with the registry's own before it ever reaches a
 * component. So this fallback is, in the ordinary run of things, unreachable.
 *
 * It exists because of what "unreachable" would cost if it were ever wrong. A button in
 * this bar is a 64px cell containing a picture and one short word; drop the picture and
 * what is left is a word floating in a space shaped like a control, which reads as a
 * failure rather than as a button. Worse, the icon is the part a યુવક navigates by after
 * the first week — he stops reading the labels. So the failure mode is chosen to be "the
 * wrong picture", which costs him one glance, rather than "no picture", which costs him
 * the button.
 *
 * 'home' specifically, because it is the one destination that is always in the bar
 * (NAV_REQUIRED_KEY) and therefore the one drawing that is certainly present in this file.
 */
export default function NavIcon({ name }) {
  const shape = PATHS[name] || PATHS.home;

  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      /*
        The label beside it is the accessible name of this button, and it is real text in
        Gujarati that a screen reader will read. An icon that also announced itself would
        make every cell say its meaning twice, and the second saying would be an English
        word ('grid') that means nothing to the person listening. `focusable="false"` is
        for the same reason on the other axis: without it, older engines put the <svg>
        into the tab order, so tabbing through a five-button bar takes ten presses.
      */
      aria-hidden="true"
      focusable="false"
    >
      {shape}
    </svg>
  );
}
