/**
 * settings['app'] — the one configuration row both apps agree on.
 *
 * The યુવક app reads it through src/lib/useSettings.js; the સંચાલક panel writes it.
 * `settings` is a key/jsonb table (supabase/migrations/0001_init.sql) and the key stays
 * `app` rather than moving to something tidier: the yuvak app already reads that row on
 * every visit, so renaming it would break a working path for no gain (§43).
 *
 * settings['levels'] holds level availability (§36), in the same table for the same
 * reason — one RLS policy, one place to look.
 */

export const SETTINGS_COLLECTION = 'settings';
export const APP_SETTINGS_DOC = 'app';
export const LEVELS_SETTINGS_DOC = 'levels';

/**
 * Accepts a full YouTube URL or a bare id, since the admin may paste either.
 * Shared so the panel's "is this link valid?" answer is the same rule the યુવક app
 * will apply when it renders the પ્રવેશદ્વાર.
 */
export function youtubeId(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}

/**
 * §33 — the યુવક app embeds this in an iframe, so an arbitrary URL is not acceptable.
 * Anything that does not resolve to a YouTube video id is rejected before it is saved.
 */
export function validateYoutubeUrl(input) {
  const s = String(input || '').trim();
  if (!s) return { ok: false, gu: 'Enter a link.' };
  const id = youtubeId(s);
  if (!id) return { ok: false, gu: 'This is not a YouTube video link. Use a youtube.com or youtu.be link.' };
  return { ok: true, id, url: s };
}

/**
 * The four levels of §7, as they stand before any સંચાલક has saved anything.
 *
 * `enabled` here means **"the સાધના includes this level"**, and §7 says all four are part
 * of it — so all four are true. It does *not* mean "the યુવક app can show it yet"; that is
 * a fact about the code, it lives beside the route in src/pages/Home.jsx, and no settings
 * document is allowed to claim otherwise. Nor does it mean "લેવલ ૪ is open": that is
 * earned per-યુવક and computed from `profiles.level4_unlocked` (§7, 0008_level4_unlock.sql).
 *
 * This list was previously three-quarters false — Level 1 disabled while Home.jsx shipped
 * it enabled and linked, Levels 3 and 4 disabled because they are not built. The two were
 * describing different things and disagreeing about all of them. Read as availability, the
 * old list is also actively wrong to fall back to: an unreadable settings row would have
 * removed three of the four levels from the home page and left the યુવક with one button.
 */
export const DEFAULT_LEVELS = [
  { levelId: 1, order: 1, name: 'વિડિયો દર્શન', enabled: true },
  { levelId: 2, order: 2, name: 'PDF દર્શન', enabled: true },
  { levelId: 3, order: 3, name: 'વર્ણન યાદી', enabled: true },
  // Level 4 is the memory-recall stage: index number only. The panel may enable or
  // disable the level; it must never be able to change what that stage shows (§37), and
  // it cannot open the lock — see admin/src/features/levels/pages/LevelsPage.jsx.
  { levelId: 4, order: 4, name: 'ફક્ત નંબર', enabled: true },
];

/** The levels the code knows about. A settings row cannot invent a fifth (§37). */
const KNOWN_LEVEL_IDS = DEFAULT_LEVELS.map((l) => l.levelId);

/**
 * settings['levels'].value.levels → the list the યુવક app renders.
 *
 * Shared with the panel rather than written into src/pages/Home.jsx because both sides
 * have to agree on what a stored list *means*, and the interesting part is not the happy
 * path — it is every way the row can be wrong. §36 forbids putting a યુવક into an
 * impossible state, and a home page with nothing on it is the most impossible one there
 * is, so every branch below ends at a renderable list:
 *
 *   absent / not an array / empty  → the defaults. Nothing has been configured.
 *   fails validateLevels()         → the defaults. A stored list that would disable
 *                                    લેવલ ૨, or duplicate an id, is not a configuration —
 *                                    it is damage, and honouring it would strand people.
 *   missing an entry               → that level comes back from the defaults. A list saved
 *                                    by an older panel does not know about a level added
 *                                    later, and absence must not read as "turned off":
 *                                    `enabled: false` is how a સંચાલક says that.
 *   an unknown levelId             → dropped. The app has no screen for it.
 *
 * What a stored entry may change is `name`, `order` and `enabled` — nothing else, because
 * nothing else about a level is data (§37).
 */
export function resolveLevels(stored) {
  // Non-objects go first, before anything reads `.levelId` off them. This is jsonb coming
  // back from a row anybody with settings.update once wrote; it is not a typed value, and
  // a single null in the array must not be able to throw the home page away.
  const clean = Array.isArray(stored) ? stored.filter((l) => l && typeof l === 'object') : [];
  const list = clean.length && validateLevels(clean).ok ? clean : DEFAULT_LEVELS;

  const byId = new Map(list.filter((l) => KNOWN_LEVEL_IDS.includes(l.levelId)).map((l) => [l.levelId, l]));

  return DEFAULT_LEVELS
    .map((d) => {
      const s = byId.get(d.levelId);
      if (!s) return { ...d };
      return {
        levelId: d.levelId,
        name: String(s.name || '').trim() || d.name,
        order: Number.isInteger(s.order) && s.order >= 1 ? s.order : d.order,
        enabled: s.enabled !== false,
      };
    })
    // Ties fall back to levelId so the order is total, never dependent on sort stability.
    .sort((a, b) => a.order - b.order || a.levelId - b.levelId);
}

export function validateLevels(levels) {
  if (!Array.isArray(levels) || !levels.length) return { ok: false, gu: 'The level list is empty.' };
  const ids = new Set();
  for (const l of levels) {
    if (!Number.isInteger(l.levelId) || l.levelId < 1) return { ok: false, gu: 'Invalid level ID.' };
    if (ids.has(l.levelId)) return { ok: false, gu: `Level ${l.levelId} appears twice.` };
    ids.add(l.levelId);
    if (!Number.isInteger(l.order) || l.order < 1) return { ok: false, gu: 'Invalid order.' };
    if (!String(l.name || '').trim()) return { ok: false, gu: 'Level name cannot be empty.' };
  }
  // A yuvak partway through must never be stranded: §36 forbids putting users into an
  // impossible learning state, and Level 2 is the only level with content today.
  if (!levels.find((l) => l.levelId === 2)?.enabled) {
    return { ok: false, gu: 'Level 2 (Darshan) cannot be disabled — it is the only active level right now.' };
  }
  return { ok: true };
}
