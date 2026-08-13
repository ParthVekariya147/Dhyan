/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE BOTTOM BAR, IN A REAL BROWSER — at six real widths and three wide ones
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   npm run verify:nav
 *
 * scripts/test-navigation.mjs proves the LOGIC: which buttons, in what order, pointing
 * where. Not one of its assertions can tell whether those buttons are 44px, whether the
 * fifth one pushes the fourth off a 320px screen, or whether the bar is sitting on top of
 * the last row of the page it is supposed to sit under. Those are measurements, and a
 * measurement needs a browser.
 *
 * Why a script and not a look at the screenshots: every failure below is one that a
 * screenshot at 390px hides and a screenshot at 320px shows, and nobody re-takes six
 * screenshots after changing one font size. `verify-mobile.mjs` makes the same argument
 * about લોગિન and નોંધણી and this is the same harness, deliberately.
 *
 * The widths are the ones §21 names and they are not arbitrary: 320 is the iPhone SE and
 * every cheap Android in portrait, 360 is the single most common Android width in India,
 * 375/390 are the iPhone mini/standard, 412/430 are the large Androids and the iPhone Pro
 * Max. 320 is the one that decides everything — five cells of 64px each, which is where
 * MOBILE_NAV_MAX's five comes from. Anything that fits there fits the rest.
 *
 * It runs against `dist/`, not the dev server, so what is measured is what ships.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The DOM contract it measures against
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   nav.bnav                 the bar, with an aria-label
 *   a.bnav-item              one button, carrying data-nav-key="<registry key>"
 *   .is-active               the one for the current route, also aria-current="page"
 *   span.bnav-icon           the drawing
 *   span.bnav-label          the word under it
 *   --bnav-h                 the bar's height INCLUDING the safe-area inset, as a custom
 *                            property, so the page underneath can reserve room for it
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What it asserts, and what each one is protecting against
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   1. THE BAR EXISTS AND HOLDS 2..5 ITEMS. The bounds are the ones the resolver enforces;
 *      this is where "the resolver returned five" is checked against "five arrived on
 *      screen", which are not the same claim — a bar that renders four of five items has a
 *      passing unit test and a missing button.
 *   2. NO HORIZONTAL SCROLLING, and no element wider than the viewport. `body { overflow-x:
 *      hidden }` HIDES a sideways page rather than preventing one, so scrollWidth alone
 *      would pass while a fifth cell sat off-screen unreachable. Every element is measured,
 *      exactly as verify-mobile.mjs measures them and for the same reason.
 *   3. EVERY ITEM IS >= 44px IN BOTH DIMENSIONS — the smaller of the two published
 *      one-handed tap floors. Both dimensions, not just height: at 320px it is the WIDTH
 *      that fails first, and it fails silently as a mis-tap rather than as a layout bug.
 *   4. NO TEXT BELOW 12px anywhere in the bar, so Gujarati keeps its matras. મુખપૃષ્ઠ at
 *      10px is not a small label, it is a smudge.
 *   5. CONTENT IS NOT HIDDEN BEHIND THE BAR. A fixed bar over an unpadded page eats the
 *      last row of every list in the app — the last દ્રશ્ય, the last લેવલ, the submit button
 *      at the end of a form. Asserted twice: the scroll container reserves at least the
 *      bar's height, AND after scrolling to the bottom nothing is still underneath it.
 *   6. THE LABEL DOES NOT WRAP. A wrapped label makes the bar taller, and a bar whose height
 *      depends on the સંચાલક's wording is a bar that moves the page under a thumb.
 *   7. EXACTLY ONE ITEM IS ACTIVE, and it is the one whose registry route matches the page,
 *      and it carries aria-current="page". Two active items is a bar that lies about where
 *      you are; nought is a bar that has stopped tracking the route at all.
 *   8. AT 768/1280/1920 THE BAR IS NOT DISPLAYED. It is mobile chrome. verify-mobile.mjs
 *      records what a desktop blind spot cost this project once already.
 *   9. IT SURVIVES A RELOAD and is there on first paint. The bar reads a settings row; if it
 *      waited for that read it would appear a beat after the page on every single visit,
 *      which is the layout shift the whole cache in useNavigation.js exists to avoid.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this suite can and cannot reach, and why it says so out loud
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every page that carries the bar is behind the login guard, and this script holds no
 * Supabase session. There is exactly one door: `VITE_PUBLIC_DARSHAN=1`, set by `.env.test`
 * and therefore by `npm run build:test`, which lifts the guard on `/darshan` so
 * verify-loading.mjs can measure image delivery without an account. That is the page this
 * suite uses, for the same reason and with the same flag.
 *
 * As of this writing all nine assertions are exercised: AppShell wraps `/darshan`, so the
 * bar is on that page under `build:test` with no session, resolving to DEFAULT_MOBILE_NAV
 * because the settings read finds no row. That is worth knowing rather than assuming, so
 * the script establishes it at step [1] instead of taking it for granted.
 *
 * If that ever stops being true — if the shell is changed to mount only for a signed-in
 * યુવક — then assertions 1..7 and 9 cannot be run, and this script says so, by name, under
 * a NOT RUN heading, and does not count them as passes. What it can still assert in that
 * case is honest and worth having: that the bar's CSS, its markup and a drawing for every
 * icon shipped in the build at all, and that the લોગિન page correctly does NOT carry a
 * bar. A green suite that measured nothing is worth less than a partial one that says
 * which half it measured.
 *
 * Assertion 8 (mobile-only) and the login-page check are run in every case, because both
 * are about a bar that must be ABSENT and absence is measurable without a session.
 *
 * One trade inside assertion 5: the reserved-room half runs at all six widths, and the
 * empirical "scroll to the very bottom and look" half runs once at 390px. દર્શન is a lazy
 * feed of 109 images and reaching its true foot six times over means asking an image CDN
 * that throttles by referrer for the whole tail of it, six times.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { createServer } from './serve-dist.mjs';
import {
  MOBILE_NAV_MAX,
  MOBILE_NAV_MIN,
  NAV_ICONS,
  navRegistryEntry,
} from '../shared/domain/navigation.js';

const CHROME = process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// 4180 is verify-loading's, 4181 verify-mobile's, 4182 verify-gallery's, 4187
// verify-admin-mobile's. This one takes 4183 so two suites can run at once.
const PORT = Number(process.env.PORT) || 4183;

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');

/** §21's list, exactly. */
const WIDTHS = [320, 360, 375, 390, 412, 430];

/**
 * The widths at which this bar must NOT be drawn.
 *
 * The same blind spot verify-mobile.mjs documents: every width above is a phone, so a rule
 * that shows mobile chrome on a monitor is invisible to all six of them. A bottom bar pinned
 * across a 1920px screen is not a minor cosmetic issue — it is 64px of every desktop page
 * spent on navigation the desktop layout is supposed to be providing some other way (§9).
 */
const WIDE = [768, 1280, 1920];

/** Where the yuvak app's public escape hatch puts a real page with real chrome on it. */
const PROBE = '/darshan';

let pass = 0;
const fails = [];
const notRun = [];
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fails.push(`${name}${detail ? `  -  ${detail}` : ''}`);
};
const cannotRun = (name, why) => {
  notRun.push(`${name}  -  ${why}`);
  console.log(`    NOT RUN  ${name}  -  ${why}`);
};

if (!existsSync(path.join(DIST, 'index.html'))) {
  console.error('\n  dist/ is missing - run `npm run build:test` first.\n');
  process.exit(1);
}

// ============================================================ the build itself
//
// Runs with no browser at all, and is the one part of this suite that cannot be skipped for
// want of a session. If the bar's stylesheet was tree-shaken out, or the component never
// made it into a chunk, nothing measured in a viewport afterwards would be meaningful.

console.log('\n[0] the bar is in the build');
{
  const assets = path.join(DIST, 'assets');
  let css = '';
  let js = '';
  for (const f of readdirSync(assets)) {
    const body = readFileSync(path.join(assets, f), 'utf8');
    if (f.endsWith('.css')) css += body;
    else if (f.endsWith('.js')) js += body;
  }

  check('the bar has a stylesheet in the build', /\.bnav\b/.test(css), 'no .bnav rule found in any css chunk');
  check('the item, icon and label are all styled', /bnav-item/.test(css) && /bnav-icon/.test(css) && /bnav-label/.test(css));
  check('the active state is styled', /is-active/.test(css));
  /*
    The custom property is the whole contract between the bar and the page under it. If it
    is missing, assertion 5 has nothing to reserve room with and the last row of every list
    in the app sits under the bar - a failure that is invisible until somebody scrolls to
    the bottom of something on a phone.
  */
  check('--bnav-h is declared', /--bnav-h\s*:/.test(css), 'the page has nothing to reserve room against');
  /*
    Scoped to the bar's OWN declarations, not to the stylesheet as a whole. `env(
    safe-area-inset-bottom)` already appears elsewhere in this app's CSS, so a plain
    `css.includes(...)` would pass on a bar that ignores the inset entirely - a green check
    for somebody else's work, which is worse than no check. What is asserted is the stated
    contract: --bnav-h is the bar's height INCLUDING the inset, so the page reserving
    --bnav-h reserves enough on a gesture-bar phone too.
  */
  const barCss = [
    ...(css.match(/--bnav-h\s*:[^;}]*/g) || []),
    ...(css.match(/\.bnav[^{}]*\{[^}]*\}/g) || []),
  ].join('\n');
  check('the safe-area inset is inside the bar\'s own height',
    /safe-area-inset-bottom/.test(barCss),
    'a gesture-bar phone will draw its home indicator over the labels');
  check('the component shipped in a chunk', /bnav-item/.test(js), 'no chunk mentions bnav-item');
  /*
    NAV_ICONS is a closed list precisely so that every name in it has a drawing behind it -
    the alternative was the સંચાલક typing a name that becomes a component lookup or a URL.
    A name he can pick in the panel and this build cannot draw renders as nothing at all,
    which is a button with no picture and no way to tell which one it was. Minification
    keeps string literals, so the names are checkable in the shipped chunk.
  */
  const undrawable = NAV_ICONS.filter((n) => !new RegExp(`["'\`]${n}["'\`]`).test(js));
  check('every icon in the closed list has a drawing in the build', undrawable.length === 0,
    `no drawing shipped for: ${undrawable.join(', ')}`);
  console.log(`      css chunks scanned: ${readdirSync(assets).filter((f) => f.endsWith('.css')).length}`);
}

// ============================================================ the browser

const server = createServer();
await new Promise((r) => server.listen(PORT, r));
const SITE = `http://localhost:${PORT}`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});

/**
 * Everything one page at one width has to say about its bar, measured in the page.
 *
 * Collected in a single evaluate() rather than a dozen round trips, because the numbers must
 * all describe the SAME layout — a measurement taken between two reflows is how a suite like
 * this ends up green on a page that is visibly broken. verify-mobile.mjs makes the same
 * argument about the same problem.
 */
async function measure(page) {
  return page.evaluate(() => {
    const px = (v) => Math.round(parseFloat(v) * 100) / 100;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const nav = document.querySelector('nav.bnav');

    // ---- 2. every element that sticks out past either edge, bar or not ----------
    const overflowing = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (r.right > vw + 0.5 || r.left < -0.5) {
        overflowing.push(`${el.tagName.toLowerCase()}.${String(el.className || '-').split(' ')[0]} [${Math.round(r.left)}…${Math.round(r.right)}]`);
      }
    }

    if (!nav) {
      return {
        vw, vh, present: false,
        docScrollWidth: document.documentElement.scrollWidth,
        overflowing,
      };
    }

    const navRect = nav.getBoundingClientRect();
    const navCs = getComputedStyle(nav);
    const items = [...nav.querySelectorAll('a.bnav-item')];

    // ---- 4. the smallest rendered text anywhere inside the bar ------------------
    let smallest = { size: Infinity, what: '' };
    for (const el of nav.querySelectorAll('*')) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const s = px(getComputedStyle(el).fontSize);
      if (s < smallest.size) smallest = { size: s, what: `${el.tagName.toLowerCase()}.${String(el.className || '-').split(' ')[0]}` };
    }

    /*
      ---- 5. the last thing on the page, and the room reserved for the bar ----

      Fixed-position elements are skipped: they are chrome of their own, positioned
      deliberately, and the ધૂન control and the back-to-top button are both down here. What
      matters is CONTENT — something that scrolls, carries its own text or is an image, and
      could therefore end up behind a bar that does not scroll with it.

      What is collected is the element with the greatest bottom edge, not everything that
      currently overlaps the bar. Content passing UNDER a fixed bar mid-scroll is the bar
      working; the failure is content still under it when there is no more page to scroll.
    */
    const isFixed = (el) => {
      for (let p = el; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).position === 'fixed') return true;
      }
      return false;
    };
    let last = null;
    for (const el of document.querySelectorAll('body *')) {
      if (el === nav || nav.contains(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own && el.tagName !== 'IMG' && el.tagName !== 'BUTTON') continue;
      if (isFixed(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (!last || r.bottom > last.bottom) {
        last = { bottom: Math.round(r.bottom), what: `${el.tagName.toLowerCase()}.${String(el.className || '-').split(' ')[0]}`, el };
      }
    }

    /*
      --bnav-h, measured rather than read.

      `getPropertyValue('--bnav-h')` hands back the TOKEN, which is
      `calc(58px + env(safe-area-inset-bottom, 0px))` — a string no amount of parseFloat
      will turn into a number. A custom property has no computed value of its own; the only
      way to find out what it resolves to is to give it to a property that does have one and
      measure the result. Hence a throwaway element one pixel wide.
    */
    const ruler = document.createElement('div');
    ruler.style.cssText = 'position:absolute;top:0;left:0;width:1px;visibility:hidden;pointer-events:none;height:var(--bnav-h)';
    document.body.appendChild(ruler);
    const barH = Math.round(ruler.getBoundingClientRect().height * 100) / 100;
    ruler.remove();

    /*
      The reserved room, looked for on the ANCESTORS of the last thing on the page rather
      than on a class name this script has been told about. Which element carries the
      padding is the shell's business and may change; that something between the content
      and the viewport reserves the bar's height is the contract. A margin counts as well as
      a padding — both push the last row up, which is the whole requirement.
    */
    let reserved = 0;
    let reservedOn = '(nothing)';
    for (let p = last?.el; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const room = Math.max(px(cs.paddingBottom), px(cs.marginBottom));
      if (room > reserved) {
        reserved = room;
        reservedOn = `${p.tagName.toLowerCase()}.${String(p.className || '-').split(' ')[0]}`;
      }
    }

    return {
      vw, vh, present: true,
      docScrollWidth: document.documentElement.scrollWidth,
      overflowing,
      smallest,
      declaredHeight: barH,
      reserved,
      reservedOn,
      lastContent: last ? { bottom: last.bottom, what: last.what } : null,
      atBottom: window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2,
      scrollHeight: document.documentElement.scrollHeight,
      bar: {
        display: navCs.display,
        position: navCs.position,
        ariaLabel: nav.getAttribute('aria-label') || '',
        top: Math.round(navRect.top),
        height: Math.round(navRect.height),
        left: Math.round(navRect.left),
        right: Math.round(navRect.right),
      },
      items: items.map((el) => {
        const r = el.getBoundingClientRect();
        const label = el.querySelector('span.bnav-label');
        const icon = el.querySelector('span.bnav-icon');
        const lr = label ? label.getBoundingClientRect() : null;
        return {
          key: el.dataset.navKey || '',
          href: el.getAttribute('href') || '',
          w: Math.round(r.width),
          h: Math.round(r.height),
          fits: r.left >= -0.5 && r.right <= vw + 0.5,
          active: el.classList.contains('is-active'),
          current: el.getAttribute('aria-current') || '',
          hasIcon: !!icon,
          hasLabel: !!label,
          labelText: label ? label.textContent.trim() : '',
          labelH: lr ? Math.round(lr.height * 100) / 100 : 0,
          labelFs: label ? px(getComputedStyle(label).fontSize) : 0,
        };
      }),
    };
  });
}

/** True once the bar is on the page. Short, because a bar that is late is a bar that failed. */
async function barAppears(page, ms = 6000) {
  try {
    await page.waitForSelector('nav.bnav', { timeout: ms });
    return true;
  } catch {
    return false;
  }
}

// ============================================================ can we reach a bar at all?

console.log('\n[1] reaching a page that carries the bar');
const probe = await browser.newPage();
await probe.setViewport({ width: 390, height: 780, deviceScaleFactor: 2, isMobile: true });
await probe.goto(`${SITE}${PROBE}`, { waitUntil: 'networkidle2' });
const REACHABLE = await barAppears(probe);
console.log(`      ${PROBE} ${REACHABLE ? 'carries the bar' : 'does NOT carry the bar'}`);
if (!REACHABLE) {
  const why = await probe.evaluate(() => ({
    path: location.pathname,
    root: document.querySelector('#root')?.firstElementChild?.className || '(empty)',
    text: (document.body.innerText || '').trim().slice(0, 120),
  }));
  console.log(`      landed on ${why.path}, root renders .${why.root}`);
  console.log(`      "${why.text.replace(/\s+/g, ' ')}"`);
}
await probe.close();

// ============================================================ 1..7, 9 — the measured suite

if (REACHABLE) {
  console.log('\n[2] the bar at every width §21 names');

  for (const width of WIDTHS) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 780, deviceScaleFactor: 2, isMobile: true });
    await page.goto(`${SITE}${PROBE}`, { waitUntil: 'networkidle2' });
    await barAppears(page);
    // One frame for the safe-area inset and the custom property to settle before anything
    // is measured against them.
    await new Promise((r) => setTimeout(r, 250));

    const at = `${PROBE} @ ${width}`;
    const before = fails.length;

    // ---- 1. the bar exists and holds a legal number of buttons ------------------
    let m = await measure(page);
    check(`${at} - the bar is on the page`, m.present);
    if (!m.present) { await page.close(); continue; }

    check(`${at} - it holds ${MOBILE_NAV_MIN}..${MOBILE_NAV_MAX} items`,
      m.items.length >= MOBILE_NAV_MIN && m.items.length <= MOBILE_NAV_MAX, `${m.items.length} items`);
    check(`${at} - the bar is named for a screen reader`, m.bar.ariaLabel.length > 0,
      'nav.bnav has no aria-label');
    check(`${at} - every item names a registry key`,
      m.items.every((i) => !!navRegistryEntry(i.key)),
      m.items.map((i) => i.key || '(none)').join(', '));
    /*
      The browser's half of test-navigation.mjs §9. The unit suite proves the RESOLVER takes
      the route from the registry; this proves the anchor actually rendered that route into
      its href rather than something the component invented on the way past.
    */
    check(`${at} - every href is the registry's route for its key`,
      m.items.every((i) => navRegistryEntry(i.key) && i.href === navRegistryEntry(i.key).route),
      m.items.map((i) => `${i.key}->${i.href}`).join(' '));
    check(`${at} - every item has an icon and a label`,
      m.items.every((i) => i.hasIcon && i.hasLabel),
      m.items.filter((i) => !i.hasIcon || !i.hasLabel).map((i) => i.key).join(', '));
    check(`${at} - every label has a word in it`,
      m.items.every((i) => i.labelText.length > 0), 'an icon with no word is a button a yuvak learns by pressing');

    // ---- 2. no horizontal scrolling, measured element by element ----------------
    check(`${at} - the document does not scroll sideways`, m.docScrollWidth <= m.vw + 0.5,
      `scrollWidth ${m.docScrollWidth} > ${m.vw}`);
    check(`${at} - nothing is laid out past the screen edge`, m.overflowing.length === 0,
      m.overflowing.slice(0, 3).join(' | '));
    check(`${at} - the bar itself spans the screen and no more`,
      m.bar.left >= -0.5 && m.bar.right <= m.vw + 0.5, `[${m.bar.left}…${m.bar.right}] in ${m.vw}`);
    check(`${at} - every item is inside the viewport`, m.items.every((i) => i.fits),
      m.items.filter((i) => !i.fits).map((i) => i.key).join(', '));

    // ---- 3. tap targets, in BOTH dimensions ------------------------------------
    const small = m.items.filter((i) => i.h < 44 || i.w < 44);
    check(`${at} - every item is at least 44x44`, small.length === 0,
      small.map((i) => `${i.key} ${i.w}x${i.h}`).join(' | '));

    // ---- 4. Gujarati keeps its matras -----------------------------------------
    check(`${at} - no text in the bar below 12px`, m.smallest.size >= 12,
      `${m.smallest.size}px on ${m.smallest.what}`);

    // ---- 6. the label is one line ---------------------------------------------
    const wrapped = m.items.filter((i) => i.labelFs > 0 && i.labelH > i.labelFs * 1.6);
    check(`${at} - no label wraps to a second line`, wrapped.length === 0,
      wrapped.map((i) => `${i.key} ${i.labelH}px at ${i.labelFs}px`).join(' | '));

    // ---- 7. exactly one active item, and it says so to a screen reader ---------
    const active = m.items.filter((i) => i.active);
    check(`${at} - exactly one item is active`, active.length === 1, `${active.length} carry .is-active`);
    if (active.length === 1) {
      check(`${at} - the active item carries aria-current="page"`, active[0].current === 'page', `aria-current="${active[0].current}"`);
      check(`${at} - the active item is the one for this page`, active[0].href === PROBE, `${active[0].key} -> ${active[0].href}`);
      check(`${at} - no inactive item claims aria-current`,
        m.items.filter((i) => !i.active).every((i) => i.current !== 'page'), 'two items both say "page"');
    }

    // ---- 5a. the room is reserved -----------------------------------------------
    /*
      Half of assertion 5, and the half that is cheap enough to run at every width: the bar
      declares its own height as a custom property and something above the content reserves
      that much. The empirical other half — scroll all the way down and look — costs a full
      lazy-loaded feed, so it runs once, below.
    */
    check(`${at} - --bnav-h resolves to the bar's real height`,
      Math.abs(m.declaredHeight - m.bar.height) <= 1.5,
      `--bnav-h resolves to ${m.declaredHeight}, bar measures ${m.bar.height}`);
    check(`${at} - the page reserves room for the bar`, m.reserved >= m.bar.height - 0.5,
      `${m.reserved}px reserved on ${m.reservedOn} for a ${m.bar.height}px bar`);

    console.log(`  ${fails.length === before ? 'PASS' : 'FAIL'}  ${width}px  -  ${m.items.map((i) => i.key).join(' / ')}`);
    await page.close();
  }

  // ---- 5b. and nothing is actually left under it at the foot of the page -------
  /*
    Once, at 390px, rather than at all six widths — and that is a considered trade rather
    than a shortcut. દર્શન is a lazy feed of 109 images: reaching its true bottom means
    loading the tail of it, six times over, from an image CDN that starts answering 429 to a
    referrer that asks too often. The reserved-room check above is the same requirement
    stated in CSS and it runs at every width; this is the one run that confirms the CSS
    describes what the browser actually did.

    The scroll is a loop, not a jump. One `scrollTo(scrollHeight)` on a feed that loads more
    as you go lands short of the bottom and then measures an image that is simply not
    scrolled to yet — which reads as a failure and is not one. It settles when the scroll
    height stops changing.
  */
  console.log('\n[3] nothing is left under the bar at the foot of the page');
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 780, deviceScaleFactor: 2, isMobile: true });
    await page.goto(`${SITE}${PROBE}`, { waitUntil: 'networkidle2' });
    await barAppears(page);

    let settled = false;
    let lastHeight = -1;
    for (let i = 0; i < 25; i++) {
      const h = await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        return document.documentElement.scrollHeight;
      });
      await new Promise((r) => setTimeout(r, 600));
      if (h === lastHeight) { settled = true; break; }
      lastHeight = h;
    }
    await new Promise((r) => setTimeout(r, 600));

    const m = await measure(page);
    console.log(`      page settled at ${m.scrollHeight}px after ${settled ? 'a stable' : 'a still-growing'} scroll`);
    check('the page really is scrolled to the bottom', m.atBottom, `scrollHeight ${m.scrollHeight}`);
    check('the last thing on the page is above the bar',
      !!m.lastContent && m.lastContent.bottom <= m.bar.top + 0.5,
      m.lastContent ? `${m.lastContent.what} ends at ${m.lastContent.bottom}, bar starts at ${m.bar.top}` : 'no content found');
    check('and still no sideways scroll down there',
      m.docScrollWidth <= m.vw + 0.5 && m.overflowing.length === 0,
      m.overflowing.slice(0, 3).join(' | '));
    await page.close();
  }

  // ---- 9. it survives a reload and is there on first paint --------------------
  /*
    Navigated and reloaded with `domcontentloaded` only. Waiting for networkidle here would
    be waiting for the settings read, which is precisely what the bar must NOT wait for: the
    cache in useNavigation.js exists so a bar is painted before the network answers, and a
    check that gave the network time would pass whether that cache worked or not.
  */
  console.log('\n[4] the bar survives a reload and is not waiting on the network');
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 780, deviceScaleFactor: 2, isMobile: true });
    await page.goto(`${SITE}${PROBE}`, { waitUntil: 'networkidle2' });
    await barAppears(page);

    await page.reload({ waitUntil: 'domcontentloaded' });
    const t0 = Date.now();
    const back = await barAppears(page, 5000);
    const took = Date.now() - t0;
    check('the bar is back after a reload', back, `not within 5s`);
    check('...and it did not need the network to appear', !back || took < 2500, `${took}ms after DOMContentLoaded`);
    if (back) {
      const m = await measure(page);
      check('...with the same number of items', m.items.length >= MOBILE_NAV_MIN && m.items.length <= MOBILE_NAV_MAX, `${m.items.length}`);
      check('...and one of them still active', m.items.filter((i) => i.active).length === 1);
      check('...and every icon name is one the app can draw',
        m.items.every((i) => i.hasIcon), 'an item rendered with no icon element');
    }
    console.log(`      bar present ${took}ms after DOMContentLoaded`);
    await page.close();
  }
} else {
  console.log('\n[2] the measured suite');
  cannotRun('1 the bar exists and holds 2..5 items', 'no reachable page carries it without a Supabase session');
  cannotRun('2 no horizontal scrolling with the bar on screen', 'same');
  cannotRun('3 tap targets >= 44x44', 'same');
  cannotRun('4 no text below 12px in the bar', 'same');
  cannotRun('5 content is not hidden behind the bar', 'same');
  cannotRun('6 the label does not wrap', 'same');
  cannotRun('7 exactly one active item, with aria-current', 'same');
  cannotRun('9 the bar survives a reload', 'same');
  console.log('');
  console.log(`      /darshan is public only under VITE_PUBLIC_DARSHAN=1 - build with \`npm run build:test\`.`);
  console.log('      If it is set and the bar is still absent, the shell renders it only for a signed-in યુવક.');
}

// ============================================================ 8 — where it must NOT be

/*
  Both of these are about a bar that must be ABSENT, which is measurable with no session at
  all — so they run whether or not the suite above could reach anything.
*/
console.log('\n[5] where the bar must not be');
for (const width of WIDE) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${SITE}${PROBE}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 400));

  const state = await page.evaluate(() => {
    const nav = document.querySelector('nav.bnav');
    if (!nav) return { present: false, display: 'absent' };
    const cs = getComputedStyle(nav);
    const r = nav.getBoundingClientRect();
    return { present: true, display: cs.display, visible: cs.display !== 'none' && r.height > 0 };
  });
  check(`@ ${width} - the bar is not drawn on a wide screen`, !state.present || !state.visible,
    `display: ${state.display}`);
  console.log(`  ${state.present ? (state.visible ? 'FAIL' : 'PASS') : 'PASS'}  ${width}px  -  ${state.display}`);
  await page.close();
}

/*
  લોગિન, at a phone width. A bottom bar here would offer four destinations that every one of
  them bounces straight back to this page: the guard in App.jsx sends an unauthenticated
  visitor to /login from all of them. That is not navigation, it is four buttons that do
  nothing, on the one screen where a યુવક most needs to believe the app works.
*/
{
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 780, deviceScaleFactor: 2, isMobile: true });
  await page.goto(`${SITE}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('form', { timeout: 10_000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  const onLogin = await page.evaluate(() => {
    const nav = document.querySelector('nav.bnav');
    if (!nav) return { present: false };
    const cs = getComputedStyle(nav);
    return { present: true, visible: cs.display !== 'none' && nav.getBoundingClientRect().height > 0 };
  });
  check('@ 360 - લોગિન carries no bottom bar', !onLogin.present || !onLogin.visible,
    'four buttons that all redirect back to this page');
  console.log(`  ${!onLogin.present || !onLogin.visible ? 'PASS' : 'FAIL'}  /login @ 360px`);
  await page.close();
}

// ============================================================ result

await browser.close();
server.close();

console.log(`\n  bottom navigation - ${pass} passed, ${fails.length} failed${notRun.length ? `, ${notRun.length} NOT RUN` : ''}\n`);
if (notRun.length) {
  console.log('  These were not exercised. They are not passes:');
  console.log(notRun.map((n) => `    ~ ${n}`).join('\n') + '\n');
}
if (fails.length) {
  console.log(fails.map((f) => `  ✗ ${f}`).join('\n') + '\n');
  process.exit(1);
}
console.log(`  ✓ ${WIDTHS.join(' / ')} px - the bar fits, taps, reads and does not cover the page`);
console.log(`  ✓ ${WIDE.join(' / ')} px - and is not drawn at all\n`);
