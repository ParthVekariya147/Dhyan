import { Outlet } from 'react-router-dom';
import BottomNav from './BottomNav';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * The frame the guarded pages are drawn inside — page above, bar below.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Two elements and no logic, which is the point. Everything a shell is usually tempted to
 * decide has been pushed somewhere it can be checked: which buttons stand in the bar is
 * settings['nav'] resolved against NAV_REGISTRY, whether the bar is drawn at all is a media
 * query in bottom-nav.css, and *where* the bar is drawn is the shape of the route tree in
 * src/App.jsx. This file is where those three meet.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why the bar is absent on લોગિન, નોંધણી and the પ્રવેશદ્વાર — and why that is
 * expressed as a route tree rather than as a list of paths in here
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A bar on the login screen offers a visitor five buttons to pages that will bounce him
 * straight back to the login screen. That is the dead end §1 forbids, dressed up as
 * navigation: every one of those taps costs him a page load and teaches him that the
 * buttons at the bottom of this app do not work.
 *
 * The obvious implementation is a denylist — `if (['/login','/register','/welcome']
 * .includes(pathname)) return children` — and it is the wrong one for a reason worth
 * stating: it makes this component hold a second, private copy of the answer to "which
 * routes need a session", when src/App.jsx already answers that with <Guarded>. Two copies
 * of one rule drift, and the drift is silent in the direction that matters: add a guarded
 * route and it simply gets a bar, add a *public* one and it gets a bar too, because a
 * denylist only knows the paths that existed when it was written.
 *
 * So the shell wraps exactly the routes it should wrap, and knows nothing at all about
 * paths. In App.jsx it is a layout route with the guarded pages nested inside it; /login,
 * /register and /welcome are declared as siblings, outside. A new page gets a bar by being
 * put inside <Guarded> and inside this element — the same decision, made once, in the file
 * that already makes it.
 *
 * <Outlet /> rather than `children` for the same reason: a layout route is how react-router
 * expresses "these routes share a frame", so the nesting in App.jsx is the literal statement
 * of which pages are in the shell, rather than a wrapper repeated around each of six route
 * elements where the seventh can be forgotten.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Desktop
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Above bottom-nav.css's breakpoint the bar is not drawn and this element becomes an inert
 * <div> around the page: the મુખપૃષ્ઠ's tiles and each level's own links are the navigation,
 * exactly as they are today. This app has no desktop sidebar, so the brief's rule that
 * mobile visibility must never be applied to one is satisfied by there being nothing to
 * apply it to — and the day a desktop surface is wanted, it is a `desktopSidebar` key in the
 * same settings row with a resolver of its own, which is why the key this bar reads is
 * named `mobileBottom` rather than `nav`.
 */
export default function AppShell() {
  return (
    <div className="app-shell">
      {/*
        The page. It carries the padding that keeps its last line clear of the bar
        (bottom-nav.css: `padding-bottom: var(--bnav-h)`, inside the same media query that
        draws the bar, so the number is written once and a desktop pays nothing for it).

        A wrapper element rather than padding on <body>, because body also hosts this app's
        fixed-position chrome — the reading-progress line, the back-to-top button, the ધૂન
        control — and padding on it would move none of them while quietly changing what
        `100vh` sits inside.
      */}
      <div className="app-shell-content">
        <Outlet />
      </div>

      {/*
        Mounted here, once, for every page in the shell — so the bar survives navigation
        instead of being unmounted and rebuilt on each route. That is the same argument
        <DhunPlayer /> makes from beside <Routes> in App.jsx, at a smaller scale: a
        component that is remounted per route is a component that re-reads its settings per
        route, and useNavigation.js's module-scope cache exists precisely so that even that
        would cost nothing. Belt and braces, in the order that keeps the bar still.
      */}
      <BottomNav />
    </div>
  );
}
