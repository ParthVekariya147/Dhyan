/**
 * દર્શન master content — the shape of it, and what "healthy" means.
 *
 * A દ્રશ્ય is three things:
 *
 *   { id, n, order, url, t }
 *
 * a **number** (`n`, the one printed inside the artwork), a **link** (`url`, a Google Drive
 * image on Google's CDN) and a **વર્ણન** (`t`). `content/darshan.json` is the master record,
 * built by `npm run darshan` from the સંચાલક's sheet and his Drive folder.
 *
 * There is no encoded ladder here and no AVIF/WebP negotiation: an `<img src>` and nothing
 * else. That is the whole point of this shape — the previous one carried six widths in
 * three formats per દ્રશ્ય, which took ~13 hours to produce and in practice never finished,
 * so the app shipped the 12 દ્રશ્યો the encoder had got through.
 *
 * What the database holds is *admin-editable state*, in the `public.scenes` table:
 * `active`/`status`, the printed `index`, the presentation `order`, the `caption`, and a
 * replacement `imageUrl`. `applyOverlay` folds those onto the manifest, and it is the
 * single place that merge happens — the panel and the યુવક app both go through it, so what
 * a સંચાલક sets is what a યુવક sees.
 *
 * Everything here is a pure function; the manifest is passed in.
 */

import { driveImageUrl } from './drive.js';

/** The width the lightbox asks for. The card's own URL is built at the feed's width. */
const FULL_WIDTH = 2560;

/**
 * The panel's grid tile. ~190 CSS px wide, so 400 covers it at DPR 2.
 *
 * This is not a nicety: a hundred tiles at the feed's own width would repeat, inside the
 * panel, the same weight problem the યુવક app was rebuilt to fix. Asking Google for a
 * narrower encode costs one number in a string.
 */
const THUMB_WIDTH = 400;

/** "darshan-009" — zero-padded so ids sort lexicographically the way people expect. */
export const darshanId = (n) => `darshan-${String(n).padStart(3, '0')}`;

/** Does this entry actually resolve to something a browser can paint? */
export const hasImage = (entry) => !!entry.url;

/**
 * A scene is learnable only when it has both an image and a વર્ણન.
 *
 * Stated once and shared, so the panel's idea of "active" cannot drift from the app's. A
 * દ્રશ્ય with a વર્ણન and no link would reach a યુવક as an empty frame, and one with a link
 * and no વર્ણન teaches nothing — the picture alone is not the lesson. §1: never a dead end.
 */
export const isLearnable = (entry) => entry.active !== false && !!entry.t && hasImage(entry);

/**
 * Manifest entry + scenes-row overlay → a scene in the **manifest's own shape**, with the
 * સંચાલક's edits folded in.
 *
 * Three details are load-bearing:
 *
 *  - **`caption` is `not null default ''`** in 0001_init.sql, so every row the સંચાલક has
 *    ever touched carries one, and most carry the empty string. An empty caption therefore
 *    means "no વર્ણન written here", never "blank this scene's વર્ણન" — treating it as an
 *    override would erase the text on every scene whose visibility had once been toggled.
 *
 *  - **The image is one URL.** A replacement published from the panel is a Drive link
 *    converted by `resolveImageInput`, which is the same thing the build script writes —
 *    so there is one code path, and a replaced દ્રશ્ય renders exactly like a built one.
 *
 *  - **`index` and `order` are nullable** since 0004_rbac.sql, so "not an integer" is the
 *    ordinary case: the સંચાલક has simply not renumbered this scene.
 *
 * @param {object} entry   an element of content/darshan.json
 * @param {object} [scene] the matching public.scenes row, if one exists
 */
export function applyOverlay(entry, scene) {
  if (!scene) return entry;

  const out = { ...entry };

  if (scene.caption) {
    out.t = scene.caption;
    // `active` in the manifest encodes one fact: whether a વર્ણન had been written when the
    // manifest was last built. Supplying the વર્ણન here therefore re-derives it, otherwise
    // a દ્રશ્ય would stay dark after the સંચાલક has written its વર્ણન and would need a
    // rebuild to appear. Hiding a scene is a separate act with its own column.
    out.active = true;
  }

  // The printed number and the presentation order are distinct and may diverge (§32).
  if (Number.isInteger(scene.index)) {
    out.index = scene.index;
    out.n = scene.index;
  }
  if (Number.isInteger(scene.order)) out.order = scene.order;

  if (scene.imageUrl) {
    out.url = scene.imageUrl;
    out.driveId = scene.driveId || '';
    // The enlarged view is the same Drive file asked for at a wider size. A URL the સંચાલક
    // typed in by hand has no id to re-ask with, so the lightbox simply reuses it.
    out.fullUrl = scene.driveId ? driveImageUrl(scene.driveId, FULL_WIDTH) : scene.imageUrl;
  }

  return out;
}

/**
 * Manifest entry + scenes-row overlay → one DarshanItem.
 *
 * @param {object} entry   an element of content/darshan.json
 * @param {object} [scene] the matching public.scenes row, if one exists
 * @returns {import('./types.js').DarshanItem}
 */
export function toDarshanItem(entry, scene) {
  // The same merge the યુવક app applies, so a caption the સંચાલક writes here is the caption
  // he sees listed back. Reading `entry.t` at this point showed him the sheet's text and
  // silently discarded his own edit.
  const merged = applyOverlay(entry, scene);
  const id = entry.id || darshanId(entry.n ?? entry.index);
  const index = merged.index ?? merged.n;
  return {
    id,
    index,
    // Presentation order defaults to the manifest's, which defaults to the printed
    // number — but the three are distinct and are allowed to diverge (§32).
    order: Number.isInteger(scene?.order) ? scene.order : (merged.order ?? index),
    // Judged on the merged scene: a વર્ણન written in the panel is what makes an
    // image-only દ્રશ્ય learnable, so a scene goes live by being filled in, not by a deploy.
    active: scene?.active === undefined ? isLearnable(merged) : !!scene.active,
    // Why it is or is not active, which the panel shows instead of just a red pill.
    // "No image" comes first because it is the one that blocks everything else: until a
    // link is set, no વર્ણન the સંચાલક writes will make the દ્રશ્ય visible, and telling him
    // "No caption written" would send him to the wrong box.
    reason: !hasImage(merged)
      ? 'No image link'
      : !merged.t
        ? 'No caption written'
        : merged.active === false
          ? 'Hidden'
          : '',
    imageUrl: merged.url || '',
    fullUrl: merged.fullUrl || merged.url || '',
    // A narrower encode of the same file for the panel's grid. Without a Drive id there is
    // nothing to re-ask with — a hand-typed URL is used as it stands.
    thumbUrl: merged.driveId ? driveImageUrl(merged.driveId, THUMB_WIDTH) : merged.url || '',
    driveId: merged.driveId || '',
    caption: merged.t || '',
    // The Drive file this came from, for the panel's "which file is this?" line.
    file: entry.file || '',
    // Rendered verbatim to a સંચાલક on the દર્શન detail page ("સ્રોત"). Display only.
    source: scene ? 'supabase+manifest' : 'manifest',
    updatedAt: scene?.updatedAt || null,
  };
}

/**
 * A manifest entry standing in for a દ્રશ્ય that the સંચાલક created in the panel.
 *
 * `content/darshan.json` names every દ્રશ્ય the sheet knows about; one added from the panel
 * has no manifest entry and never will until the next build, so one is synthesised here and
 * the સંચાલક's row is folded onto it by the ordinary `applyOverlay` path. That is the entire
 * mechanism — no second merge, no second notion of a scene.
 *
 * It is deliberately empty of imagery: a દ્રશ્ય carries no artwork until a link is set, and
 * until then `isLearnable` keeps it away from યુવકો, which is right — an entry with no
 * picture is a placeholder and the તપાસ page should say so out loud (§1).
 *
 * @param {object} scene a public.scenes row in the domain's camelCase shape
 */
export function sceneRowEntry(scene) {
  const n = Number.isInteger(scene.index) ? scene.index : null;
  return {
    id: scene.id,
    index: n,
    order: Number.isInteger(scene.order) ? scene.order : n,
    n,
    // No વર્ણન and no image of its own: the row's `caption` and `imageUrl` are the only ones
    // such a દ્રશ્ય has, and applyOverlay is what puts them here. Seeding them from the row
    // would apply the same value twice and hide the difference between "set" and "inherited".
    t: '',
    url: '',
    fullUrl: '',
    driveId: '',
    file: '',
  };
}

/**
 * @param {Array}  manifest content/darshan.json
 * @param {object} scenes   { [id]: sceneDoc } — may be empty
 */
export function buildDarshanItems(manifest, scenes = {}) {
  const claimed = new Set();
  const items = manifest.map((entry) => {
    const id = entry.id || darshanId(entry.n ?? entry.index);
    claimed.add(id);
    return toDarshanItem(entry, scenes[id]);
  });

  // Rows the manifest does not know about — દ્રશ્યો created in the panel (§12). Appended
  // rather than merged in place because the manifest keeps its own order and these have
  // no position in it; the sort below is what actually places them.
  for (const scene of Object.values(scenes)) {
    if (!scene?.id || claimed.has(scene.id)) continue;
    items.push(toDarshanItem(sceneRowEntry(scene), scene));
  }

  return items.sort((a, b) => a.order - b.order);
}

/**
 * Real validation over real records (§29).
 *
 * Every number returned is counted. `total` is items.length — there is no TOTAL = 100 and
 * no TOTAL = 109 anywhere in this function (§62), because the manifest is built from the
 * સંચાલક's sheet and whatever it contains is the truth. A scene with a link but no વર્ણન is
 * reported as a real, named gap rather than silently dropped.
 */
export function validateDarshanItems(items) {
  const issues = [];
  const add = (severity, code, id, message) => issues.push({ severity, code, id, message });

  const byId = new Map();
  const byIndex = new Map();
  const byOrder = new Map();

  for (const it of items) {
    if (byId.has(it.id)) add('error', 'duplicate-id', it.id, `Duplicate ID: ${it.id}`);
    byId.set(it.id, it);

    if (byIndex.has(it.index)) add('error', 'duplicate-index', it.id, `Duplicate number: ${it.index}`);
    byIndex.set(it.index, it);

    if (byOrder.has(it.order)) add('warn', 'duplicate-order', it.id, `Duplicate order: ${it.order}`);
    byOrder.set(it.order, it);

    if (!Number.isInteger(it.index) || it.index < 1) add('error', 'invalid-index', it.id, 'Invalid number');
    if (!Number.isInteger(it.order) || it.order < 1) add('error', 'invalid-order', it.id, 'Invalid order');
    if (!it.imageUrl) add('error', 'missing-image', it.id, 'No image link');
    // The gap that matters most: the picture is ready, the words are not.
    if (!it.caption) add('warn', 'missing-caption', it.id, 'No caption written — the yuvak cannot learn this scene');
  }

  // Gaps in the printed numbering, e.g. 1…109 with 47 absent.
  const max = items.length ? Math.max(...items.map((i) => i.index)) : 0;
  const missing = [];
  for (let n = 1; n <= max; n++) if (!byIndex.has(n)) missing.push(n);
  if (missing.length) {
    add(
      'error',
      'missing-index',
      '',
      `${missing.length} numbers missing: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '…' : ''}`
    );
  }

  const errorIds = new Set(issues.filter((i) => i.severity === 'error').map((i) => i.id).filter(Boolean));
  const withoutCaption = items.filter((i) => !i.caption);

  return {
    total: items.length,
    active: items.filter((i) => i.active).length,
    inactive: items.filter((i) => !i.active).length,
    invalid: errorIds.size,
    valid: items.length - errorIds.size,
    missingCaptions: withoutCaption.length,
    missingCaptionIds: withoutCaption.map((i) => i.id),
    missingIndexes: missing,
    highestIndex: max,
    issues,
  };
}
