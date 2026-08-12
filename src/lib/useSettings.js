import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { isSupabaseConfigured, supabaseConfigFromEnv } from '../../shared/supabase/client.js';
import {
  APP_SETTINGS_DOC,
  LEVELS_SETTINGS_DOC,
  resolveLevels,
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
 * What is *not* here: લેવલ ૪'s lock. It is not settings — it is earned per-યુવક and read
 * from `profiles.level4_unlocked` (§7).
 */
export function useLevels() {
  const { settings, loading } = useSettingsRow(LEVELS_SETTINGS_DOC);
  const levels = useMemo(() => resolveLevels(settings?.levels), [settings]);
  return { levels, loading };
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

/** Accepts a full YouTube URL or a bare id, since the admin may paste either. */
export function youtubeId(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}
