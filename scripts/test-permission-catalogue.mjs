/**
 * The permission catalogue agrees with itself — across the migrations, the bundle and the menu.
 *
 *     node scripts/test-permission-catalogue.mjs
 *
 * No database and no Docker. Everything asserted here is a property of the *source*, and
 * checking it against a running Postgres would only prove that the migration applied — which
 * scripts/test-rbac-dynamic.mjs already does, from the other side.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The failure this exists to catch, which 0043 introduced
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Before 0043, the role→permission matrix lived in `public.permissions_for()` and was mirrored
 * in shared/domain/permissions.js. Two copies of one list, and `seed-admin.mjs` reported drift
 * between them. That was the whole of the risk: the two could disagree about who holds what.
 *
 * 0043 replaces that with something better and something worse. The matrix is now one table, so
 * the two-copies problem is gone. What it introduces is a gap of a different shape, in two
 * directions, and neither is visible from inside either file:
 *
 *   ENFORCED BUT NOT GRANTABLE
 *     A policy or function checks `has_permission('points.adjust')`, and `points.adjust` is not
 *     in the catalogue. Then no role can ever hold it, no screen in the panel can offer it, and
 *     the thing it guards is unreachable by everybody — including the SUPER_ADMIN, whose
 *     "holds every permission" means every permission *in the catalogue*. This is the dangerous
 *     one, because it presents as a feature that mysteriously does not work.
 *
 *   GRANTABLE BUT NOT ENFORCED
 *     The catalogue carries a permission that nothing checks. Then the role editor renders a
 *     tick box that hands out nothing, and a સંચાલક believes he has given somebody an ability
 *     he has not. This is the false-assurance failure shared/domain/permissions.js has warned
 *     about in its header since it was written.
 *
 * And one more, inherited from before:
 *
 *   A MENU ENTRY NAMING A PERMISSION THAT DOES NOT EXIST
 *     AdminShell's NAV gates each section on a permission. A `need` absent from the catalogue
 *     is one no role can hold, so the section disappears for everybody, silently, for ever.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The groups
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  §A  The migration's seed and shared/domain/permissions.js list the same keys.
 *  §B  Every permission named in a migration exists in the catalogue.
 *  §C  Every NAV `need` exists in the catalogue.
 *  §D  Every catalogue key is enforced somewhere, or is listed as deliberately not.
 *  §E  The seed is well-formed: keys match the CHECK, every split names a real source.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PERMISSIONS } from '../shared/domain/permissions.js';
import { PAGES, mappedPermissions } from '../shared/domain/access-map.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const RBAC = path.join(MIGRATIONS, '0043_dynamic_rbac.sql');
const SHELL = path.join(ROOT, 'admin', 'src', 'app', 'AdminShell.jsx');
const APP = path.join(ROOT, 'admin', 'src', 'App.jsx');

let pass = 0;
const fails = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else fails.push(`${name}\n       got  ${g}\n       want ${w}`);
};
const ok = (name, cond) => eq(name, Boolean(cond), true);
const group = (t) => console.log(`\n  ${t}\n`);

const read = (p) => fs.readFileSync(p, 'utf8');

/**
 * The keys the migration seeds into public.permissions.
 *
 * Read from the `insert into public.permissions (...) values` block rather than from every
 * quoted string in the file: the file also *names* permissions in comments and in the
 * role_permissions seed, and counting those would make this test pass by accident.
 */
function seededKeys() {
  /*
    Every migration that writes the catalogue, not just the one that created it.

    0043 seeded the first forty-six and this originally read only that file. 0046 adds
    `users.smk.read`, and a parser pinned to one filename reported it as "in the bundle but not
    seeded" — a failure about the test rather than about the code, and the kind that gets fixed
    by deleting the assertion.

    The catalogue is append-only by construction: `permissions_immutable()` refuses every write
    with a session user, so the only way a key gets in is an insert in a migration, and the only
    way one leaves is a migration that deletes it. Scanning them all is therefore the same
    question, asked of the whole history instead of one chapter of it.
  */
  const out = [];
  for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = read(path.join(MIGRATIONS, file));
    let from = 0;
    for (;;) {
      const start = sql.indexOf('insert into public.permissions (key,', from);
      if (start < 0) break;
      const end = sql.indexOf('on conflict (key) do nothing', start);
      if (end < 0) throw new Error(`unterminated catalogue seed in ${file}`);
      // Only the first column of each VALUES row: a line begins with ('key', 'resource', …
      for (const m of sql.slice(start, end).matchAll(/^\s*\('([a-z0-9.]+)',/gm)) out.push(m[1]);
      from = end;
    }
  }
  if (!out.length) throw new Error('no catalogue seed found in any migration');
  return out;
}

/** Every `has_permission('…')` across every migration — what the schema actually enforces. */
function enforcedKeys() {
  const out = new Set();
  for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) {
    const sql = read(path.join(MIGRATIONS, file));
    for (const m of sql.matchAll(/has_permission\(\s*'([a-z0-9.]+)'\s*\)/g)) out.add(m[1]);
    /*
      0043's report gate reads the same way and is the same kind of check.

      `''` as well as `'`: the લેવલ ૩ rewrite substitutes its call inside a SQL string literal,
      where the quotes are doubled — `admin_can_report(''points.level3.read'')`. A matcher that
      only understood single quotes reported that permission as unenforced, which is the one
      thing this test must never get wrong in that direction.
    */
    for (const m of sql.matchAll(/admin_can_report\(\s*''?([a-z0-9.]+)''?\s*\)/g)) out.add(m[1]);
    for (const m of sql.matchAll(/admin_assert_report_reader\(\s*''?([a-z0-9.]+)''?\s*\)/g)) out.add(m[1]);

    /*
      0043 re-issues ten report functions from pg_get_functiondef with one token replaced, so
      the permission each ends up checking never appears beside a call in the source — it is a
      value in the VALUES list that drives the rewrite, substituted through format() at apply
      time. Matching only literal call sites would report all six points.*.read as unenforced,
      which is precisely wrong: they are the most carefully enforced permissions in the file.

      Matched on the mapping's own shape: `('function_name', 'permission')` where the second
      half is a permission and the first is not.
    */
    for (const m of sql.matchAll(/\(\s*'(admin_[a-z0-9_]+)',\s*'([a-z0-9]+\.[a-z0-9.]+)'\s*\)/g)) {
      out.add(m[2]);
    }
  }
  return out;
}

/** Every `need:` in AdminShell's NAV. Parsed rather than imported - the file is JSX. */
function navNeeds(jsx) {
  return [...jsx.matchAll(/need:\s*'([a-z0-9.]+)'/g)].map((m) => m[1]);
}

/**
 * Catalogue permissions that nothing in the schema checks, and are known not to.
 *
 * Each is here because the thing it governs is not a database operation, so no policy could
 * name it. They are the honest exceptions to §D, and the list is short on purpose: anything
 * added here is a permission whose enforcement someone has to be able to point at.
 */
const UI_ONLY = {
  /*
    Three that predate 0043, and that this test found rather than introduced.

    None of them has ever appeared in a `has_permission()` call anywhere in the schema. They are
    real permissions in the sense that the panel reads them to decide what to render, and the
    write each one describes is governed by a *broader* permission on the same table:

      darshan.read     public.scenes is readable by everyone - the યુવક app reads it on every
                       visit - so there is nothing narrower to enforce. It gates the section.
      darshan.disable  the scenes policy is `for all using (darshan.update)`, so moving a
                       દ્રશ્ય between states is already governed by darshan.update.
      users.disable    the profiles update policy is users.update, which covers a status change.

    Left as they are rather than tightened here. Making them real means splitting two policies
    that 122 other expressions are written against, which is its own migration and its own
    review - and doing it quietly inside a file about roles is how a permission change ships
    without anybody noticing it happened.
  */
  'darshan.read': 'public.scenes is world-readable; this gates the section',
  'darshan.disable': 'the scenes policy is darshan.update, which covers a status change',
  'users.disable': 'the profiles policy is users.update, which covers a status change',

  // Reading a settings row is not permission-gated in the database - the યુવક app reads
  // settings on every visit - so these three gate the *panel section*, and every write behind
  // them is refused by settings.update and the policy on public.settings.
  'levels.read': 'the settings row is world-readable; the section is what this gates',
  'level4.read': 'as levels.read - level4_configs is read through the same settings surface',

  // Downloads. The rows are already on screen by the time an export runs, so an export
  // permission cannot be enforced at the row level without also refusing the screen. It gates
  // the button, and the read that filled the table was already governed.
  'users.export': 'gates the download button; the rows it writes were already read under users.read',

  /*
    A display permission, and 0046 says so at length rather than letting it look like column
    security. `users.read` governs public.profiles and `smk` is a column of it, so anybody who
    can open the list can read the number over PostgREST whether or not this is ticked. What it
    controls is bulk exposure on a screen and in an exported file, which is the thing that was
    asked for and the thing that actually leaks. Real column masking would mean rewriting
    public.yuvaks and the nine functions 0040 re-issued against it, to withhold a number from
    people already trusted with the name, the mobile and the whole learning record beside it.
  */
  'users.smk.read': 'hides the SMK column in lists and exports; users.read still reads it over the API',
  'progress.export': 'as users.export, under progress.read',
  'audit.export': 'as users.export, under audit.read',

  // Writes that go through settings['app'], which settings.update already governs. They exist
  // so a role can be given "may change the video" without "may reprice the point engine", and
  // they are checked in the panel until a later migration splits the settings policy by key.
  'video.update': 'a settings["app"] field; settings.update is the database check',
  'navigation.update': 'a settings["nav"] row; settings.update is the database check',
  'appicon.update': 'a settings["app"] field; settings.update is the database check',
  'dhun.update': 'a settings["app"] field; settings.update is the database check',
  'levels.update': 'a settings["levels"] row; settings.update is the database check',
  'level4.update': 'level4_configs; settings.update is the database check',
  'points.config.update': 'settings["levels"].points; settings.update is the database check',
  'points.bonus.update': 'point_bonus_rules; settings.update is the database check',
  'points.adjust': 'admin_award_manual_points() checks settings.update today',

  /*
    `scope.assign` was here, and 0051 is why it is not.

    It was the honest exemption for two migrations: the permission shipped with 0043 so the
    role editor could offer it, and nothing read it - there was no `admin_scopes` table for it
    to govern. 0051 adds the table and `admin_scopes_guard()` checks this permission on every
    write to it, as a BEFORE trigger that binds service_role too, so the exemption became stale
    the moment that file applied. Removing it is what this half of §D is for: an exemption
    nobody removes is how the list stops being read.
  */

  // Reserved for the detail screens, which are governed by progress.read on the function.
  'progress.detail.read': 'admin_user_progress_detail() checks progress.read',

  // દર્શન writes, all governed by the darshan.update policy on public.scenes. Split so a role
  // can edit a વર્ણન without being able to replace an image two thousand phones will see.
  'darshan.image.replace': 'public.scenes policy is darshan.update; this splits the panel action',
  'darshan.reorder': 'as darshan.image.replace',
  'darshan.import': 'as darshan.create',
};

const sql = read(RBAC);
const seeded = seededKeys();
const enforced = enforcedKeys();
const needs = navNeeds(read(SHELL));

// ══════════════════════════════════════════════════════════════════ §A
group('§A  the migration and the bundle list the same permissions');

eq('the seed has no duplicate keys', seeded.length, new Set(seeded).size);
eq('shared/domain/permissions.js has no duplicates', PERMISSIONS.length, new Set(PERMISSIONS).size);
eq('every seeded permission is in the bundle list',
  seeded.filter((k) => !PERMISSIONS.includes(k)), []);
eq('every bundle permission is seeded',
  PERMISSIONS.filter((k) => !seeded.includes(k)), []);

// ══════════════════════════════════════════════════════════════════ §B
group('§B  every enforced permission is grantable');

/*
  The dangerous direction. A permission a policy checks and the catalogue does not carry is one
  no role can hold - SUPER_ADMIN included, since 0043 defines its set as the catalogue - so the
  thing it guards is unreachable by everybody, and it presents as a feature that mysteriously
  does not work rather than as a refusal.
*/
eq('nothing is checked that cannot be granted',
  [...enforced].filter((k) => !seeded.includes(k)).sort(), []);

// ══════════════════════════════════════════════════════════════════ §C
group('§C  every menu entry names a permission that exists');

eq('NAV needs are all in the catalogue', needs.filter((k) => !seeded.includes(k)).sort(), []);

// A section nobody can reach is a section that should not be in the menu. Every `need` must be
// held by SUPER_ADMIN, which by definition holds the catalogue - so this is really a check that
// the parse above found anything at all, and that no `need` was left as a stale spelling.
eq('and NAV was actually parsed', needs.length > 10, true);

// ══════════════════════════════════════════════════════════════════ §D
group('§D  every grantable permission is enforced, or listed as deliberately not');

/*
  The false-assurance direction. A tick box in the role editor that hands out nothing is worse
  than a missing one: the સંચાલક believes he has given somebody an ability, and nobody finds out
  until the person tries to use it.

  UI_ONLY is the honest exception list. Each entry names where the real check happens, and the
  test fails if a key is in neither the enforcement set nor that list - so a permission added to
  the catalogue in future has to be either enforced or explained.
*/
const unenforced = seeded.filter((k) => !enforced.has(k) && !UI_ONLY[k]);
eq('nothing is grantable that nothing checks', unenforced.sort(), []);

// And the reverse: an entry in UI_ONLY that has since become enforced is a stale exemption, and
// a stale exemption is how the list stops being read.
const staleExemptions = Object.keys(UI_ONLY).filter((k) => enforced.has(k));
eq('and no exemption is stale', staleExemptions.sort(), []);

eq('every exemption names a real permission',
  Object.keys(UI_ONLY).filter((k) => !seeded.includes(k)).sort(), []);

// ══════════════════════════════════════════════════════════════════ §E
group('§E  the seed is well-formed');

// The CHECK on public.permissions.key. A key that fails it would take the whole migration down
// on the first apply, which is the right outcome and a slow way to find out.
const KEY_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;
eq('every key matches the column CHECK', seeded.filter((k) => !KEY_RE.test(k)), []);

/*
  Every `split` entry names a permission that exists on both sides.

  This is the derivation that makes "no administrator gains or loses anything today" true. A
  source that does not exist means the new permission is granted to nobody - a role silently
  short one ability - and it would not fail anywhere: the join in the seed simply matches no
  rows.
*/
const splitBlock = sql.slice(sql.indexOf('split (permission, carved_from) as ('), sql.indexOf('insert into public.role_permissions'));
const splits = [...splitBlock.matchAll(/\('([a-z0-9.]+)',\s*'([a-z0-9.]+)'\)/g)].map((m) => ({ perm: m[1], from: m[2] }));

eq('the split derivation was parsed', splits.length > 20, true);
eq('every split names a permission that exists',
  splits.filter((s) => !seeded.includes(s.perm)).map((s) => s.perm), []);
eq('every split names a source that exists',
  splits.filter((s) => !seeded.includes(s.from)).map((s) => s.from), []);
// A permission carved from itself would grant it to every role that already had it, which is a
// no-op dressed as a migration.
eq('and nothing is carved from itself',
  splits.filter((s) => s.perm === s.from).map((s) => s.perm), []);

// ══════════════════════════════════════════════════════════════════ §F
group('§F  the page map accounts for the whole catalogue');

/*
  shared/domain/access-map.js is what the role editor and the effective-access screen are built
  from: it presents the catalogue page by page, because nobody decides access by thinking about
  `points.ledger.read` - they think "should he be able to open the Point Ledger".

  It is a presentation and never a second model, and these three assertions are what hold it to
  that. The first is the one that matters most:

    MISSING    a permission in the catalogue and absent from the map is one the page-wise
               editor cannot grant. It exists, a policy enforces it, and nobody can be given
               it - which presents as a feature that mysteriously cannot be turned on.
    DUPLICATED a permission on two pages is two checkboxes writing the same row, so ticking
               one silently changes the other.
    INVENTED   a key here that the catalogue does not carry is a tick box whose save the
               foreign key refuses.
*/
const mapped = mappedPermissions();

eq('nothing in the catalogue is missing from the page map',
  PERMISSIONS.filter((k) => !mapped.includes(k)).sort(), []);

eq('and nothing appears on two pages',
  mapped.filter((k, i) => mapped.indexOf(k) !== i && !PAGES.some((p) => p.view === k)).sort(), []);

eq('and the map names no permission that does not exist',
  [...new Set(mapped)].filter((k) => !PERMISSIONS.includes(k)).sort(), []);

/*
  A view permission may legitimately be shared - settings.read opens Settings, Video and
  Navigation, because all three read the same row and there is nothing narrower to check. An
  *action* may never be, because an action is a specific write and putting it on two pages
  means two rows of the editor fighting over it.
*/
const actionKeys = PAGES.flatMap((p) => p.actions.map((a) => a.key));
eq('no action permission is listed on two pages',
  actionKeys.filter((k, i) => actionKeys.indexOf(k) !== i).sort(), []);

for (const p of PAGES) {
  ok(`${p.label}: its view permission is in the catalogue`, PERMISSIONS.includes(p.view));
}

/*
  The NAV entries and the page map name the same permission for the same route.

  Both exist for good reasons - NAV is what the sidebar renders, the map is what the editor
  renders - and the moment they disagree the panel offers a section the editor says is closed,
  or the reverse. Parsed out of AdminShell rather than imported, because the file is JSX.
*/
const navPairs = [...read(SHELL).matchAll(/to:\s*'([^']+)'[^}]*?need:\s*'([a-z0-9.]+)'/g)]
  .map((m) => ({ to: m[1], need: m[2] }));

for (const p of PAGES) {
  const nav = navPairs.find((n) => n.to === p.to);
  if (!nav) continue; // Not every page in the map is a top-level sidebar entry.
  eq(`${p.label}: the sidebar and the page map agree on what opens it`, nav.need, p.view);
}

// ══════════════════════════════════════════════════════════════════ §G
group('§G  the sidebar and the route agree about every section');

/*
  The invariant: a link in the sidebar leads somewhere the person can actually open.

  Two independent gates decide that, and they were allowed to disagree:

    AdminShell.NAV   `need` decides whether the entry is *rendered*.
    App.jsx <Gate>   `need` decides whether the route is *reachable*.

  When 0043 split the coarse permissions, NAV was re-pointed at the fine ones and the route
  gates were left behind. A VIEWER given `levels.read` but not `settings.read` — an ordinary
  thing to do in the page-wise role editor, and exactly what happened — saw "Level" in his
  sidebar and got "This section is not open to your role" when he pressed it.

  That is the worst kind of access bug: the panel offers something and then refuses it, so the
  person cannot tell whether he lacks the permission or the product is broken. Neither gate is
  wrong on its own; the defect is that nothing checked they were the same.

  This checks it. `path` is matched exactly, so a sub-route (/users/:userId, /darshan/health)
  is not compared against its parent — those legitimately differ, and /darshan/import is gated
  on the write it performs rather than on darshan.read like its neighbours.
*/
const gates = [...read(APP).matchAll(/path="([^"]+)"\s+element=\{<Gate need="([a-z0-9.]+)"/g)]
  .map((m) => ({ path: m[1], need: m[2] }));

eq('App.jsx route gates were parsed', gates.length > 15, true);

eq('every route gate names a permission that exists',
  gates.filter((g) => !seeded.includes(g.need)).map((g) => `${g.path} -> ${g.need}`).sort(), []);

const navByPath = Object.fromEntries(navPairs.map((n) => [n.to, n.need]));

for (const g of gates) {
  const navNeed = navByPath[g.path];
  if (navNeed === undefined) continue; // a sub-route with no sidebar entry of its own
  eq(`${g.path}: the sidebar and the route ask for the same permission`, g.need, navNeed);
}

/*
  And the reverse direction: every sidebar entry has a route.

  A `need` in NAV pointing at a path App.jsx does not serve renders a link that falls through
  to the catch-all redirect — the person presses it and lands back on the dashboard with no
  explanation at all, which reads as the panel losing his click.
*/
const gatePaths = new Set(gates.map((g) => g.path));
eq('every sidebar entry has a route behind it',
  navPairs.filter((n) => !gatePaths.has(n.to)).map((n) => n.to).sort(), []);

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
for (const f of fails) console.log(`  FAIL  ${f}\n`);
if (fails.length) process.exitCode = 1;
