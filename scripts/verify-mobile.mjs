/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE MOBILE ACCEPTANCE TEST (§21) — લોગિન and નોંધણી, at six real widths
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   npm run verify:mobile
 *
 * Why a script and not a look at the screenshots: every failure this checks for is one
 * that a screenshot at 390px hides and a screenshot at 320px shows, and nobody re-takes
 * six screenshots after changing one font size. These are measurements, so they can be
 * re-taken on every build for nothing.
 *
 * The widths are the ones §21 names and they are not arbitrary: 320 is the iPhone SE and
 * every cheap Android in portrait, 360 is the single most common Android width in India,
 * 375/390 are the iPhone mini/standard, 412/430 are the large Androids and the iPhone Pro
 * Max. 320 is the one that decides everything — anything that fits there fits the rest.
 *
 * What it asserts, and what each one is protecting against:
 *
 *   1. NO HORIZONTAL SCROLLING, and no element wider than the screen. `body { overflow-x:
 *      hidden }` HIDES a sideways page rather than preventing one, so scrollWidth alone
 *      would pass while content sat off-screen unreachable. Every element is measured.
 *   2. NOTHING CLIPPED. Every button and input must lie fully inside the viewport.
 *   3. NO TEXT BELOW 12px, so Gujarati keeps its matras.
 *   4. NO INPUT BELOW 16px, which is the size at which iOS Safari zooms the page on focus
 *      and does not zoom back out — the "keyboard breaks the layout" failure.
 *   5. NO OVERSIZED HEADING. One <h1>, and it stays inside the scale.
 *   6. ONE DESIGN SYSTEM (§2, §20). લોગિન and નોંધણી are measured independently and their
 *      numbers must be identical — input height, radius, label size, button size, title
 *      size, container width. This is the check that catches the two pages drifting apart
 *      again, which is what the whole task began with.
 *   7. TAP TARGETS ≥ 44px, the smaller of the two published one-handed floors.
 *   8. VALIDATION DOES NOT MOVE THE PAGE. The primary button's position is measured before
 *      and after a failed submit fills every field with an error message; it must not have
 *      moved by a single pixel.
 *
 * It runs against `dist/`, not the dev server, so what is measured is what ships.
 */
import puppeteer from 'puppeteer-core';
import { createServer } from './serve-dist.mjs';

const CHROME = process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const PORT = 4181;
const server = createServer();
await new Promise((r) => server.listen(PORT, r));
const SITE = `http://localhost:${PORT}`;

/** §21's list, exactly. */
const WIDTHS = [320, 360, 375, 390, 412, 430];

/**
 * The widths §21 does not name, and the blind spot that cost us the desktop layout.
 *
 * Every width above is BELOW --page-max (460px), so at all six of them the form column
 * is simply the screen minus its padding — which means a bug that removes the 460px cap
 * entirely is invisible here. That is not hypothetical: `.auth-wrap` carried both
 * `max-width: var(--page-max)` (forms.css) and `max-width: 100%` (tokens.css's overflow
 * guard) at the same specificity, the bundler emitted the guard last, and લોગિન and
 * નોંધણી rendered as a single 1900px-wide line of inputs on a monitor. All six mobile
 * widths stayed green throughout.
 *
 * So the cap is asserted where it can actually fail: on screens WIDER than the form.
 */
const WIDE = [768, 1280, 1920];

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
  } else {
    fails.push(`${name}${detail ? `  —  ${detail}` : ''}`);
  }
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});

/**
 * Everything one page at one width has to say about itself, measured in the page.
 *
 * Collected in a single evaluate() rather than a dozen round trips, because the numbers
 * must all describe the SAME layout — a measurement taken between two reflows is how a
 * suite like this ends up green on a page that is visibly broken.
 */
async function measure(page) {
  return page.evaluate(() => {
    const px = (v) => Math.round(parseFloat(v) * 100) / 100;
    const vw = document.documentElement.clientWidth;

    // Every element that sticks out past the right edge, or starts left of zero.
    const overflowing = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vw + 0.5 || r.left < -0.5) {
        overflowing.push(`${el.tagName.toLowerCase()}.${el.className || '—'} [${Math.round(r.left)}…${Math.round(r.right)}]`);
      }
    }

    // The smallest rendered text anywhere with actual words in it.
    let smallest = { size: Infinity, what: '' };
    for (const el of document.querySelectorAll('body *')) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const s = px(getComputedStyle(el).fontSize);
      if (s < smallest.size) smallest = { size: s, what: `${el.tagName.toLowerCase()}.${el.className || '—'}` };
    }

    const inputs = [...document.querySelectorAll('.field input, .field select')];
    const buttons = [...document.querySelectorAll('button, a.btn')];
    const h1 = document.querySelector('h1');
    const label = document.querySelector('.field label');
    const wrap = document.querySelector('.auth-wrap');
    const primary = document.querySelector('form .btn:not(.btn-quiet)');

    const cs = (el, prop) => (el ? px(getComputedStyle(el)[prop]) : null);

    return {
      vw,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      overflowing,
      smallest,
      // The design-system fingerprint. લોગિન and નોંધણી must produce identical values.
      system: {
        titleSize: cs(h1, 'fontSize'),
        labelSize: cs(label, 'fontSize'),
        inputSize: cs(inputs[0], 'fontSize'),
        inputHeight: inputs[0] ? Math.round(inputs[0].getBoundingClientRect().height) : null,
        inputRadius: cs(inputs[0], 'borderTopLeftRadius'),
        buttonSize: cs(primary, 'fontSize'),
        buttonRadius: cs(primary, 'borderTopLeftRadius'),
        containerWidth: wrap ? Math.round(wrap.getBoundingClientRect().width) : null,
        containerPad: cs(wrap, 'paddingLeft'),
      },
      inputSizes: inputs.map((el) => px(getComputedStyle(el).fontSize)),
      // Height AND horizontal fit, for every control on the page.
      controls: [...inputs, ...buttons].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          what: `${el.tagName.toLowerCase()}.${el.className || '—'}`,
          h: Math.round(r.height),
          fits: r.left >= -0.5 && r.right <= vw + 0.5,
        };
      }),
      primaryTop: primary ? Math.round(primary.getBoundingClientRect().top + window.scrollY) : null,
    };
  });
}

/** Submits the form empty, which is the fastest way to make every field show an error. */
async function submitEmpty(page) {
  await page.evaluate(() => {
    document.querySelector('form .btn:not(.btn-quiet)')?.click();
  });
  // One frame for React to render the messages into the reserved slots.
  await new Promise((r) => setTimeout(r, 250));
}

const results = {};

/*
  /forgot-password joins the two original pages here, and it belongs in this loop rather
  than in one of its own.

  §18 asks that the recovery screens be "consistent with existing login/register UI", and
  that is not a claim a reading of the CSS can settle - it is the same claim these two pages
  already make about each other, and the reason this file measures rather than reviews. The
  page is built from the same components/Field.jsx and the same styles/forms.css, so it
  either produces the identical fingerprint at every width or something about it is quietly
  different. Adding it to the array is the whole change: all eight checks below, and the
  design-system comparison further down, then cover it too.

  /reset-password is deliberately NOT here. Without a recovery session it has no <form> to
  measure - it renders the refusal screen - so `waitForSelector('form')` would time out. It
  is measured separately below, in the state a visitor without a link actually sees.
*/
for (const path of ['/register', '/login', '/forgot-password']) {
  results[path] = {};

  for (const width of WIDTHS) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 780, deviceScaleFactor: 2, isMobile: true });
    await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle0' });
    // The auth state has to settle before the form exists — until then the route renders
    // the loading dots, and measuring those would prove nothing.
    await page.waitForSelector('form', { timeout: 10_000 });

    const m = await measure(page);
    results[path][width] = m.system;
    const at = `${path} @ ${width}`;

    // ---- 1. no horizontal scrolling -------------------------------------------
    check(`${at} — document does not scroll sideways`, m.docScrollWidth <= m.vw + 0.5,
      `scrollWidth ${m.docScrollWidth} > ${m.vw}`);
    check(`${at} — nothing is laid out past the screen edge`, m.overflowing.length === 0,
      m.overflowing.slice(0, 3).join(' | '));

    // ---- 2/7. controls fit, and are thumb-sized -------------------------------
    const clipped = m.controls.filter((c) => !c.fits);
    check(`${at} — no control is clipped`, clipped.length === 0,
      clipped.slice(0, 3).map((c) => c.what).join(' | '));
    const small = m.controls.filter((c) => c.h < 44);
    check(`${at} — every control is at least 44px tall`, small.length === 0,
      small.slice(0, 3).map((c) => `${c.what} ${c.h}px`).join(' | '));

    // ---- 3. Gujarati keeps its matras -----------------------------------------
    check(`${at} — no text below 12px`, m.smallest.size >= 12,
      `${m.smallest.size}px on ${m.smallest.what}`);

    // ---- 4. iOS does not zoom on focus ----------------------------------------
    const tooSmall = m.inputSizes.filter((s) => s < 16);
    check(`${at} — every input is at least 16px (iOS focus zoom)`, tooSmall.length === 0,
      tooSmall.join(', '));

    // ---- 5. no oversized heading ----------------------------------------------
    check(`${at} — the heading stays inside the scale`,
      m.system.titleSize >= 18 && m.system.titleSize <= 28, `${m.system.titleSize}px`);

    // ---- 8. validation must not move the page ---------------------------------
    const before = m.primaryTop;
    await submitEmpty(page);
    const after = await measure(page);
    check(`${at} — validation messages move nothing`, before === after.primaryTop,
      `button top ${before} → ${after.primaryTop}`);
    check(`${at} — still no sideways scroll once errors are showing`,
      after.docScrollWidth <= after.vw + 0.5 && after.overflowing.length === 0,
      after.overflowing.slice(0, 3).join(' | '));

    await page.close();
  }
}

// ---- 6. ONE design system across both pages -----------------------------------
/*
  The check the whole task exists for. Both pages are measured independently at each
  width and every number in the fingerprint must match — so a font size shaved on one
  page to fix an overflow, which is exactly how the two drifted apart before, fails here
  rather than six months later on somebody's phone.
*/
const LABEL = { '/register': 'નોંધણી', '/forgot-password': 'પાસવર્ડ ભૂલી ગયા?' };

for (const width of WIDTHS) {
  const a = results['/login'][width];
  // લોગિન is the reference every other auth screen is compared against, which is what makes
  // this a system rather than a set of pairs: a third page added later is one entry in this
  // array, and it either matches લોગિન at all six widths or it is a second design.
  for (const other of ['/register', '/forgot-password']) {
    const b = results[other][width];
    for (const key of Object.keys(a)) {
      check(`@ ${width} — લોગિન and ${LABEL[other]} agree on ${key}`, a[key] === b[key],
        `login ${a[key]} vs ${other} ${b[key]}`);
    }
  }
}

// ---- 9. the column stops growing, and centres -----------------------------------
/*
  On a screen wider than the form, three things must be true and only the first one is
  about width: the column is capped at --page-max, it is centred rather than parked
  against the left edge, and the controls inside it are the same size they are on a
  phone. The third is what stops a "desktop fix" from quietly becoming a second design.
*/
const PAGE_MAX = 460;

for (const path of ['/register', '/login', '/forgot-password']) {
  for (const width of WIDE) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
    await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('form', { timeout: 10_000 });

    const m = await measure(page);
    const box = await page.evaluate(() => {
      const r = document.querySelector('.auth-wrap').getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right) };
    });
    const at = `${path} @ ${width}`;

    check(`${at} — the form column stops at --page-max`, m.system.containerWidth === PAGE_MAX,
      `${m.system.containerWidth}px wide, expected ${PAGE_MAX}`);

    // Centred: the gap either side must match. Off-by-one from an odd viewport is fine.
    const gapL = box.left;
    const gapR = width - box.right;
    check(`${at} — the column is centred`, Math.abs(gapL - gapR) <= 1,
      `${gapL}px left vs ${gapR}px right`);

    // The design system does not change because the screen got bigger.
    check(`${at} — controls keep their phone size`,
      m.system.inputHeight >= 44 && m.system.inputSize >= 16,
      `input ${m.system.inputHeight}px tall, ${m.system.inputSize}px text`);

    check(`${at} — document does not scroll sideways`, m.docScrollWidth <= m.vw + 0.5,
      `scrollWidth ${m.docScrollWidth} > ${m.vw}`);

    await page.close();
  }
}

// ---- 10. the refusal screen, which is the one a visitor without a link gets --------
/*
  /reset-password has no <form> until Supabase has opened a recovery session, so it cannot
  join the loops above. What it does have - and what every other check in this file would
  miss - is a screen it shows to somebody arriving with an expired link, a forwarded link,
  or no link at all. That screen is a heading, a paragraph and two full-width links, and it
  is reached by a યુવક who is already stuck; a sideways scroll or a clipped button there is
  worse than anywhere else in the app.

  The `#error=` fragment is what a real expired Supabase link carries, and using it here
  means the page renders its refusal immediately instead of waiting out the six-second grace
  window - so this measures the finished state rather than the spinner.

  Both `.btn`s are <Link>s wearing a button's clothes, which is exactly the thing worth
  measuring: the `a.btn` rule in forms.css is what makes an inline <a> the same object as
  the <button> above it, and without it they would be left-aligned and shrink-wrapped.
*/
for (const width of [...WIDTHS, ...WIDE]) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 780, deviceScaleFactor: 2, isMobile: width < 700 });
  await page.goto(`${SITE}/reset-password#error=access_denied&error_code=otp_expired`, {
    waitUntil: 'networkidle0',
  });
  await page.waitForSelector('.auth-card .btn', { timeout: 10_000 });

  const m = await measure(page);
  const at = `/reset-password (expired link) @ ${width}`;

  check(`${at} — document does not scroll sideways`, m.docScrollWidth <= m.vw + 0.5,
    `scrollWidth ${m.docScrollWidth} > ${m.vw}`);
  check(`${at} — nothing is laid out past the screen edge`, m.overflowing.length === 0,
    m.overflowing.slice(0, 3).join(' | '));

  const clipped = m.controls.filter((c) => !c.fits);
  check(`${at} — no control is clipped`, clipped.length === 0,
    clipped.slice(0, 3).map((c) => c.what).join(' | '));
  const small = m.controls.filter((c) => c.h < 44);
  check(`${at} — every control is at least 44px tall`, small.length === 0,
    small.slice(0, 3).map((c) => `${c.what} ${c.h}px`).join(' | '));
  check(`${at} — no text below 12px`, m.smallest.size >= 12,
    `${m.smallest.size}px on ${m.smallest.what}`);

  // Both ways off the dead end must be there. §1 - a refusal without an exit is the thing
  // this project forbids, and it is one deleted line away at any time.
  const exits = await page.evaluate(() =>
    [...document.querySelectorAll('.auth-card a')].map((a) => a.getAttribute('href'))
  );
  check(`${at} — offers a new link and a way back to લોગિન`,
    exits.includes('/forgot-password') && exits.includes('/login'), exits.join(', '));

  /*
    Nothing internal reaches the screen.

    The page READS `error_code` to decide what to draw, which is exactly the situation in
    which somebody later renders it "to help with support". `otp_expired` and `access_denied`
    are Supabase's words, not a યુવક's, and the second one in particular describes an
    account rather than a link. Asserted against the rendered text rather than the source,
    so it holds however the string arrives.
  */
  const shown = await page.evaluate(() => document.body.innerText);
  check(`${at} — the refusal shows no internal error code`,
    !shown.includes('otp_expired') && !shown.includes('access_denied'), shown.slice(0, 120));

  // And with no recovery session there is no password field to submit, at any width. This
  // is the reset-session bypass, checked from the outside.
  const inputs = await page.evaluate(() => document.querySelectorAll('input').length);
  check(`${at} — no password field without a recovery session`, inputs === 0, `${inputs} input(s)`);

  await page.close();
}

await browser.close();
server.close();

console.log(`\n  mobile acceptance (§21) — ${pass} passed, ${fails.length} failed\n`);
if (fails.length) {
  console.log(fails.map((f) => `  ✗ ${f}`).join('\n') + '\n');
  process.exit(1);
}
console.log('  ✓ ' + `${WIDTHS.join(' / ')} px — લોગિન, નોંધણી and પાસવર્ડ ભૂલી ગયા? fit, agree, and do not jump`);
console.log('  ✓ ' + `${[...WIDTHS, ...WIDE].join(' / ')} px — the expired-link screen fits and keeps both exits`);
console.log('  ✓ ' + `${WIDE.join(' / ')} px — the column stops at ${PAGE_MAX}px and centres\n`);
