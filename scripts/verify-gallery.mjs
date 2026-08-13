/**
 * Acceptance run for the fullscreen દર્શન gallery viewer (લેવલ ૨).
 *
 *   npm run verify:gallery
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this does not talk to Google
 * ────────────────────────────────────────────────────────────────────────────
 *
 * scripts/verify-loading.mjs measures the real thing on purpose — bytes, cache, encode.
 * This one is about behaviour, and behaviour must not be at the mercy of lh3's throttle:
 * a few runs in a row and the CDN starts answering 429, then ERR_BLOCKED_BY_ORB, and every
 * assertion about navigation turns into an assertion about Google's mood.
 *
 * So every lh3 request is answered here with a 1×1 JPEG. The URL is still observed — which
 * is the part that matters for "did it ask for the full width" and "did it preload exactly
 * the two neighbours" — but the picture always arrives, and a refusal happens only when this
 * script decides one should.
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { createServer } from './serve-dist.mjs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// 4180 is verify-loading's, 4181 is verify-mobile's.
const PORT = Number(process.env.PORT) || 4182;
const server = createServer();
await new Promise((r) => server.listen(PORT, r));
// દર્શન sits behind the login guard, so this targets it directly: the build under test must
// come from `npm run build:test`, which sets VITE_PUBLIC_DARSHAN=1.
const SITE = `http://localhost:${PORT}/darshan`;
const ROOT = path.resolve(import.meta.dirname, '..');
const SHOTS = process.env.SHOTS || null;

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'content', 'darshan.json'), 'utf8'));
const active = [...manifest].sort((a, b) => (a.order ?? a.n) - (b.order ?? b.n)).filter((s) => s.url && s.t);
const TOTAL = active.length;

const GU = ['૦', '૧', '૨', '૩', '૪', '૫', '૬', '૭', '૮', '૯'];
const gu = (n) => String(n).replace(/\d/g, (d) => GU[Number(d)]);

/** A valid 1×1 JPEG, so `naturalWidth > 0` really means "the picture arrived". */
const PIXEL = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwc' +
    'KDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAA' +
    'AAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64'
);
const CDN = /lh\d+\.googleusercontent\.com/;

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms, step = 250) => {
  const stop = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > stop) return false;
    await wait(step);
  }
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });

/** A page with the CDN stubbed. `refuse` decides, per call, whether a URL is turned away. */
async function makePage(ctx, refuse = () => false) {
  const pg = await ctx.newPage();
  await pg.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const hits = [];
  await pg.setRequestInterception(true);
  pg.on('request', (req) => {
    const u = req.url();
    if (!CDN.test(u)) return req.continue();
    hits.push(u);
    if (refuse(u)) return req.abort('failed');
    return req.respond({ status: 200, contentType: 'image/jpeg', body: PIXEL });
  });
  return { pg, hits };
}

const shot = async (pg, name) => {
  if (SHOTS) await pg.screenshot({ path: `${SHOTS}/${name}.png` });
};

const ctx = await browser.createBrowserContext();
const { pg: page } = await makePage(ctx);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

/*
  `numShown` and `descShown` are computed rather than merely "is the element in the DOM".

  The requirement they stand for is that the number and the ⓘ control are visible *at all
  times* — and an element can be present and still be gone: opacity 0, visibility hidden,
  display none, or pushed off the bottom of a landscape viewport. An earlier draft of this
  viewer faded exactly these two after four seconds of stillness, so the check that matters
  is the rendered one, not the existence one.
*/
const VISIBLE = `(el) => {
  if (!el) return false;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05
    && r.width > 0 && r.height > 0
    && r.bottom <= window.innerHeight + 0.5 && r.top >= -0.5;
}`;

const snap = () =>
  page.evaluate(`(() => {
    const q = (s) => document.querySelector(s);
    const visible = ${VISIBLE};
    const img = q('img[data-full-image]');
    return {
      open: !!q('.gv'),
      src: img ? img.currentSrc || img.src : null,
      shown: !!(img && img.complete && img.naturalWidth > 0 && img.style.visibility !== 'hidden'),
      count: q('.gv-count')?.textContent?.trim() ?? null,
      num: q('.gv-num')?.textContent?.trim() ?? null,
      numShown: visible(q('.gv-num')),
      descShown: visible(q('.gv-desc-btn')),
      descDisabled: q('.gv-desc-btn')?.disabled ?? null,
      descExpanded: q('.gv-desc-btn')?.getAttribute('aria-expanded') ?? null,
      desc: q('.gv-desc')?.textContent?.trim() ?? null,
      prevDisabled: q('.gv-prev')?.disabled ?? null,
      nextDisabled: q('.gv-next')?.disabled ?? null,
      auto: q('.gv-auto')?.getAttribute('aria-pressed') ?? null,
      fail: !!q('.gv-fail'),
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    };
  })()`);

await page.goto(SITE, { waitUntil: 'networkidle2' });
await page.waitForSelector('.frame');

// ── 1 · opens on the દ્રશ્ય the યુવક tapped, at the full width ───────────────
console.log('\n[1] opens on the દ્રશ્ય the યુવક tapped');
await page.evaluate(() => window.scrollBy(0, window.innerHeight * 3));
await wait(1000);
await page.evaluate(() => window.scrollTo(0, 0));
await wait(400);
const frames = await page.$$('.frame');
console.log(`      ${frames.length} cards mounted, collection is ${TOTAL}`);
await frames[4].click();
await until(async () => (await snap()).shown, 8000);
let s = await snap();
check('the viewer opened', s.open);
check('on દ્રશ્ય ૫, not ૧', s.src === active[4].fullUrl, s.src?.slice(-24));
check('the picture is on screen', s.shown);
check('it asked for the full width, not the feed’s file', s.src?.includes('=w2560') && !s.src?.includes('=w1600'));
check(`counter reads ૫ / ${gu(TOTAL)}`, s.count === `${gu(5)} / ${gu(TOTAL)}`, s.count);
check('the દ્રશ્ય’s own number is on screen', s.num === `#${gu(5)}` && s.numShown, `${s.num} shown=${s.numShown}`);
check('the ⓘ વર્ણન control is on screen', s.descShown && s.descDisabled === false);
check('no horizontal overflow at 412', s.scrollW <= s.innerW + 0.5, `${s.scrollW} vs ${s.innerW}`);
check('the વર્ણન panel starts closed', s.desc === null);
check('આપોઆપ starts off — it never autostarts', s.auto === 'false', s.auto);
await shot(page, 'gv-412-portrait');

// ── 2 · arrows ───────────────────────────────────────────────────────────────
console.log('\n[2] ‹ and › move, and everything moves with them');
await page.click('.gv-next');
await until(async () => (await snap()).src === active[5].fullUrl, 8000);
s = await snap();
check('› advanced to દ્રશ્ય ૬', s.src === active[5].fullUrl);
check('counter followed', s.count === `${gu(6)} / ${gu(TOTAL)}`, s.count);
check('the number followed — no stale number', s.num === `#${gu(6)}`, s.num);
check('…and the number never blinked out', s.numShown && s.descShown);
await page.click('.gv-prev');
await until(async () => (await snap()).src === active[4].fullUrl, 8000);
check('‹ went back to દ્રશ્ય ૫', (await snap()).src === active[4].fullUrl);

// ── 3 · keyboard ─────────────────────────────────────────────────────────────
console.log('\n[3] keyboard');
await page.keyboard.press('ArrowRight');
await wait(500);
check('→ advances', (await snap()).count === `${gu(6)} / ${gu(TOTAL)}`);
await page.keyboard.press('ArrowLeft');
await wait(500);
check('← returns', (await snap()).count === `${gu(5)} / ${gu(TOTAL)}`);
// Space belongs to a focused control when there is one — the browser's contract, and a
// screen reader's expectation. Tapping the picture parks focus back on the dialog itself.
await page.touchscreen.tap(206, 300);
await wait(300);
await page.keyboard.press(' ');
await wait(300);
check('Space starts આપોઆપ', (await snap()).auto === 'true');
await page.keyboard.press(' ');
await wait(300);
s = await snap();
check('Space pauses it again', s.auto === 'false');
check('…and Space never moved the દ્રશ્ય', s.count === `${gu(5)} / ${gu(TOTAL)}`, s.count);

// ── 4 · વર્ણન ────────────────────────────────────────────────────────────────
console.log('\n[4] the વર્ણન');
await page.click('.gv-desc-btn');
await wait(400);
s = await snap();
check('ⓘ opens it, verbatim', s.desc === active[4].t, s.desc?.slice(0, 26));
check('the control says it is open', s.descExpanded === 'true');
/*
  The requirement the whole foot is arranged around: opening the વર્ણન must not cost a યુવક
  sight of which દ્રશ્ય he is reading about. The panel is rendered ABOVE this row, never in
  place of it — an earlier draft replaced the number with the open panel and this is the
  check that would have caught it.
*/
check('the number is STILL on screen with the panel open', s.num === `#${gu(5)}` && s.numShown, `${s.num} shown=${s.numShown}`);
check('…and so is the ⓘ control', s.descShown);
await page.click('.gv-next');
await until(async () => (await snap()).desc === active[5].t, 8000);
s = await snap();
check('navigating swaps the text — never stale', s.desc === active[5].t);
check('…and the number swapped with it', s.num === `#${gu(6)}`, s.num);
check('…and the panel stayed open', s.descExpanded === 'true');
await shot(page, 'gv-412-desc');
await page.click('.gv-desc-btn');
await wait(300);
s = await snap();
check('ⓘ closes it again', s.desc === null);
check('…and the row it opened from is untouched', s.numShown && s.descShown && s.descExpanded === 'false');
await page.click('.gv-prev');
await until(async () => (await snap()).num === `#${gu(5)}`, 8000);

// ── 5 · preload, on a page that has never seen these files ──────────────────
console.log('\n[5] preload asks for the neighbours and nothing else');
{
  const cold = await browser.createBrowserContext();
  const { pg, hits } = await makePage(cold);
  await pg.goto(SITE, { waitUntil: 'networkidle2' });
  await pg.waitForSelector('.frame');
  hits.length = 0;
  await (await pg.$$('.frame'))[2].click(); // દ્રશ્ય ૩
  await until(async () => hits.filter((u) => u.includes('=w2560')).length >= 2, 12000);
  await wait(1500);
  const wanted = new Set(hits.filter((u) => u.includes('=w2560')));
  const allowed = new Set([active[1].fullUrl, active[2].fullUrl, active[3].fullUrl]);
  const stray = [...wanted].filter((u) => !allowed.has(u));
  console.log(`      ${wanted.size} full-width request(s) after opening દ્રશ્ય ૩`);
  check('the opened દ્રશ્ય was fetched at full width', wanted.has(active[2].fullUrl));
  check('the next one was preloaded', wanted.has(active[3].fullUrl));
  check('nothing outside દ્રશ્ય ૨–૪ was asked for', stray.length === 0, stray.join(' ').slice(0, 70));
  check('the collection was not preloaded', wanted.size <= 3, `${wanted.size} of ${TOTAL}`);
  await cold.close();
}

// ── 6 · the two ends of the ક્રમ ────────────────────────────────────────────
console.log('\n[6] the two ends of the ક્રમ');
await page.evaluate(() => {
  const b = document.querySelector('.gv-prev');
  for (let i = 0; i < 200; i++) b.click();
});
await wait(1000);
s = await snap();
check('walked back to દ્રશ્ય ૧', s.count === `${gu(1)} / ${gu(TOTAL)}`, s.count);
check('‹ is disabled at the first', s.prevDisabled === true);
check('and it did not wrap round to the last', s.src === active[0].fullUrl);
await page.evaluate(() => {
  const b = document.querySelector('.gv-next');
  for (let i = 0; i < 400; i++) b.click();
});
await wait(1200);
s = await snap();
check(`walked on to દ્રશ્ય ${gu(TOTAL)}`, s.count === `${gu(TOTAL)} / ${gu(TOTAL)}`, s.count);
check('› is disabled at the last', s.nextDisabled === true);
check('and it did not wrap round to the first', s.src === active[TOTAL - 1].fullUrl);

// ── 7 · આપોઆપ ───────────────────────────────────────────────────────────────
console.log('\n[7] આપોઆપ runs, and stops at the end rather than looping');
await page.click('.gv-auto');
await wait(600);
s = await snap();
check('pressing it on the last દ્રશ્ય stops at once', s.auto === 'false');
check('…and did not jump back to દ્રશ્ય ૧', s.count === `${gu(TOTAL)} / ${gu(TOTAL)}`, s.count);
await page.evaluate(() => {
  const b = document.querySelector('.gv-prev');
  for (let i = 0; i < 2; i++) b.click();
});
await until(async () => (await snap()).shown, 10000);
const before = (await snap()).count;
const startedAt = Date.now();
await page.click('.gv-auto');
check('આપોઆપ is on', (await snap()).auto === 'true');
const advanced = await until(async () => (await snap()).count !== before, 20000);
check('it advanced on its own', advanced, `${before} → ${(await snap()).count}`);
/*
  The dwell is a real interval, not zero.

  This is the one behaviour the whole slideshow setting turns on, and the failure it guards
  against is silent: `setTimeout(fn, NaN)` and `setTimeout(fn, 0)` both fire immediately, so a
  settings row that resolved wrongly would not throw — it would run the ક્રમ past a યુવક as
  fast as the pictures decode. resolveSlideshow() is written with `typeof` rather than
  `Number()` precisely so `null`, `''` and `[]` cannot become 0 here, and this is where that
  reasoning is checked against a running browser.

  Bounded generously on both sides: the assertion is "a human interval elapsed", not "exactly
  six seconds" — the dwell is armed from the picture's load event, so a slow stub adds to it.
*/
const dwell = Date.now() - startedAt;
check('the dwell is a real interval, not an instant flicker', !advanced || dwell >= 2000, `${dwell}ms`);
check('…and not an apparently hung slideshow', !advanced || dwell <= 20000, `${dwell}ms`);
const ended = await until(async () => {
  const x = await snap();
  return x.auto === 'false' && x.count === `${gu(TOTAL)} / ${gu(TOTAL)}`;
}, 30000);
s = await snap();
check('it reached the end and switched itself off', ended, `${s.count} auto=${s.auto}`);

// ── 8 · nothing auto-hides, ever ─────────────────────────────────────────────
/*
  The inverse of the test that used to be here.

  This viewer once faded the arrows, the counter and the whole foot after four seconds of
  stillness. That is the conventional gallery behaviour and it was wrong for લેવલ ૨: the
  number is not decoration over the artwork, it is half of what a યુવક is here to learn, and
  taking it away when he stops moving removes the lesson at the moment he settles down to
  study it. So the fade was deleted rather than lengthened, and this asserts it stays deleted
  — including through the two states that would most plausibly bring a timer back: a long
  stillness, and a running slideshow.
*/
console.log('\n[8] the controls never hide');
const held = async (why) => {
  const x = await snap();
  check(`the number is still there ${why}`, x.numShown, `num=${x.num}`);
  check(`the ⓘ control is still there ${why}`, x.descShown);
};
await wait(9000); // more than twice the old fade delay
await held('after nine seconds of stillness');
const stillNav = await page.evaluate(`(() => {
  const visible = ${VISIBLE};
  return {
    prev: visible(document.querySelector('.gv-prev')),
    next: visible(document.querySelector('.gv-next')),
    close: visible(document.querySelector('.gv-close')),
    count: visible(document.querySelector('.gv-count')),
    auto: visible(document.querySelector('.gv-auto')),
  };
})()`);
check('and so are ‹ › ✕, the counter and આપોઆપ', Object.values(stillNav).every(Boolean), JSON.stringify(stillNav));
await shot(page, 'gv-412-resting');
// A tap on the picture must do nothing at all — there is nothing hidden for it to reveal,
// and a tap that quietly navigated would be the surprise §13 forbids.
const atTap = (await snap()).count;
await page.touchscreen.tap(206, 450);
await wait(400);
check('a tap on the picture does not navigate', (await snap()).count === atTap, `${atTap} → ${(await snap()).count}`);
await held('after a tap');

// ── 9 · touch targets, labels, dialog semantics ─────────────────────────────
console.log('\n[9] touch targets, labels and dialog semantics');
const controls = await page.evaluate(() =>
  [...document.querySelectorAll('.gv button')].map((b) => {
    const r = b.getBoundingClientRect();
    return {
      cls: b.className.split(' ')[1] || b.className,
      h: Math.round(r.height),
      label: (b.getAttribute('aria-label') || b.textContent || '').trim(),
      inside: r.left >= -0.5 && r.right <= window.innerWidth + 0.5,
    };
  })
);
check('every control is at least 44px tall', controls.every((c) => c.h >= 44), controls.map((c) => `${c.cls}:${c.h}`).join(' '));
check('every control has an accessible name', controls.every((c) => c.label.length > 0));
check('every control sits inside the viewport', controls.every((c) => c.inside));
const dialog = await page.evaluate(() => {
  const el = document.querySelector('.gv');
  return { role: el.getAttribute('role'), modal: el.getAttribute('aria-modal'), named: !!el.getAttribute('aria-label') };
});
check('the root is a named modal dialog', dialog.role === 'dialog' && dialog.modal === 'true' && dialog.named, JSON.stringify(dialog));
const trapped = await page.evaluate(async () => {
  const root = document.querySelector('.gv');
  root.focus();
  return root.contains(document.activeElement) || document.activeElement === root;
});
check('focus starts inside the dialog', trapped);

// ── 10 · landscape ──────────────────────────────────────────────────────────
console.log('\n[10] landscape');
await page.setViewport({ width: 740, height: 360, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await wait(600);
const land = await page.evaluate(() => {
  const r = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.getBoundingClientRect().toJSON() : null;
  };
  const hit = (a, b) => a && b && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
  const prev = r('.gv-prev');
  const next = r('.gv-next');
  const bottom = r('.gv-bottom');
  return {
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    clash: hit(prev, bottom) || hit(next, bottom),
    allInside: [prev, next, bottom].every(
      (x) => x && x.left >= -0.5 && x.right <= window.innerWidth + 0.5 && x.top >= -0.5 && x.bottom <= window.innerHeight + 0.5
    ),
  };
});
check('no horizontal overflow', land.scrollW <= land.innerW + 0.5, `${land.scrollW} vs ${land.innerW}`);
check('the arrows do not sit on the foot', !land.clash);
check('every control stays inside the viewport', land.allInside, JSON.stringify(land));
// §4 again, in the orientation most likely to break it: a 360px-tall viewport is where a
// foot would be tempted to drop a row, and the number is the row that must never go.
await held('in landscape');
await shot(page, 'gv-740-landscape');
await page.click('.gv-desc-btn');
await wait(400);
const landDesc = await page.evaluate(() => {
  const d = document.querySelector('.gv-desc').getBoundingClientRect();
  const p = document.querySelector('.gv-prev').getBoundingClientRect();
  return {
    fits: d.top >= -0.5 && d.bottom <= window.innerHeight + 0.5,
    clash: !(d.right <= p.left || p.right <= d.left || d.bottom <= p.top || p.bottom <= d.top),
  };
});
check('the વર્ણન panel fits on screen', landDesc.fits);
check('…and does not sit under the arrows', !landDesc.clash);
await held('in landscape with the panel open');
await shot(page, 'gv-740-landscape-desc');
await page.click('.gv-desc-btn');

// ── 11 · every width the brief names ────────────────────────────────────────
console.log('\n[11] every width the brief names');
for (const w of [320, 360, 375, 390, 412, 430]) {
  await page.setViewport({ width: w, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await wait(350);
  const r = await page.evaluate(`(() => {
    const visible = ${VISIBLE};
    const bad = [...document.querySelectorAll('.gv *')].filter((el) => {
      const b = el.getBoundingClientRect();
      if (!b.width && !b.height) return false;
      return b.right > window.innerWidth + 0.5 || b.left < -0.5;
    });
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth + 0.5,
      bad: bad.map((el) => el.className || el.tagName),
      minH: Math.min(...[...document.querySelectorAll('.gv button')].map((b) => b.getBoundingClientRect().height)),
      meta: visible(document.querySelector('.gv-num')) && visible(document.querySelector('.gv-desc-btn')),
    };
  })()`);
  check(
    `${w}px — nothing overflows, number + ⓘ visible, smallest control ${Math.round(r.minH)}px`,
    !r.overflow && r.bad.length === 0 && r.minH >= 44 && r.meta,
    `${r.bad.join(',')}${r.meta ? '' : ' meta hidden'}`
  );
}
await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await wait(300);

// ── 12 · closing ────────────────────────────────────────────────────────────
console.log('\n[12] closing');
const scrollBefore = await page.evaluate(() => window.scrollY);
await page.keyboard.press('Escape');
await wait(600);
const closed = await page.evaluate(() => ({
  gone: !document.querySelector('.gv'),
  overflow: document.body.style.overflow,
  focused: document.activeElement?.className || '',
  sceneId: document.activeElement?.dataset?.sceneId || '',
  scrollY: window.scrollY,
  path: location.pathname,
}));
check('Escape closes it', closed.gone);
check('body scrolling is handed back', closed.overflow === '', JSON.stringify(closed.overflow));
check('focus returns to the card that opened it', closed.focused.includes('frame'), `${closed.focused} ${closed.sceneId}`);
check('still on /darshan', closed.path === '/darshan', closed.path);
check('the દર્શન did not jump', Math.abs(closed.scrollY - scrollBefore) < 4, `${scrollBefore} → ${closed.scrollY}`);

// ── 13 · back closes the gallery, it does not leave લેવલ ૨ ──────────────────
console.log('\n[13] browser / hardware back');
await (await page.$$('.frame'))[2].click();
await wait(700);
check('open again', (await snap()).open);
await page.goBack();
await wait(700);
const afterBack = await page.evaluate(() => ({ open: !!document.querySelector('.gv'), path: location.pathname }));
check('back closed the gallery', !afterBack.open);
check('…and stayed on /darshan', afterBack.path === '/darshan', afterBack.path);

// ── 14 · twenty opens and closes ────────────────────────────────────────────
console.log('\n[14] twenty opens and closes');
for (let i = 0; i < 20; i++) {
  await page.evaluate(() => document.querySelectorAll('.frame')[1].click());
  await wait(110);
  await page.keyboard.press('Escape');
  await wait(110);
}
await wait(600);
const stable = await page.evaluate(() => ({
  layers: document.querySelectorAll('.gv').length,
  overflow: document.body.style.overflow,
  listeners: document.querySelectorAll('.gv-stage').length,
}));
check('no viewer left behind', stable.layers === 0, String(stable.layers));
check('body scrolling still restored', stable.overflow === '');
await page.evaluate(() => document.querySelectorAll('.frame')[1].click());
await wait(700);
check('and it still opens on the twenty-first', (await snap()).open);
await page.keyboard.press('Escape');
await wait(400);

// ── 15 · a દ્રશ્ય the CDN refuses ───────────────────────────────────────────
console.log('\n[15] a દ્રશ્ય the CDN refuses');
{
  const badCtx = await browser.createBrowserContext();
  let refusing = true;
  const { pg } = await makePage(badCtx, (u) => refusing && u.includes('=w2560'));
  await pg.goto(SITE, { waitUntil: 'networkidle2' });
  await pg.waitForSelector('.frame');
  await (await pg.$$('.frame'))[0].click();

  const state = () =>
    pg.evaluate(() => {
      const img = document.querySelector('img[data-full-image]');
      return {
        fail: !!document.querySelector('.gv-fail'),
        retry: document.querySelector('.gv-fail button')?.textContent?.trim() ?? null,
        open: !!document.querySelector('.gv'),
        cards: document.querySelectorAll('.card').length,
        loaded: !!(img?.complete && img?.naturalWidth > 0),
      };
    });

  // Three jittered retries then give up: roughly 700 + 1400 + 2800 ms.
  check('after its retries it says so', await until(async () => (await state()).fail, 15000));
  const f = await state();
  check('…and offers ફરી પ્રયત્ન કરો', f.retry === 'ફરી પ્રયત્ન કરો', f.retry);
  check('the viewer did not crash', f.open);
  check('the દર્શન page behind it is intact', f.cards > 0, String(f.cards));
  await shot(pg, 'gv-412-error');

  refusing = false;
  await pg.click('.gv-fail button');
  check(
    'ફરી પ્રયત્ન કરો recovers that one દ્રશ્ય',
    await until(async () => {
      const r = await state();
      return !r.fail && r.loaded;
    }, 15000),
    JSON.stringify(await state())
  );

  // The useImageRetry reset trap: a દ્રશ્ય that exhausted its retries must not leave the
  // next one with none.
  refusing = true;
  await pg.click('.gv-next');
  check('the next દ્રશ્ય still gets its own retries', await until(async () => (await state()).fail, 15000));
  refusing = false;
  await pg.click('.gv-fail button');
  check(
    '…and recovers on its own ફરી પ્રયત્ન',
    await until(async () => {
      const r = await state();
      return !r.fail && r.loaded;
    }, 15000),
    JSON.stringify(await state())
  );
  await badCtx.close();
}

console.log('\n  page errors: ' + (errors.length ? errors.join(' | ') : 'none'));
if (errors.length) failures++;

console.log(`\n${failures === 0 ? 'GALLERY ACCEPTED' : failures + ' FAILED'}\n`);
await browser.close();
server.close();
process.exit(failures ? 1 : 0);
