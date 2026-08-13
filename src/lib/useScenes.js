import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { isSupabaseConfigured, supabaseConfigFromEnv } from '../../shared/supabase/client.js';
/*
  `withDisplayIndex` is the one derivation of the number a યુવક reads (ORDERING.md §2). It is
  imported here and applied once, at the end of this hook, because this hook is the single
  place the effective collection exists — see the note on the useMemo below.
*/
import { applyOverlay, isLearnable, sceneRowEntry, withDisplayIndex } from '../../shared/domain/darshan.js';
import { ALL_SCENES, SCENES } from './scenes';

const configured = isSupabaseConfigured(supabaseConfigFromEnv(import.meta.env));

/**
 * The two statuses that mean "a યુવક may see this".
 *
 * They are not a guess: supabase/migrations/0004_rbac.sql's `scenes_sync_status` trigger
 * derives `active := status in ('PUBLISHED', 'ACTIVE')` on every write, so these are
 * exactly the states the database itself treats as visible. DRAFT, VALIDATED and
 * DISABLED are the withheld ones.
 */
const VISIBLE = new Set(['PUBLISHED', 'ACTIVE']);

const isWithheld = (row) => !(row.active !== false && VISIBLE.has(row.status ?? 'ACTIVE'));

/**
 * ────────────────────────────────────────────────────────────────────────────
 * One overlay read per page load, not one per screen
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This hook used to hold its `select *` inside the effect, so every mount was another full
 * read of `public.scenes`. That is not one screen's cost: useScenes() is read by the home
 * ring, દર્શન, લેવલ ૩, the લેવલ ૪ list, one કસોટી, its પુનરાવર્તન and સેટિંગ — so an ordinary
 * evening of મુખપૃષ્ઠ → લેવલ ૩ → લેવલ ૪ → કસોટી is four full-table reads of the same rows,
 * doubled again by StrictMode in development. At 400-500 યુવકો that is the busiest query in
 * the application and none of it buys anything: the rows have not changed between two
 * navigations a second apart.
 *
 * The shape is `src/lib/useNavigation.js`'s, deliberately and to the line — a module-scope
 * promise every caller joins, plus the settled value beside it so a mount after the read has
 * finished paints the final list on its first frame instead of one frame of the manifest.
 * That file's reasoning applies here unchanged, so it is not restated:
 *
 *   * **No TTL, and there must not be one.** The cache is scoped to the page load and dies
 *     with the tab. A સંચાલક who withholds a દ્રશ્ય reaches a યુવક on his next visit, which is
 *     how every other setting in this app already behaves. A TTL would buy nothing a reload
 *     does not and would cost a દર્શન list that can renumber itself under a thumb mid-session
 *     — and renumbering is exactly what ORDERING.md §1 asks this app never to do casually.
 *   * **No concurrent duplicates.** Two screens mounting in the same frame join one promise.
 *   * **A failed read still resolves**, to null, which is the manifest fallback the comment
 *     below already describes. It never rejects: a rejection here would be an unhandled one
 *     in the console of every યુવક with a bad signal, and the screen has something to render
 *     either way.
 *
 * Nothing about the overlay's *meaning* changes here. Both gates, the numbering and the
 * fallback are the same lines they were; only how often the rows are fetched is different.
 */
let overlayPromise = null;

/** `undefined` = not settled yet. `null` is a real settled value: no overlay, use the manifest. */
let overlaySettled;

function loadOverlay() {
  if (overlayPromise) return overlayPromise;

  overlayPromise = (async () => {
    // Selected whole rather than column by column, exactly as the panel's loadScenes does.
    // One small table — and naming columns here would mean quoting `order`, which is also
    // PostgREST's own sort parameter.
    const { data, error } = await supabase.from('scenes').select('*');

    // An unreadable overlay is not fatal. Falling back to the manifest shows the finalised
    // દર્શન rather than an empty page, which is the §1 answer: never leave the યુવક at a dead
    // end. A signed-out visitor reads zero rows here by RLS, not an error, and lands in the
    // same place.
    //
    // The failure is NOT cached as a settled answer — `overlayPromise` is cleared so the next
    // screen he opens tries again. A bad minute of signal on the મુખપૃષ્ઠ must not cost him the
    // સંચાલક's edits for the rest of the tab's life.
    if (error) {
      overlayPromise = null;
      return null;
    }

    overlaySettled = data ?? null;
    return overlaySettled;
  })();

  return overlayPromise;
}

/**
 * Throw the overlay away, so the next reader fetches it again.
 *
 * Exported for symmetry with `clearNavCache()` and for the same narrow purpose: a screen that
 * *changes* the overlay would have to call this, or it would go on showing what it just
 * replaced. Nothing in the યુવક app is that screen — `public.scenes` is written only from the
 * સંચાલક panel, which is a separate build in a separate tab — so today this has no caller. It
 * is here so that the day one appears, the answer is a function that already exists rather
 * than a reload.
 */
export function clearSceneOverlayCache() {
  overlayPromise = null;
  overlaySettled = undefined;
}

/**
 * The finalised દર્શન — what the Drive folder and the સંચાલક's sheet produced, with the
 * સંચાલક's own edits applied on top and anything he has withheld removed.
 *
 * Two gates, both of which must pass (§7, §21):
 *
 *   1. The સંચાલક gate: `public.scenes` is an overlay holding admin-editable state, and a
 *      row whose status is not PUBLISHED/ACTIVE is withheld from યુવકો.
 *   2. The content gate: a scene is learnable only when it has BOTH a master image and a
 *      વર્ણન. Applied *after* the overlay, so a વર્ણન the સંચાલક writes in the panel is what
 *      brings an image-only દ્રશ્ય to life — દ્રશ્ય ૧૦૧–૧૦૯ go live by being filled in, not
 *      by a deploy (§12).
 *
 * A scene with NO overlay row is shown. That is deliberate, and it is the one place this
 * departs from a literal reading of "both must be true": `public.scenes` is seeded by
 * nothing — no migration inserts into it, and the panel only ever writes the row it is
 * editing — so requiring a row to exist would hide every finalised દર્શન and leave the
 * યુવક an empty page. Absence of a row means the સંચાલક has never ruled on that scene,
 * not that he has withheld it. Withholding is a deliberate act and has a row to prove it.
 *
 * Reading this table needs no migration: 0001_init.sql's "scenes readable by signed-in"
 * policy already lets any authenticated યુવક select from it.
 */
export function useScenes() {
  // Seeded from the settled value, so the second screen of a session paints the final list on
  // its first frame. `undefined` means the read has not finished; `null` is a real answer.
  const [overlay, setOverlay] = useState(() => (overlaySettled === undefined ? null : overlaySettled));
  const [loading, setLoading] = useState(configured && overlaySettled === undefined);

  useEffect(() => {
    // Hooks cannot be skipped, so the unconfigured guard lives inside the effect — the
    // same shape useSettings uses. An unconfigured build falls back to the manifest.
    if (!configured) {
      setLoading(false);
      return;
    }

    // Already settled: nothing to wait for and nothing to request. This is the path every
    // navigation after the first takes.
    if (overlaySettled !== undefined) {
      setOverlay(overlaySettled);
      setLoading(false);
      return;
    }

    let alive = true;

    loadOverlay().then((rows) => {
      if (!alive) return;
      setOverlay(rows);
      setLoading(false);
    });

    return () => {
      alive = false;
    };
  }, []);

  const scenes = useMemo(() => {
    /*
      ────────────────────────────────────────────────────────────────────────
      One list, and then one numbering (ORDERING.md §4)
      ────────────────────────────────────────────────────────────────────────

      Every screen in the યુવક app used to print the દ્રશ્ય's *stored* number, so the moment
      the સંચાલક withheld દ્રશ્ય ૧૦૬ a યુવક read "…૧૦૫, ૧૦૭, ૧૦૮…" and the ક્રમ he is asked
      to hold in his mind had a hole in it. `withDisplayIndex()` closes it: it hands back
      the same entries carrying `displayIndex`, a continuous ૧…N counted over exactly the
      entries that survive the two gates below — derived on read, stored nowhere, so
      withholding one દ્રશ્ય rewrites no rows and reactivating it rewrites none back
      (ORDERING.md §1).

      It is applied **here and nowhere else**, after the overlay and both gates, because
      this hook is the only place the effective collection exists. Downstream screens
      receive entries already sequenced and already in canonical order and must not sort
      again (ORDERING.md §8 rule 4) — which is why the `.sort((a, b) => (a.order ?? a.n) …)`
      that used to close this block is gone. `withDisplayIndex()` carries that sort itself,
      and total order broken by `id` beats a comparison that can call two દ્રશ્યો equal.

      The overlay-less branch goes through it too. A build whose સંચાલક has never edited a
      દ્રશ્ય must number its દર્શન exactly as one whose સંચાલક has; returning `SCENES`
      straight out would hand every screen entries with no `displayIndex` on them at all.
    */
    if (!overlay?.length) return withDisplayIndex(SCENES);

    const byId = new Map(
      overlay.map((row) => [
        row.id,
        {
          // Carried so sceneRowEntry() below can build an entry for a દ્રશ્ય that exists
          // only as a row. Every other consumer reads it off the Map key.
          id: row.id,
          index: row.index,
          order: row.order,
          active: row.active,
          status: row.status,
          // The short name (0013). Carried through so a screen that wants to name a દ્રશ્ય
          // has it on the entry rather than fetching this table a second time. It is not a
          // gate and must not become one: `isLearnable` below tests the image and the વર્ણન,
          // and every row ships with `title = ''` — folding it into the filter would empty
          // this hook and take the whole app down (DARSHAN_DATA_CONTRACT.md §2.1).
          title: row.title,
          caption: row.caption,
          // snake_case in Postgres, camelCase in the domain model. The panel maps it the
          // same way; reading `row.imageUrl` here would silently be undefined and every
          // republished image would go on serving the old file.
          imageUrl: row.image_url,
          // The Drive file id behind that URL, so the lightbox can ask the CDN for a wider
          // encode of the same image instead of enlarging the feed's copy.
          driveId: row.drive_id,
        },
      ])
    );

    /**
     * દ્રશ્યો the સંચાલક created in the panel (§12), which the manifest cannot know about
     * until the next `npm run darshan`.
     *
     * They pass through exactly the same two gates as everything else below — nothing here
     * lets a panel-created દ્રશ્ય skip a check. In practice both gates matter: such a row is
     * created DRAFT and so is withheld by `isWithheld` until the સંચાલક publishes an image
     * and moves it on, and `isLearnable` then holds it back again until it has a વર્ણન. A
     * દ્રશ્ય typed in five minutes ago with no artwork is invisible to a યુવક, which is the
     * §1 answer — a card with no image is a dead end.
     */
    const inManifest = new Set(ALL_SCENES.map((s) => s.id));
    const created = overlay.filter((row) => !inManifest.has(row.id)).map((row) => sceneRowEntry(byId.get(row.id)));

    // ALL_SCENES, not SCENES: the content gate is re-applied below, *after* the overlay,
    // so a caption written in the panel can promote a scene that shipped without one.
    //
    // ક્રમ કદી તૂટે નહીં (§1 rule 2): the canonical order and the numbering are one act, and
    // `withDisplayIndex()` performs both — the સંચાલક may have renumbered or reordered
    // scenes, and scenes.js sorted the manifest before any of those edits existed.
    return withDisplayIndex(
      [...ALL_SCENES, ...created]
        .filter((s) => {
          const row = byId.get(s.id);
          return !row || !isWithheld(row);
        })
        .map((s) => applyOverlay(s, byId.get(s.id)))
        .filter(isLearnable)
    );
  }, [overlay]);

  /*
    Unchanged, deliberately: `{ scenes, total, loading }` is what four screens read, and
    `displayIndex` arrives *on* the entries rather than as a fifth field. `total` is still
    `scenes.length` — which is now also the largest `displayIndex`, because the sequence
    counts exactly the entries in this array (ORDERING.md §8 rule 2: never a literal).
  */
  return { scenes, total: scenes.length, loading };
}
