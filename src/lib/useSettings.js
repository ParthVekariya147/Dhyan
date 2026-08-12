import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { isSupabaseConfigured, supabaseConfigFromEnv } from '../../shared/supabase/client.js';
import {
  APP_SETTINGS_DOC,
  LEVELS_SETTINGS_DOC,
  LEVEL4_GATE_KEY,
  TICK_WORD_KEY,
  resolveLevel4Gate,
  resolveLevels,
  resolveTickWord,
} from '../../shared/domain/settings.js';
import { JOURNEY_SETTINGS_DOC, resolveJourney } from '../../shared/domain/journey.js';

const configured = isSupabaseConfigured(supabaseConfigFromEnv(import.meta.env));

/**
 * One row of the `settings` key/jsonb table.
 *
 * Under Firestore this was deliberately one document holding everything, to keep the
 * read count down. That constraint is gone, but a single `settings` row keyed by name
 * is still the right shape: it is one small object the whole app reads once at start.
 *
 * Every failure ends at `{}` rather than at an error, because every caller of this has a
 * sensible thing to render without the row — the પ્રવેશદ્વાર explains that no link is set
 * yet, the home page falls back to the four levels of §7. A page that cannot open because
 * a configuration read failed is the dead end §1 forbids.
 */
function useSettingsRow(key) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Callers run this hook before they can check `unconfigured` — hooks cannot be
    // skipped — so the guard has to live here too, or the effect would touch the client
    // and throw on an unconfigured build. Settings already degrade to {} on any failure.
    if (!configured) {
      setSettings({});
      setLoading(false);
      return;
    }

    let alive = true;
    setLoading(true);

    supabase
      .from('settings')
      .select('value')
      .eq('key', key)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        // A missing or unreadable row is not fatal — pages degrade and say so rather
        // than failing to render (the entry gate explains that no link is set yet).
        setSettings(error ? {} : data?.value ?? {});
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [key]);

  return { settings, loading };
}

/**
 * settings.app — the two dhun and the YouTube video link, editable by the સંચાલક
 * without a redeploy (§8, §12).
 */
export function useSettings() {
  return useSettingsRow(APP_SETTINGS_DOC);
}

/**
 * settings.levels — which levels the સંચાલક offers, and in what order (§36).
 *
 * This hook is the missing half of a feature that was already built: the panel's Levels
 * page has been writing `settings['levels'].value.levels` correctly all along, while
 * src/pages/Home.jsx held the level list as a literal — so nothing the સંચાલક did there
 * ever reached a યુવક. Everything the panel saves now arrives here.
 *
 * `levels` is never null and never empty, at any point in the lifecycle including the
 * first render before the row has arrived: resolveLevels() falls back to the four levels
 * of §7. That is deliberate rather than a spinner — the home page is the first thing a
 * યુવક sees after signing in, and §1 asks for no friction. The cost is that a level a
 * સંચાલક has switched off can be visible for the width of one round trip; `loading` is
 * returned so a caller that minds can wait, and Home does not, because a level appearing
 * and then leaving is a smaller wrong than a home page that is blank on every visit.
 *
 * What is *not* here: whether લેવલ ૪ is open **to this યુવક**. That is earned, not
 * configured — see useLevel4GateSetting() below for the number he has to reach, and
 * `level4_gate_open()` in the database for whether he has reached it.
 */
export function useLevels() {
  const { settings, loading } = useSettingsRow(LEVELS_SETTINGS_DOC);
  const levels = useMemo(() => resolveLevels(settings?.levels), [settings]);
  return { levels, loading };
}

/**
 * settings.levels.level4Gate — the number of દ્રશ્યો in one day that opens લેવલ ૪ (0014).
 *
 * The same row `useLevels()` reads, and the same resolver both apps use, so the panel and
 * the યુવક app cannot disagree about what the સંચાલક typed.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this replaced, and why it matters more than it looks
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `LEVEL4_UNLOCK_THRESHOLD` — a literal ૮૦ in shared/domain/constants.js — used to be the
 * only answer anywhere in this app. Since 0014 the number is the સંચાલક's, and a project
 * running at ૬૦ had one piece of the યુવક app still testing against ૮૦: src/lib/progress.js,
 * which decides *when to send the day and re-read the profile*. Between ૬૦ and ૭૯ a યુવક had
 * genuinely opened લેવલ ૪ and nothing on the phone knew it, so the tile stayed shut until the
 * next natural flush or a reload. The gate was right and the app was a minute behind it.
 *
 * That is the whole reason this hook exists: it is not another way to ask the same question,
 * it is the *only* way, so nothing is left testing the old literal.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `require: false`
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The gate switched off is not "threshold ૦" — it is "no threshold at all". Callers should
 * read `require` rather than comparing against the number, which is still returned (the
 * સંચાલક's last value, kept so switching the gate back on restores what he typed).
 *
 * @returns {{ gate: { require: boolean, threshold: number }, loading: boolean }}
 *   Never null and never partial, on the very first paint: resolveLevel4Gate() falls back to
 *   the shared default. A caller that renders the number should still wait on `loading`, or
 *   it will print ૮૦ for the width of one round trip and then correct itself to ૬૦ — the one
 *   thing worse than a late promise is a wrong one.
 */
export function useLevel4GateSetting() {
  const { settings, loading } = useSettingsRow(LEVELS_SETTINGS_DOC);
  const gate = useMemo(() => resolveLevel4Gate(settings?.[LEVEL4_GATE_KEY]), [settings]);
  return { gate, loading };
}

/**
 * settings.journey — the wording of every page's description (shared/domain/journey.js).
 *
 * Never null and never partial, at any point in the lifecycle: resolveJourney() starts
 * from the code's own descriptions and lets the row replace individual sentences. So a
 * page renders its description on the very first paint, before the row has arrived and
 * whether or not one exists — which is the point. A description that appears half a second
 * late is a page that flickers; a description that never appears because a settings read
 * failed is a યુવક left guessing what the screen wants from him (§1).
 *
 * `loading` is returned for callers who would rather wait. None of the pages do: the worst
 * case is one paint of the code's wording before the સંચાલક's replaces it, and the two say
 * the same thing in different words.
 */
export function useJourney() {
  const { settings, loading } = useSettingsRow(JOURNEY_SETTINGS_DOC);
  const journey = useMemo(() => resolveJourney(settings?.pages), [settings]);
  return { journey, loading };
}

/**
 * settings.app → the word a ticked row carries (shared/domain/settings.js).
 *
 * Returns the string to render, or '' for "render nothing" — the two cases that mean
 * nothing (the સંચાલક turned it off, and the row has not arrived yet) are deliberately
 * collapsed into one value, so a caller cannot show the default word by forgetting to
 * check `loading`.
 *
 * **Empty while loading, and that is the point.** Every other settings hook here renders
 * the code's default immediately and lets the row replace it, because a page that is blank
 * until a read returns is the worse failure (§1). This one is the exception: nothing on the
 * screen is missing without it — an unticked row looks exactly as it always has — so the
 * alternative is a યુવક who ticks a box in the first half-second, sees 'સ્વામિનારાયણ'
 * appear, and watches it change or vanish when the row lands. A word that flickers is worse
 * than a word that arrives a moment late.
 */
export function useTickWord() {
  const { settings, loading } = useSettingsRow(APP_SETTINGS_DOC);
  const word = useMemo(() => resolveTickWord(settings?.[TICK_WORD_KEY]), [settings]);
  return { tickWord: loading || !word.show ? '' : word.text, loading };
}

/** Accepts a full YouTube URL or a bare id, since the admin may paste either. */
export function youtubeId(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}
