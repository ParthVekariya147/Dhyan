import { supabase } from '../../../lib/supabase';
import { buildDarshanItems, darshanId, validateDarshanItems, withDisplayIndex } from '../../../../../shared/domain/darshan.js';
import { parseDriveLink, resolveImageInput } from '../../../../../shared/domain/drive.js';

/**
 * દર્શન content, assembled from the two places it actually lives.
 *
 *   content/darshan.json   the master record — id, index, order, વર્ણન and the image link.
 *                          Built by `npm run darshan` from the સંચાલક's sheet and his Drive
 *                          folder. Not copied into the database (§7).
 *
 *   scenes (table)         admin-editable state layered on top: active, order, title,
 *                          caption, and a replacement image link. `title` (0013) has no
 *                          manifest counterpart at all — the sheet never carried one — so
 *                          this table is the only place it exists.
 *
 * A દ્રશ્ય is three things — a link, a વર્ણન and a number — and this file is how a સંચાલક
 * changes any of them without a build or a deploy.
 *
 * The manifest is imported dynamically so it does not sit in the panel's entry chunk — the
 * same reason the યુવક app's DarshanPage is lazy (§51).
 */

const SCENES = 'scenes';

let manifestCache = null;

async function loadManifest() {
  if (!manifestCache) {
    const mod = await import('../../../../../content/darshan.json');
    manifestCache = mod.default;
  }
  return manifestCache;
}

/**
 * Column names are snake_case in Postgres and camelCase in the domain model, so the two
 * are mapped here rather than anywhere else. `imageUrl` in particular used to be read and
 * written under its camelCase name directly, against a column that did not exist — every
 * image replacement failed with an unknown-column error from PostgREST.
 */
const TO_COLUMN = {
  index: 'index',
  order: 'order',
  active: 'active',
  status: 'status',
  // Added by 0013. Same-named in both spellings, so it needs no translation — it is listed
  // anyway because this map is also the allow-list: saveScene() throws on a field that is
  // not here, so an omission would refuse the write rather than silently dropping it.
  title: 'title',
  caption: 'caption',
  imageUrl: 'image_url',
  driveId: 'drive_id',
  sourceDriveUrl: 'source_drive_url',
};

/** The scenes overlay → a lookup keyed by id. One small table, read whole, once per view. */
async function loadScenes() {
  const { data, error } = await supabase.from(SCENES).select('*');
  if (error) throw error;
  const out = {};
  for (const r of data || []) {
    out[r.id] = {
      id: r.id,
      index: r.index,
      order: r.order,
      active: r.active,
      status: r.status,
      // Read as it stands, empty string included: applyOverlay is what decides that ''
      // means "not written" rather than "blank it", and normalising to null here would
      // take that decision away from the one place it belongs.
      title: r.title,
      caption: r.caption,
      imageUrl: r.image_url,
      driveId: r.drive_id,
      sourceDriveUrl: r.source_drive_url,
      updatedAt: r.updated_at,
    };
  }
  return out;
}

/**
 * The effective collection, **canonically sequenced**.
 *
 * `withDisplayIndex()` is applied here and not in any page, so every screen in the panel —
 * this section, the તપાસ report, the લેવલ ૪ builder — is looking at one order and one set
 * of numbers. That is the whole point of ORDERING.md rule 4: a screen that sorted for
 * itself would eventually disagree with the numbers a યુવક is being shown, and the two
 * apps would be arguing about which દ્રશ્ય is "૩૧".
 *
 * Each entry therefore carries two more fields than it used to:
 *
 *   sourceIndex   the printed number, from the sheet — identity, never rewritten
 *   displayIndex  what a યુવક sees, 1…N over the ACTIVE entries, `null` for the rest
 *
 * `displayIndex` is derived on every read and stored nowhere. A withheld દ્રશ્ય keeps its
 * place in the array with a null number rather than being dropped: the સંચાલક's list has to
 * show it to bring it back.
 *
 * @returns {Promise<import('../../../../../shared/domain/types.js').DarshanItem[]>}
 */
export async function listDarshan() {
  const [manifest, scenes] = await Promise.all([
    loadManifest(),
    // scenes/ may legitimately be empty before the admin has touched anything, and it
    // must never blank the content list if it is unreadable.
    loadScenes().catch((e) => {
      console.warn('[admin] scenes/ unreadable, showing manifest only', e);
      return {};
    }),
  ]);
  return withDisplayIndex(buildDarshanItems(manifest, scenes));
}

/**
 * Write the સંચાલક's order for the whole collection, in one call.
 *
 * `p_ids` is the entire sequence and not the part that moved. `darshan_reorder()` sets
 * `"order"` to each id's 1-based place in the array it is given, so a partial list would
 * hand positions 1…k to the named દ્રશ્યો while the unnamed ones went on holding numbers in
 * the same range — and `scenes_order_unique` would refuse the result, correctly. Sending
 * the whole sequence is what makes the write a permutation rather than a collision.
 *
 * Everything that makes it safe is inside the function: `has_permission('darshan.update')`,
 * the duplicate check, the upsert that gives a દ્રશ્ય with no `scenes` row one, and the
 * two-statement parking trick that lets a rotation pass a partial unique index. It is one
 * transaction, so a failure here has written nothing — the caller may show the arrangement
 * still on screen and let the સંચાલક try again.
 *
 * It writes `"order"` and nothing else. `id` and the printed `index` are identity and are
 * never touched by a reorder (ORDERING.md rule 3).
 *
 * @param {string[]} orderedIds every દ્રશ્ય id, in the order they should be presented
 */
export async function reorderDarshan(orderedIds) {
  const ids = [...orderedIds];

  // The RPC refuses a duplicate itself and remains the authority. This is only the better
  // message — the same arrangement validateNewScene() has with the unique indexes.
  if (new Set(ids).size !== ids.length) {
    throw new Error('The same Darshan was listed twice in the new order. Reload and try again.');
  }

  const { data, error } = await supabase.rpc('darshan_reorder', { p_ids: ids });
  if (error) throw error;
  return data;
}

export async function getDarshanItem(itemId) {
  const items = await listDarshan();
  return items.find((i) => i.id === itemId) || null;
}

/**
 * §29 — real validation over real records.
 *
 * `total` is items.length. There is no expected-count constant here and there must not
 * be one (§62): the manifest is generated from the સંચાલક's sheet, so whatever it holds
 * is the dataset, and 150 scenes would need no code change. What the report does name is
 * the gap that actually blocks the product — scenes whose image is ready but whose વર્ણન
 * has not been written, which is why the app teaches fewer scenes than there are files.
 */
export async function loadDarshanHealth() {
  const items = await listDarshan();
  return { items, report: validateDarshanItems(items) };
}

/**
 * Write the admin-editable state for one scene.
 *
 * The row holds only overlay fields. Manifest fields are never written here; copying
 * them in would create the duplicate master §7 forbids.
 */
export async function saveScene(itemId, patch) {
  const row = { id: itemId };
  for (const [k, v] of Object.entries(patch)) {
    const col = TO_COLUMN[k];
    if (!col) throw new Error(`saveScene: unknown field "${k}"`);
    row[col] = v;
  }

  // upsert on the primary key is the merge: an existing row keeps the columns this
  // patch does not name, so setting `active` cannot erase `order`. `updated_at` is set by
  // the scenes_sync_status trigger, and the audit row by audit_scene() — both inside this
  // same statement, so neither can be skipped by a caller that forgets.
  const { error } = await supabase.from(SCENES).upsert(row, { onConflict: 'id' });
  if (error) throw error;
}

/**
 * The ક્રમ a new દ્રશ્ય would take — one past the highest the collection currently holds.
 *
 * Derived, never a constant (§62). The manifest is 109 entries today and the sheet decides
 * what it is tomorrow, so the next number is whatever is actually there plus one. `index`
 * and `order` are advanced independently because §32 allows them to diverge; on a
 * collection nobody has renumbered they are the same number, which is the ordinary case.
 *
 * @param {import('../../../../../shared/domain/types.js').DarshanItem[]} items
 */
export function nextDarshanSlot(items) {
  const top = (pick) => items.reduce((m, i) => (Number.isInteger(pick(i)) && pick(i) > m ? pick(i) : m), 0);
  const index = top((i) => i.index) + 1;
  return { index, order: top((i) => i.order) + 1, id: darshanId(index) };
}

/**
 * Everything that must be true before a દ્રશ્ય can be created, checked against the real
 * collection rather than against a rule of thumb.
 *
 * The two unique indexes this is guarding — `scenes_index_unique` and `scenes_order_unique`
 * from 0004_rbac.sql — would reject a collision anyway. They are checked here first so the
 * સંચાલક gets a sentence naming the દ્રશ્ય he has collided with, rather than PostgREST's
 * constraint name. The database remains the authority; this is only the better message.
 *
 * @param {import('../../../../../shared/domain/types.js').DarshanItem[]} items
 * @param {{index: number, order: number}} draft
 */
export function validateNewScene(items, draft) {
  const index = Number(draft.index);
  const order = Number(draft.order);

  if (!Number.isInteger(index) || index < 1) return { ok: false, gu: 'The number must be a whole number, 1 or more.' };
  if (!Number.isInteger(order) || order < 1) return { ok: false, gu: 'The order must be a whole number, 1 or more.' };

  const id = darshanId(index);
  if (items.some((i) => i.id === id)) return { ok: false, gu: `${id} already exists.` };
  if (items.some((i) => i.index === index)) return { ok: false, gu: `Number ${index} is already taken.` };
  if (items.some((i) => i.order === order)) return { ok: false, gu: `Order ${order} is already taken.` };

  return { ok: true, id, index, order };
}

/**
 * §12 — call a new દ્રશ્ય into existence from the panel.
 *
 * `insert`, not the `upsert` saveScene uses: an upsert here would silently overwrite an
 * existing દ્રશ્ય if two સંચાલકો picked the same number at once, and quietly replacing
 * artwork is the one outcome §28 exists to prevent. A duplicate key must fail loudly.
 *
 * The row is created DRAFT, and that is the load-bearing decision in this function. A
 * દ્રશ્ય created here has no artwork — there is no manifest entry behind it and nothing has
 * been published to it yet — so were it ACTIVE, `useScenes` would hand યુવકો a card with no
 * image the moment a વર્ણન was typed. DRAFT is withheld by that hook's VISIBLE set, so the
 * દ્રશ્ય stays invisible until the સંચાલક publishes an image and moves it on. §1: never a
 * dead end.
 *
 * `active: false` is passed alongside for the same reason, though the trigger derives it:
 * scenes_sync_status() reads `status` first on INSERT and sets `active` from it, so the two
 * cannot disagree — this only makes the intent legible in the audit row.
 */
export async function createScene({ index, order, caption = '' }) {
  const { error } = await supabase.from(SCENES).insert({
    id: darshanId(index),
    index,
    order,
    caption: String(caption || '').trim(),
    status: 'DRAFT',
    active: false,
  });

  // 23505 is unique_violation — someone else took this number between the check above and
  // this statement. Named rather than passed through, because the raw message quotes an
  // index name that means nothing to a સંચાલક.
  if (error) {
    if (error.code === '23505') throw new Error('That number or order was just taken. Reload and try again.');
    throw error;
  }

  return darshanId(index);
}

/**
 * §28 — point a દ્રશ્ય at a different image, without overwriting the old one.
 *
 * Setting the link IS the change. There is no publish step, no queue and nothing to poll:
 * the row records where the image is, and the next યુવક to load the page fetches it from
 * Google. A rollback is pasting the previous link back — nothing was ever deleted.
 *
 * A Drive link is converted rather than rejected. `uc?export=download` is a download route:
 * it is metered by Drive's per-file quota and answers large files with an HTML confirmation
 * page instead of image bytes, so pointing a card at it would blank the દર્શન for everybody
 * at once. `lh3.googleusercontent.com` is Google's image CDN, which serves Drive's own
 * previews, re-encodes on request and is not quota-metered. `resolveImageInput` is what
 * turns the first into the second — the same function the build script uses, so a link
 * pasted here produces exactly the URL a rebuild would have produced.
 */
export function validateImageUrl(url, current) {
  const s = String(url || '').trim();
  if (!s) return { ok: false, gu: 'Paste the Google Drive link for this image.' };

  const resolved = resolveImageInput(s);
  if (!resolved.ok) return resolved;
  if (current && resolved.url === current) return { ok: false, gu: 'This is already the current image.' };

  return {
    ok: true,
    url: resolved.url,
    driveId: resolved.driveId,
    note: resolved.driveId
      ? 'Drive link converted to Google’s image CDN, which is what a browser can display.'
      : '',
  };
}

/**
 * Set one દ્રશ્ય's image from a pasted link.
 *
 * Three columns move together and so are written in one statement: the URL the app renders,
 * the Drive id behind it (which is what lets the enlarged view ask for a wider encode), and
 * the સંચાલક's original paste, kept so the box can show him what he actually typed rather
 * than the derived lh3 URL.
 */
export async function setSceneImage(itemId, input) {
  const resolved = resolveImageInput(input);
  if (!resolved.ok) throw new Error(resolved.gu);

  await saveScene(itemId, {
    imageUrl: resolved.url,
    driveId: resolved.driveId || null,
    sourceDriveUrl: String(input || '').trim(),
  });

  return resolved;
}

/** Re-exported so pages can name a bad Drive link before anything is written. */
export { parseDriveLink };

