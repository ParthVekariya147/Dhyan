/**
 * Tests for the app shell — the icon on the home screen, and how long a session lasts.
 *
 *     node scripts/test-app-shell.mjs
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why these two are one suite
 * ────────────────────────────────────────────────────────────────────────────
 *
 * They are supabase/migrations/0042's pair, and the migration explains why they ship together:
 * the icon setting is the change, and the session policy is what delivers it. An installed PWA
 * is opened and closed for weeks without ever being *loaded* — the service worker serves the
 * precached shell and a phone that installed in June still runs June's JavaScript in August —
 * so a maximum session age is the mechanism that makes a phone go back to the network at all.
 * Testing either without the other would be testing half a feature.
 *
 * Pure, like scripts/test-domain.mjs and for the same reasons: no Docker, no database, no
 * network, no React. Everything here is a function of its arguments, so it can be checked
 * exactly and in milliseconds. The parts that are not pure are checked elsewhere —
 * scripts/test-nav-grants.mjs asks Postgres about the triggers that mirror these validators,
 * and the manifest function's live behaviour is a deploy-time concern.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this is really protecting
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Three failures, all of which are invisible from the panel and expensive to discover:
 *
 *   1. **An icon that resolves to nothing.** A damaged row must produce the built-in mark, not
 *      an empty manifest entry. The difference is a home screen showing the સંઘ's mark and a
 *      home screen showing a blank square, and on an already-installed iPhone the second one
 *      cannot be corrected by any means at all.
 *
 *   2. **A session policy that signs the સંઘ out by accident.** `enabled` arriving as the
 *      *string* "false" — which a hand-edited jsonb row can easily hold — must resolve to off.
 *      `Boolean("false")` is `true`, so the wrong branch here logs out two thousand people at
 *      once, with no deploy and nothing to point at.
 *
 *   3. **The manifest drifting from the build.** netlify/functions/manifest.js restates the
 *      static fields vite.config.js declares, because a function that must answer in
 *      milliseconds cannot import build configuration. The last group in this file reads both
 *      as text and requires that they still agree.
 *
 * No test framework, matching the house harness: `eq`, `group`, a passed/failed tail, and the
 * exit code as the result.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  APP_ICON_KEY,
  APP_ICON_MAX_BYTES,
  APP_ICON_MIN_PX,
  APP_ICON_OUTPUT_PX,
  APP_ICON_SOURCE_MAX_BYTES,
  APP_ICON_ZOOM_MAX,
  APP_ICON_ZOOM_MIN,
  BUILT_IN_ICON,
  appIconManifestIcons,
  centredIconPlacement,
  clampIconPlacement,
  iconCoverBox,
  iconCropRect,
  resolveAppIcon,
  shouldOfferReinstall,
  validateAppIcon,
  validateAppIconFile,
  validateAppIconSource,
  withVersion,
  zoomIconPlacement,
} from '../shared/domain/appicon.js';
import {
  DEFAULT_SESSION,
  SESSION_KEY,
  SESSION_MAX_HOURS,
  SESSION_MIN_HOURS,
  resolveSessionPolicy,
  sessionExpired,
  sessionRemainingMs,
  validateSessionPolicy,
} from '../shared/domain/session.js';

let pass = 0;
const fails = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else fails.push(`${name}\n       got  ${g}\n       want ${w}`);
};

const group = (name) => console.log(`\n  ${name}`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// A URL of the shape the panel actually stores — a public object in the `app-icon` bucket.
const GOOD_URL = 'https://xyz.supabase.co/storage/v1/object/public/app-icon/icon-1723.png';

const NONE = { url: '', path: '', size: 0, version: 0, updatedAt: null, custom: false };

// ==================================================================== resolveAppIcon
//
// The resolver forgives, because whatever is in the row, three consumers have to render
// something: the manifest function, the running app's <link> tags, and the panel's preview.
// The direction each damaged shape falls in is the whole point — every one of them must land
// on "no custom icon", which is the built-in mark, and never on "a custom icon that happens to
// be broken".

group('resolveAppIcon - nothing configured, in all its shapes');
{
  // The ordinary case for a project that has never opened the panel's card. `settings['app']`
  // has held youtubeUrl and dhun since 0001 and simply has no appIcon field.
  eq('undefined is the built-in mark', resolveAppIcon(undefined), NONE);

  // JSON null is the documented way to clear a custom icon (0042 accepts it deliberately), so
  // it must not be an error here either — pressing "Use the built-in icon" writes exactly this.
  eq('null is the built-in mark', resolveAppIcon(null), NONE);

  // A hand-edited jsonb row can hold anything at all. A string reaching property access would
  // throw on some shapes and silently produce nonsense on others.
  eq('a string is the built-in mark', resolveAppIcon('icon.png'), NONE);
  eq('a number is the built-in mark', resolveAppIcon(7), NONE);
  eq('an array is the built-in mark', resolveAppIcon([]), NONE);

  // An object with no url is not "a custom icon that failed to load", it is no custom icon.
  eq('an empty object is the built-in mark', resolveAppIcon({}), NONE);
  eq('an empty url is the built-in mark', resolveAppIcon({ url: '', version: 2 }), NONE);
  eq('whitespace is an empty url', resolveAppIcon({ url: '   ', version: 2 }), NONE);
  eq('a non-string url is the built-in mark', resolveAppIcon({ url: 42, version: 2 }), NONE);
}

group('resolveAppIcon - schemes that would produce a blank square on a phone');
{
  // http: on an https page is blocked as mixed content; the manifest entry is dropped and
  // Chrome then treats the installed WebAPK as having no icon at all.
  eq('http:// is refused', resolveAppIcon({ url: 'http://cdn.test/i.png', version: 2 }), NONE);

  // data: and blob: are unfetchable by Google's WebAPK minter, which runs on Google's servers
  // and not inside the phone — the URL means something in one browser and nowhere else.
  eq(
    'data: is refused',
    resolveAppIcon({ url: 'data:image/png;base64,iVBORw0KGgo=', version: 2 }),
    NONE
  );
  eq('blob: is refused', resolveAppIcon({ url: 'blob:https://x/abc', version: 2 }), NONE);

  // A relative path is the shape a well-meaning edit produces, and it would resolve against
  // Supabase's origin for some readers and the site's for others.
  eq('a relative path is refused', resolveAppIcon({ url: '/icon-512.png', version: 2 }), NONE);
}

group('resolveAppIcon - a usable icon');
{
  eq(
    'a good https row is carried through whole',
    resolveAppIcon({
      url: GOOD_URL,
      path: 'icon-1723.png',
      size: 41233,
      version: 3,
      updatedAt: '2026-08-15T10:00:00Z',
    }),
    {
      url: GOOD_URL,
      path: 'icon-1723.png',
      size: 41233,
      version: 3,
      updatedAt: '2026-08-15T10:00:00Z',
      custom: true,
    }
  );

  // Trimmed before the scheme test, so a stray newline from a paste does not silently mean
  // "no icon configured".
  eq('the url is trimmed', resolveAppIcon({ url: ` ${GOOD_URL}\n`, version: 1 }).url, GOOD_URL);

  // HTTPS:// — uppercase is a valid scheme and refusing it would be a rule nobody could see.
  eq(
    'the scheme test is case-insensitive',
    resolveAppIcon({ url: GOOD_URL.replace('https', 'HTTPS'), version: 1 }).custom,
    true
  );
}

group('resolveAppIcon - the version counter only ever falls towards zero');
{
  // The counter decides whether an iPhone has already been shown the reinstall notice for this
  // icon. An unreadable value must read as "older than anything": a bogus *large* value would
  // suppress the notice permanently, which is the one direction that never corrects itself.
  eq('a missing version is 0', resolveAppIcon({ url: GOOD_URL }).version, 0);
  eq('a string version is 0', resolveAppIcon({ url: GOOD_URL, version: '4' }).version, 0);
  eq('a negative version is 0', resolveAppIcon({ url: GOOD_URL, version: -3 }).version, 0);
  eq('a zero version stays 0', resolveAppIcon({ url: GOOD_URL, version: 0 }).version, 0);
  eq('NaN is 0', resolveAppIcon({ url: GOOD_URL, version: Number.NaN }).version, 0);
  eq('Infinity is 0', resolveAppIcon({ url: GOOD_URL, version: Infinity }).version, 0);
  eq('null is 0', resolveAppIcon({ url: GOOD_URL, version: null }).version, 0);
  eq('a fraction floors', resolveAppIcon({ url: GOOD_URL, version: 2.9 }).version, 2);

  // A bad version must not cost the icon itself. The mark still shows; only the cache-busting
  // suffix and the iPhone notice are affected.
  eq('a bad version keeps the icon', resolveAppIcon({ url: GOOD_URL, version: '4' }).custom, true);
}

group('resolveAppIcon - `custom` is true only for a usable https url');
{
  // Three separate places ask "is there a custom icon?", so the resolver answers it once. This
  // asserts the answer is exactly "a non-empty https url" and nothing looser.
  const cases = [
    [undefined, false],
    [null, false],
    [{}, false],
    [{ url: '' }, false],
    [{ url: 'http://cdn.test/i.png' }, false],
    [{ url: 'data:image/png;base64,x' }, false],
    [{ url: GOOD_URL }, true],
    [{ url: GOOD_URL, version: 0 }, true],
  ];
  eq(
    'custom follows the url and not the version',
    cases.map(([stored]) => resolveAppIcon(stored).custom),
    cases.map(([, want]) => want)
  );
}

// ==================================================================== validateAppIcon
//
// The other half of the division of labour: the resolver forgives so a stored row always
// renders, the validator refuses so a સંચાલક is told which rule he hit rather than watching the
// old mark stay put and guessing whether the save worked.

group('validateAppIcon - what the panel refuses to store');
{
  eq('missing is refused', validateAppIcon(undefined).ok, false);
  eq('null is refused', validateAppIcon(null).ok, false);
  eq('a non-object is refused', validateAppIcon('icon.png').ok, false);
  eq('no url is refused', validateAppIcon({ version: 1 }).ok, false);
  eq('an empty url is refused', validateAppIcon({ url: '  ', version: 1 }).ok, false);
  eq('http:// is refused', validateAppIcon({ url: 'http://cdn.test/i.png', version: 1 }).ok, false);

  // Oversize. The bucket in 0042 carries the same 512 KB limit, so this is the message he gets
  // before the upload rather than the storage error he would get after it.
  eq(
    'oversize is refused',
    validateAppIcon({ url: GOOD_URL, size: APP_ICON_MAX_BYTES + 1, version: 1 }).ok,
    false
  );
  eq(
    'exactly at the ceiling is allowed',
    validateAppIcon({ url: GOOD_URL, size: APP_ICON_MAX_BYTES, version: 1 }).ok,
    true
  );

  // The version is required rather than defaulted, for the reason 0042 gives: a row written
  // without one is an icon that changes in the database and nowhere else.
  eq('a missing version is refused', validateAppIcon({ url: GOOD_URL }).ok, false);
  eq('version 0 is refused', validateAppIcon({ url: GOOD_URL, version: 0 }).ok, false);
  eq('a fractional version is refused', validateAppIcon({ url: GOOD_URL, version: 1.5 }).ok, false);
  eq('a string version is refused', validateAppIcon({ url: GOOD_URL, version: '2' }).ok, false);

  eq('a good icon passes', validateAppIcon({ url: GOOD_URL, size: 41233, version: 3 }), {
    ok: true,
    url: GOOD_URL,
    version: 3,
  });

  // Every refusal carries a message for the સંચાલક. A silent `{ ok: false }` would surface as a
  // dialog that closes without saving and without saying why.
  const refusals = [undefined, {}, { url: 'http://x/i.png', version: 1 }, { url: GOOD_URL }];
  eq(
    'every refusal explains itself',
    refusals.every((r) => typeof validateAppIcon(r).gu === 'string' && validateAppIcon(r).gu),
    true
  );
}

// ==================================================================== validateAppIconFile
//
// Asks about a *file* the સંચાલક has picked but not yet uploaded, from the decoded bitmap and
// before a single byte goes to storage. Separate from validateAppIcon() because the stored row
// has no file in it — which is what lets the manifest function validate a row without
// pretending to know anything about pixels.

group('validateAppIconFile - the image, before it is uploaded');
{
  const ok = { type: 'image/png', size: 41233, width: 512, height: 512 };

  eq('a good 512x512 PNG passes', validateAppIconFile(ok), { ok: true, width: 512, height: 512 });
  eq('exactly 192 passes', validateAppIconFile({ ...ok, width: 192, height: 192 }).ok, true);

  // SVG: Android's WebAPK minter and iOS's home-screen path both want a raster, and a vector
  // that renders on a laptop can render as nothing on a launcher.
  eq('an SVG is refused', validateAppIconFile({ ...ok, type: 'image/svg+xml' }).ok, false);
  // JPEG cannot carry transparency — a mark on a white square, on every phone, permanently.
  eq('a JPEG is refused', validateAppIconFile({ ...ok, type: 'image/jpeg' }).ok, false);
  // WebP: Safari's home-screen path has not reliably accepted it, and iOS is the one platform
  // that can never be corrected after the fact.
  eq('a WebP is refused', validateAppIconFile({ ...ok, type: 'image/webp' }).ok, false);
  eq('no type at all is refused', validateAppIconFile({ ...ok, type: undefined }).ok, false);
  eq('a missing argument is refused', validateAppIconFile().ok, false);

  eq('oversize is refused', validateAppIconFile({ ...ok, size: APP_ICON_MAX_BYTES + 1 }).ok, false);
  eq('exactly at the ceiling passes', validateAppIconFile({ ...ok, size: APP_ICON_MAX_BYTES }).ok, true);

  // Non-square is refused rather than letter-boxed, because a launcher does not letterbox — it
  // stretches, and a stretched મૂર્તિ is not something to discover from someone else's phone.
  eq('a wide image is refused', validateAppIconFile({ ...ok, width: 600, height: 512 }).ok, false);
  eq('a tall image is refused', validateAppIconFile({ ...ok, width: 512, height: 600 }).ok, false);

  // Below 192 is being upscaled on every phone in the સંઘ, since 192 is the smallest size the
  // manifest declares.
  eq(
    'below the minimum is refused',
    validateAppIconFile({ ...ok, width: APP_ICON_MIN_PX - 1, height: APP_ICON_MIN_PX - 1 }).ok,
    false
  );
  eq('a 0x0 image is refused', validateAppIconFile({ ...ok, width: 0, height: 0 }).ok, false);
  eq('unreadable dimensions are refused', validateAppIconFile({ type: 'image/png' }).ok, false);

  // The messages name the numbers, because "that image is not allowed" leaves him resizing at
  // random. The dimensions message must contain the size he actually picked.
  eq(
    'the non-square message names the size',
    validateAppIconFile({ ...ok, width: 600, height: 512 }).gu.includes('600'),
    true
  );
}

// ==================================================================== validateAppIconSource
//
// The other half of the pair above, and the looser one. It asks about the file the સંચાલક
// PICKED; validateAppIconFile() asks about the PNG the panel produced from it and is what
// actually guards the bucket. The whole point of the split is that a photograph is a legitimate
// source for an icon and used not to be allowed to be one.

group('validateAppIconSource - the file he picked, before it is cropped');
{
  const ok = { type: 'image/jpeg', size: 2_400_000, width: 2560, height: 1440 };

  // The case the old card refused and this exists for: a wide phone photograph.
  eq('a 2560x1440 JPEG passes', validateAppIconSource(ok), { ok: true, width: 2560, height: 1440 });
  eq('a PNG passes too', validateAppIconSource({ ...ok, type: 'image/png' }).ok, true);
  eq('a WebP passes', validateAppIconSource({ ...ok, type: 'image/webp' }).ok, true);
  eq('a HEIC off an iPhone passes', validateAppIconSource({ ...ok, type: 'image/heic' }).ok, true);

  // Shape is deliberately NOT asked about — the crop is the answer to it.
  eq('a tall image passes', validateAppIconSource({ ...ok, width: 800, height: 2000 }).ok, true);
  eq('a square image passes', validateAppIconSource({ ...ok, width: 512, height: 512 }).ok, true);

  // An empty type is a machine that did not recognise the extension, not a bad file; the decode
  // in the browser is the real test and this must not pre-empt it.
  eq('an empty type is left to the decode', validateAppIconSource({ ...ok, type: '' }).ok, true);
  eq('a missing type is left to the decode', validateAppIconSource({ ...ok, type: undefined }).ok, true);
  // Something that positively says it is not an image is refused here rather than downloaded.
  eq('a PDF is refused', validateAppIconSource({ ...ok, type: 'application/pdf' }).ok, false);
  eq('a video is refused', validateAppIconSource({ ...ok, type: 'video/mp4' }).ok, false);

  eq('at the size ceiling passes', validateAppIconSource({ ...ok, size: APP_ICON_SOURCE_MAX_BYTES }).ok, true);
  eq('over the size ceiling is refused', validateAppIconSource({ ...ok, size: APP_ICON_SOURCE_MAX_BYTES + 1 }).ok, false);

  // The SHORT side is what matters: no square can be cut from a 4000x100 strip that is not
  // already being upscaled on every phone.
  eq(
    'a wide strip with a short side under the minimum is refused',
    validateAppIconSource({ ...ok, width: 4000, height: APP_ICON_MIN_PX - 1 }).ok,
    false
  );
  eq(
    'exactly at the minimum on the short side passes',
    validateAppIconSource({ ...ok, width: 4000, height: APP_ICON_MIN_PX }).ok,
    true
  );
  eq('unreadable dimensions are refused', validateAppIconSource({ type: 'image/png' }).ok, false);
  eq('a missing argument is refused', validateAppIconSource().ok, false);

  // The ceiling here is far above the stored one, and that is the design rather than a slip:
  // what he picks is a photograph, what is stored is a 512px PNG made from it.
  eq('the source ceiling is well above the stored one', APP_ICON_SOURCE_MAX_BYTES > APP_ICON_MAX_BYTES, true);
}

// ==================================================================== the crop geometry
//
// Four pure functions in fractions-of-the-square. The same numbers drive the dragged <img>, the
// round launcher preview and the exported canvas, so these tests are the only thing standing
// between "what he lined up" and "what was cut".

group('iconCoverBox - the image at zoom 1, scaled to just fill the square');
{
  eq('a square image is exactly the square', iconCoverBox(512, 512), { width: 1, height: 1 });
  eq('16:9 overhangs left and right', iconCoverBox(1600, 900), { width: 16 / 9, height: 1 });
  eq('9:16 overhangs top and bottom', iconCoverBox(900, 1600), { width: 1, height: 16 / 9 });
  // The short side is always exactly 1 — that IS cover, and it is what makes a freshly picked
  // image fill the frame with no gaps whichever way round it is.
  eq(
    'the short side is always 1',
    [[4000, 300], [300, 4000], [1, 1], [1920, 1080]].every((d) => {
      const b = iconCoverBox(...d);
      return Math.min(b.width, b.height) === 1;
    }),
    true
  );
  eq('nonsense falls back to the square', iconCoverBox(0, 0), { width: 1, height: 1 });
  eq('a negative falls back to the square', iconCoverBox(-5, 100), { width: 1, height: 1 });
}

group('clampIconPlacement - the square stays covered, and the image stays reachable');
{
  const wide = { width: 1600, height: 900 }; // cover box 1.777 x 1

  // Zoomed in or at 1, the image is longer than the square on at least one axis, so the square
  // must stay covered: the left edge may not come right of 0, nor the right edge left of 1.
  eq(
    'a drag past the left edge stops at 0',
    clampIconPlacement({ ...wide, zoom: 1, offsetX: 0.4, offsetY: 0 }).offsetX,
    0
  );
  eq(
    'a drag past the right edge stops at 1 - span',
    clampIconPlacement({ ...wide, zoom: 1, offsetX: -5, offsetY: 0 }).offsetX,
    1 - 16 / 9
  );
  // The short axis is exactly 1 at zoom 1, so there is nowhere to go on it at all.
  eq('the covered axis is pinned', clampIconPlacement({ ...wide, zoom: 1, offsetY: 0.3 }).offsetY, 0);

  // Zoomed out, the image is SMALLER than the square, and the rule inverts: it is the image that
  // must stay inside, so nothing can be dragged off the edge and lost.
  const out = clampIconPlacement({ ...wide, zoom: 0.5, offsetX: -1, offsetY: -1 });
  eq('a zoomed-out image cannot be dragged off the left', out.offsetX, 0);
  eq('nor off the top', out.offsetY, 0);
  eq(
    'nor off the bottom',
    clampIconPlacement({ ...wide, zoom: 0.5, offsetY: 9 }).offsetY,
    1 - 0.5
  );

  eq('the zoom is clamped low', clampIconPlacement({ ...wide, zoom: 0.001 }).zoom, APP_ICON_ZOOM_MIN);
  eq('the zoom is clamped high', clampIconPlacement({ ...wide, zoom: 99 }).zoom, APP_ICON_ZOOM_MAX);
  eq('a NaN zoom becomes 1', clampIconPlacement({ ...wide, zoom: NaN }).zoom, 1);
  eq('an undefined offset centres rather than throwing', clampIconPlacement({ ...wide, zoom: 1 }).offsetX, (1 - 16 / 9) / 2);
}

group('centredIconPlacement - where a freshly picked image opens');
{
  eq(
    'a square image opens filling the square exactly',
    centredIconPlacement({ width: 512, height: 512 }),
    { zoom: 1, offsetX: 0, offsetY: 0 }
  );
  const wide = centredIconPlacement({ width: 1600, height: 900 });
  eq('a wide image opens centred', wide.offsetX, (1 - 16 / 9) / 2);
  eq('...with nothing to move on the short axis', wide.offsetY, 0);
  eq('and at zoom 1, so nothing has been cropped for him yet', wide.zoom, 1);
}

group('zoomIconPlacement - the point he lined up does not walk away');
{
  const img = { width: 1000, height: 1000 };
  const start = { ...img, zoom: 2, offsetX: -0.5, offsetY: -0.5 }; // centred at 2x

  // The middle of the square is the same piece of the picture before and after. This is the
  // whole reason the function exists: growing from the top-left corner instead would slide
  // whatever he had lined up in the circle straight out of it.
  const zoomed = zoomIconPlacement({ ...start, next: 4 });
  const middleBefore = (0.5 - start.offsetX) / 2;
  const middleAfter = (0.5 - zoomed.offsetX) / zoomed.zoom;
  eq('the centre of the square holds through a zoom in', middleBefore.toFixed(6), middleAfter.toFixed(6));

  const out = zoomIconPlacement({ ...start, next: 1.2 });
  eq(
    'and through a zoom out',
    ((0.5 - out.offsetX) / out.zoom).toFixed(6),
    middleBefore.toFixed(6)
  );

  // A wheel holds the pointer instead, which is what makes zooming at the cursor feel right.
  const atCorner = zoomIconPlacement({ ...start, next: 4, focusX: 0.2, focusY: 0.8 });
  eq(
    'a focus point other than the centre holds too',
    ((0.2 - atCorner.offsetX) / atCorner.zoom).toFixed(6),
    ((0.2 - start.offsetX) / start.zoom).toFixed(6)
  );

  // Still clamped afterwards: holding a point still must never be a way to leave a gap.
  eq('the result is still clamped', zoomIconPlacement({ ...start, next: 0.9 }).offsetX >= 0, true);
  eq('and the zoom itself is clamped', zoomIconPlacement({ ...start, next: 500 }).zoom, APP_ICON_ZOOM_MAX);
}

group('iconCropRect - the two rectangles drawImage() is given');
{
  // A square image at rest: the whole picture, straight into the whole PNG.
  eq(
    'a square image at zoom 1 is an untouched copy',
    iconCropRect({ width: 512, height: 512, zoom: 1, offsetX: 0, offsetY: 0, out: 512 }),
    { sx: 0, sy: 0, sWidth: 512, sHeight: 512, dx: 0, dy: 0, dWidth: 512, dHeight: 512 }
  );

  // A 16:9 photograph, centred. The square cut from it is its full height, and the source x
  // starts where the overhanging left third ends.
  const wide = iconCropRect({
    width: 1600,
    height: 900,
    zoom: 1,
    offsetX: (1 - 16 / 9) / 2,
    offsetY: 0,
    out: 512,
  });
  eq('a centred wide crop takes the full height', [wide.sy, wide.sHeight], [0, 900]);
  eq('...and a 900-wide square from the middle', wide.sWidth.toFixed(4), '900.0000');
  eq('...starting a third of the way in', wide.sx.toFixed(4), ((1600 - 900) / 2).toFixed(4));
  eq('...filling the whole PNG', [wide.dx, wide.dy, wide.dWidth, wide.dHeight], [0, 0, 512, 512]);

  // Dragged to the far left: the crop starts at the image's own left edge and nothing is
  // clipped, because the square is still covered.
  const left = iconCropRect({ width: 1600, height: 900, zoom: 1, offsetX: 0, offsetY: 0, out: 512 });
  eq('dragged left, the cut starts at 0', left.sx, 0);
  eq('and still fills the PNG', [left.dx, left.dWidth], [0, 512]);

  // Zoomed in: less of the picture, still the whole PNG.
  const close = iconCropRect({ width: 1000, height: 1000, zoom: 2, offsetX: -0.5, offsetY: -0.5, out: 512 });
  eq('at 2x exactly half the picture is taken', [close.sWidth, close.sHeight], [500, 500]);
  eq('from the middle', [close.sx, close.sy], [250, 250]);
  eq('and it still fills the PNG', [close.dx, close.dy, close.dWidth, close.dHeight], [0, 0, 512, 512]);

  /*
    Zoomed OUT, which is the case the hand-written clipping exists for. The square is bigger than
    the picture, so the source rectangle would stick out past its edges; the surviving piece must
    keep its scale and land in the middle, and the rest of the PNG must be left transparent.
  */
  const small = iconCropRect({ width: 1000, height: 1000, zoom: 0.5, offsetX: 0.25, offsetY: 0.25, out: 512 });
  eq('the whole picture is taken', [small.sx, small.sy, small.sWidth, small.sHeight], [0, 0, 1000, 1000]);
  eq('it lands at a quarter in', [small.dx.toFixed(4), small.dy.toFixed(4)], ['128.0000', '128.0000']);
  eq('at half the size', [small.dWidth.toFixed(4), small.dHeight.toFixed(4)], ['256.0000', '256.0000']);
  eq(
    'so the padding is symmetrical and the rest is transparent',
    (small.dx + small.dWidth).toFixed(4),
    (512 - 128).toFixed(4)
  );

  // Never hands a canvas something that would throw.
  eq('a zero-size image draws nothing', iconCropRect({ width: 0, height: 0, out: 512 }).sWidth, 0);
  eq('a zero output draws nothing', iconCropRect({ width: 512, height: 512, out: 0 }).sWidth, 0);
  eq('a missing argument draws nothing', iconCropRect().sWidth, 0);
  eq(
    'no rectangle ever leaves the picture',
    [
      { zoom: 0.25, offsetX: 0, offsetY: 0 },
      { zoom: 6, offsetX: -5, offsetY: -5 },
      { zoom: 1, offsetX: 99, offsetY: -99 },
      { zoom: NaN, offsetX: NaN, offsetY: NaN },
    ].every((p) => {
      const r = iconCropRect({ width: 1600, height: 900, out: 512, ...p });
      return r.sx >= 0 && r.sy >= 0 && r.sx + r.sWidth <= 1600.0001 && r.sy + r.sHeight <= 900.0001;
    }),
    true
  );
}

group('APP_ICON_OUTPUT_PX - the sizes the PNG is tried at');
{
  eq('starts at the ideal', APP_ICON_OUTPUT_PX[0], 512);
  eq('ends at the minimum, never below it', APP_ICON_OUTPUT_PX.at(-1), APP_ICON_MIN_PX);
  eq(
    'every step is descending',
    APP_ICON_OUTPUT_PX.every((px, i) => i === 0 || px < APP_ICON_OUTPUT_PX[i - 1]),
    true
  );
  // Whatever it steps down to must still pass the rule that guards the bucket, or the panel
  // would produce a file it then refuses.
  eq(
    'every size it can land on satisfies validateAppIconFile',
    APP_ICON_OUTPUT_PX.every(
      (px) => validateAppIconFile({ type: 'image/png', size: 40_000, width: px, height: px }).ok
    ),
    true
  );
}

// ==================================================================== appIconManifestIcons
//
// The array netlify/functions/manifest.js serves and the panel previews. One producer, so the
// preview cannot promise something the manifest does not deliver.

group('appIconManifestIcons - no custom icon means the files the build ships');
{
  const icons = appIconManifestIcons(null);
  eq('three entries', icons.length, 3);
  eq(
    'the built-in files, at the sizes vite.config.js declares',
    icons,
    [
      { src: BUILT_IN_ICON.any192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: BUILT_IN_ICON.any512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: BUILT_IN_ICON.maskable512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]
  );

  // Every failure path in the manifest function calls this with null, and a resolved
  // "no icon" object must reach the same place — otherwise a damaged row and a missing env var
  // would produce two different manifests.
  eq('a resolved empty icon is the same array', appIconManifestIcons(resolveAppIcon(null)), icons);
  eq('undefined is the same array', appIconManifestIcons(undefined), icons);

  // The maskable entry is what stops Android drawing the mark on a white badge. Its absence
  // would look fine on a laptop and wrong on every launcher.
  eq('maskable is declared', icons.some((i) => i.purpose === 'maskable'), true);
}

group('appIconManifestIcons - a custom icon, versioned so the updater re-fetches it');
{
  const icons = appIconManifestIcons(resolveAppIcon({ url: GOOD_URL, version: 3 }));
  eq('three entries', icons.length, 3);

  // Supabase serves public objects with an hour of cache, and Chrome's icon cache, the phone's
  // HTTP cache and Google's WebAPK minter all sit between the row and the home screen. A URL
  // that has not changed is a fetch that does not happen.
  eq('every entry carries ?v=', icons.every((i) => i.src === `${GOOD_URL}?v=3`), true);
  eq('the sizes are unchanged', icons.map((i) => i.sizes), ['192x192', '512x512', '512x512']);
  eq('the purposes are unchanged', icons.map((i) => i.purpose), ['any', 'any', 'maskable']);
  eq('still declared PNG', icons.every((i) => i.type === 'image/png'), true);

  // The single uploaded file is declared `any` and `maskable` both, which is the honest thing
  // one image can do: Android crops it either way, and declaring only `any` makes it draw the
  // mark on a white badge instead. The panel shows him the safe-zone circle before the save.
  eq('maskable is declared for a custom icon too', icons.some((i) => i.purpose === 'maskable'), true);

  // Version 0 — a row whose counter was damaged. The icon still serves; only the suffix goes.
  const unversioned = appIconManifestIcons(resolveAppIcon({ url: GOOD_URL, version: '4' }));
  eq('a damaged version serves the icon unsuffixed', unversioned[0].src, GOOD_URL);
}

// ==================================================================== withVersion

group('withVersion - the cache-buster');
{
  eq('appends ?v=', withVersion('https://x/i.png', 3), 'https://x/i.png?v=3');

  // Supabase storage URLs can already carry a query (`?download=`, transform parameters), and
  // a second `?` produces a URL that fetches nothing.
  eq(
    'uses & when there is already a query',
    withVersion('https://x/i.png?download=1', 3),
    'https://x/i.png?download=1&v=3'
  );

  // A no-op at 0, so a row with no counter yet serves a plain URL rather than `?v=0` — which
  // would be a distinct URL that then has to change again the moment a real version arrives.
  eq('version 0 is a no-op', withVersion('https://x/i.png', 0), 'https://x/i.png');
  eq('a negative version is a no-op', withVersion('https://x/i.png', -1), 'https://x/i.png');
  eq('a string version is a no-op', withVersion('https://x/i.png', '3'), 'https://x/i.png');
  eq('a missing version is a no-op', withVersion('https://x/i.png'), 'https://x/i.png');
  eq('a fractional version floors', withVersion('https://x/i.png', 2.9), 'https://x/i.png?v=2');
}

// ==================================================================== shouldOfferReinstall
//
// iOS copies apple-touch-icon into SpringBoard at "Add to Home Screen" and never reads the page
// again. There is no API, no manifest field and no header that revises it, so the only route is
// a notice asking the યુવક to remove and re-add the app — once per icon, never on every open.

group('shouldOfferReinstall - once per icon, and never for an icon that does not exist');
{
  // Nothing has been configured. A notice here would ask two thousand people to reinstall in
  // order to receive the icon they already have.
  eq('version 0 never offers', shouldOfferReinstall({ version: 0, seen: -1 }), false);
  eq('a missing version never offers', shouldOfferReinstall({}), false);
  eq('no argument never offers', shouldOfferReinstall(), false);
  eq('a negative version never offers', shouldOfferReinstall({ version: -2 }), false);
  eq('a string version never offers', shouldOfferReinstall({ version: '3' }), false);

  // A phone that has never stored anything — including every phone the first time an icon is
  // set, which is exactly who the notice is for.
  eq('unseen offers', shouldOfferReinstall({ version: 3, seen: undefined }), true);
  eq('never stored offers', shouldOfferReinstall({ version: 1 }), true);

  // Once dismissed it stays dismissed, or the notice becomes something people learn to ignore.
  eq('seen does not offer again', shouldOfferReinstall({ version: 3, seen: 3 }), false);
  eq('seen a newer one does not offer', shouldOfferReinstall({ version: 3, seen: 4 }), false);

  // The next icon is a new decision by the સંચાલક and gets its own notice.
  eq('a newer version offers again', shouldOfferReinstall({ version: 4, seen: 3 }), true);

  // A damaged `seen` falls towards showing it. The failure this exists to prevent is a સંઘ
  // looking at an old mark with nobody knowing why; the cost of being wrong is one dismissal.
  eq('a string seen offers', shouldOfferReinstall({ version: 3, seen: '3' }), true);
  eq('a null seen offers', shouldOfferReinstall({ version: 3, seen: null }), true);
  eq('a NaN seen offers', shouldOfferReinstall({ version: 3, seen: Number.NaN }), true);
  eq('an object seen offers', shouldOfferReinstall({ version: 3, seen: {} }), true);
}

// ==================================================================== resolveSessionPolicy
//
// The branch that matters most in this whole file. `enabled` resolving the wrong way does not
// produce a wrong pixel — it signs every યુવક in the સંઘ out at once, from a deploy that
// changed no code they can see.

group('resolveSessionPolicy - off unless somebody deliberately turned it on');
{
  // "Nothing configured" must never mean "expire". Off by default is why deploying 0042
  // changes nothing for anybody.
  eq('absent is off', resolveSessionPolicy(undefined), { enabled: false, hours: 24 });
  eq('null is off', resolveSessionPolicy(null), { enabled: false, hours: 24 });
  eq('a string is off', resolveSessionPolicy('24h'), { enabled: false, hours: 24 });
  eq('an empty object is off', resolveSessionPolicy({}), { enabled: false, hours: 24 });

  // THE ONE. A hand-edited jsonb row, a form that posted a string, a value round-tripped
  // through a query parameter — all produce "false" rather than false, and `Boolean("false")`
  // is `true`. `s.enabled === true` is what stops that switching the whole સંઘ's sessions on.
  eq(
    'the STRING "false" resolves to off',
    resolveSessionPolicy({ enabled: 'false', hours: 24 }),
    { enabled: false, hours: 24 }
  );
  eq(
    'the string "true" also resolves to off',
    resolveSessionPolicy({ enabled: 'true', hours: 24 }).enabled,
    false
  );
  eq('1 resolves to off', resolveSessionPolicy({ enabled: 1, hours: 24 }).enabled, false);
  eq('"yes" resolves to off', resolveSessionPolicy({ enabled: 'yes', hours: 24 }).enabled, false);

  // Hours missing means the policy cannot be applied at all, so it is off — not "off but
  // remember 24". `typeof`, never `Number()`: Number(null) and Number('') are both 0, and a
  // coercing check would turn an empty field into an expiry of zero hours.
  eq('hours missing is off', resolveSessionPolicy({ enabled: true }), { enabled: false, hours: 24 });
  eq('a string hours is off', resolveSessionPolicy({ enabled: true, hours: '24' }).enabled, false);
  eq('a null hours is off', resolveSessionPolicy({ enabled: true, hours: null }).enabled, false);
  eq('a NaN hours is off', resolveSessionPolicy({ enabled: true, hours: Number.NaN }).enabled, false);

  // The pre-filled number is kept across a switched-off policy, so the panel shows the last
  // number he typed when he toggles it back on — the same thing resolveLevel4Gate() does.
  eq(
    'a switched-off policy keeps its hours',
    resolveSessionPolicy({ enabled: false, hours: 72 }),
    { enabled: false, hours: 72 }
  );
  eq('the default hours is DEFAULT_SESSION.hours', resolveSessionPolicy({}).hours, DEFAULT_SESSION.hours);
}

group('resolveSessionPolicy - out of range is clamped, never switched off');
{
  // 0 is "as short as possible" and one hour is the honest answer. Zero itself is not a short
  // session, it is a login screen that reappears on every foreground.
  eq('0 clamps up to the floor', resolveSessionPolicy({ enabled: true, hours: 0 }), {
    enabled: true,
    hours: SESSION_MIN_HOURS,
  });
  eq('a negative clamps up to the floor', resolveSessionPolicy({ enabled: true, hours: -5 }).hours, 1);

  // 5000 is clamped to thirty days rather than switched off, because switching off a policy
  // somebody deliberately enabled is the one direction that fails silently.
  eq('5000 clamps down to the ceiling', resolveSessionPolicy({ enabled: true, hours: 5000 }), {
    enabled: true,
    hours: SESSION_MAX_HOURS,
  });
  eq('a clamped policy stays enabled', resolveSessionPolicy({ enabled: true, hours: 5000 }).enabled, true);

  eq('a fraction rounds', resolveSessionPolicy({ enabled: true, hours: 12.4 }).hours, 12);
  eq('Infinity clamps to the ceiling', resolveSessionPolicy({ enabled: true, hours: Infinity }).enabled, false);

  eq('a good policy is carried through', resolveSessionPolicy({ enabled: true, hours: 12 }), {
    enabled: true,
    hours: 12,
  });
  eq('both bounds are themselves allowed', [
    resolveSessionPolicy({ enabled: true, hours: SESSION_MIN_HOURS }).hours,
    resolveSessionPolicy({ enabled: true, hours: SESSION_MAX_HOURS }).hours,
  ], [SESSION_MIN_HOURS, SESSION_MAX_HOURS]);
}

// ==================================================================== validateSessionPolicy

group('validateSessionPolicy - what the panel refuses to store');
{
  eq('missing is refused', validateSessionPolicy(undefined).ok, false);
  eq('null is refused', validateSessionPolicy(null).ok, false);
  eq('a non-object is refused', validateSessionPolicy('off').ok, false);

  // Refused rather than coerced, so that the string "false" cannot reach the row in the first
  // place — the resolver's guard is the second line of defence, not the only one.
  eq('a string enabled is refused', validateSessionPolicy({ enabled: 'false', hours: 24 }).ok, false);
  eq('a numeric enabled is refused', validateSessionPolicy({ enabled: 1, hours: 24 }).ok, false);
  eq('a missing enabled is refused', validateSessionPolicy({ hours: 24 }).ok, false);

  eq('a string hours is refused', validateSessionPolicy({ enabled: true, hours: '24' }).ok, false);
  eq('a missing hours is refused', validateSessionPolicy({ enabled: true }).ok, false);
  eq('NaN hours is refused', validateSessionPolicy({ enabled: true, hours: Number.NaN }).ok, false);
  eq('fractional hours are refused', validateSessionPolicy({ enabled: true, hours: 1.5 }).ok, false);

  eq('below the floor is refused', validateSessionPolicy({ enabled: true, hours: 0 }).ok, false);
  eq('above the ceiling is refused', validateSessionPolicy({ enabled: true, hours: 721 }).ok, false);
  eq(
    'both bounds are themselves allowed',
    [
      validateSessionPolicy({ enabled: true, hours: SESSION_MIN_HOURS }).ok,
      validateSessionPolicy({ enabled: true, hours: SESSION_MAX_HOURS }).ok,
    ],
    [true, true]
  );

  // The hours are checked even when the switch is off, because that number comes into force the
  // instant somebody flips it — from a screen that shows him the value but not that it is out
  // of range. 0042's trigger applies the same rule where PostgREST cannot go around it.
  eq('bad hours are refused even when disabled', validateSessionPolicy({ enabled: false, hours: 0 }).ok, false);
  eq(
    'huge hours are refused even when disabled',
    validateSessionPolicy({ enabled: false, hours: 99999 }).ok,
    false
  );
  eq(
    'a switched-off policy with good hours passes',
    validateSessionPolicy({ enabled: false, hours: 24 }),
    { ok: true, enabled: false, hours: 24 }
  );

  eq('a good policy passes', validateSessionPolicy({ enabled: true, hours: 12 }), {
    ok: true,
    enabled: true,
    hours: 12,
  });

  const refusals = [undefined, {}, { enabled: 'false', hours: 24 }, { enabled: true, hours: 5000 }];
  eq(
    'every refusal explains itself',
    refusals.every((r) => typeof validateSessionPolicy(r).gu === 'string' && validateSessionPolicy(r).gu),
    true
  );
}

// ==================================================================== sessionExpired
//
// Every ambiguous branch falls towards reloading, and that direction is the point: this whole
// mechanism exists because installed phones get stuck on old builds, so an ambiguity resolved
// as "keep the old build" would be the mechanism failing at its own job. The cost of being
// wrong is one network load at a moment nobody is in the middle of anything.

const HOUR = 60 * 60 * 1000;

group('sessionExpired - a policy that is off never expires anything');
{
  const off = { enabled: false, hours: 24 };
  eq('a fresh session is fine', sessionExpired(off, 1_000, 1_000), false);
  eq('a year-old session is still fine', sessionExpired(off, 0, 365 * 24 * HOUR), false);
  // The damaged-clock branches must not fire either — a switched-off policy is not a shortcut
  // into the expiry logic.
  eq('a missing startedAt is still fine', sessionExpired(off, undefined, 1_000), false);
  eq('a future startedAt is still fine', sessionExpired(off, 9_000, 1_000), false);
  eq('no policy at all is fine', sessionExpired(undefined, 0, 365 * 24 * HOUR), false);
  eq('a string enabled does not expire', sessionExpired({ enabled: 'true', hours: 1 }, 0, 99 * HOUR), false);
}

group('sessionExpired - the boundary');
{
  const on = { enabled: true, hours: 1 };
  eq('a session just started is not expired', sessionExpired(on, 1_000, 1_000), false);
  eq('one millisecond short is not expired', sessionExpired(on, 0, HOUR - 1), false);
  // >=, not >. At exactly the hour the policy has been satisfied; treating the boundary as
  // "not yet" leaves a session that expires only if the phone happens to be looked at later.
  eq('exactly at the boundary is expired', sessionExpired(on, 0, HOUR), true);
  eq('past the boundary is expired', sessionExpired(on, 0, HOUR + 1), true);
  eq('a long policy is respected', sessionExpired({ enabled: true, hours: 720 }, 0, 719 * HOUR), false);
  eq('and expires at its own boundary', sessionExpired({ enabled: true, hours: 720 }, 0, 720 * HOUR), true);
}

group('sessionExpired - a phone whose clock is wrong');
{
  const on = { enabled: true, hours: 24 };

  // A session whose beginning is unknown cannot be shown to be young.
  eq('a missing startedAt is expired', sessionExpired(on, undefined, 5 * HOUR), true);
  eq('a null startedAt is expired', sessionExpired(on, null, 5 * HOUR), true);
  eq('a NaN startedAt is expired', sessionExpired(on, Number.NaN, 5 * HOUR), true);
  eq('a string startedAt is expired', sessionExpired(on, '1000', 5 * HOUR), true);
  eq('a NaN now is expired', sessionExpired(on, 1_000, Number.NaN), true);

  // The one failure mode that never corrects itself. A phone whose clock jumped forward, was
  // corrected, and now holds a startedAt in the future would be treated as "very recently
  // started" forever — permanently stuck on whatever build it had.
  eq('a startedAt in the future is expired', sessionExpired(on, 10 * HOUR, 1 * HOUR), true);
  eq('one millisecond in the future is expired', sessionExpired(on, 1_001, 1_000), true);

  // No tolerance window, deliberately: a spurious reload costs one network request, a missed
  // one costs a યુવક running last month's app for another month.
  eq('there is no grace for small skew', sessionExpired(on, 1_000_005, 1_000_000), true);

  // Defensive, and unreachable through resolveSessionPolicy() — which clamps hours to at least
  // 1 — but a caller passing a raw row must not turn "0 hours" into "expire on every check".
  eq('hours of 0 does not expire', sessionExpired({ enabled: true, hours: 0 }, 0, 99 * HOUR), false);
}

group('sessionRemainingMs - what a timer would be armed with');
{
  const on = { enabled: true, hours: 2 };
  eq('a disabled policy never fires', sessionRemainingMs({ enabled: false, hours: 2 }, 0, 0), Infinity);
  eq('a fresh session has its full length', sessionRemainingMs(on, 0, 0), 2 * HOUR);
  eq('half way through', sessionRemainingMs(on, 0, HOUR), HOUR);
  eq('an expired session is 0, not negative', sessionRemainingMs(on, 0, 5 * HOUR), 0);
  eq('a broken clock is 0', sessionRemainingMs(on, Number.NaN, 0), 0);
}

// ==================================================================== the keys

group('the setting keys the three readers agree on');
{
  // src/lib/useSettings.js, the panel's settingsService.js and netlify/functions/manifest.js all
  // reach into settings['app'].value by these names. 0042's triggers test for the same two
  // strings, so a rename here without a migration produces a guard that silently stops firing.
  eq('the icon key', APP_ICON_KEY, 'appIcon');
  eq('the session key', SESSION_KEY, 'session');

  const migration = read('supabase/migrations/0042_app_shell.sql');
  eq("0042's trigger tests for 'appIcon'", migration.includes("? 'appIcon'"), true);
  eq("0042's trigger tests for 'session'", migration.includes("? 'session'"), true);
}

// ==================================================================== manifest parity
//
// netlify/functions/manifest.js restates the static half of the manifest that vite.config.js
// declares. They cannot share a module: vite.config.js is build configuration that Netlify's
// function bundler never loads, and importing it would pull the entire plugin graph into a
// function that has to answer a manifest fetch in milliseconds.
//
// So the drift is caught rather than prevented, and this is the group that catches it. Read
// both files as text, pull the same fields out of each with the same expression, and require
// that they are identical.
//
// Why it matters, since a mismatched theme colour looks cosmetic: Chrome compares the WHOLE
// manifest against what an installed WebAPK holds. A difference in any of these fields makes it
// re-mint the package for a change nobody made — and for anyone not yet installed, the install
// sheet would show something other than what the build's own manifest promised.

group('the manifest function has not drifted from the build');
{
  const vite = read('vite.config.js');
  const fn = read('netlify/functions/manifest.js');

  // The lookbehind is what keeps `name` from matching inside `short_name`.
  const field = (source, key) => {
    const m = new RegExp(String.raw`(?<![\w$])${key}:\s*'([^']*)'`).exec(source);
    return m ? m[1] : null;
  };

  const FIELDS = [
    'name',
    'short_name',
    'lang',
    'start_url',
    'display',
    'background_color',
    'theme_color',
  ];

  // Both halves are asserted separately from the comparison, because two nulls compare equal:
  // a rename that made the expression stop matching in both files would otherwise pass.
  eq(
    'every field is found in vite.config.js',
    FIELDS.filter((f) => field(vite, f) === null),
    []
  );
  eq(
    'every field is found in the manifest function',
    FIELDS.filter((f) => field(fn, f) === null),
    []
  );
  eq(
    'the two agree, field for field',
    FIELDS.map((f) => `${f}=${field(fn, f)}`),
    FIELDS.map((f) => `${f}=${field(vite, f)}`)
  );

  // The values themselves, spelled out once, so that a change made carefully in both files at
  // the same time still has to be a deliberate edit to this suite as well.
  eq('the app is still called this', field(fn, 'name'), 'નીલકંઠ વર્ણી ધ્યાન');
  eq('it still starts at the root', field(fn, 'start_url'), '/');
  eq('it is still standalone', field(fn, 'display'), 'standalone');
}

group('the manifest function can only ever answer with a manifest');
{
  const fn = read('netlify/functions/manifest.js');

  // THE property this file exists for. A manifest that 500s or hands back HTML is an install
  // that fails and - far worse - an installed Android app whose daily update check cannot read
  // it. Missing env vars, a Supabase outage and a damaged row must all end at HTTP 200 with the
  // icons the build ships.
  eq(
    'no status other than 200 appears anywhere in it',
    [...fn.matchAll(/statusCode:\s*(\d+)/g)].map((m) => m[1]),
    ['200']
  );
  eq('it serves the registered manifest type', fn.includes('application/manifest+json'), true);
  eq('it lets caches re-check', /Cache-Control[^\n]*max-age=\d+/.test(fn), true);

  // The icons come from the shared producer rather than a fourth hand-written copy of the
  // array, and the fallback is that producer's own "no custom icon" answer.
  eq('it uses the shared icon builder', fn.includes('appIconManifestIcons'), true);
  eq('it forgives the stored row rather than trusting it', fn.includes('resolveAppIcon'), true);

  // It reads settings with the secret key, because `settings` is readable by `authenticated`
  // only (0001:245) and Chrome's manifest fetch carries no session at all.
  eq('it reads with the secret key', fn.includes('SUPABASE_SECRET_KEY'), true);
}

group('netlify.toml routes the manifest to the function, forcibly');
{
  const toml = read('netlify.toml');
  const rule = /\[\[redirects\]\][\s\S]*?from = "\/manifest\.webmanifest"[\s\S]*?(?=\n#|\n\[\[|$)/.exec(toml);

  eq('the redirect exists', Boolean(rule), true);
  eq('it points at the function', rule?.[0].includes('/.netlify/functions/manifest'), true);
  eq('it is a rewrite, not a 301', rule?.[0].includes('status = 200'), true);

  // Netlify serves static files BEFORE consulting redirects, and `npm run build` really does
  // produce dist/manifest.webmanifest. Without `force` this rule never fires once: the static
  // file wins, the manifest is frozen at build time, and the icon setting becomes a control
  // that reports "Saved" while every installed phone keeps the old mark. It looks redundant,
  // which is exactly why it is asserted here.
  eq('force = true is present', rule?.[0].includes('force = true'), true);

  // Order still matters for the rest of the file: /admin/* must precede the yuvak catch-all,
  // and the catch-all must be last.
  eq(
    'the SPA catch-all is still the last rule',
    toml.lastIndexOf('from = "/*"') > toml.lastIndexOf('from = "/admin/*"'),
    true
  );
  eq(
    'the manifest rule comes before the catch-all',
    toml.indexOf('from = "/manifest.webmanifest"') < toml.indexOf('from = "/*"'),
    true
  );
}

// ==================================================================== result

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
if (fails.length) {
  console.log(fails.map((f) => `  x ${f}`).join('\n\n') + '\n');
  process.exitCode = 1;
}
