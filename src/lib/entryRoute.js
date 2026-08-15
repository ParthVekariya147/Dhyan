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
 *
 * It does carry one impure piece again, and this is the right file for it: guardRoute()'s
 * `installed` is the one input to the entry decision that cannot be derived from the યુવક.
 * It is a fact about the WINDOW — was this document opened from the home screen or from a
 * browser — and the shared module has to stay pure so scripts/test-domain.mjs can assert it
 * without a DOM.
 *
 * Re-exported from src/lib/installPrompt.js rather than written again here, because that
 * module already answers exactly this question for the invitation ("do not offer to install
 * an app that is already installed") and it answers it across three platforms: the standard
 * display-mode query, Safari's `navigator.standalone`, and the android-app:// referrer a TWA
 * leaves behind. Two copies of that would drift, and they would drift into the state this
 * change exists to prevent — one of them saying "installed" while the other opens નોંધણી.
 *
 * The import costs nothing here: src/App.jsx already pulls installPrompt.js eagerly through
 * <InstallPrompt />, which must attach its `beforeinstallprompt` listener at module
 * evaluation.
 */
export * from '../../shared/domain/entry-route.js';

export { isStandalone as isInstalledApp } from './installPrompt';
