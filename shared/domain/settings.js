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

import { LEVEL4_UNLOCK_THRESHOLD } from './constants.js';

export const SETTINGS_COLLECTION = 'settings';
export const APP_SETTINGS_DOC = 'app';
export const LEVELS_SETTINGS_DOC = 'levels';

/**
 * settings['levels'].value.level4Gate — what opens લેવલ ૪.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this moved here
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The number used to live on the published લેવલ ૪ configuration (`gate_threshold`,
 * LEVEL4.md decision #3), and that was defensible — each published edition carrying its own
 * gate — but it had one consequence nobody chose: **there was nowhere to set it until a
 * configuration existed.** A સંચાલક who had not yet composed ૪.૧ could not answer the
 * question "how much of લેવલ ૩ opens લેવલ ૪?" at all, because the only field that held the
 * answer lived inside a draft he had not made yet. He would look on the Levels page, where
 * every other fact about a level is configured, and find nothing.
 *
 * So it lives beside `levels` now: same settings row, same RLS policy, same audit trigger,
 * one place to look. It is answerable on day one, before a single કસોટી has been composed.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * This is the only answer, and that is deliberate
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `level4_configs.require_gate` and `.gate_threshold` still exist and are still written by
 * older drafts, but **nothing reads them any more** (0014). Two places answering one
 * question is exactly the fault `0011_level4_gate_view.sql` was written to remove — the
 * panel and the યુવક app disagreeing about a rule the સંચાલક set himself — and reintroducing
 * it one layer down would be the same bug wearing a different hat. A configuration may be
 * republished, cloned or archived without any of it changing what opens the level.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What it does NOT do
 * ────────────────────────────────────────────────────────────────────────────
 *
 * It does not open લેવલ ૪. There is nothing to open until a configuration is published —
 * a gate in front of an empty room. Setting the number early is answering *when*, not
 * *whether*.
 */
export const LEVEL4_GATE_KEY = 'level4Gate';

/**
 * `require: true` at the shared threshold — today's behaviour exactly, so a project that
 * has never touched this setting behaves as it always did.
 *
 * The number is `LEVEL4_UNLOCK_THRESHOLD` re-used rather than an ૮૦ typed here: it is the
 * same ૮૦ that 0008's trigger writes `profiles.level4_unlocked` from, and two literals that
 * are meant to be one number are two literals that will eventually differ.
 */
export const DEFAULT_LEVEL4_GATE = Object.freeze({
  require: true,
  threshold: LEVEL4_UNLOCK_THRESHOLD,
});

/**
 * settings['levels'].value.level4Gate → the gate actually in force.
 *
 * Written in the same defensive shape as resolveLevels() below, and for the same reason:
 * this is jsonb that anybody with `settings.update` once wrote, not a typed value. Every
 * way it can be wrong has to end at a usable gate rather than at an exception or, worse, at
 * a `NaN` threshold that no score can ever reach and that would shut લેવલ ૪ for everybody.
 *
 *   absent / not an object   → the defaults. Nothing has been configured.
 *   `require` absent         → true. Defaulting to "open to everyone" is the unsafe
 *                              direction to guess in — it would hand લેવલ ૪ to every યુવક
 *                              because a key was missing.
 *   threshold not a number   → the default. **Tested with `typeof`, not `Number()`**, and
 *                              that is the whole of this function worth reading twice:
 *                              `Number(null)` is 0, `Number('')` is 0, `Number([])` is 0 —
 *                              so a coercing check turns three ways of saying "nothing here"
 *                              into a threshold of zero, which is a gate every યુવક passes.
 *                              A missing key would have opened લેવલ ૪ to all 2,000 of them.
 *   threshold negative       → the default. A negative gate is open to everyone, which is
 *                              what `require: false` is for and should have to be said.
 *
 * A numeric **string** is refused too, and deliberately: `level4_gate_setting()` (0014) tests
 * `jsonb_typeof(...) = 'number'` and falls back for anything else, so accepting '75' here
 * would make the panel show ૭૫ while the database gated at ૮૦ — the two-answers-to-one-
 * question fault that 0011 and 0014 both exist to remove. The panel casts to a number before
 * saving, so a string in this column means something else wrote it.
 *
 * A threshold of 0 is honoured, not defaulted: it is a legitimate way to say "any day he
 * opens લેવલ ૩ at all", and it is distinguishable from absence because absence is undefined.
 */
export function resolveLevel4Gate(stored) {
  const g = stored && typeof stored === 'object' ? stored : {};
  const n = g.threshold;
  return {
    require: g.require !== false,
    threshold:
      typeof n === 'number' && Number.isFinite(n) && n >= 0
        ? Math.floor(n)
        : DEFAULT_LEVEL4_GATE.threshold,
  };
}

/**
 * Refuses what resolveLevel4Gate() would silently correct.
 *
 * The resolver forgives, because a stored row must always render; this refuses, because a
 * સંચાલક typing a number should be told it is not one rather than have it quietly become
 * ૮૦ and wonder later why the gate is not where he put it. Same division of labour as
 * resolveLevels()/validateLevels().
 *
 * There is no upper bound, and that is not an oversight: the collection grows, and a limit
 * written here would be a second total (§6 rule 1) that goes stale the day a દ્રશ્ય is added.
 * A threshold above the collection size is a gate nobody can pass — which the panel warns
 * about, because it is almost certainly a typo, but does not forbid.
 */
export function validateLevel4Gate(gate) {
  const g = gate && typeof gate === 'object' ? gate : null;
  if (!g) return { ok: false, gu: 'The Level 4 unlock setting is missing.' };
  if (typeof g.require !== 'boolean') return { ok: false, gu: 'Level 4 unlock: on or off must be set.' };
  if (!g.require) return { ok: true };

  // `typeof`, matching the resolver above. Validating with `Number()` while resolving with
  // `typeof` is how a value passes the save and is then quietly replaced by the default —
  // the સંચાલક is told "Saved", and the gate is not where he put it.
  const n = g.threshold;
  if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false, gu: 'Level 4 unlock: enter a number.' };
  if (!Number.isInteger(n)) return { ok: false, gu: 'Level 4 unlock: enter a whole number.' };
  if (n < 0) return { ok: false, gu: 'Level 4 unlock: the number cannot be negative.' };
  return { ok: true };
}

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
 * document is allowed to claim otherwise. Nor does it mean "લેવલ ૪ is open": that is earned
 * per-યુવક, against `level4Gate` above — the સંચાલક sets the number, each યુવક reaches it or
 * does not, and no field in this list can hand it to him (§7).
 *
 * This list was previously three-quarters false — Level 1 disabled while Home.jsx shipped
 * it enabled and linked, Levels 3 and 4 disabled because they are not built. The two were
 * describing different things and disagreeing about all of them. Read as availability, the
 * old list is also actively wrong to fall back to: an unreadable settings row would have
 * removed three of the four levels from the home page and left the યુવક with one button.
 */
export const DEFAULT_LEVELS = [
  { levelId: 1, order: 1, name: 'વિડિયો દર્શન', enabled: true },
  // Named plainly 'દર્શન'. It was 'PDF દર્શન' from the days when the collection was a PDF
  // a યુવક scrolled; it has not been one for a long time — /darshan is a feed of the master
  // images themselves — and a name that describes a file format the app no longer uses
  // tells him nothing about what he is about to open. The level's behaviour is unchanged;
  // only the word is (§36 — the name is data, the level is not).
  { levelId: 2, order: 2, name: 'દર્શન', enabled: true },
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
