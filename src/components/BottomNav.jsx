import { NavLink } from 'react-router-dom';
import { useMobileNav } from '../lib/useNavigation';
import NavIcon from './NavIcon';
import './bottom-nav.css';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * The phone's bottom bar (§15, §16) — the whole of this app's chrome.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * On a phone there is no sidebar, no hamburger and no breadcrumb behind this: what a યુવક
 * can reach in one thumb-press is what the app is. shared/domain/navigation.js's header
 * says that at length; this component is the four lines of markup it describes.
 *
 * It decides nothing. Which buttons stand here, in what order, under what word and with
 * which picture is the સંચાલક's, resolved from settings['nav'] by useMobileNav(); whether
 * a destination exists at all is NAV_REGISTRY's, checked against src/App.jsx's route list.
 * This file maps a resolved list onto elements and gets out of the way — which is why there
 * is no `if` in it about any particular key.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * There is no loading state, deliberately
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `useMobileNav()` returns `loading`, and this component ignores it, because `items` is
 * never empty at any point in the lifecycle — including the very first paint, before any
 * network read has returned. A spinner in the bar, or a bar that is absent until the row
 * lands, is 64px of chrome appearing under a thumb that is already moving: everything above
 * it shifts up mid-tap. That is §18's "a validation message must not move the button" seen
 * from the bottom of the screen, and it is the reason the hook is built the way it is.
 */
export default function BottomNav() {
  const { items } = useMobileNav();

  return (
    /*
      A <nav> with an accessible name, because this is not the only landmark on the page —
      several level pages carry their own in-page navigation, and an unnamed <nav> in a list
      of <nav>s tells a screen-reader user nothing about which one he has landed in. The
      name is Gujarati because the app is (§14); it is the app's own words for this thing,
      not a translation of "bottom navigation", which is a description of where it is drawn
      rather than of what it does.
    */
    <nav className="bnav" aria-label="મુખ્ય મેનુ">
      {items.map((item) => (
        <NavLink
          key={item.key}
          /*
            The registry's route, carried through the resolver — never the stored one. The
            row may choose among destinations and may never name one; see the header of
            shared/domain/navigation.js for why that is a security property and not a
            tidiness one.
          */
          to={item.route}
          /*
            `end` on '/' and nowhere else.

            Without it, react-router treats the home route as a prefix of every path in the
            app and marks it active on /darshan, /level/3 and everything else — so two cells
            light up at once and neither reads as where you are. admin/src/app/AdminShell.jsx
            makes exactly this point about /levels, which is a prefix of /levels/4; '/' is
            the extreme case of the same rule, being a prefix of every path there is.

            Written as a comparison against the route rather than against the key, because
            what makes `end` necessary is the SHAPE of the path — the day a second item
            points at a path that is a prefix of another, this line is where that is noticed.
          */
          end={item.route === '/'}
          /*
            The identity, on the element, for anything that has to find a particular button
            without knowing what the સંચાલક has called it: the acceptance script, and any
            future analytics. The label is his and changes; the key is the registry's and
            survives a rename (see NAV_REGISTRY's field notes).
          */
          data-nav-key={item.key}
          /*
            `is-active` in addition to NavLink's own `aria-current="page"`, which it sets by
            itself for the active link and which is deliberately not overridden here. Two
            statements of the same fact, in the two vocabularies that have to hear it: CSS
            cannot style on `aria-current` in a way this codebase uses anywhere else, and a
            screen reader cannot hear a class.
          */
          className={({ isActive }) => (isActive ? 'bnav-item is-active' : 'bnav-item')}
        >
          <span className="bnav-icon">
            <NavIcon name={item.icon} />
          </span>
          {/*
            The word under the picture, and it is never absent: resolveMobileNav() falls back
            to the registry's own label rather than allowing an empty one, because a cell
            with an icon and no word is a button whose meaning a યુવક has to learn by
            pressing it. It truncates rather than wraps — bottom-nav.css says why.
          */}
          <span className="bnav-label">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
