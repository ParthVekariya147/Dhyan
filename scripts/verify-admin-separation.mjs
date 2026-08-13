/**
 * Proves the કરાર that makes two apps worth having: no સંચાલક code in the યુવક bundle.
 *
 * §50 is blunt about this — if adding the panel grows the app a yuvak downloads to reach
 * the login screen, the architecture is wrong and "it's only a little larger" is not an
 * answer. A rule that is only written down drifts; this is the same rule, executed.
 *
 * It also re-checks the one flag that must never reach production (§64) and the four
 * secrets that must never reach a browser (§75).
 *
 *   npm run build && npm run verify:separation
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const yuvakAssets = path.join(root, 'dist', 'assets');
const adminAssets = path.join(root, 'dist', 'admin', 'assets');

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};
const kb = (n) => (n / 1024).toFixed(0) + ' KB';

function readAll(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(js|css)$/.test(f))
    .map((f) => ({ name: f, body: readFileSync(path.join(dir, f), 'utf8'), size: statSync(path.join(dir, f)).size }));
}

console.log('\n[1] both builds present');
const yuvak = readAll(yuvakAssets);
const admin = readAll(adminAssets);
check('યુવક build exists', yuvak.length > 0, `${yuvak.length} files`);
check('સંચાલક build exists', admin.length > 0, `${admin.length} files`);
if (!yuvak.length || !admin.length) {
  console.log('\nRun `npm run build` first.');
  process.exit(1);
}

// ---------------------------------------------------------------- test 2
console.log('\n[2] no admin code in the યુવક bundle');
/**
 * Strings that exist only in admin/ source. String literals rather than function names:
 * a bundler renames identifiers but leaves literals alone, so a literal is the only
 * marker that survives minification intact.
 *
 * Deliberately NOT in this list: `signInWithPassword`, `getSession`, `rpc` and friends.
 * Those are supabase-js exports and appear in the vendor chunk of any app that links the
 * SDK, used or not — matching them proves nothing and fails for the wrong reason. The
 * scan therefore runs over the application chunks, with the vendor chunks excluded.
 *
 * Every marker below is a panel-only literal, so none of them collides with supabase-js
 * as things stand. The exclusion is what keeps that true the day someone adds a marker
 * that is a plainer word, so it stays.
 */
const ADMIN_MARKERS = [
  '/audit-logs',
  'auditLogs',
  'admin-claim',
  // These two were the panel's Gujarati nav label and its permission-denied message.
  // The panel reads English now, so the Gujarati versions exist nowhere and the checks
  // passed against strings that were gone — a guard that can no longer fail. They track
  // the English wording instead: AdminShell's nav label and NOT_ADMIN in admin/src/lib/
  // errors.js. Reword either one and this list has to follow.
  'Audit Log',
  'ADMIN_LOGIN',
  'DARSHAN_DISABLED',
  'You do not have permission to use the Admin Panel.',
  'pendingHotspots',
  'stageBreakdown',
];
// Note: the phrase "સંચાલક પેનલ" is NOT a marker, even though it is the panel's title.
// The યુવક home page names the panel on the link that takes a સંચાલક to it, so the phrase
// legitimately appears in both bundles. Every marker above is something only the panel's
// own code contains — a route, a collection, an action name, a nav label.
const isVendor = (name) => /^(supabase|react|rolldown-runtime)-/.test(name);
const yuvakApp = yuvak.filter((f) => !isVendor(f.name));
console.log(`      scanning ${yuvakApp.length} app chunks (${yuvak.length - yuvakApp.length} vendor chunks excluded)`);
const yuvakAppBody = yuvakApp.map((f) => f.body).join('\n');
for (const marker of ADMIN_MARKERS) {
  check(`"${marker}" absent`, !yuvakAppBody.includes(marker));
}
// Nothing in src/ may import from admin/ — the one import that would silently undo all
// of the above. Vite would inline it, so the marker scan above is the detector; this is
// the direct check on the source itself.
const srcImportsAdmin = readdirSync(path.join(root, 'src'), { recursive: true })
  .filter((f) => typeof f === 'string' && /\.(js|jsx)$/.test(f))
  .filter((f) => /from\s+['"][^'"]*admin\//.test(readFileSync(path.join(root, 'src', f), 'utf8')));
check('no file in src/ imports from admin/', srcImportsAdmin.length === 0, srcImportsAdmin.join(', '));

// ---------------------------------------------------------------- test 3
console.log('\n[3] the two builds are separate artefacts');
const adminHtml = readFileSync(path.join(root, 'dist', 'admin', 'index.html'), 'utf8');
check('panel served from its own directory', existsSync(path.join(root, 'dist', 'admin', 'index.html')));
// The panel must load its own chunks, not reach into the યુવક build's — otherwise a
// redeploy of one app could invalidate the other's entry point.
const adminRefs = [...adminHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
const strays = adminRefs.filter((r) => r.startsWith('/assets/'));
check('panel references only /admin/assets/*', strays.length === 0, strays.join(', '));
// Every page is its own chunk, so opening the dashboard does not download the audit log.
check('panel routes are code-split', admin.filter((f) => f.name.endsWith('.js')).length >= 10,
  `${admin.filter((f) => f.name.endsWith('.js')).length} js chunks`);

// ---------------------------------------------------------------- test 4
console.log('\n[4] યુવક bundle budget');
/**
 * The baseline was 955 KB of js+css when the SDK was Firebase (~610 KB of it) — that is
 * what the old 980 KB ceiling was built around. Supabase replaced it at ~208 KB, so the
 * whole app now measures ~495 KB and the old ceiling could no longer fail for any reason.
 * A budget nothing can breach is not a budget, so it is re-set against the new measured
 * total plus a margin for growth.
 *
 * Re-set again on 2026-08-12, for the same reason in the other direction: the app had
 * grown past 620 KB and the check was failing on every build, which is just as useless as
 * one that can never fail — a guard nobody can get green stops being read.
 *
 * Measured that day: **647.7 KB** over 27 chunks, of which **426.5 KB is vendor** (React
 * 224 KB + Supabase 204 KB, both unchanged since the last re-set) and **221.3 KB is app
 * code**, up from roughly 67 KB. The growth is entirely લેવલ ૪ and what came with it —
 * Level4Page, ActivityTestPage, the level4 domain chunk and the progress/settings work —
 * i.e. a whole learning level that did not exist when 620 KB was written. Nothing about
 * the split regressed: the entry chunk is still app-code-only and both vendor SDKs are
 * still their own cacheable chunks, which the three checks below this one assert
 * independently of the total.
 *
 * The margin is deliberately tighter than last time (~11%, not ~25%): the app is past the
 * stage of replacing its whole backend, so a jump of 70 KB now is worth a look rather than
 * worth absorbing silently.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Re-set again on 2026-08-13, to 760 KB
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The 11% margin above did its job: the check went red on a 2 KB overage rather than
 * letting a day's growth through unnoticed, which is exactly the "worth a look" it was
 * tightened for. Looked at, and the growth is accounted for.
 *
 * Measured this day: **721.8 KB**, of which **427 KB is vendor** (React 224 KB + Supabase
 * 208 KB — still unchanged, still their own cacheable chunks) and **294 KB is app code**,
 * up from 221.3 KB. The 73 KB is four features that did not exist when 720 KB was written:
 * ક્રમાંક, મારી પ્રગતિ, the points work, and પાસવર્ડ રીકવરી — the last of which is 7.8 KB
 * across two lazy chunks and is the smallest of the four.
 *
 * Nothing about the split regressed, and one thing improved: the entry chunk measures 58 KB
 * against its own 60 KB limit, down from the 122 KB it reached earlier in the day, because
 * content/darshan.json is off the eager path. The recovery flow had to be split across two
 * modules to keep it there — shared/domain/recovery-routes.js exists so that src/lib/auth.jsx,
 * which is eager, can address the mail without pulling every Gujarati sentence of the two
 * recovery screens into the entry bundle. That is the kind of thing this check catches.
 *
 * The margin goes back to ~5%. Tighter still than last time, and deliberately so: at this
 * size the vendor half is fixed and every further KB is app code, so the next re-set should
 * have to argue for itself rather than ride on headroom left over from this one.
 */
const BUDGET = 760 * 1024;
const total = yuvak.reduce((s, f) => s + f.size, 0);
console.log(`      યુવક js+css: ${kb(total)}   ·   સંચાલક js+css: ${kb(admin.reduce((s, f) => s + f.size, 0))}`);
check(`યુવક bundle within ${kb(BUDGET)}`, total <= BUDGET, kb(total));

/**
 * The entry chunk is what every visitor downloads before anything is rendered, so the two
 * things that must not be in it are the vendor SDKs and the દર્શન manifest.
 *
 * These thresholds are deliberately near the measured sizes rather than generous. The
 * failure this replaced was silent for exactly that reason: admin/vite.config.js went on
 * splitting `node_modules/firebase` after the migration, so nothing matched, Supabase fell
 * into the entry chunk, and a 120 KB allowance was loose enough to look survivable at
 * 226 KB only because the manifest had shrunk at the same time.
 */
const entry = yuvak.find((f) => /^index-.*\.js$/.test(f.name));
check('યુવક entry chunk is app code only', !!entry && entry.size < 60 * 1024,
  entry ? kb(entry.size) : 'no entry chunk');
const adminEntry = admin.find((f) => /^index-.*\.js$/.test(f.name));
check('સંચાલક entry chunk is panel code only', !!adminEntry && adminEntry.size < 60 * 1024,
  adminEntry ? kb(adminEntry.size) : 'no entry chunk');

/**
 * …and the positive form of the same rule. Size alone cannot tell a split SDK from a
 * missing one: if the import were dropped altogether the entry chunk would also be small,
 * and the check above would pass while the app was broken.
 */
for (const [label, files] of [['યુવક', yuvak], ['સંચાલક', admin]]) {
  const vendor = files.find((f) => /^supabase-.*\.js$/.test(f.name));
  check(`${label} ships Supabase as its own cacheable chunk`, !!vendor,
    vendor ? kb(vendor.size) : 'no supabase chunk — check manualChunks in vite.config.js');
}

// ---------------------------------------------------------------- test 5
console.log('\n[5] the test-only flag did not reach production');
const html = readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
check('VITE_PUBLIC_DARSHAN not baked into the production build',
  !yuvakAppBody.includes('VITE_PUBLIC_DARSHAN') && !html.includes('VITE_PUBLIC_DARSHAN'));

// ---------------------------------------------------------------- test 6
console.log('\n[6] no server-only secret in any browser bundle');
// SUPABASE_SECRET_KEY belongs to netlify/functions/* — read from the Netlify environment
// at runtime — and nowhere else (§49, §75).
/**
 * Strings that mean a server-only credential has been bundled into something a browser
 * downloads.
 *
 * `sb_secret_` and `service_role` are the two that matter now: either one bypasses every
 * RLS policy, which is the whole of this project's authorisation. The publishable key is
 * deliberately absent from this list — it is meant to ship.
 */
/**
 * `sb_secret_` and `service_role` are the two that matter: either one bypasses every RLS
 * policy, which is the whole of this project's authorisation.
 *
 * They are patterns rather than plain substrings because the bare prefixes are not
 * evidence of anything. supabase-js contains the literal `sb_secret_` itself, in the
 * predicate that classifies a key by its prefix — searching for the substring reports the
 * library as a leak on every build. What distinguishes a real key is that the prefix is
 * followed by the key, so that is what is matched. Same for a legacy service_role JWT,
 * which is three base64url segments.
 */
const SECRET_PATTERNS = [
  ['new-style secret key', /sb_secret_[A-Za-z0-9_-]{12,}/],
  ['service_role JWT', /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['SUPABASE_SECRET_KEY', /SUPABASE_SECRET_KEY/],
  ['SUPABASE_DB_PASSWORD', /SUPABASE_DB_PASSWORD/],
  ['private key block', /BEGIN [A-Z ]*PRIVATE KEY/],
];
const allBody = yuvak.concat(admin).map((f) => f.body).join('\n');
for (const [label, pattern] of SECRET_PATTERNS) {
  const hit = allBody.match(pattern);
  // Never print the match itself — this output goes to CI logs.
  check(`no ${label} in either bundle`, !hit, hit ? `matched ${hit[0].length} chars` : '');
}

console.log('\n[7] no founding સંચાલક mobile number in any browser bundle');
/*
  The three §3 numbers, and this check is why they are worth restating here rather than
  imported.

  They used to live in shared/domain/constants.js, which `src/lib/constants.js` re-exports
  wholesale, so `src/lib/auth.jsx` pulled them in to decide whether to draw one link — and the
  deployed site served all three to every visitor in a chunk `index.html` preloads. They have
  moved to shared/domain/admin-bootstrap.js, which no client module imports;
  `public.effective_role()` answers that question now.

  Importing the list to test for it would defeat the test: this file would then be a module
  that reads it, and a future bundler change that pulled scripts/ into a build would sail past
  a check written in terms of its own import. Literals here mean the assertion is about the
  *bytes on the CDN* and nothing else.

  Nor is this covered by tree-shaking. Rolldown would probably drop an unused export from a
  module imported for its other symbols — probably is not a guarantee, and it would regress
  silently the first time somebody wrote `import * as C from './constants'`. This is what makes
  it a guarantee.

  If this fails: something under src/ or admin/src/ has imported admin-bootstrap.js, directly
  or through a re-export. That import is the defect. Do not add the number to an allowlist.
*/
const FOUNDING_MOBILES = ['9601269715', '9601269009', '9925842081'];
for (const [i, number] of FOUNDING_MOBILES.entries()) {
  // Reported by position, never by value: this output goes to CI logs, and a check that
  // prints the numbers it exists to keep private has defeated itself.
  check(`founding number ${i + 1} of ${FOUNDING_MOBILES.length} is absent`, !allBody.includes(number));
}

console.log(`\n${failures === 0 ? 'SEPARATION HOLDS' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
