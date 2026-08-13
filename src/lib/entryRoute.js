/**
 * The યુવક app's door to the entry-route decision (shared/domain/entry-route.js).
 *
 * Same pattern as src/lib/constants.js, src/lib/journey.js and src/lib/level4.js — screens
 * import `../lib/entryRoute` and never reach across into shared/ themselves.
 *
 * This file used to carry one impure piece the shared module could not: where the યુવક was
 * last standing, in localStorage, as `varni:last-route:<uid>`. That is gone. Signing in now
 * lands on the મુખપૃષ્ઠ every time (see resolveEntryRoute), so nothing read the recorded
 * route, and a writer with no reader is just a key accumulating in storage. Removed with it:
 * `lastRouteKey`, `readLastRoute`, `writeLastRoute`, and App.jsx's <RouteMemory>.
 *
 * Old installs keep a stale `varni:last-route:*` key until the browser is cleared. It is
 * inert — nothing reads it, and §23 already said nothing that matters is kept here — so it
 * is left alone rather than swept up by migration code that would exist to delete four
 * bytes nobody looks at.
 */
export * from '../../shared/domain/entry-route.js';
