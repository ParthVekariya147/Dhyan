/**
 * The યુવક app's door to the entry-route decision (shared/domain/entry-route.js), plus the
 * one piece of it that cannot be pure: where he was last standing.
 *
 * Same pattern as src/lib/constants.js, src/lib/journey.js and src/lib/level4.js — screens
 * import `../lib/entryRoute` and never reach across into shared/ themselves.
 */
export * from '../../shared/domain/entry-route.js';

import { RESUMABLE_ROUTES } from '../../shared/domain/entry-route.js';

/**
 * One key per યુવક, on this device.
 *
 * Per-device and not in Postgres, deliberately. "Where was I?" is a property of the phone
 * in his hand, not of his સાધના: a યુવક who does લેવલ ૩ on his own phone every evening and
 * opens the app once on his brother's should not have the brother's phone decide where he
 * lands tomorrow. It is also, by the same token, not progress — losing it costs him one
 * tap on the મુખપૃષ્ઠ and nothing else, which is why it may live somewhere as fragile as
 * localStorage (§23: nothing that matters is stored here).
 */
export const lastRouteKey = (uid) => `varni:last-route:${uid}`;

/** The last front door this યુવક stood at on this phone, or null. */
export function readLastRoute(uid) {
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(lastRouteKey(uid));
    // Validated against the same set that the resolver checks, so a value written by an
    // older build — or edited by hand — is simply not a resume.
    return RESUMABLE_ROUTES.has(raw) ? raw : null;
  } catch {
    return null; // private mode, or storage denied
  }
}

/** Records a front door. Anything else is ignored rather than overwriting the last one. */
export function writeLastRoute(uid, path) {
  if (!uid || !RESUMABLE_ROUTES.has(path)) return;
  try {
    localStorage.setItem(lastRouteKey(uid), path);
  } catch {
    // Storage denied. He resumes at the મુખપૃષ્ઠ, which is not a failure — it is the
    // default this whole mechanism improves on.
  }
}
