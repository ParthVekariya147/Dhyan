# સંચાલક પેનલ — the admin application

Two applications, one Supabase project — `tjovudfsodviwijyyvdw`, region `ap-south-1`.

```
d:/DHYAN
├── src/            યુવક app          →  dist/          →  /
├── admin/          સંચાલક panel      →  dist/admin/    →  /admin
├── shared/         domain + Supabase factory, used by both
├── netlify/        server-only functions (hold the secrets)
└── supabase/migrations/   the schema, the RLS policies and the audit triggers
```

## Why it is built this way

The panel is a **separate Vite build with its own entry point**, not a route inside the
યુવક app. Rollup never sees `src/` and `admin/src/` in one graph, so no amount of
careless importing can put admin code into the bundle a yuvak downloads to reach the
login screen. `npm run verify:separation` executes that claim rather than trusting it:
it scans the built application chunks for admin-only strings, checks that nothing in
`src/` imports from `admin/`, and holds the યુવક bundle to a measured byte budget.

What the two apps *do* share is `shared/` — domain constants, the દર્શન content model,
settings validation, audit vocabulary, and one Supabase client factory
(`shared/supabase/client.js`). Nothing more.
No shared UI: the યુવક app is a dark, gold, unhurried reading surface and the panel is a
light, neutral operational console, and they are meant to look nothing alike.

The panel's design system is **one file** — `admin/src/app/admin.css`. Colour, spacing,
type, radius, elevation and control sizing are all tokens declared at the top of it, and
a page or a feature stylesheet must never write a raw hex value or a bare pixel radius:
one edit there restyles the whole console, and a local literal is the thing that stops
being true. The legacy short names (`--bg`, `--panel`, `--line`, `--accent`, `--ok`…) are
aliases onto the semantic tokens, kept because every page already spells them that way.

Two rules in that file are load-bearing rather than cosmetic, and both are commented where
they live: `--tap` rises from 34px to 44px under `pointer: coarse`, and form controls go to
16px there as well — below that, iOS Safari zooms on focus and never zooms back out.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | યુવક app, port 5173 |
| `npm run dev:admin` | સંચાલક panel, port 5174 |
| `npm run build` | both, in order — યુવક first (it owns and empties `dist/`), panel second |
| `npm run build:yuvak` / `build:admin` | one at a time |
| `npm run verify` | builds with the test flag, then runs the 18-check image-delivery suite |
| `npm run verify:separation` | proves no admin code reached the યુવક bundle |
| `npm run verify:admin` | the panel at the eleven widths §36 names, served under netlify.toml's own redirect rules — so `/admin/users` resolving to the panel rather than the યુવક shell is part of what is tested (needs `dist/`, so run a build first) |
| `npm run test:navigation` | the bottom bar as pure logic — resolving, validating, reordering, and the registry against both `src/App.jsx` and `0019_mobile_navigation.sql` |
| `npm run verify:nav` | the bottom bar in a real Chrome at the six widths §21 names: it fits, it taps, it does not cover the page, and it is not drawn on a desktop |
| `npm run check` | build → separation → regression, i.e. everything |
| `node scripts/db.mjs migrate` | applies every unapplied file in `supabase/migrations/`, in filename order (needs `SUPABASE_DB_PASSWORD`) |
| `npm run seed:admin` | creates the first સંચાલક account — an auth user with its email confirmed outright, plus a `profiles` row carrying one of the `ADMIN_MOBILES` (needs `SUPABASE_SECRET_KEY`) |
| `npm run seed:admin:check` | reports which of the સંચાલક numbers have a profile behind them yet |

Changing panel code and running `npm run build:admin` does not rebuild the યુવક app, and
the reverse is also true. Only a change inside `shared/` requires both.

## Adding new દ્રશ્યો

A દ્રશ્ય is three things: a **link**, a **વર્ણન** and a **number**. It goes live only when it
has both a link and a વર્ણન — that is the whole activation rule, and it is why no code change
is ever needed to grow the collection. There is no `TOTAL = 100` anywhere; every count in the
application is derived from `content/darshan.json` (see `src/lib/scenes.js`).

**Nothing is downloaded, encoded or committed.** The images stay in the સંચાલક's Google Drive
folder and are served to યુવકો by Google's own image CDN, which resizes and re-encodes them on
request. `content/darshan.json` holds one URL per દ્રશ્ય and nothing heavier.

The spreadsheet is the source of truth for the વર્ણન, in three columns:

| Column | Header | Meaning |
|---|---|---|
| A | `ક્રમ` | the scene number — the join key |
| B | `ફોટો ફાઇલ` | the image file for that ક્રમ — **authoritative when present** |
| C | `દ્રશ્ય-વર્ણન` | the caption the યુવક reads |

English headers (`n`/`index`, `file`/`image`, `caption`/`description`) are accepted too, so
an Excel export that lost its Gujarati headers still imports.

**One step.** The sheet and the Drive folder go in, `content/darshan.json` comes out:

```bash
npm run darshan                          # the live Google Sheet + the default Drive folder
npm run darshan -- --folder <id|url>     # a different Drive folder
npm run darshan -- --file <data.xlsx>    # an Excel / CSV / TSV export instead of the sheet
npm run darshan:dry                      # report, write nothing

npm run validate                         # structure: duplicate ક્રમ, gaps, malformed links
npm run validate -- --fetch              # …and fetch all 109 links to prove they still serve
```

Takes about ten seconds. The whole collection is 11 MB as delivered, against 549 MB of
masters and a multi-hour encode under the previous scheme.

**Which Drive folder** is set in **પેનલ → સેટિંગ્સ → Darshan image folder**, not in code. The
build script takes `--folder` or `DRIVE_FOLDER_ID`, and both fall back to the same default in
`shared/domain/drive.js`. The folder must be shared as **Anyone with the link**, or Google
will not serve the images.

**The filename is a binding key, never a label.** Nothing displays it — the યુવક sees only the
ક્રમ and the વર્ણન. Its only job is to tell the build which Drive file belongs to which ક્રમ,
which is why the convention may change freely between collections.

`scripts/lib/naming.mjs` resolves that binding two ways, in order: **declared** (column B
names the file — works for any scheme at all, including names with no number in them) and
**inferred** (a pattern table covering `Varni (12).png`, `darshan-012.png`, `scene_12.png`,
`012.png`). A new convention is one row added to `PATTERNS`, not a code change. Nothing is
ever resolved silently: every binding records how it was made, and an ambiguity — two files
claiming one ક્રમ, a column B name that is not on disk — is reported rather than guessed at.
The current collection binds all 109 by declaration.

**A scene with an image but no વર્ણન ships inactive**, which is the designed way to stage
work: it goes live the moment its row is filled in. Writing the વર્ણન in the સંચાલક panel does
the same thing without a rebuild (§12).

### Changing one દ્રશ્ય

No rebuild and no deploy. On the દ્રશ્ય's own page in the panel, paste the Drive link for the
image, write the વર્ણન, set the order. Saving is the change — the next યુવક to open the page
sees it.

A Drive link is **converted**, not stored as pasted: `uc?export=download` is a download route,
metered by Drive's per-file quota and answering large files with an HTML page instead of
bytes, so pointing a card at it would blank the દર્શન for everybody at once. The panel and the
build script both go through `resolveImageInput`, so a link set by hand produces exactly the
URL a rebuild would have produced.

### The fullscreen gallery, and its one setting

Tapping any દ્રશ્ય in લેવલ ૨ opens it full screen, on that દ્રશ્ય and not on the first, and
`‹ ›` / swipe / arrow keys walk the whole ક્રમ from there. The foot always shows the દ્રશ્ય's
own number and an **ⓘ વર્ણન** control; neither ever fades, which is deliberate — the number is
half of what લેવલ ૨ is teaching, so it is furniture rather than a hint. The viewer records
nothing: it cannot tick, score, complete લેવલ ૨ or open લેવલ ૩.

The one thing configurable about it is **પેનલ → સેટિંગ્સ → Gallery slideshow** — how long the
**આપોઆપ** button holds each દ્રશ્ય, **1–60 seconds**, default 6. આપોઆપ never starts by itself
and stops at the last દ્રશ્ય rather than looping back to the first.

**That number is now a default rather than a description of what every યુવક sees.** Each યુવક
may set his own speed on his own phone — see *What a યુવક sets for himself* below — and where
he has, his choice is what runs. The field here is still the answer for everybody who has
never opened that screen, which today is nearly all of them, and it is the answer they go
back to when they clear their choice.

The range is enforced in three places on purpose, and they are not redundant: the panel's
field explains it, `validateSlideshow()` in `shared/domain/settings.js` is the rule both apps
agree on, and a trigger from `0018_gallery_slideshow.sql` refuses an out-of-range write at the
table. `settings` is writable through PostgREST by anyone `is_admin()` admits without going
near `admin/src`, so a disabled input is an explanation and only the trigger is a guarantee.

Two counters appear in the viewer and they are different numbers. Top-right is **position in
today's collection** (`૫ / ૧૦૯`); the foot is the દ્રશ્ય's **own printed number** (`#૫`), the
same one લેવલ ૩'s rows and લેવલ ૪'s કસોટી use. Withhold one દ્રશ્ય and the two stop matching —
which is correct, and why both are shown, marked differently.

### Why the encoder is gone

The previous scheme downloaded 549 MB of masters and re-encoded all 109 into six widths ×
three formats, binary-searching each for the lowest quality still above SSIM 0.985. It was
correct and it did not work: the last full run reported **~13 hours remaining** and was killed
after 12 images, which is why the app spent that period showing 12 દ્રશ્યો out of 109.

Google's image CDN does the same job in the URL. `=w1600-rj-v1` turns a 1606 KB PNG master
into a **132 KB JPEG** — twelve times smaller, no visible loss, no local CPU, nothing to
commit. `shared/domain/drive.js` documents what each part of that suffix does and what it
costs to drop it.

## The bottom navigation bar

**પેનલ → Navigation** decides what stands at the bottom of a યુવક's phone: which buttons,
in what order, under which word, with which picture, and whether each one is shown at all.
On a phone that bar is the whole app as far as a યુવક is concerned — what he can reach in
one thumb-press is what the app *is* — and which buttons those should be is a judgement
about what he ought to be doing this month, not a fact about the code. So it is
configuration, changeable without a deploy, in the same row-shaped place as every other
judgement the સંચાલક makes.

The page lists every destination the app has, shown and hidden together, each with a switch,
a drag handle, a name field and an icon picker. Saving writes the whole list at once, after
`validateMobileNav()` has agreed to it.

**Between 2 and 5 buttons may be shown, and 5 is a measurement rather than a preference.**
At 320px — the iPhone SE and every cheap Android in portrait, the width the whole design
system is drawn against — five cells are 64px each: a tap target above the 44px one-handed
floor with room for an icon and one short Gujarati word beneath it. Six cells are 53px,
which is under the floor with the label already clipped. Two is the other end, because one
button is not navigation, it is a logo: there is nothing to move between and it costs 64px
of screen to say where you already are. A સંચાલક who wants no bottom bar at all wants a
setting that does not exist yet, and is told so rather than left to express it by hiding
everything. Labels are capped at **12 characters** for the same reason and are truncated
rather than wrapped — a bar whose height depends on the wording is a bar that moves the page
under a thumb.

**મુખપૃષ્ઠ cannot be switched off.** Its switch is disabled and the save is refused if it
is missing, hidden or disabled — three different ways of taking the way back off the screen,
all three refused. This bar is the only chrome the app has on a phone: there is no sidebar,
no hamburger and no breadcrumb behind it, and a PWA in standalone mode does not draw a
browser Back button. A યુવક deep in લેવલ ૪'s કસોટી with no મુખપૃષ્ઠ button has no way out,
so hiding it is not a configuration, it is a trap.

**Destinations come from a fixed registry and are never typed.** `NAV_REGISTRY` in
`shared/domain/navigation.js` holds every route a button may have, beside the `<Route>` list
in `src/App.jsx` where the build can check it. The stored row carries a *key* and the
સંચાલક's opinions about it; the resolver looks the key up and takes the route from code.
There is no field in the panel for a URL and there is deliberately no way to add one:
`settings` is writable through PostgREST by anyone `has_permission('settings.update')`
admits, so a stored route that was honoured would mean one `curl` could put an arbitrary
path — or an off-site URL — under a button that 2,000 people press without reading. The row
is data; a destination is not.

**The icon list is closed** — ten names, each mapped to an inline SVG the app draws itself
(`src/components/NavIcon.jsx`). Nothing is fetched and nothing is evaluated. The names
describe the drawing and not the destination (`grid`, not `level4`), because the point of
making the icon configurable is that a સંચાલક may want a different picture on a button
without changing where it goes.

**Where it is stored, and why not a table.** `settings['nav'].value.mobileBottom` — a key
beside `app`, `levels` and `journey` in the same table. An `app_navigation_items` table was
the obvious shape and is the wrong one: this project already has a configuration system with
all four of the properties such a table would have been built to get — one RLS policy naming
`settings.update`, one audit trigger filing every write as `SETTINGS_UPDATED`, one
server-side validation pattern, and one read the યુવક app is already making. A second system
would duplicate all four and add a second round trip on a phone, to hold at most nine rows
that change a few times a year. It is its own key rather than a field of `app` because `app`
is read and patched by four different hooks, and a list living in the row that four hooks
merge is a list one of them eventually drops.

**The trigger is the guarantee; the panel is the explanation.** `0019_mobile_navigation.sql`
re-states the same rules — the registry keys, the icon names, 2..5 shown, the 12-character
cap, મુખપૃષ્ઠ present and on — in a `BEFORE` trigger on `settings`. That is the only one of
the two that a `curl` cannot go around, exactly as `0018` does for the gallery interval. The
panel's disabled switch and its error message exist so the સંચાલક knows *why* before he
presses Save, not because they stop anything.

**ક્રમાંક (Points / Leaderboard) is a placeholder and cannot be switched on.** It is listed
in the panel with its switch off and a line saying it is not built yet, because a page that
simply does not mention it invites the question every month. `ready: false` in the registry
is a fact about `src/App.jsx` rather than an opinion anybody may hold, and both
`validateMobileNav()` and the trigger refuse to show an item that carries it — so no save
and no `curl` can turn it into a button that navigates to a route which does not exist.
Points and gamification are a separate piece of work; switching this on is that task's
business. **સેટિંગ** was listed on the same terms until `/settings` was built; it is now
`ready: true` on both sides — `NAV_REGISTRY` and `nav_registry()` in
`0020_nav_settings_ready.sql` — so the સંચાલક may put it in the bar if he wants it there. It
is not in the default four, because a યુવક looks for his settings under **મારું**.

Two suites hold all of this: `npm run test:navigation` for the resolving, the validating and
the reordering, and `npm run verify:nav` for the bar itself in a real Chrome at the six
widths §21 names. `test:navigation` also compares the registry against both of the things it
claims to describe — the `<Route>` list in `src/App.jsx`, and the `ready` flag on every row of
`nav_registry()` in the **latest** migration that defines it. A registry that says ready while
the database says not-built is a checkbox the panel offers and the trigger refuses, which is
why the two copies are asserted to agree rather than remembered to.

## What a યુવક sets for himself

Almost everything a યુવક sees is the સંચાલક's. One thing is not, and it is worth knowing about
before somebody reports that the slideshow "is not using the number I set".

**પેનલ → સેટિંગ્સ → Gallery slideshow is a default.** Each યુવક may override it from
**/settings** in his own app — reached from **મારું** — where he picks one of four named
speeds or types his own:

| વિકલ્પ | seconds | આશરે, at 109 દ્રશ્યો |
| --- | --- | --- |
| ઝડપી | 3 | ૫ મિનિટ |
| મધ્યમ | 5 | ૯ મિનિટ |
| ધીમું | 8 | ૧૫ મિનિટ |
| અતિ ધીમું | 12 | ૨૨ મિનિટ |
| પોતાની ગતિ | 2-30 | counted |

The minute column is **computed, never stored** — it is the seconds against the size of
today's collection, so the day દ્રશ્ય ૧૧૦ is added every row of it corrects itself. It is the
reason the speeds are named rather than offered as a bare slider: "8 seconds" is a number a
યુવક cannot picture, and "આશરે ૧૫ મિનિટ" is the same fact in the unit he is actually deciding
in — how long am I sitting down for.

**His bounds are 2-30, and they are deliberately not the સંચાલક's 1-60.** The two answer
different questions. 1-60 is what one person setting a default for two thousand others may
choose, including the deliberately slow end used for a hall watching together. 2-30 is what a
યુવક may do to his own દર્શન in the moment: the floor is 2 rather than 1 because he arrives at
this control by tapping and could hit the floor by accident, and at one second a દ્રશ્ય the
collection is not being looked at, it is flickering past. The ceiling is 30 because past that
a દ્રશ્ય that has not moved is indistinguishable from an app that has frozen, and he has the
`›` arrow for going slower still. A સંચાલક default outside 2-30 is perfectly legal and is
honoured exactly as he set it — it is his number, and the યુવક's bounds do not clamp it.

**His choice never reaches the database.** It is stored on his device, one field, and there is
no column for it, no row written, no request made. Three consequences to be clear about: it
does not follow him to another phone, it disappears when he clears his browser data, and it is
not visible anywhere in the panel — there is no report of who has chosen what, because nothing
was recorded. **Clearing it returns him to the સંચાલક's number**, immediately and on every
screen that reads the speed.

`shared/domain/viewing-speed.js` holds the presets, the bounds, the resolver and the
validator, and `npm run test:speed` holds it to them — including the four published minute
totals, which are asserted against the requirement document's own figures so that a change to
the arithmetic cannot quietly re-time the સાધના.

## Deployment

Both builds publish from one Netlify site today. `netlify.toml` sends `/admin/*` to
`dist/admin/index.html` **before** the SPA catch-all, so deep links like `/admin/users`
reach the panel instead of booting the યુવક shell at an admin URL.

To move the panel to its own subdomain later, three lines change:

1. `admin/vite.config.js` — `base: '/'`
2. `admin/src/App.jsx` — drop `basename="/admin"`
3. a second Netlify site with `publish = "dist/admin"` and `command = "npm run build:admin"`

Nothing else, because nothing else assumes the path.

## Setup, in order

**1. Apply the migrations.** The panel cannot work without the tables, the RLS policies
and the audit triggers, and all three live in `supabase/migrations/`.

```
SUPABASE_DB_PASSWORD=... node scripts/db.mjs migrate
```

`SUPABASE_DB_PASSWORD` is the Postgres password from Supabase → Settings → Database. It
is a real credential with full database access: pass it from the environment for the
length of one command and never write it into a file in this repository.

Applied files are recorded in `public.schema_migrations`, so re-running only applies what
is new and each file runs inside its own transaction — a file that fails half way leaves
nothing behind. **As of 2026-08-11 every migration in the directory is already applied to
the live project**, so this step is a no-op until a new file is added; run it anyway, it
will simply list what is already present.

**2. Set the Netlify environment variables.** Two audiences, and they are not
interchangeable.

| Variable | Who reads it | Why |
|---|---|---|
| `VITE_SUPABASE_URL` | the build | baked into both bundles by `shared/supabase/client.js` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the build | ditto — public by design; RLS is the protection, not secrecy |
| `SUPABASE_URL` | `netlify/functions/login-mobile.js` | at request time, not build time |
| `SUPABASE_PUBLISHABLE_KEY` | `login-mobile` | signs the user in as an ordinary user, so RLS still applies |
| `SUPABASE_SECRET_KEY` | `login-mobile` | resolves mobile → email past RLS; bypasses every policy, so it belongs nowhere else |

`login-mobile` checks all three of its variables before doing anything and, if any is
missing, answers `503` with `code: 'setup-incomplete'` and the Gujarati sentence
*'મોબાઈલથી લોગિન હજુ ચાલુ થયું નથી. હમણાં ઈમેલથી લોગિન કરો.'* — so a half-configured site
degrades to email-only login rather than failing opaquely.

**3. Seed the first administrator.** There is no deployed site to register on yet, and
`scripts/seed-admin-supabase.mjs` can confirm the email outright instead of waiting on an
inbox:

```
SUPABASE_SECRET_KEY=... SEED_ADMIN_PASSWORD=... npm run seed:admin -- \
  --email you@example.com --mobile 9925842081 --smk PVK147 --name "…" --sub-zone varachha
```

`--sub-zone` is one of `vedroad`, `varachha`, `navsari`; `--zone` defaults to `surat`.
`--mobile` must already be in `ADMIN_MOBILES` — the script refuses to invent authority,
because a number it accepted but `is_admin()` did not would grant nothing. Adding a number
means editing `shared/domain/constants.js` **and** `is_admin()` in a new migration, both,
or the UI and the database disagree about who is an admin.
`npm run seed:admin:check` reports which of the numbers have a profile behind them.

**4. Sign in at `/admin`** with that email, or with the mobile via `/api/login-mobile`.
Nothing else is needed and there is no claim to refresh: `effective_role()` reads the
database live on every query.

## Authorisation

Roles, not a boolean. Defined in `supabase/migrations/0004_rbac.sql`:

| Role | Holds |
|---|---|
| `SUPER_ADMIN` | everything, and the only role that may assign roles |
| `ADMIN` | users, દર્શન, settings, reports, audit — but never administrator management |
| `CONTENT_MANAGER` | દર્શન content only; no user data at all |
| `COORDINATOR` | reads people and progress; changes nothing |
| `VIEWER` | read-only, and deliberately excluded from the audit trail |

Two layers, and only the second is security:

1. **The panel**, via `can('darshan.update')` from `useAdminAuth`, decides what renders.
   Hiding a button is usability.
2. **The RLS policy** on the table being read or written calls
   `public.has_permission('darshan.update')`. That is the boundary. A yuvak who edits the
   guard out of his own copy of the bundle gets empty results from every query.

There is no third layer and no token to sync: `effective_role()` reads `admin_profiles`
live inside each policy, so a role change takes effect on the next query rather than on
the next token refresh. The permission matrix exists twice — `shared/domain/permissions.js`
for the panel, `public.permissions_for()` for the database — and **nothing checks the two
for drift automatically.** `scripts/seed-admin.mjs`, which used to report it, was deleted
with the Firebase backend; its Supabase replacement only reports which સંચાલક numbers have
a profile. Changing one copy means changing the other by hand.

**Role assignment is not an ordinary write.** `admin_profiles_guard` refuses
self-appointment, refuses changing your own role or status, refuses granting or revoking
`SUPER_ADMIN` unless the caller holds it, and applies to `service_role` too — which an RLS
policy would not. The three founding numbers from §3 resolve to `SUPER_ADMIN` with or
without a row, so the owners cannot be locked out of their own panel.

The panel never sees a password, a password hash or an authentication token. There is
deliberately no "log in as this user".

## Data model — reused, not duplicated

| Table | Owner | The panel |
|---|---|---|
| `public.profiles` | યુવક app | reads, paginated and searched; writes `status` to suspend or disable |
| `public.progress` | યુવક app | reads — one row per yuvak per day, `level3_score` and `level4_score` |
| `public.learning_state` | યુવક app | reads — current stage and the three item-id arrays |
| `public.learning_sessions` | યુવક app | reads — one row per submitted round |
| `content/darshan.json` | build pipeline | reads — the master content |
| `public.scenes` | **panel** | writes `active`/`status`, `order`, `caption`, replacement `image_url` |
| `public.settings` | **panel** | writes the `app` row (video URL, app settings, the two ધૂન, the Drive folder, the gallery slideshow interval), the `levels` row (level availability, what opens લેવલ ૪) and the `nav` row (the phone's bottom bar) |
| `public.admin_profiles` | **panel** | who holds which role; guarded by `admin_profiles_guard`, never deleted |
| `public.audit_logs` | **database** | append-only; no update, no delete, for anyone |

Ordinary reads go through PostgREST. The two aggregate reports that a GROUP BY is needed
for — `public.stage_breakdown()` and `public.effective_role()` — are RPCs, both
`SECURITY INVOKER`, so RLS still applies and they are a convenience rather than a way
around a policy.

No table was duplicated to give the panel something to own. Three decisions are worth
stating because they look like omissions:

- **દર્શન images stay in `content/darshan.json`**, not in Postgres. The hashed filenames
  are what make the `immutable` cache header safe and what the regression suite measures.
  `public.scenes` holds only admin-editable state layered on top.
- **There is no separate sessions table beyond `learning_sessions`.** It already is one,
  written once per submitted round by the યુવક app; the id is derived from the user and
  the round, so a retried submit overwrites its own row rather than making two.
- **`audit_logs` is owned by the database, not the panel.** Since `0004_rbac.sql` the rows
  are written by triggers inside the same transaction as the change, from data the client
  never supplies. A browser that edited the audit call out of its own bundle would still
  leave a trail. The one exception is `ADMIN_LOGIN`, which is not a table mutation and so
  no trigger can produce it — the panel writes that one, with `actor_id` pinned by policy
  to the caller.

## Deliberately not built

- **Per-scene "which દર્શન is hardest" across the whole organisation.** The પ્રગતિ page
  still shows this from a bounded sample of recent sessions and says the sample size next
  to the result. Note that the *reason* changed and the obstacle is now smaller than the
  code assumes: under Firestore this could not be an aggregation at all, because
  `pendingItemIds` is an array and Firestore counts documents, not array members. Postgres
  has no such limit — `unnest(pending_item_ids)` with a `group by` would tally the whole
  organisation in one scan, as a `stage_breakdown()`-style RPC. What remains is only that
  nobody has written that RPC; `learningService.pendingHotspots()` still samples, and its
  comment still gives the Firestore reasoning.
- **Editing a yuvak's progress.** Read-only by default, as specified.
- **Impersonation, and permanent deletion of content.** Scenes are disabled, never
  deleted; the old asset stays in place so a rollback is a field change.
- **Multi-organisation tenancy.** One ઝોન, one સંસ્થા. An `organizations` table and an
  `organization_id` on every row would add a join to effectively every query and buy
  nothing today. `zone_id` is the seam if that ever changes.
- **A UI for role assignment.** `0004_rbac.sql` enforces the roles; the panel does not yet
  have an Admin Management page, so roles are assigned by SQL until it does.

## Open items

- ~~**Region is unverified.**~~ ✅ **Resolved.** The backend is Supabase project
  `tjovudfsodviwijyyvdw` in **`ap-south-1`** (Mumbai), which satisfies the India-residency
  requirement. Recorded at the top of `.env.local` and in the pooler hosts
  `scripts/db.mjs` falls back to. Nothing further to check before production data is
  written.
- **દર્શન is complete — 109 of 109.** The Drive folder holds 109 images and the sheet holds
  109 વર્ણન, every one bound by declaration from the `ફોટો ફાઇલ` column. `npm run validate --
  --fetch` confirms all 109 links still serve real images. A scene is only taught when it has
  both a link and a વર્ણન, and the **દર્શન તપાસ** page counts and names any future gap.
  Note that 109 is one more than the spec's 108 — see §2.3; the સંચાલક should confirm why.
