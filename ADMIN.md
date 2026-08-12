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
cool-toned operational console, and they are meant to look nothing alike.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | યુવક app, port 5173 |
| `npm run dev:admin` | સંચાલક panel, port 5174 |
| `npm run build` | both, in order — યુવક first (it owns and empties `dist/`), panel second |
| `npm run build:yuvak` / `build:admin` | one at a time |
| `npm run verify` | builds with the test flag, then runs the 18-check image-delivery suite |
| `npm run verify:separation` | proves no admin code reached the યુવક bundle |
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

### Why the encoder is gone

The previous scheme downloaded 549 MB of masters and re-encoded all 109 into six widths ×
three formats, binary-searching each for the lowest quality still above SSIM 0.985. It was
correct and it did not work: the last full run reported **~13 hours remaining** and was killed
after 12 images, which is why the app spent that period showing 12 દ્રશ્યો out of 109.

Google's image CDN does the same job in the URL. `=w1600-rj-v1` turns a 1606 KB PNG master
into a **132 KB JPEG** — twelve times smaller, no visible loss, no local CPU, nothing to
commit. `shared/domain/drive.js` documents what each part of that suffix does and what it
costs to drop it.

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
| `public.settings` | **panel** | writes the `app` row (video URL and app settings) and the `levels` row (level availability) |
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
