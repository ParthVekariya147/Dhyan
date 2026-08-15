import { supabase } from '../../../lib/supabase';
import {
  APP_ICON_BUCKET,
  APP_ICON_MAX_BYTES,
  APP_ICON_OUTPUT_PX,
  iconCropRect,
} from '../../../../../shared/domain/appicon.js';

/**
 * The bytes behind `settings['app'].appIcon` — putting them in Storage, taking the old ones
 * out again, and reading a picked file's dimensions before either happens.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Two stores, one operation — and which one is the record
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The PNG goes into the `app-icon` bucket (supabase/migrations/0042_app_shell.sql); the URL,
 * the path, the size and the version counter go into the `appIcon` field of the settings['app']
 * row. The **row is the record**: the bucket is where the bytes happen to live, and an object
 * the row does not name is rubbish. That asymmetry decides the order of every operation in
 * AppIconCard — upload, then write the row, then sweep — and it is why removeAppIcon() below is
 * allowed to fail quietly while the other two are not.
 *
 * Both halves are guarded by the same predicate, `has_permission('settings.update')`: the RLS
 * policy on `settings` (0004_rbac.sql:649) and the three storage policies in 0042. Nothing in
 * this file is a security boundary — it is where the boundary becomes visible. dhunService.js
 * says the same about the `dhun` bucket and the shape here is deliberately its twin, so that a
 * reader who has understood one has understood both.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What is NOT here, and why
 * ────────────────────────────────────────────────────────────────────────────
 *
 * No validation. `validateAppIconFile()` and `validateAppIcon()` live in
 * shared/domain/appicon.js because the same two rules are applied by the panel, by the trigger
 * in 0042 and by netlify/functions/manifest.js, and a fourth copy in this file would be a
 * fourth chance for them to disagree. readImageSize() below hands the card the two numbers the
 * shared validator asks for; it does not decide anything about them.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * There IS a canvas here now, and the earlier note against it still stands
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This file used to say, at length, that it did no resizing and no re-encoding: the સંચાલક
 * uploaded a મૂર્તિ, and a panel that silently shrinks or re-compresses it is answering a
 * question about how the mark should look, which is his question and not this code's.
 *
 * That argument was right and renderAppIconPng() does not contradict it, because the word doing
 * the work in it is **silently**. Nothing below happens on its own. The crop it applies is the
 * one he dragged into place, watching the safe-zone circle, in the box that fills half the card;
 * the square it cuts is the square he was looking at when he pressed Save. The panel is not
 * deciding how the mark should look - it is finally giving him somewhere to decide it, instead
 * of refusing his photograph and sending him off to find a program that can square a JPEG.
 *
 * What has not changed is that the stored bytes are a square PNG within the same 512 KB, so the
 * bucket, the trigger in 0042, the WebAPK minter and iOS see precisely what they saw before.
 */

/**
 * The bytes, uploaded under a name that has never existed before.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why a fresh name every time instead of a fixed `icon.png`
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A fixed name is the obvious design and it is the wrong one here, for a reason particular to
 * this file: the icon URL is fetched by Google's WebAPK minter, by Chrome's icon cache, by
 * every phone's HTTP cache and by Supabase's own CDN, none of which this panel can reach into.
 * Overwriting `icon.png` would leave four caches holding the old bytes under a URL that says
 * nothing has changed, and the સંચાલક would be told "Saved" while two thousand home screens
 * kept the old mark. `?v=` (withVersion, shared/domain/appicon.js) is the belt; an immutable
 * object name is the braces, and on this path both are wanted.
 *
 * An immutable name is also what makes the year-long `cacheControl` below honest rather than
 * reckless: these bytes at this name can never change, so caching them forever is free.
 *
 * The name carries a timestamp **and** six random characters. The timestamp alone would be
 * enough on one laptop and is not enough across two: two સંચાલક saving inside the same
 * millisecond is vanishingly unlikely and `upsert: false` would turn it into a hard failure
 * rather than a silent overwrite, but a retry that fails permanently because of a name
 * collision is a bad way to spend somebody's afternoon.
 *
 * @param {File} file a PNG the caller has already put through validateAppIconFile()
 * @returns {Promise<{url: string, path: string, size: number}>}
 */
export async function uploadAppIcon(file) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `icon-${stamp}-${rand}.png`;

  const { error } = await supabase.storage.from(APP_ICON_BUCKET).upload(path, file, {
    /*
      Stated rather than inferred from the File.

      The bucket in 0042 allows exactly one mime type, and what a browser reports for a `.png`
      depends on the OS registry — the same file can arrive as `image/png`, as
      `application/octet-stream` or as an empty string. Passing the type through would let a
      perfectly good PNG be refused by the bucket for the name Windows happens to give it. The
      card has already checked the type through the shared validator and, more to the point,
      has decoded the file as an image to measure it, so by the time this runs the file is
      known to be a real raster and not merely named like one.

      It is also what the bucket will serve the bytes back as, which is what keeps an uploaded
      file from ever being rendered as a page.
    */
    contentType: 'image/png',
    // Immutable name → immutable bytes → a year is safe. See the note above.
    cacheControl: '31536000',
    // Never overwrite. If this name somehow existed, this must fail loudly rather than
    // silently replace the icon two thousand phones are currently showing.
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(APP_ICON_BUCKET).getPublicUrl(path);
  return { path, url: data.publicUrl, size: file.size };
}

/**
 * Sweeps up an object the settings row no longer names. Best effort, and deliberately so.
 *
 * The old icon becomes rubbish the moment the row stops pointing at it, and the row is the
 * record. Failing the whole save because a 40 KB PNG could not be swept up would turn a change
 * that succeeded into a failure the સંચાલક is asked to retry — and the retry would upload a
 * second copy of the new icon and try to delete the same old one again. An orphaned 40 KB
 * object in a bucket capped at 512 KB per file is not worth any of that.
 *
 * The caller is responsible for the ordering, and it is the ordering that matters: the settings
 * row is written first and the old object deleted afterwards. Reversed, a failed save would
 * have deleted the file the row still names, and the app would show a broken square.
 */
export async function removeAppIcon(path) {
  if (!path) return;
  try {
    await supabase.storage.from(APP_ICON_BUCKET).remove([path]);
  } catch {
    /* ignore — see above */
  }
}

/**
 * Decodes a picked file in the browser and hands back something a canvas can draw, plus its
 * pixel dimensions.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this exists at all
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Two callers need two different halves of it. The card needs the **dimensions** the moment a
 * file is picked, because the crop box cannot place an image whose shape it does not know and
 * because validateAppIconSource() refuses anything whose short side is under 192px. The save
 * needs the **decoded image itself**, to draw the chosen square onto a canvas.
 *
 * Before the upload rather than after, on purpose. Uploading first and measuring second would
 * leave an orphaned object in the bucket every time somebody picks the wrong image.
 *
 * A decode is also the only honest test that the file is an image at all. `type` is whatever the
 * OS said about the file name, and a `.png` that is really something else would otherwise sail
 * through every check here and fail on a phone. If this resolves, the bytes are an image the
 * browser can draw — which, now that the panel re-encodes everything to PNG itself, is the only
 * property of the source that has to be true.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Two paths, and why the old one is kept
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `createImageBitmap` is the direct answer, decodes off the main thread and needs no DOM. It is
 * absent in Safari before 15 and in a few enterprise-managed builds, and this panel is opened on
 * whatever laptop the સંચાલક has. The `<img>` fallback works everywhere an image can be shown,
 * which is the floor for a panel whose whole job on this card is showing an image. `drawImage()`
 * accepts either, so nothing downstream has to know which one it got.
 *
 * **The caller must call `close()`**, and on both paths — it revokes the object URL as well as
 * releasing the bitmap. A leaked blob URL pins the whole file in memory until the tab is closed,
 * and this card is a place where somebody tries four photographs before settling on one.
 *
 * @param {File|Blob} file
 * @returns {Promise<{image: CanvasImageSource, width: number, height: number, close: () => void}>}
 *   rejects if the bytes are not an image
 */
export async function decodeAppIconImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        // Frees the decoded surface immediately instead of waiting for the collector — a
        // 2560x1440 bitmap is 14 MB of RGBA, and this runs again on every image he tries.
        close: () => bitmap.close?.(),
      };
    } catch {
      // Falls through to the <img> path rather than failing. Some browsers refuse a bitmap for
      // a format they will nonetheless render, and a decode that succeeds by another route is
      // still a decode that succeeded.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image-decode-failed'));
      el.src = url;
    });
    return {
      image: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    // The URL is revoked here and not in a `finally`: on the success path it has to outlive this
    // function, because an <img> that is still being drawn from needs its source to exist.
    URL.revokeObjectURL(url);
    throw e;
  }
}

/**
 * Just the dimensions, for the moment a file is picked. The decoded surface is released before
 * this returns; the save decodes again, which costs one decode and keeps a multi-megabyte
 * bitmap from being held for the whole time he spends deciding.
 *
 * @param {File} file
 * @returns {Promise<{width: number, height: number}>} rejects if the bytes are not an image
 */
export async function readImageSize(file) {
  const src = await decodeAppIconImage(file);
  try {
    return { width: src.width, height: src.height };
  } finally {
    src.close();
  }
}

/**
 * `canvas.toBlob()` as a promise, with the old browser's route behind it.
 *
 * `toBlob` is the right call and is everywhere that matters, but it returns `null` rather than
 * throwing when the browser declines to encode, and a `null` here would arrive at the upload as
 * a confusing failure several steps later. The dataURL path is both the fallback for a browser
 * without `toBlob` and the answer to that `null`.
 */
function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    const fromDataUrl = () => {
      try {
        const url = canvas.toDataURL('image/png');
        const bin = atob(url.slice(url.indexOf(',') + 1));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        resolve(new Blob([bytes], { type: 'image/png' }));
      } catch (e) {
        reject(e);
      }
    };

    if (typeof canvas.toBlob !== 'function') {
      fromDataUrl();
      return;
    }
    canvas.toBlob((blob) => (blob ? resolve(blob) : fromDataUrl()), 'image/png');
  });
}

/**
 * The chosen square → the PNG that is actually stored.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this does, in one line
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Takes the file he picked, whatever its format and shape, and the placement he dragged it
 * into, and produces a square PNG that satisfies every rule the bucket and 0042 enforce. From
 * here on the icon path is exactly what it was before this feature existed.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why it may come back smaller than 512
 * ────────────────────────────────────────────────────────────────────────────
 *
 * PNG is lossless and has no quality dial. A 512 x 512 crop of a flat મૂર્તિ mark encodes to
 * 20-60 KB and this returns on the first pass; a 512 x 512 crop of a **photograph** — which is
 * now a thing somebody can choose, and could not before — can encode past the 512 KB ceiling,
 * and there is no knob to turn. So the size steps down through APP_ICON_OUTPUT_PX until one
 * fits, and the caller is told which one it landed on so the card can say so rather than let
 * him wonder why his icon looks soft.
 *
 * Every step is a fresh draw from the original decode rather than a re-scale of the previous
 * canvas, so a 256px result is one resample of the source and not four stacked ones.
 *
 * @returns {Promise<{file: File|Blob, px: number, size: number}>}
 */
export async function renderAppIconPng({ file, zoom, offsetX, offsetY }) {
  const src = await decodeAppIconImage(file);
  try {
    let smallest = null;

    for (const out of APP_ICON_OUTPUT_PX) {
      const canvas = document.createElement('canvas');
      canvas.width = out;
      canvas.height = out;

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('icon-canvas-unavailable');
      // Left transparent on purpose. A zoomed-out image leaves the square only partly covered,
      // and transparent is what an icon's spare room is supposed to be — filling it with white
      // would put a white box on every dark launcher.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const r = iconCropRect({ width: src.width, height: src.height, zoom, offsetX, offsetY, out });
      // A rectangle of nothing means he has dragged the image entirely outside the square, which
      // the clamp forbids — so this is a guard rather than a case, and a zero-width rectangle
      // would make drawImage throw.
      if (r.sWidth > 0 && r.sHeight > 0) {
        ctx.drawImage(
          src.image,
          r.sx, r.sy, r.sWidth, r.sHeight,
          r.dx, r.dy, r.dWidth, r.dHeight
        );
      }

      const blob = await canvasToPng(canvas);
      smallest = { blob, px: out };
      if (blob.size <= APP_ICON_MAX_BYTES) break;
    }

    if (!smallest || smallest.blob.size > APP_ICON_MAX_BYTES) {
      throw new Error('icon-too-detailed');
    }

    /*
      A File rather than the bare Blob, only so the object has a name.

      Storage accepts either and uploadAppIcon() names the object itself, but a File is what the
      rest of this card's code paths expect and what shows up legibly in a network log. The
      fallback is not defensive habit: the File constructor is absent in older Safari, where a
      Blob does the whole job anyway.
    */
    let out = smallest.blob;
    try {
      out = new File([smallest.blob], 'icon.png', { type: 'image/png' });
    } catch {
      /* a Blob is enough — see above */
    }
    return { file: out, px: smallest.px, size: smallest.blob.size };
  } finally {
    src.close();
  }
}
