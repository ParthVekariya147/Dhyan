/**
 * The યુવક app's door to the finishing moments (shared/domain/milestones.js).
 *
 * The sentences live in shared/ because they are text and the સંચાલક panel is where text is
 * eventually edited — the same reason shared/domain/journey.js is there. This file exists so
 * the screens import `../../lib/milestones` and never reach across into shared/ themselves,
 * exactly as src/lib/journey.js, src/lib/constants.js and src/lib/level4.js do for theirs.
 *
 * Nothing is added on this side. If a moment ever needs the સંચાલક's wording rather than the
 * code's, it gets a resolver here beside `usePageSpec()` and the screens do not change.
 */
export * from '../../shared/domain/milestones.js';
