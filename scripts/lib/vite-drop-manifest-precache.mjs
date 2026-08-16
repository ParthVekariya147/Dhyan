/**
 * Keep the web app manifest OUT of the service worker's precache.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this exists
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Since 0042 the manifest is not a build artefact, it is an endpoint: netlify/functions/
 * manifest.js serves it from `settings['app']` so that a સંચાલક can change the mark on two
 * thousand home screens without a deploy. The entire mechanism rests on the file being
 * ALLOWED TO DIFFER from what the build produced - Chrome re-fetches it roughly daily,
 * compares it with the installed WebAPK, and re-mints the package when the icon has changed.
 *
 * vite-plugin-pwa precaches the manifest it generates. That is a sensible default and the
 * wrong one here: a precached manifest is a build-time snapshot of the very file the function
 * exists to replace, served from the worker's cache until the worker itself updates - on the
 * one population this feature is for, the already-installed.
 *
 * It is the same failure the project has now met from three directions. netlify.toml needs
 * `force = true` so the static file cannot answer this URL. middleware.js exists so Vercel's
 * filesystem cannot answer it either. And with both of those in place the worker was still
 * free to answer it from cache.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why a plugin and not a workbox option
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `globPatterns` does not list `webmanifest` and never did - this entry is not swept in by
 * the glob. vite-plugin-pwa pushes it onto `workbox.additionalManifestEntries` itself, and
 * workbox appends those AFTER `manifestTransforms` have run, so a transform cannot see it.
 * Tried, verified against dist/sw.js, and it left the entry in place.
 *
 * `extendManifestEntries` is the plugin's own supported hook for exactly this, exposed on its
 * `api` object. This must therefore be registered AFTER VitePWA() in the plugins array, so
 * that the entries exist by the time buildStart runs here.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What is given up
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Nothing. A manifest is read at install time and at update time, and both are online by
 * definition; there is no offline case in which a phone needs one. dist/manifest.webmanifest
 * is still built and still shipped, so any host serving it statically goes on doing so - only
 * the worker's copy goes.
 */
export default function dropManifestFromPrecache(filename = 'manifest.webmanifest') {
  return {
    name: 'dhyan:drop-manifest-from-precache',
    // Build only. There is no precache in dev and no worker to keep a stale copy in.
    apply: 'build',
    buildStart() {
      const pwa = this.environment?.config?.plugins?.find?.((p) => p.name === 'vite-plugin-pwa');
      const extend = pwa?.api?.extendManifestEntries;
      if (typeof extend !== 'function') {
        // Loud, because silence here is a precached manifest nobody notices for months: the
        // icon setting would go on reporting "Saved" while installed phones read a snapshot.
        this.warn(
          'dhyan:drop-manifest-from-precache found no vite-plugin-pwa api - the manifest may be precached. ' +
            'Check the plugin order in vite.config.js and see this file for what that breaks.'
        );
        return;
      }
      extend((entries) => entries.filter((e) => !String(e?.url ?? '').endsWith(filename)));
    },
  };
}
