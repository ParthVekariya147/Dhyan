/**
 * The web app manifest, served from the database instead of from the build.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this is a function at all
 * ────────────────────────────────────────────────────────────────────────────
 *
 * vite-plugin-pwa builds dist/manifest.webmanifest with three icon paths compiled into it.
 * That file is correct and it is also permanently frozen: a static manifest can never differ
 * from itself.
 *
 * That matters because of one consumer in particular. Everyone in the સંઘ has installed the app
 * to their home screen, and on Android an installed PWA is a WebAPK — a real package minted by
 * Google Play Services, with the icon baked into it at install time. Chrome re-fetches the
 * manifest roughly once a day and compares it with what the installed package holds; when the
 * icon differs it requests an updated package, which lands on the phone within a day or two,
 * with nobody asked to do anything. That comparison is the entire delivery mechanism for a
 * new icon on an already-installed phone, and against a static file it has nothing to compare.
 *
 * So the manifest is served from here, with the icons read out of `settings['app'].appIcon` —
 * the row the સંચાલક writes from the panel. netlify.toml rewrites /manifest.webmanifest to this
 * function with `force = true`, because Netlify serves static files before it consults
 * redirects and dist/manifest.webmanifest is a real file that would otherwise win; that flag
 * is load-bearing and its comment in netlify.toml says so.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE ONE PROPERTY THIS FILE MUST NEVER LOSE: it always answers 200 with a manifest
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Missing environment variables, a Supabase outage, a damaged jsonb row, a request that times
 * out — every one of them falls through to `appIconManifestIcons(null)`, the icons the build
 * ships, at HTTP 200. There is deliberately no error path, no 500 and no non-manifest body.
 *
 * This is not defensive habit, it is the difference between a bad minute and a bad month:
 *
 *   * A manifest that 500s, or that answers with an HTML error page, is an install prompt that
 *     does not appear. Someone trying to add the app that day simply cannot.
 *   * Far worse, it is an *installed* Android app whose daily update check fails. Chrome treats
 *     a manifest it cannot read as a signal about the app's health, and the failure modes there
 *     are outside this project's control and cannot be undone from here.
 *   * The fallback is not a degradation anybody sees. It is exactly today's icons — the same
 *     three paths the static manifest carried. A phone that receives it is in the state it was
 *     already in.
 *
 * The cost of the fallback is that a new icon arrives a day late. The cost of an error is a
 * home screen nobody can fix remotely. The trade is not close.
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY in Netlify → Site settings → Environment
 * variables — the same two login-mobile.js and create-admin.js read. The secret key is
 * required rather than preferred: `settings` is readable by `authenticated` only
 * (supabase/migrations/0001_init.sql:245) and Chrome's manifest fetch carries no session at
 * all, not even the yuvak's. This reads exactly one row, of settings, and returns no user data
 * of any kind.
 */

// Imported rather than restated, for the reason login-mobile.js gives about `normaliseMobile`:
// the panel's preview, the running app and this function must describe one icon, and a second
// copy of the rules here is a second chance to disagree with the two readers that are looking
// at the same row. esbuild bundles the relative import; see netlify.toml.
import { APP_ICON_KEY, appIconManifestIcons, resolveAppIcon } from '../../shared/domain/appicon.js';

// ────────────────────────────────────────────────────────────────────────────
// The static half of the manifest
// ────────────────────────────────────────────────────────────────────────────
//
// A verbatim copy of the `manifest` block in vite.config.js, and THE TWO MUST NOT DRIFT.
//
// They cannot simply be shared: vite.config.js is build-time configuration that Netlify's
// function bundler never loads, and importing it here would pull the whole plugin graph into a
// function that must answer in milliseconds. So they are two copies, and the drift is caught
// instead of prevented — scripts/test-app-shell.mjs reads both files as text and requires that
// every field below matches vite.config.js character for character. Change one, change the
// other, or that suite goes red.
//
// What drift would actually do, in case it looks cosmetic: an installed WebAPK compares the
// whole manifest, so a stray difference here makes Chrome re-mint the package for a name or a
// colour nobody changed, and — for anyone not yet installed — the install sheet would show
// something other than what the build's own manifest promised.
//
// `scope` and `id` are absent here because they are absent from vite.config.js. A manifest with
// no scope scopes itself to the start URL's directory, which is '/' either way, so declaring
// one here would be a field the static manifest does not have — drift, in the direction that
// looks like a fix.
const SHELL = Object.freeze({
  name: 'નીલકંઠ વર્ણી ધ્યાન',
  short_name: 'વર્ણી ધ્યાન',
  lang: 'gu',
  start_url: '/',
  display: 'standalone',
  background_color: '#100d0a',
  theme_color: '#100d0a',
});

// ────────────────────────────────────────────────────────────────────────────
// Headers
// ────────────────────────────────────────────────────────────────────────────
//
// `application/manifest+json` is the registered type and Chrome warns in the console when it
// gets anything else, including the `application/json` that would be the lazy choice here.
//
// Five minutes, and the number is a balance between two real costs rather than a default:
//
//   * Too long — a browser or CDN holding the old manifest is a phone that keeps the old icon
//     for the length of that hold, on top of the day or two Chrome's WebAPK update already
//     takes. An hour here would turn "he changed it this morning" into the better part of a
//     week, and there would be nothing anywhere saying why.
//   * Too short — every install check, every tab load and every crawler becomes a function
//     invocation and a PostgREST round trip. This file is fetched far more often than it
//     changes; an icon changes perhaps once a year.
//
// `must-revalidate` is what makes the number honest: past five minutes a cache must ask rather
// than serve stale bytes while it refreshes. `no-store` was considered and rejected — the icon
// is not sensitive, and paying a database read for every tab in the સંઘ to deliver a change
// that happens annually is the wrong side of the trade.
const HEADERS = Object.freeze({
  'Content-Type': 'application/manifest+json',
  'Cache-Control': 'public, max-age=300, must-revalidate',
});

// Bounded rather than left to Netlify's 10-second function ceiling. A Supabase that is slow
// rather than down would otherwise hold Chrome's manifest fetch open for ten seconds; falling
// back to the built-in icons after three is both faster and, since the fallback is what the
// build already shipped, indistinguishable from success for everyone except the one phone
// waiting on a new icon.
const READ_TIMEOUT_MS = 3000;

const manifest = (icons) => ({
  statusCode: 200,
  headers: HEADERS,
  body: JSON.stringify({ ...SHELL, icons }),
});

/** Every failure path lands here: the four files the build ships, at 200. */
const builtIn = () => manifest(appIconManifestIcons(null));

// ESM, because it has to be — the root package.json declares `"type": "module"` and there is no
// package.json under netlify/, so Node loads this as an ES module. login-mobile.js documents
// what `exports.handler = …` did here instead.
//
// Deliberately no method check. A manifest is a GET-only resource and nothing but a browser
// ever asks for it, so a 405 branch could only ever fire on a request that is already lost —
// and it would be the one path in this file that answers something other than a manifest.
export const handler = async () => {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    // Logged, because this is a deploy that is quietly serving the built-in mark forever while
    // the panel goes on reporting "Saved" — the one failure here that does not heal itself.
    console.error('manifest: SUPABASE_URL / SUPABASE_SECRET_KEY missing - serving built-in icons');
    return builtIn();
  }

  try {
    const res = await fetch(`${url}/rest/v1/settings?select=value&key=eq.app&limit=1`, {
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`settings read failed: ${res.status}`);

    const rows = await res.json();

    // Optional chaining the whole way down on purpose: a missing row, a row whose value is not
    // an object and a row with no appIcon field are all "no custom icon", which is what a
    // project that has never opened the panel's card looks like. resolveAppIcon() takes
    // undefined and every other damaged shape to the same place.
    const stored = rows?.[0]?.value?.[APP_ICON_KEY];
    return manifest(appIconManifestIcons(resolveAppIcon(stored)));
  } catch (e) {
    console.error('manifest: serving built-in icons after a failed settings read:', e);
    return builtIn();
  }
};
