/**
 * Master content access (§21).
 *
 * Every total in the application comes from here, and every one of them is derived.
 * There is no TOTAL = 100 and no TOTAL = 109 anywhere: `content/darshan.json` is built by
 * `npm run darshan` from the સંચાલક's sheet and his Drive folder, and whatever it contains
 * is what the app teaches. 150 scenes would need no code change.
 *
 * A scene is `active` only when it has both an image link and a વર્ણન — `isLearnable`, the
 * same rule the panel applies, so the two cannot drift.
 */
import data from '../../content/darshan.json';
import { isLearnable } from '../../shared/domain/darshan.js';

/** Stable identity is the id, never the array position (§3). */
export const ALL_SCENES = [...data].sort((a, b) => (a.order ?? a.n) - (b.order ?? b.n));

/** The scenes a yuvak actually learns. */
export const SCENES = ALL_SCENES.filter(isLearnable);

export const TOTAL = SCENES.length;

const BY_ID = new Map(SCENES.map((s) => [s.id, s]));

export const sceneById = (id) => BY_ID.get(id) ?? null;
export const sceneIds = () => SCENES.map((s) => s.id);

/** Ordered lookup, used to re-sort a stored id list back into ક્રમ order (§1 rule 2). */
const ORDER_OF = new Map(SCENES.map((s, i) => [s.id, i]));

/**
 * ક્રમ કદી તૂટે નહીં — the order must never break. Progress is persisted as unordered id
 * lists, so every screen re-sorts through this before rendering. Unknown ids (a scene
 * withdrawn since the list was written) are dropped rather than rendered as a hole.
 */
export function inOrder(ids) {
  return [...new Set(ids)]
    .filter((id) => ORDER_OF.has(id))
    .sort((a, b) => ORDER_OF.get(a) - ORDER_OF.get(b));
}

/** Only ids that exist and are active — the client-side half of §30's validation. */
export const keepKnown = (ids) => (Array.isArray(ids) ? ids.filter((id) => BY_ID.has(id)) : []);

/** Gujarati numerals, for display only. Counting stays in JS numbers. */
const GU_DIGITS = ['૦', '૧', '૨', '૩', '૪', '૫', '૬', '૭', '૮', '૯'];
export const gu = (n) => String(n).replace(/\d/g, (d) => GU_DIGITS[Number(d)]);
