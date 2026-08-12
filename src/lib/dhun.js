/**
 * ધૂન — reading the two tracks the સંચાલક uploaded, and remembering what this yuvak likes.
 *
 * §8 asks for exactly two dhun/kirtan, uploaded and named from the panel, one of them
 * playing softly and looping while the yuvak meditates. The two entries live in the `dhun`
 * field of the settings['app'] row — the field 0001_init.sql:263 seeded as `[]` and that
 * src/lib/useSettings.js:8 has always described ("the two dhun and the YouTube video
 * link") without anything reading it. This is the reader.
 *
 * The preference — which dhun, on or off, at what volume — never leaves the phone.
 * PLAN.md §6 is explicit: "music choice and scroll speed live only on the phone — never in
 * Firebase", and §13 asks for nothing to be collected that is not needed. What a yuvak
 * listens to while sitting with the ૧૦૮ દ્રશ્યો is not the સંઘ's business, and storing it
 * would also cost a write per fiddle with the volume slider against the §12 write budget.
 *
 * The normaliser is deliberately a second copy of the panel's
 * (admin/src/features/settings/services/dhunService.js). Its natural home is
 * shared/domain/, but this app already keeps its own copy of youtubeId() for the same
 * reason (src/lib/useSettings.js:53): the યુવક bundle is what 2,000 phones download, and
 * scripts/verify-admin-separation.mjs exists to keep panel code out of it. Both copies
 * enforce one rule — a dhun needs a name and a URL or it does not exist — and a slot that
 * fails it is dropped on both sides, so the panel can never show a track as configured
 * that the app quietly ignores.
 */

/** §8: "exactly two". Anything beyond the first two is ignored rather than rendered. */
export const MAX_DHUN = 2;

/**
 * "શરૂઆતમાં ધીમેથી શરૂ થાય" (§8) — it starts *softly*. This is a background for dhyan, not
 * something to listen to, so the default sits well under half. The yuvak's own choice
 * overrides it and is remembered.
 */
export const DEFAULT_VOLUME = 0.3;

const PREF_KEY = 'varni.dhun';

/** @typedef {{ id: string, name: string, url: string }} Dhun */

/** @returns {Dhun[]} */
export function readDhunList(settings) {
  const raw = settings?.dhun;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d) => d && typeof d === 'object')
    .map((d) => ({
      // `id` is what the preference points at, so it must survive the સંચાલક renaming a
      // dhun — hence the storage path, not the name and not the position in the array.
      id: String(d.id || d.path || d.url || ''),
      name: String(d.name || '').trim(),
      url: String(d.url || '').trim(),
    }))
    .filter((d) => d.id && d.name && d.url)
    .slice(0, MAX_DHUN);
}

/**
 * The remembered choice. Every access is wrapped: localStorage throws outright in Safari's
 * private mode and in a few embedded browsers, and a yuvak must never lose the app over a
 * music preference (§1 — nothing here is allowed to be a dead end).
 *
 * @returns {{ id: string|null, on: boolean, volume: number }}
 */
export function readDhunPref() {
  const fallback = { id: null, on: true, volume: DEFAULT_VOLUME };
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw);
    return {
      id: typeof p?.id === 'string' && p.id ? p.id : null,
      // `on` defaults to true only when nothing has been stored: §8 wants the dhun to
      // start on entering the app. Once he has turned it off, that answer is kept — a
      // corner button that quietly re-enables itself every visit is not a toggle.
      on: p?.on !== false,
      volume: clampVolume(p?.volume),
    };
  } catch {
    return fallback;
  }
}

export function writeDhunPref(pref) {
  try {
    localStorage.setItem(
      PREF_KEY,
      JSON.stringify({ id: pref.id ?? null, on: Boolean(pref.on), volume: clampVolume(pref.volume) })
    );
  } catch {
    /* Private mode, or a full quota. The session still works; only the memory is lost. */
  }
}

export function clampVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, n));
}

/**
 * Which track to play, given what is configured and what he chose last time.
 *
 * Falls through to the first dhun rather than to silence when his remembered one is gone —
 * the સંચાલક replacing a track changes the id, and a yuvak whose dhun disappeared should
 * hear the other one, not wonder why the button does nothing.
 */
export function pickDhun(list, prefId) {
  if (!list.length) return null;
  return list.find((d) => d.id === prefId) || list[0];
}
