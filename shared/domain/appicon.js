/**
 * The app's icon, chosen by the સંચાલક instead of compiled into the build.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this is a setting, and what a setting can honestly promise
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Everyone has installed the app to their home screen. Changing the mark it shows there used
 * to mean rasterising four PNGs, committing them and redeploying — an engineer's job for a
 * decision that is not an engineer's to make. So the icon becomes a row in `settings['app']`,
 * exactly as the two ધૂન and the slideshow interval already are.
 *
 * What that row can and cannot reach is the part worth writing down, because it is a platform
 * limit and not something better code would fix:
 *
 *   * **A browser tab, and anyone who has not installed** — changes on the next load. The
 *     `<link rel="icon">` is rewritten at runtime from this row.
 *   * **A new install, on any platform** — gets the new mark, because the manifest is read at
 *     install time and netlify/functions/manifest.js serves this row's icon.
 *   * **Android, already installed** — changes on its own, without anybody being asked to do
 *     anything. Chrome re-fetches the manifest roughly once a day, notices the icon differs
 *     from the installed WebAPK's, and requests an updated one through Play Services. It
 *     lands within a day or two. This is the whole reason the manifest is served by a
 *     function rather than as the static file vite-plugin-pwa builds: a static manifest can
 *     never differ from itself, so Chrome would never see a change to act on.
 *   * **iPhone, already installed** — **never changes, by any means.** iOS reads
 *     `apple-touch-icon` once, at the moment "Add to Home Screen" is tapped, copies the
 *     bitmap into SpringBoard and never looks at the page again. There is no API, no
 *     manifest field and no header that revises it. The only route is to remove the app and
 *     add it again.
 *
 * That last case is why `version` exists below and why it is a counter rather than a
 * timestamp — see its own note.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * One image, not four
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The build ships four files (favicon.svg, icon-192, icon-512, icon-maskable-512) because a
 * designer produced them together. A સંચાલક uploading a replacement has one image, so this
 * stores one URL and declares it for every purpose — including `maskable`, which Android
 * crops to the launcher's shape and of which only the central 80% is guaranteed to survive.
 *
 * The panel is what makes that honest: AppIconCard draws the safe-zone circle over the
 * preview before the save, so the cropping is something he sees rather than something he
 * discovers on a phone. vite.config.js explains at length why the built-in maskable icon is
 * its own smaller drawing; a custom icon cannot be redrawn for him, so it is shown to him
 * instead.
 */

/** The field inside `settings['app'].value`. */
export const APP_ICON_KEY = 'appIcon';

/** The storage bucket the bytes live in (supabase/migrations/0042_app_shell.sql). */
export const APP_ICON_BUCKET = 'app-icon';

/**
 * 512 KB, and it is generous rather than tight.
 *
 * A 512×512 PNG of a flat devotional mark is 20-60 KB. The ceiling exists to refuse a
 * photograph somebody dropped in by mistake, not to make anyone optimise: this file is
 * fetched by Chrome's WebAPK updater and by every browser tab, so it is small on purpose,
 * but a સંચાલક should never have to think about bytes.
 *
 * Must stay in step with `file_size_limit` on the bucket in 0042. Checked in the panel first
 * so he is told before the upload starts rather than after it fails.
 */
export const APP_ICON_MAX_BYTES = 512 * 1024;

/**
 * PNG only — **what is stored**, and that is a decision rather than an oversight.
 *
 * SVG is refused because Android's WebAPK minter and iOS's home-screen path both want a
 * raster, and a vector that renders on a laptop can render as nothing at all on a launcher.
 * JPEG is refused because an app icon needs transparency and a JPEG cannot carry it — a mark
 * on a white square is what a JPEG upload would produce, on every phone, permanently.
 * WebP is refused for the narrower reason that Safari's home-screen path has historically not
 * accepted it, and the one platform that can never be corrected after the fact is the one
 * platform this must not be wrong on.
 *
 * None of that is a reason to make the સંચાલક go and find a PNG. It is a rule about the bytes
 * that reach a phone, not about the photograph on his laptop — see APP_ICON_SOURCE_MAX_BYTES
 * and the crop geometry below, which are how a JPEG off a camera becomes one of these.
 */
export const APP_ICON_MIME = Object.freeze(['image/png']);

/**
 * ────────────────────────────────────────────────────────────────────────────
 * What he may PICK, as opposed to what is stored
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The panel used to demand a square PNG of at least 192px and refuse everything else, which
 * put the whole job on the સંચાલક: open something that can crop, square the image, export a
 * PNG, come back. That is a design tool's job description, and he does not have one.
 *
 * So the two rules are split. **This** one governs the file he picks and is deliberately
 * loose - any raster the browser can decode, at any shape, up to a phone-photograph size.
 * APP_ICON_MIME above still governs what is uploaded, and nothing about it is relaxed: the
 * panel crops his pick to a square and re-encodes it as a PNG before a byte goes anywhere, so
 * the bucket, the trigger in 0042 and every phone see exactly what they saw before.
 *
 * The mime list is a courtesy for the file picker's own filter and for a message worth reading;
 * it is not the test. The test is whether the browser can decode the bytes, which is the only
 * honest one - `type` is whatever the operating system said about the file name, and a `.png`
 * arrives as `image/png`, as `application/octet-stream` or as an empty string depending on the
 * machine. An empty type is therefore accepted here and left to the decode.
 */
export const APP_ICON_SOURCE_MIME = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
  'image/heic',
  'image/heif',
]);

/**
 * 16 MB for the picked file — thirty-two times what may be stored.
 *
 * It is not a contradiction of APP_ICON_MAX_BYTES, it is the other end of the same pipe. What
 * he picks is a photograph off a phone; what is stored is a 512px PNG the panel produced from
 * it. The ceiling here exists only to refuse something that would take a minute to decode and
 * exhaust the tab's memory, so it is set where a real camera file is comfortably under it and
 * a video somebody renamed is not.
 */
export const APP_ICON_SOURCE_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Square, and at least 192 on a side.
 *
 * 192 is the smallest icon the manifest declares, so anything below it is being upscaled on
 * every phone in the સંઘ. 512 is what the panel asks for and what the built-in icons are.
 * Non-square is refused rather than letter-boxed: a launcher does not letterbox, it stretches,
 * and a stretched મૂર્તિ is not something to discover from someone else's home screen.
 */
export const APP_ICON_MIN_PX = 192;
export const APP_ICON_IDEAL_PX = 512;

/**
 * The four files the build ships, which are what "no custom icon" resolves to.
 *
 * Held here rather than in each caller so that the app, the panel's preview and the manifest
 * function are describing one set of paths. They are public/ files served from the site root.
 */
export const BUILT_IN_ICON = Object.freeze({
  favicon: '/favicon.svg',
  apple: '/apple-touch-icon.png',
  any192: '/icon-192.png',
  any512: '/icon-512.png',
  maskable512: '/icon-maskable-512.png',
});

/**
 * No icon configured — today's behaviour exactly, so a project that never opens this card
 * keeps the mark it already has. Same rule DEFAULT_SLIDESHOW follows and for the same reason.
 */
export const DEFAULT_APP_ICON = Object.freeze({
  url: '',
  path: '',
  size: 0,
  version: 0,
  updatedAt: null,
});

/**
 * `settings['app'].appIcon` → the icon actually in force.
 *
 * Forgiving in the same shape as resolveSlideshow(): this is jsonb that anybody holding
 * `settings.update` once wrote, and every way it can be wrong has to end at something the
 * three consumers can render. The direction each branch falls in is the point —
 *
 *   absent / not an object   → the built-in mark. Nothing has been configured.
 *   url missing or not a     → the built-in mark. A row naming no image is not "a custom
 *   string / not https           icon that failed to load", it is no custom icon, and the
 *                                distinction decides whether a phone shows the સંઘ's mark or
 *                                a broken-image square on its home screen.
 *   version not a number     → 0. The counter only ever grows, so an unreadable one must
 *                                read as "older than anything", never as "newer" — a bogus
 *                                large value would suppress the iPhone notice forever.
 *
 * `custom` is returned rather than left to callers to infer from a non-empty url, because
 * three separate places ask the question and a fourth spelling of it would be a fourth
 * chance to get it wrong.
 *
 * **`https` only, and not merely as hygiene.** An `http:` icon URL on an https page is
 * blocked as mixed content by every browser — the manifest entry is simply dropped, and
 * Chrome then treats the WebAPK as having no icon at all. A `data:` or `blob:` URL is refused
 * for the same class of reason: neither is fetchable by the WebAPK minter, which runs on
 * Google's servers and not in the phone.
 */
export function resolveAppIcon(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const url = typeof s.url === 'string' ? s.url.trim() : '';
  const ok = url !== '' && /^https:\/\//i.test(url);
  const version = typeof s.version === 'number' && Number.isFinite(s.version) && s.version > 0
    ? Math.floor(s.version)
    : 0;

  if (!ok) return { ...DEFAULT_APP_ICON, custom: false };

  return {
    url,
    path: typeof s.path === 'string' ? s.path : '',
    size: typeof s.size === 'number' && Number.isFinite(s.size) ? s.size : 0,
    version,
    updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : null,
    custom: true,
  };
}

/**
 * Refuses what resolveAppIcon() would silently drop — the same division of labour as every
 * other validator in this folder.
 *
 * The resolver forgives because a stored row must always produce a rendered icon; this
 * refuses because a સંચાલક who uploaded a 900 KB photograph should be told which rule he hit,
 * not watch the old mark stay put and be left guessing whether the save worked.
 */
export function validateAppIcon(icon) {
  const i = icon && typeof icon === 'object' ? icon : null;
  if (!i) return { ok: false, gu: 'The icon setting is missing.' };

  const url = typeof i.url === 'string' ? i.url.trim() : '';
  if (!url) return { ok: false, gu: 'Choose an icon image first.' };
  if (!/^https:\/\//i.test(url)) {
    return { ok: false, gu: 'The icon address must start with https://.' };
  }

  if (typeof i.size === 'number' && i.size > APP_ICON_MAX_BYTES) {
    return {
      ok: false,
      gu: `The icon must be ${Math.round(APP_ICON_MAX_BYTES / 1024)} KB or smaller.`,
    };
  }

  const v = i.version;
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v < 1) {
    return { ok: false, gu: 'The icon version is not a whole number.' };
  }

  return { ok: true, url, version: v };
}

/**
 * Refuses an image the સંચાલક has picked but not yet uploaded — dimensions and type, checked
 * in the browser from the decoded bitmap before a single byte goes to storage.
 *
 * Separate from validateAppIcon() because it asks about a **file**, and the stored row has no
 * file in it. Keeping the two apart is what lets the manifest function validate a row without
 * pretending to know anything about pixels.
 */
export function validateAppIconFile({ type, size, width, height } = {}) {
  if (!APP_ICON_MIME.includes(String(type))) {
    return { ok: false, gu: 'The icon must be a PNG image.' };
  }
  if (typeof size === 'number' && size > APP_ICON_MAX_BYTES) {
    return {
      ok: false,
      gu: `The icon must be ${Math.round(APP_ICON_MAX_BYTES / 1024)} KB or smaller. This one is ${Math.round(size / 1024)} KB.`,
    };
  }
  if (!width || !height) return { ok: false, gu: 'That image could not be read.' };
  if (width !== height) {
    return { ok: false, gu: `The icon must be square. This one is ${width} x ${height}.` };
  }
  if (width < APP_ICON_MIN_PX) {
    return {
      ok: false,
      gu: `The icon must be at least ${APP_ICON_MIN_PX} x ${APP_ICON_MIN_PX}. This one is ${width} x ${height}.`,
    };
  }
  return { ok: true, width, height };
}

/**
 * Refuses the file he **picked**, which is a much shorter list of reasons than the file that is
 * **stored**.
 *
 * Only three things can be wrong with a source image, and all three are things the panel cannot
 * fix for him:
 *
 *   * it is not an image at all, which the decode discovers and this cannot;
 *   * it is enormous, which would hang the tab rather than produce a bad icon;
 *   * its **short side** is under 192px, so no square can be cut from it that is not already
 *     being upscaled on every phone in the સંઘ.
 *
 * Shape is deliberately not checked. A 2560 x 1440 photograph is a perfectly good source for a
 * square icon - that is the entire point of the crop - and refusing it for being wide was the
 * old behaviour that sent people off to find another program.
 */
export function validateAppIconSource({ type, size, width, height } = {}) {
  const t = String(type ?? '');
  // An empty type is a machine that did not recognise the extension, not a bad file. Anything
  // that claims to be an image is let through to the decode, which is the real test; only a
  // type that positively says "not an image" is refused here.
  if (t !== '' && !t.startsWith('image/')) {
    return { ok: false, gu: 'That is not an image. Choose a JPG, PNG or WebP.' };
  }
  if (typeof size === 'number' && size > APP_ICON_SOURCE_MAX_BYTES) {
    return {
      ok: false,
      gu: `That image is ${Math.round(size / (1024 * 1024))} MB. Choose one under ${Math.round(
        APP_ICON_SOURCE_MAX_BYTES / (1024 * 1024)
      )} MB.`,
    };
  }
  if (!width || !height) return { ok: false, gu: 'That image could not be read.' };
  const shortSide = Math.min(width, height);
  if (shortSide < APP_ICON_MIN_PX) {
    return {
      ok: false,
      gu: `That image is ${width} x ${height}. Its shorter side must be at least ${APP_ICON_MIN_PX} so the icon is not blurred.`,
    };
  }
  return { ok: true, width, height };
}

/* ---------------------------------------------------------------------------
 * The crop — how a picture of any shape becomes the square that is saved
 * ---------------------------------------------------------------------------
 *
 * Four pure functions and no canvas. The panel drags an <img> around with CSS while he is
 * deciding, and only calls this to turn what he decided into a source rectangle at the moment
 * of the save — so the geometry is written once, tested once (scripts/test-app-shell.mjs), and
 * cannot drift between what he was shown and what was cut.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The units, which are the whole trick
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Everything here is in **fractions of the square**, never in pixels. The square is 1 wide and
 * 1 tall, whatever it happens to measure on screen; the image is placed inside it with a
 * top-left corner (`offsetX`, `offsetY`) and a size that comes from its aspect and the zoom.
 *
 * That is not a stylistic choice. The preview is a responsive box - 168px on a laptop, less on
 * a narrow window, and a different number again in the round preview beside it - and offsets
 * held in screen pixels would mean the crop moved when the window was resized, or that the two
 * previews disagreed about where the image was. Fractions are the same number in every box, so
 * one piece of state drives the drag stage, the round preview and the exported canvas alike.
 *
 * Zoom 1 is **cover**: the image is scaled until it just fills the square, which is the state a
 * freshly picked image opens in. Above 1 he is going in closer; below 1 the image shrinks
 * inside the square and the uncovered part stays transparent, which is a legitimate way to make
 * a mark with room around it and is why the lower bound is not simply 1.
 */

/** How much a zoom of 1 may be multiplied or divided by. */
export const APP_ICON_ZOOM_MIN = 0.25;
export const APP_ICON_ZOOM_MAX = 6;

/**
 * The sizes the exported PNG is tried at, largest first.
 *
 * 512 is what is wanted and what nearly every icon lands at. The rest are the answer to a case
 * that only appears now that a photograph can be the source: a 512 x 512 PNG of a detailed
 * photograph can encode to more than the 512 KB the bucket accepts, and PNG has no quality dial
 * to turn down. So the panel steps the size down instead, and the smallest step is
 * APP_ICON_MIN_PX - below that it would be storing something it refuses to accept.
 *
 * Shrinking rather than switching to JPEG is deliberate: see APP_ICON_MIME. A 256px icon is a
 * slightly soft mark on a launcher; a JPEG one is a mark on a white box, for ever, on iOS.
 */
export const APP_ICON_OUTPUT_PX = Object.freeze([512, 448, 384, 320, 256, APP_ICON_MIN_PX]);

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/**
 * The image's size at zoom 1, in fractions of the square — i.e. scaled to just cover it.
 *
 * The short side becomes exactly 1 and the long side overhangs by the aspect ratio. A square
 * image is `{ width: 1, height: 1 }`, which is what makes "an already-square icon needs no
 * cropping at all" fall out of the same code path rather than needing a branch of its own.
 */
export function iconCoverBox(width, height) {
  const w = num(width, 0);
  const h = num(height, 0);
  if (w <= 0 || h <= 0) return { width: 1, height: 1 };
  const aspect = w / h;
  return aspect >= 1 ? { width: aspect, height: 1 } : { width: 1, height: 1 / aspect };
}

export function clampIconZoom(zoom) {
  const z = num(zoom, 1);
  return Math.min(APP_ICON_ZOOM_MAX, Math.max(APP_ICON_ZOOM_MIN, z));
}

/**
 * One axis of the drag, kept inside its limits.
 *
 * `span` is how long the image is on this axis, in squares. Both branches are needed and they
 * are not symmetrical:
 *
 *   span >= 1  the image is longer than the square, so the square must stay covered: the
 *              top-left may run from `1 - span` (image pushed left/up until its far edge meets
 *              the square's) to 0 (near edges flush). This is the ordinary drag.
 *   span < 1   he has zoomed out and the image is smaller than the square, so it is the image
 *              that must stay inside: 0 to `1 - span`. Nothing may be dragged off the edge and
 *              lost.
 *
 * `Math.min`/`Math.max` over the pair rather than an `if`, because that one expression is
 * correct for both and there is no third case.
 */
function clampAxis(value, span) {
  const lo = Math.min(0, 1 - span);
  const hi = Math.max(0, 1 - span);
  const v = num(value, (1 - span) / 2);
  return Math.min(hi, Math.max(lo, v));
}

/** A whole placement, corrected. Called after every drag, every zoom and on every load. */
export function clampIconPlacement({ width, height, zoom, offsetX, offsetY } = {}) {
  const box = iconCoverBox(width, height);
  const z = clampIconZoom(zoom);
  return {
    zoom: z,
    offsetX: clampAxis(offsetX, box.width * z),
    offsetY: clampAxis(offsetY, box.height * z),
  };
}

/** Where a freshly picked image sits: filling the square, centred, nothing chosen yet. */
export function centredIconPlacement({ width, height, zoom = 1 } = {}) {
  const box = iconCoverBox(width, height);
  const z = clampIconZoom(zoom);
  return { zoom: z, offsetX: (1 - box.width * z) / 2, offsetY: (1 - box.height * z) / 2 };
}

/**
 * A new zoom, holding one point of the square still.
 *
 * Without this, zooming re-centres: he lines the મૂર્તિ's face up, reaches for the slider, and
 * the face slides away as the image grows from its top-left corner. The fix is to decide what
 * must not move - the middle of the square for a slider, the pointer for a wheel - convert it
 * to a position **within the image**, and put the image back so that position lands there
 * again at the new size.
 */
export function zoomIconPlacement({
  width,
  height,
  zoom,
  offsetX,
  offsetY,
  next,
  focusX = 0.5,
  focusY = 0.5,
} = {}) {
  const box = iconCoverBox(width, height);
  const from = clampIconPlacement({ width, height, zoom, offsetX, offsetY });
  const to = clampIconZoom(next);

  const spanX = box.width * from.zoom;
  const spanY = box.height * from.zoom;
  // The held point, as a fraction of the image itself rather than of the square.
  const inImageX = spanX > 0 ? (num(focusX, 0.5) - from.offsetX) / spanX : 0.5;
  const inImageY = spanY > 0 ? (num(focusY, 0.5) - from.offsetY) / spanY : 0.5;

  return clampIconPlacement({
    width,
    height,
    zoom: to,
    offsetX: num(focusX, 0.5) - inImageX * box.width * to,
    offsetY: num(focusY, 0.5) - inImageY * box.height * to,
  });
}

/**
 * The placement → the two rectangles `drawImage()` takes.
 *
 * `s*` is the piece of the original picture to cut, in its own pixels. `d*` is where that piece
 * lands in the `out` x `out` PNG.
 *
 * The clipping is done here rather than left to the canvas, and that is the only interesting
 * part of the function. When he has zoomed out, the square is larger than the image and the
 * source rectangle sticks out past its edges; the specification says a browser must clip such a
 * rectangle and shrink the destination in the same proportion, which is exactly right, but
 * "must" and "does, in every browser a સંચાલક might open this panel in" are different claims.
 * Doing the arithmetic here makes the overhang transparent padding by construction, and makes
 * it testable without a canvas.
 *
 * A returned `sWidth` or `sHeight` of 0 means there is nothing to draw at all, and the caller
 * must skip the draw rather than pass a zero-width rectangle to a canvas that will throw.
 */
export function iconCropRect({ width, height, zoom, offsetX, offsetY, out } = {}) {
  const w = num(width, 0);
  const h = num(height, 0);
  const size = num(out, APP_ICON_IDEAL_PX);
  const empty = { sx: 0, sy: 0, sWidth: 0, sHeight: 0, dx: 0, dy: 0, dWidth: 0, dHeight: 0 };
  if (w <= 0 || h <= 0 || size <= 0) return empty;

  const box = iconCoverBox(w, h);
  const p = clampIconPlacement({ width: w, height: h, zoom, offsetX, offsetY });

  // Original pixels per square — one for each axis, and they are equal in practice because the
  // zoom scales both together. Computed separately anyway so a future non-uniform zoom would
  // not silently produce a stretched icon.
  const perSquareX = w / (box.width * p.zoom);
  const perSquareY = h / (box.height * p.zoom);

  let sx = -p.offsetX * perSquareX;
  let sy = -p.offsetY * perSquareY;
  let sWidth = perSquareX;
  let sHeight = perSquareY;

  // Output pixels per original pixel, taken before anything is clipped: the whole point is that
  // the surviving piece keeps the scale it would have had, so it lands where he saw it.
  const outPerSrcX = size / sWidth;
  const outPerSrcY = size / sHeight;

  let dx = 0;
  let dy = 0;
  let dWidth = size;
  let dHeight = size;

  if (sx < 0) {
    const cut = -sx;
    sx = 0;
    sWidth -= cut;
    dx += cut * outPerSrcX;
    dWidth -= cut * outPerSrcX;
  }
  if (sy < 0) {
    const cut = -sy;
    sy = 0;
    sHeight -= cut;
    dy += cut * outPerSrcY;
    dHeight -= cut * outPerSrcY;
  }
  if (sx + sWidth > w) {
    const cut = sx + sWidth - w;
    sWidth -= cut;
    dWidth -= cut * outPerSrcX;
  }
  if (sy + sHeight > h) {
    const cut = sy + sHeight - h;
    sHeight -= cut;
    dHeight -= cut * outPerSrcY;
  }

  if (sWidth <= 0 || sHeight <= 0) return empty;
  return { sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight };
}

/**
 * The `icons` array for the web app manifest, from a resolved icon.
 *
 * One place, three readers: netlify/functions/manifest.js serves it, the panel previews it,
 * and the test suite compares the two. `?v=` is appended so that Chrome's WebAPK updater sees
 * a URL it has not fetched before — Supabase Storage serves public objects with a long
 * cache lifetime, and an updater that reads the cached bytes concludes nothing has changed.
 *
 * The custom image is declared `any` **and** `maskable`, which is the honest thing a single
 * uploaded file can do: Android will crop it to the launcher's shape either way, and
 * declaring only `any` makes Android draw it on a white badge instead — a worse outcome than
 * a crop the panel has already shown him.
 */
export function appIconManifestIcons(resolved) {
  const icon = resolved?.custom ? resolved : null;
  if (!icon) {
    return [
      { src: BUILT_IN_ICON.any192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: BUILT_IN_ICON.any512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: BUILT_IN_ICON.maskable512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ];
  }
  const src = withVersion(icon.url, icon.version);
  return [
    { src, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
}

/**
 * The two `<link>` hrefs the running app rewrites — the tab icon, and the bitmap iOS copies
 * at "Add to Home Screen".
 *
 * `apple` matters only for someone who has **not** installed yet; for anyone who has, it is
 * read and forgotten. That is not a reason to skip it: everybody who installs from today
 * onward is in the first group.
 */
export function appIconLinks(resolved) {
  if (!resolved?.custom) {
    return { icon: BUILT_IN_ICON.favicon, apple: BUILT_IN_ICON.apple, type: 'image/svg+xml' };
  }
  const src = withVersion(resolved.url, resolved.version);
  return { icon: src, apple: src, type: 'image/png' };
}

/**
 * `?v=N` on the storage URL.
 *
 * Not a cosmetic cache-buster. Supabase serves public objects with `cache-control: max-age=3600`
 * and Google's WebAPK minter, Chrome's icon cache and the phone's HTTP cache all sit between
 * the row and the home screen. A URL that has not changed is a fetch that does not happen, and
 * an icon that does not change. The counter in the row is what makes the URL new.
 */
export function withVersion(url, version) {
  const v = typeof version === 'number' && version > 0 ? Math.floor(version) : 0;
  if (!v) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${v}`;
}

/**
 * Has this phone been shown the reinstall notice for this icon already?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why a counter and not a timestamp
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The notice must appear once per icon, on an iPhone that installed the app before that icon
 * existed. Answering that needs "which icon was in force when this phone last looked", and a
 * timestamp cannot answer it: phone clocks are wrong, `updatedAt` is written by whichever
 * machine the સંચાલક was sitting at, and a comparison between the two produces a notice that
 * either never appears or never stops.
 *
 * A counter the panel increments is a total order that both sides agree on with no clock
 * involved. `seen` is whatever this phone stored last; a stored value that is absent, damaged
 * or from the future all fall the same way — show it — because the failure this exists to
 * prevent is a સંઘ looking at an old mark and nobody knowing why.
 */
export function shouldOfferReinstall({ version, seen } = {}) {
  const v = typeof version === 'number' && Number.isFinite(version) ? Math.floor(version) : 0;
  if (v < 1) return false;
  const s = typeof seen === 'number' && Number.isFinite(seen) ? Math.floor(seen) : -1;
  return s < v;
}
