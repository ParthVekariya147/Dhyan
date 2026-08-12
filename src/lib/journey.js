import { useJourney } from './useSettings';
import { LEVEL_PAGE_KEY, DEFAULT_JOURNEY } from '../../shared/domain/journey.js';

/**
 * The યુવક app's door to the page specification (shared/domain/journey.js).
 *
 * The definitions are shared with the સંચાલક panel — he edits the wording, so he must be
 * shown the same pages in the same order with the same names. This file exists so the
 * screens import `../lib/journey` and never reach across into shared/ themselves, exactly
 * as src/lib/constants.js and src/lib/level4.js do for their own domains.
 */
export * from '../../shared/domain/journey.js';
export { useJourney };

/**
 * The description for one page, ready to render.
 *
 * `usePageSpec(JOURNEY_PAGE.LEVEL3)` is what a screen calls. It hands back the code's
 * description immediately and the સંચાલક's wording as soon as the settings row lands, so
 * a page never renders without one.
 *
 * An unknown key returns null rather than throwing: a description is not worth taking a
 * screen down for, and the caller's `spec && <PageIntro …/>` already covers it.
 */
export function usePageSpec(key) {
  const { journey } = useJourney();
  return journey[key] ?? DEFAULT_JOURNEY[key] ?? null;
}

/** The same, for a level whose number is known but whose page key is not. */
export function useLevelSpec(levelId) {
  return usePageSpec(LEVEL_PAGE_KEY[levelId]);
}

/*
  `LEVEL_ROUTE` and `nextLevelAfter()` live in shared/domain/journey.js and arrive here
  through the `export *` above. They are pure functions over the level list, so they belong
  where scripts/test-domain.mjs can reach them — this file imports ./useSettings, and a test
  that had to load React to check which level comes after લેવલ ૪ would not get written.
*/

/**
 * The English half of a page's description, where one exists (લેવલ ૧ only — see the note in
 * shared/domain/journey.js). Falls back to the Gujarati rather than to nothing: a sentence
 * in the wrong language is still an answer to "what am I meant to do here", and an empty
 * page is not.
 */
export function inEnglish(spec) {
  if (!spec) return null;
  return spec.en ? { ...spec, ...spec.en } : spec;
}
