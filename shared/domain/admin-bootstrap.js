/**
 * The founding સંચાલક numbers — **server-side only, and that is the whole point of this file.**
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why these three lines are not in shared/domain/constants.js any more
 * ────────────────────────────────────────────────────────────────────────────
 *
 * They were, and `src/lib/constants.js` is `export * from` that module, and `src/lib/auth.jsx`
 * imported `isAdminMobile` from it to decide whether to draw one link. So three real people's
 * personal mobile numbers were compiled into the યુવક bundle and served to every visitor of
 * the site. Verified on the deployed application:
 *
 *     https://varni-dhyan.netlify.app/assets/useSettings-Tn0XZLNa.js
 *
 *
 * — in a chunk `index.html` preloads, so nobody even had to navigate to receive them.
 *
 * Two separate harms, and the second outlives the first:
 *
 *   1. **Until 0024 they were credentials.** `effective_role()` returned SUPER_ADMIN for any
 *      profile carrying one, and `profiles.mobile` is typed into the નોંધણી form and verified
 *      by nothing. Publishing them told every visitor exactly which value to register with.
 *      0024 ended that: authority is `public.bootstrap_admins`, resolved once by migration,
 *      and these numbers now grant nothing.
 *
 *   2. **They are still personal data, and still a target list.** They name the three accounts
 *      worth attacking — for password guessing through /api/login-mobile, for squatting the
 *      number so its owner can never register, for a phone call that starts "this is Supabase
 *      support". None of that is fixed by a migration, and none of it is a reason a યુવક's
 *      browser needs the list.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The rule this file exists to make structural
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **Nothing under `src/` or `admin/src/` may import this module.** Not "should not" — the
 * import would be the defect, and it is checked rather than remembered:
 * `scripts/verify-admin-separation.mjs` §6 greps both built bundles for each number and fails
 * the build if one appears.
 *
 * Tree-shaking is not the mechanism and must not be relied on as one. Rolldown would very
 * likely drop an unused export from a module imported for its other symbols — but "very
 * likely" is not a property you want standing between a privacy commitment and a CDN, and it
 * would regress silently the first time somebody wrote `import * as C from './constants'`.
 * A separate module with no client importer cannot regress that way.
 *
 * The one legitimate reader is `scripts/seed-admin-supabase.mjs`, a Node script run by hand
 * with the secret key. It needs the list because it refuses to seed a number the database
 * would not recognise — see its own note.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Changing the list
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Editing this array **grants nothing on its own**, and that is deliberate. Since 0024 the
 * database reads `public.bootstrap_admins`, whose rows were resolved from these numbers at the
 * moment that migration ran. Adding a fourth number here only teaches the seed script to
 * accept it; making it an administrator is `admin_profiles`, through the panel, by somebody
 * who already holds `admins.create` — which is the ordinary path and the one with an audit
 * trail behind it.
 */

export const ADMIN_MOBILES = [
  '9601269715', // §3
  '9601269009', // §3
  '9925842081', // developer/owner account, added 2026-08-11
];

export const isAdminMobile = (mobile) => ADMIN_MOBILES.includes(String(mobile || '').trim());
