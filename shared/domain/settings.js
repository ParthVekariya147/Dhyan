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
 * settings['app'].value.tickWord — the word a ticked row carries.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What it is for
 * ────────────────────────────────────────────────────────────────────────────
 *
 * લેવલ ૪'s કસોટી is a list of bare numbers and boxes — no ચિત્ર, no વર્ણન, by design and
 * enforced in three places (see src/modules/level4/ActivityTestPage.jsx). The consequence
 * is a row that is mostly empty band, and a screen of thirty of them reads as unfinished
 * rather than as deliberate. This fills that band, and only once the box is ticked: the
 * યુવક brings the દ્રશ્ય to mind, ticks, and the row answers with the name.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why a settings value and not a literal
 * ────────────────────────────────────────────────────────────────────────────
 *
 * §36 — a word a યુવક reads belongs to the સંચાલક. `show: false` turns it off entirely and
 * returns the rows to exactly what they are today, so this can be withdrawn without a
 * deploy if it turns out to be noise on a thirty-row list.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why it cannot leak an answer
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This is **one string for the whole list**, identical on every row, and it is a
 * configuration value that has never met a દ્રશ્ય. It cannot be per-scene because there is
 * nowhere per-scene for it to come from: no row is asked for its own word, and the value
 * arrives from settings rather than from the કસોટી. That is the same reasoning the page
 * applies to its own imports, and it is why the row still takes no text prop at all — the
 * word reaches it as an inherited CSS custom property set once on the list.
 */
export const TICK_WORD_KEY = 'tickWord';

/**
 * On, with the name. A project that has never opened the field gets the behaviour the
 * feature was asked for; `show: false` is how it is turned off, and it has to be said.
 */
export const DEFAULT_TICK_WORD = Object.freeze({ show: true, text: 'સ્વામિનારાયણ' });

/**
 * A row's band is about 150px wide on a 320px phone, which is ~14 Gujarati characters at
 * the row's own size. Past that the word wraps and the row grows — not a break, but not
 * what anybody chose either, and on a thirty-row list it is thirty rows that grew. The cap
 * is set above the natural words for this (સ્વામિનારાયણ is 12) and well below a sentence,
 * because a sentence is what this must not become: §16 keeps instructions off this screen.
 */
export const TICK_WORD_MAX = 24;

/**
 * settings['app'].value.tickWord → the word actually rendered.
 *
 * Forgiving, in the same shape and for the same reason as resolveLevel4Gate() above: this
 * is jsonb somebody once wrote, and every way it can be wrong has to end at something a row
 * can render. The one direction worth stating: an unusable `text` falls back to the default
 * word rather than to nothing, because "nothing" is indistinguishable from the સંચાલક having
 * turned the feature off, and those are different answers.
 *
 * Whitespace is collapsed rather than preserved. The word travels to the row as a CSS
 * string, where a newline is not a line break but an escape sequence for the letter 'n' —
 * so a pasted two-line value would not wrap, it would render the letter n. Collapsing here
 * means the panel and the row cannot disagree about what was saved.
 */
export function resolveTickWord(stored) {
  const w = stored && typeof stored === 'object' ? stored : {};
  const text = typeof w.text === 'string' ? w.text.replace(/\s+/g, ' ').trim() : '';
  return {
    show: w.show !== false,
    text: text && text.length <= TICK_WORD_MAX ? text : DEFAULT_TICK_WORD.text,
  };
}

/** Refuses what resolveTickWord() would silently correct — same division of labour as above. */
export function validateTickWord(word) {
  const w = word && typeof word === 'object' ? word : null;
  if (!w) return { ok: false, gu: 'The ticked-row word setting is missing.' };
  if (typeof w.show !== 'boolean') return { ok: false, gu: 'Ticked-row word: on or off must be set.' };
  if (!w.show) return { ok: true };

  if (typeof w.text !== 'string') return { ok: false, gu: 'Ticked-row word: enter a word.' };
  const text = w.text.replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, gu: 'Ticked-row word: enter a word, or turn it off.' };
  if (text.length > TICK_WORD_MAX) {
    return {
      ok: false,
      gu: `Ticked-row word: ${TICK_WORD_MAX} characters or fewer - it has to fit inside a row.`,
    };
  }
  return { ok: true, text };
}

/**
 * settings['app'].value.slideshow — how long the fullscreen દર્શન holds each દ્રશ્ય.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What it is for
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The gallery's આપોઆપ (GalleryViewer.jsx) advances by itself once a યુવક starts it. How long
 * it waits is not a fact about the code — it is a judgement about how long a દ્રશ્ય wants to
 * be looked at, and that judgement belongs to the સંચાલક, who can watch a room full of યુવકો
 * and see whether six seconds is hurried. So it is a setting, not a constant.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why it lives on settings['app'] and not settings['levels']
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `levels` holds what a level *is* — its name, its order, whether it is offered, what opens
 * લેવલ ૪. This is none of those. It is a property of a viewing surface, in the same class as
 * `tickWord` and the two ધૂન: something a યુવક experiences, changeable without a deploy,
 * changing nothing about the ladder. The યુવક app already reads the `app` row on every visit
 * (src/lib/useSettings.js), so this rides a request that is being made anyway.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Seconds, stored; milliseconds, used
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The stored unit is **seconds**, because that is the unit the સંચાલક types and the unit the
 * bound is expressed in. The conversion to the milliseconds `setTimeout` wants happens at the
 * one place that starts the timer, and never in the stored value — a row holding 8000 that
 * someone later reads as seconds is a two-and-a-quarter-hour slideshow.
 */
export const SLIDESHOW_KEY = 'slideshow';

/**
 * One second to sixty, and both ends are meant.
 *
 * The floor is 1 and not 0: zero is not a fast slideshow, it is a slideshow with no dwell at
 * all — ૧૦૯ દ્રશ્યો flickering past in whatever time the pictures take to decode, which is
 * not a setting anybody wants and is indistinguishable from a bug. A યુવક who wants to move
 * that fast has the › arrow.
 *
 * The ceiling is 60 because past a minute the slideshow has stopped being a slideshow: a
 * યુવક watching a દ્રશ્ય for two minutes cannot tell it from one that has frozen, and would
 * reasonably reload the app. An unbounded number here would also let a mistyped 600 look
 * exactly like a broken આપોઆપ, with nothing on any screen to say which it was.
 */
export const SLIDESHOW_MIN_SECONDS = 1;
export const SLIDESHOW_MAX_SECONDS = 60;

/**
 * Six seconds — today's behaviour exactly, so a project that never opens this field keeps
 * the pace it already had.
 *
 * That is the same rule DEFAULT_LEVEL4_GATE follows and it is the one that matters here:
 * this setting is being added to a feature that already shipped with a six-second dwell
 * hard-coded in GalleryViewer.jsx, and a default of anything else would silently re-time
 * every existing project's દર્શન on deploy. Six also sits inside the 5–10s the brief
 * recommends, so nothing is being preserved at the cost of being wrong.
 */
export const DEFAULT_SLIDESHOW = Object.freeze({ seconds: 6 });

/**
 * settings['app'].value.slideshow → the dwell actually in force.
 *
 * Forgiving, in the same shape and for the same reason as resolveLevel4Gate() and
 * resolveTickWord() above: this is jsonb that anybody with `settings.update` once wrote, and
 * every way it can be wrong has to end at a number `setTimeout` can use. The direction each
 * branch falls in is the whole point —
 *
 *   absent / not an object   → the default. Nothing has been configured.
 *   not a number             → the default. **`typeof`, never `Number()`**, exactly as the
 *                              gate resolver argues: `Number(null)` and `Number('')` are both
 *                              0, so a coercing check turns "nothing here" into a dwell of
 *                              zero — the flickering slideshow the floor exists to forbid.
 *   below the floor          → clamped up to 1, not defaulted to 6. A સંચાલક who wrote 0 was
 *                              asking for "as fast as possible", and the fastest this is
 *                              allowed to go is the honest answer to that.
 *   above the ceiling        → clamped down to 60, for the mirror-image reason.
 *   fractional               → rounded, not floored. 1.6s is nearer 2 than 1, and unlike the
 *                              gate — where flooring is the safe direction because it can
 *                              only make a threshold easier — nothing here is safer either
 *                              way, so the arithmetic that is simply more accurate wins.
 *
 * A NaN or an Infinity is refused by `Number.isFinite` before either clamp sees it: NaN
 * survives both `Math.min` and `Math.max` unchanged, so clamping alone would hand
 * `setTimeout` a NaN — which fires immediately, and turns a mistyped setting into exactly
 * the zero-dwell flicker the floor is written to prevent.
 */
export function resolveSlideshow(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const n = s.seconds;
  if (typeof n !== 'number' || !Number.isFinite(n)) return { seconds: DEFAULT_SLIDESHOW.seconds };
  return {
    seconds: Math.min(SLIDESHOW_MAX_SECONDS, Math.max(SLIDESHOW_MIN_SECONDS, Math.round(n))),
  };
}

/**
 * Refuses what resolveSlideshow() would silently clamp — same division of labour as the two
 * validators above.
 *
 * The resolver forgives because a stored row must always produce a running slideshow; this
 * refuses because a સંચાલક who types 90 should be told the ceiling is 60, not have it
 * quietly become 60 and be left to discover the difference by watching. A value this accepts
 * is a value the resolver returns unchanged — that equivalence is what keeps the panel's
 * field and the યુવક's dwell the same number, and `settings_slideshow_seconds()` in
 * 0018_gallery_slideshow.sql mirrors both.
 */
export function validateSlideshow(slideshow) {
  const s = slideshow && typeof slideshow === 'object' ? slideshow : null;
  if (!s) return { ok: false, gu: 'The slideshow setting is missing.' };

  // `typeof`, matching the resolver. Validating with Number() while resolving with typeof is
  // how a value passes the save and is then quietly replaced — the સંચાલક is told "Saved",
  // and the slideshow runs at a speed he did not choose.
  const n = s.seconds;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return { ok: false, gu: 'Slideshow interval: enter a number of seconds.' };
  }
  if (!Number.isInteger(n)) return { ok: false, gu: 'Slideshow interval: enter a whole number of seconds.' };
  if (n < SLIDESHOW_MIN_SECONDS || n > SLIDESHOW_MAX_SECONDS) {
    return {
      ok: false,
      gu: `Slideshow interval: between ${SLIDESHOW_MIN_SECONDS} and ${SLIDESHOW_MAX_SECONDS} seconds.`,
    };
  }
  return { ok: true, seconds: n };
}

/**
 * settings['app'].value.dhunAutoplay — whether the ધૂન starts by itself on entering the app.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What it is for
 * ────────────────────────────────────────────────────────────────────────────
 *
 * §8 asks for the ધૂન to start softly the moment a યુવક is in, and that is what the app has
 * always done. This is the switch that decides whether it still does — and it is the
 * સંચાલક's, not the code's, for the same reason the slideshow dwell is his: whether music
 * should greet a room full of યુવકો is a judgement about the સાધના, and it changes without a
 * deploy.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Off is "not fetched", not "fetched and muted"
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This is the half worth reading twice, because it is the difference between a setting and a
 * decoration. The <audio> in src/components/DhunPlayer.jsx carries `preload="none"`, so the
 * MP3's bytes are requested by the call to play() and by nothing else. Switching this off
 * therefore does not mute a download that happened anyway — it means the file is never asked
 * for at all, on a screen served to ~2,000 યુવકો on mobile data (§14). A યુવક who wants it
 * taps the corner button, and *that* tap is what fetches it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What it does NOT do
 * ────────────────────────────────────────────────────────────────────────────
 *
 * It does not remove the ધૂન. The corner button, the two names and the volume slider are all
 * still there with this off — it decides who starts the music, not whether there is any. A
 * setting that hid the control would be the સંચાલક answering a question §8 gave to the યુવક.
 *
 * It is also not the યુવક's own on/off, which lives in his phone's localStorage and never
 * leaves it (src/lib/dhun.js). The two are read together: this one says whether playback may
 * begin unasked, his says whether he wants it at all.
 */
export const DHUN_AUTOPLAY_KEY = 'dhunAutoplay';

/**
 * On — today's behaviour exactly, so a project that never opens this field keeps the ધૂન it
 * already had. The same rule DEFAULT_SLIDESHOW and DEFAULT_LEVEL4_GATE follow, and the same
 * reason: this setting is being added to shipped behaviour, and any other default would
 * silently switch the music off for every existing project on deploy.
 */
export const DEFAULT_DHUN_AUTOPLAY = Object.freeze({ on: true });

/**
 * settings['app'].value.dhunAutoplay → whether playback may begin without a tap.
 *
 * Forgiving, in the same shape and for the same reason as the three resolvers above: this is
 * jsonb anybody with `settings.update` once wrote, and every way it can be wrong has to end
 * at a boolean the player can act on.
 *
 * `!== false` rather than `Boolean(a.on)`, which is the whole of the branch that matters:
 * absence must read as the default and the default is on, so a row written by an older panel
 * — every row in the database today — must not be read as "the સંચાલક turned the music off".
 * Only a stored, literal `false` does that, which means switching it off has to be said.
 *
 * There is no validator beside this one, unlike the settings above. There is nothing to
 * refuse: a checkbox produces a boolean or it produces nothing, and both of those already
 * have an answer here. A validator that could only ever return ok would be a rule with
 * nothing to enforce.
 */
export function resolveDhunAutoplay(stored) {
  const a = stored && typeof stored === 'object' ? stored : {};
  return { on: a.on !== false };
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
    return { ok: false, gu: 'Level 2 (Darshan) cannot be disabled - it is the only active level right now.' };
  }
  return { ok: true };
}
