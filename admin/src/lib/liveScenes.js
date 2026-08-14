import { supabase } from './supabase';

/**
 * The દર્શન collection as the યુવક app sees it, computed in the panel.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this exists
 * ────────────────────────────────────────────────────────────────────────────
 *
 * "૮૭ of ૧૦૮" needs the ૧૦૮, and Postgres cannot produce it. The collection is
 * `content/darshan.json` - a file the database has never seen - with `public.scenes` as a
 * *sparse* overlay on top: most દ્રશ્યો have no row at all, some rows withhold a દ્રશ્ય, and
 * some rows are દ્રશ્યો the સંચાલક created that the manifest will not know about until the
 * next `npm run darshan` (0010:167).
 *
 * 0029 approximated the size of that set from the largest `total_items` a recent લેવલ ૩
 * attempt reported. It got the number right and told us nothing about the membership, which
 * is a different question and the one that matters: four યુવકો in production have each
 * submitted 108 distinct દ્રશ્યો and hold 107 of today's 108, because one દ્રશ્ય they ticked
 * has since been withheld and one દ્રશ્ય added since they finished is one they have never
 * seen. A count cannot distinguish that from "he missed one".
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why it is not a second definition of the collection
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This module runs `withDisplayIndex`, `applyOverlay`, `isLearnable` and `sceneRowEntry`
 * from `shared/domain/darshan.js` over `ALL_SCENES` from `src/lib/scenes.js` - the same
 * four functions and the same manifest that `src/lib/useScenes.js` runs to build what the
 * યુવક is actually shown. The gates are applied in the same order, for the same reason:
 *
 *   1. the સંચાલક gate - a row whose status is not PUBLISHED/ACTIVE is withheld
 *   2. the content gate - a દ્રશ્ય is learnable only with BOTH an image and a વર્ણન,
 *      applied *after* the overlay so a વર્ણન written in the panel brings a દ્રશ્ય to life
 *
 * A દ્રશ્ય with no overlay row is shown: `public.scenes` is seeded by nothing, so requiring a
 * row would hide the entire collection. Absence of a row means the સંચાલક has never ruled
 * on that દ્રશ્ય, not that he withheld it.
 *
 * If this file and useScenes.js ever disagree, the report is wrong and
 * `admin_verify_user_progress()` is the tool that will say so.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The manifest is 124 KB, so nothing here is imported eagerly
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `src/lib/scenes.js` pulls in `content/darshan.json`, which is the single largest asset in
 * either build - it is why §51 keeps દર્શન lazy in the panel and why the યુવક app refuses to
 * put it in a login bundle. The import below is dynamic and the result is memoised for the
 * session, so a સંચાલક who never opens a progress screen never downloads it, and one who
 * opens five downloads it once.
 */

/** Settled value, so the second screen of a session paints without a second fetch. */
let cached = null;
let inFlight = null;

/** Mirrors isWithheld() in src/lib/useScenes.js - the સંચાલક gate, and only that gate. */
const isWithheld = (row) =>
  row.active === false || !(row.status === 'PUBLISHED' || row.status === 'ACTIVE');

/**
 * The live collection, ordered and sequenced exactly as the યુવક sees it.
 *
 * Returns `{ scenes, ids, total, source }` where `scenes` carry `displayIndex` (the ૧…N a
 * યુવક reads, derived and stored nowhere) plus whatever વર્ણન and title survived the
 * overlay, and `ids` is the plain array the reporting RPCs take.
 *
 * `source` is `'app-manifest'` on success. On failure this throws rather than returning a
 * partial collection: a report that silently counted against half a collection would print
 * a percentage that looks fine and is wrong, which is worse than a page that says it could
 * not load.
 */
export async function loadLiveScenes({ force = false } = {}) {
  if (cached && !force) return cached;
  if (inFlight && !force) return inFlight;

  inFlight = (async () => {
    // Both dynamic: the manifest for its size, the domain module because it rides with it.
    const [{ ALL_SCENES }, darshan, { data: rows, error }] = await Promise.all([
      import('../../../src/lib/scenes.js'),
      import('../../../shared/domain/darshan.js'),
      supabase.from('scenes').select('id, index, order, active, status, title, caption, image_url, drive_id'),
    ]);
    if (error) throw error;

    const { withDisplayIndex, applyOverlay, isLearnable, sceneRowEntry } = darshan;
    const overlay = rows || [];

    // snake_case in Postgres, camelCase in the domain model. Reading `row.imageUrl` here
    // would be silently undefined and every republished image would go on serving the old
    // file - the same trap useScenes.js documents at its own mapping.
    const byId = new Map(
      overlay.map((row) => [
        row.id,
        {
          id: row.id,
          index: row.index,
          order: row.order,
          active: row.active,
          status: row.status,
          title: row.title,
          caption: row.caption,
          imageUrl: row.image_url,
          driveId: row.drive_id,
        },
      ])
    );

    // દ્રશ્યો that exist only as a row. They pass through both gates below like everything
    // else - nothing here lets a panel-created દ્રશ્ય skip a check.
    const inManifest = new Set(ALL_SCENES.map((s) => s.id));
    const created = overlay
      .filter((row) => !inManifest.has(row.id))
      .map((row) => sceneRowEntry(byId.get(row.id)));

    // ALL_SCENES and not SCENES: the content gate is re-applied after the overlay, so a
    // વર્ણન written in the panel can promote a દ્રશ્ય that shipped without one.
    const scenes = withDisplayIndex(
      [...ALL_SCENES, ...created]
        .filter((s) => {
          const row = byId.get(s.id);
          return !row || !isWithheld(row);
        })
        .map((s) => applyOverlay(s, byId.get(s.id)))
        .filter(isLearnable)
    );

    cached = {
      scenes,
      ids: scenes.map((s) => s.id),
      total: scenes.length,
      source: 'app-manifest',
    };
    return cached;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Exported for the same narrow purpose as clearSceneOverlayCache() in the યુવક app: a screen
 * that *changes* the overlay would otherwise go on reporting against what it replaced. The
 * દર્શન editor is that screen, and it lives in this build.
 */
export function clearLiveScenesCache() {
  cached = null;
  inFlight = null;
}

/** A `Map` from scene id to its live entry, for turning stored ids back into numbered rows. */
export function sceneIndex(live) {
  return new Map((live?.scenes || []).map((s) => [s.id, s]));
}
