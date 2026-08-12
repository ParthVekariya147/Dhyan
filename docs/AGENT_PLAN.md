# દર્શન content management — agent plan

## Status of the original brief

The brief assumed a greenfield build on Firestore with RBAC to be consumed and an Excel
pipeline to be written. Inspection on 2026-08-12 found most of it already shipping:

| Brief assumed | Reality |
| ------------- | ------- |
| Firestore master DB | **Supabase Postgres.** `firebase.json` / `firestore.rules` are dead files; `firebase-admin` survives only for one Netlify function |
| RBAC exists, consume it | **Correct.** 5 roles, `permissions_for()` / `effective_role()` / `has_permission()`, enforced in every RLS policy, mirrored in `shared/domain/permissions.js`, drift-checked by `seed:admin:check` |
| Google Drive pipeline to build | **Already built** — `list-drive-folder.js`, `scenes.drive_id` (0009), publish-to-Storage (0005) |
| Excel import to build | **Largely built** — `shared/domain/sheet-import.js` (column detection, Drive matching, planning), `DarshanImportPage.jsx`, plus a zero-dependency `.xlsx` reader in `scripts/lib/spreadsheet.mjs` |
| Display order to build | **Already built** — `darshan_reorder()` RPC (0012) + drag-and-drop |
| No tests | `npm test` → **153 passing** |
| TypeScript | None, by design. JSDoc typedefs (`shared/domain/types.js`); `tsc --noEmit --allowJs` understands them |
| 109 items | Confirmed: manifest holds 109, all with a Drive URL and a Gujarati વર્ણન |

Scope was therefore narrowed to the six real gaps below. Rebuilding what exists would
violate the brief's own "NO DUPLICATE IMPLEMENTATION" rule.

## Baseline (2026-08-12, before any change)

```
npm test                 290 passed, 0 failed   (test-domain 137 + test-level4 153)
content/darshan.json     109 entries · 109 with url · 109 with caption · index 1..109
assets/masters           109 files
```

> `npm test` prints a per-file total, so its **last** line reads 153. An earlier draft of this
> doc quoted that as the whole baseline. The combined figure is 290, and that is what the
> "count must go up" rule is measured against.

`npm run verify` needs a build and a browser; three of its image-request checks fail on a
clean baseline for environmental reasons and are not a regression.

## The six gaps

1. `title` — no such field anywhere. Schema, domain, admin edit, user app.
2. Excel **export** of દર્શન + downloadable template. `export.js` covers users/progress/sessions only.
3. Browser-side `.xlsx` upload. The reader is Node-only; the panel accepts `.csv/.tsv/.txt`.
4. Import columns — only `index`/`file`/`caption` are detected. Need Item ID, Title, Status, Display Order.
5. Import modes — `writableEntries()` keeps only `status === 'update'`; no CREATE_ONLY / UPSERT, no duplicate choices.
6. Bulk actions — no multi-select validate/publish/disable/export on the list page.

## Ownership — no two agents write the same file

| Agent | Responsibility | Owns (exclusive write) |
| ----- | -------------- | ---------------------- |
| **A** | `title`, schema → both apps | `supabase/migrations/0013_darshan_title.sql` (new)<br>`shared/domain/darshan.js`<br>`shared/domain/types.js`<br>`admin/src/features/darshan/services/darshanService.js`<br>`admin/src/features/darshan/pages/DarshanDetailPage.jsx`<br>`admin/src/features/darshan/pages/DarshanHealthPage.jsx`<br>`src/lib/useScenes.js`<br>`scripts/test-domain.mjs` |
| **B** | Excel modules, pure | `shared/domain/darshan-excel.js` (new)<br>`shared/domain/xlsx-read.js` (new)<br>`scripts/test-darshan-excel.mjs` (new)<br>`package.json` (test script only) |
| **C** | Import pipeline | `shared/domain/sheet-import.js`<br>`admin/src/features/darshan/services/importService.js`<br>`admin/src/features/darshan/pages/DarshanImportPage.jsx` |
| **D** | List page, bulk actions, export UI | `admin/src/features/darshan/pages/DarshanListPage.jsx`<br>`admin/src/features/darshan/darshan.css`<br>`admin/src/lib/darshanExport.js` (new) |

Read-only for everyone: the three contract docs, `ORDERING.md`, `ADMIN.md`,
`shared/domain/permissions.js`, `shared/domain/drive.js`, `admin/src/lib/export.js`, every
existing migration.

**Nobody** edits: `shared/domain/permissions.js`, `permissions_for()`, any `0001`–`0012`
migration, `firestore.rules`, `firebase.json`, `content/darshan.json`, `public/darshan/`,
`assets/`, `.env*`.

## Dependencies

```
        contracts frozen (Agent 0)
                 │
     ┌───────┬───┴───┬────────┐
     A       B       C        D
   title   modules import   list UI
                 └───┬───────┘
              C and D consume B's frozen
              signatures (EXCEL_CONTRACT §9)
```

C and D code against the signatures in `EXCEL_CONTRACT.md §9` rather than waiting for B, so
all four run in parallel. Agent 0 verifies the seams at integration.

A's migration adds `title`; B, C and D reference it per `DARSHAN_DATA_CONTRACT.md §2`.

## Integration requirements

Every agent, before reporting done:

- `npm test` passes and the count has gone **up** from 153, never down.
- No new npm dependency.
- No new permission, role, or RBAC code path.
- Gujarati strings byte-identical through any transform.
- Nothing hardcodes 109 or 108. Counts come from the data.
- New user-facing strings follow the surrounding file's language.

Agent 0 then runs `npm test`, `npm run build`, `npm run verify:separation`, and reviews the
seams between the four branches.

## Status

| Agent | Status | Result |
| ----- | ------ | ------ |
| **A** — `title` | **done, verified** | `0013_darshan_title.sql`; `title` on `DarshanItem`; edit field on the detail page; `missingTitles` on the health page; 29 new assertions (test-domain 137 → 166). Independently re-checked: all 109 ship `title = ''`, all 109 still number 1…109 gapless, `missing-title` is `warn` only, `invalid` stays 0, RBAC files untouched |
| **B** — Excel modules | **done, verified** | `darshan-excel.js` (column contract, planner, template), `xlsx-read.js` (browser `.xlsx` via `DecompressionStream`), 161 new assertions. Re-checked on real data: 109 rows round-trip to 0 create / 0 update / 0 error, Gujarati byte-identical, template carries no real Item ID, and the export-only decoy columns do not hijack `Display Order` / `Google Drive URL` |
| **C** — import | **done, verified** | Nine-role detection delegating to B's detector, three import modes gated on existing permissions, §7 duplicate resolution, `.xlsx` upload, preview-then-confirm preserved. Writes still row-by-row through `saveScene` so every row is individually audited |
| **D** — list UI | **done, verified** | Selection bar + bulk Validate / Publish / Turn off / Export, three downloads reusing the existing BOM + formula-injection encoder, no bulk delete, disabled during arrange mode |

Final: `npm test` **538 passing, 0 failed** (193 + 153 + 192), up from a 290 baseline.
`npm run build` clean for both apps. No new runtime dependency, no new permission, no RBAC file
touched, no test deleted or weakened.

Live-sheet import verified end to end against the real 109, driven through Agent C's detector
exactly as the panel does it:

```
ક્રમ | ફોટો ફાઈલ | દ્રશ્ય-વર્ણન (વિગતવાર)     ← no Item ID column
10 edited rows  → joinedOn: index · update: 10 · conflicts: 0 · row 1 → darshan-001
109 unedited    → update: 0 · create: 0 · skip: 109   (round trip still a no-op)
```

### Open items

1. **`verify:separation` — યુવક bundle 625 KB against a 620 KB budget.** Not from this work:
   every Excel/import/export module is admin-only (verified — zero occurrences of
   `darshan-excel`, `xlsx-read`, `sheet-import`, `importService`, `darshanExport`, `readXlsx`,
   `buildExcelPlan` in any `dist/assets/*.js`), and Agent A's યુવક-side additions are two object
   fields. The growth is pre-existing uncommitted work, chiefly `shared/domain/journey.js`
   (25 KB of source, imported by ten યુવક-side files including `App.jsx`), which was already in
   the working tree at session start. **Decision: left failing, reported not fixed.** The check
   stays red and honest; whether `journey.js` earns its 25 KB is a separate call. The budget was
   deliberately not raised — editing a check so a build passes is what the brief forbids.
2. **The live sheet did not import straight through. Fixed.** `EXCEL_CONTRACT.md` §3a amends
   the join key: when a sheet has no `Item ID` column at all, rows join on `Index Number`
   instead, so the સંચાલક's own sheet imports as it always did. `Item ID` still wins whenever
   the column is present, and §7 conflicts keep their meaning — a row naming one identity while
   carrying a number belonging to another, which can only arise when an ID column exists. The
   accepted trade-off is that renumbering `ક્રમ` in the sheet retargets that row; the mandatory
   preview shows every change first.
3. **`buildImportPlan` / `writableEntries` in `sheet-import.js` are now dead to the app** —
   only `scripts/test-domain.mjs` still calls them. Worth retiring together, deliberately.
4. **"Validate" is read-only.** Agent D resolved the ambiguity that way, correctly: `VALIDATED`
   sits outside `useScenes`'s `VISIBLE = {PUBLISHED, ACTIVE}`, so a Validate button that wrote
   status would have withheld live દર્શન from યુવકો and renumbered the collection.

### Corrections issued mid-flight

Two errors in the first draft of these contracts, both caused by the stale-snapshot read
described at the top of this file. Found by Agent A, verified against the migrations, fixed
in the docs, and sent to the agents still working:

1. **`darshan.publish` does not exist.** `0009_darshan_drive_direct.sql` deleted the encoder
   and folded it into `darshan.update`, re-declaring `permissions_for()` without it. A control
   gated on it would be dead for every role. The current set is exactly `darshan.read`,
   `darshan.create`, `darshan.update`, `darshan.disable`.
2. **`IMAGE_CONTRACT.md` described a pipeline that no longer exists.** `image_variants`,
   `publish_status`, `publish_error` and `published_at` were dropped by 0009. There is no
   publish queue. `lh3.googleusercontent.com/d/<id>` **is** the production URL, deliberately;
   what is refused is `drive.google.com` / `uc?export=download`. The instruction "import must
   never write `image_url`" was too strong and was withdrawn — an import may set it, but only
   through `resolveImageInput()`.

## Conflicts to escalate, not work around

- Needing to change a frozen contract.
- Needing a new permission.
- Needing to touch another agent's file.
- Anything that would put `title` into `isLearnable()` / `isNumbered()` — see
  `DARSHAN_DATA_CONTRACT.md §2.1`.
