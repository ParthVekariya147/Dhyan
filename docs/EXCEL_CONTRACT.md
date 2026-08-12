# Excel contract — FROZEN

Excel is an interchange format. It is never the live database, and the યુવક app never parses
a spreadsheet.

## 1. Columns

Export writes all of these, in this order. Import accepts any subset containing a join key.

| # | Header (English)      | Header (ગુજરાતી) | Maps to            | Import | Notes |
|---|----------------------|------------------|--------------------|--------|-------|
| 1 | `Item ID`            | `આઈડી`           | `id`               | key    | join key when the column is present. Blank cell ⇒ new row (CREATE modes only) |
| 2 | `Index Number`       | `ક્રમ`            | `scenes.index`     | yes    | positive integer, unique |
| 3 | `Title`              | `શીર્ષક`          | `scenes.title`     | yes    | Gujarati, may be empty |
| 4 | `Description`        | `વર્ણન`           | `scenes.caption`   | yes    | Gujarati, may be empty |
| 5 | `Google Drive File ID`| `ડ્રાઈવ ફાઈલ આઈડી`| `scenes.drive_id`  | yes    | |
| 6 | `Google Drive URL`   | `ડ્રાઈવ લિંક`      | derived            | yes    | file ID extracted on import; ID wins if both given and they disagree |
| 7 | `Display Order`      | `ક્રમાંક`          | `scenes."order"`   | yes    | positive integer, unique |
| 8 | `Status`             | `સ્થિતિ`          | `scenes.status`    | yes    | one of the five; case-insensitive |

Export-only, ignored on import (round-trip safe):

| `Production Image URL` | `imageUrl` |
| `Display Number`       | `displayIndex` — derived, never imported |
| `Image File`           | manifest `file` |
| `Updated At`           | `updatedAt` |

**Never exported:** passwords, tokens, session data, service keys, `.env` values, e-mail
addresses, mobile numbers, or anything from `profiles`.

Header matching is by **name, never by position** — the existing rule in
`shared/domain/sheet-import.js`. Both language variants above must match, plus the English
short forms already accepted. A column that matches nothing is ignored, not guessed at.

## 2. File formats

| Format | Import | Export |
|--------|--------|--------|
| `.csv` (UTF-8) | yes | yes |
| `.tsv` / `.txt` | yes | no |
| `.xlsx` | yes — **new** | no |

Export is CSV with a UTF-8 BOM, following `admin/src/lib/export.js`. Excel opens it natively.
Writing a real `.xlsx` would need a ZIP writer and a new dependency in a panel that has three;
reading one does not, because the reader already exists.

**Two traps, already solved in `admin/src/lib/export.js` — reuse it, do not reimplement:**
- **BOM.** Without `U+FEFF`, Excel on Windows renders every Gujarati string as mojibake.
- **Formula injection.** A cell starting `=`, `+`, `-` or `@` is evaluated by Excel. Prefix
  with an apostrophe.

## 3. Round-trip guarantee

```
scenes ──export──> file ──import──> preview ──apply──> scenes
```

must be a no-op: zero changes detected, and byte-identical Gujarati in `title` and
`caption`. This is a required test.

Specifically preserved: Gujarati combining marks (ઈ vs ઇ are **not** normalised), embedded
commas, newlines and quotes inside `Description`, leading zeros in ids, and empty strings
staying empty rather than becoming `null`.

## 3a. The join key — AMENDED 2026-08-12

The first draft made `Item ID` the only join key, with a blank meaning "new row". That was
wrong for the workflow this feature exists to serve: **the સંચાલક's live sheet has no Item ID
column at all** — its headers are `ક્રમ`, `ફોટો ફાઈલ`, `દ્રશ્ય-વર્ણન (વિગતવાર)`. Under the
original rule every row collided with an existing `ક્રમ`, every collision defaulted to Skip,
and a straight-through import of the organisation's own sheet applied **nothing**. Verified:
10 edited rows produced `skip: 10, update: 0, conflicts: 10`.

The rule is therefore:

| Sheet shape | Join on |
| ----------- | ------- |
| `Item ID` column present, cell filled | `id` |
| `Item ID` column present, cell blank | new row (CREATE modes only) |
| **`Item ID` column absent entirely** | **`Index Number`** |

When joining on `Index Number`, a row whose number matches an existing દ્રશ્ય is an ordinary
`update` — **not** a §7 conflict. §7 conflicts remain what they were: a row that names one
identity while carrying an `Index Number` that belongs to a *different* દ્રશ્ય. That can only
arise when an `Item ID` column is present, which is exactly when the ambiguity is real.

A row whose `Index Number` matches nothing existing is a create, subject to the mode.

The trade-off, accepted deliberately: if someone renumbers `ક્રમ` in the sheet, that row now
updates a different દ્રશ્ય. The mandatory preview (§5) still shows every field that would
change, before anything is written, which is what makes this safe enough to be the default.

## 4. Import modes

| Mode | Row has known `Item ID` | Row is new |
|------|------------------------|------------|
| `CREATE_ONLY` | skipped | created |
| `UPDATE_ONLY` | updated | skipped |
| `UPSERT` (default) | updated | created |

Creating requires `darshan.create`; updating requires `darshan.update`. A mode the operator
lacks the permission for is offered disabled, with the reason shown.

## 5. Flow — never Excel straight to production

```
select file → parse → map columns → validate → PREVIEW → explicit confirm → apply
```

The preview is mandatory. There is no "apply immediately" path, no auto-apply flag.

Preview must report, over real rows:

```
TOTAL ROWS: 109
NEW: 4    UPDATED: 103    SKIPPED: 1    ERRORS: 1
```

plus per-row detail naming the field at fault, not just the row.

## 6. Validation

Errors (block that row):
- unparseable or missing required column
- `Index Number` / `Display Order` not a positive integer
- duplicate `Index Number` or `Display Order` **within the file**
- duplicate `Item ID` within the file
- `Status` outside the five values
- malformed Drive reference
- `Item ID` not found, in `UPDATE_ONLY`

Warnings (row still applies):
- empty `Title` or `Description`
- `Index Number` collides with a **different** existing `id` → see §7
- Drive file ID names a file not present in the configured folder

## 7. Duplicates — never silently overwritten

When an imported `Index Number` already belongs to a different `id`:

```
Index 27 already belongs to darshan-027.
  [ Skip this row ]   [ Update the existing item ]   [ Cancel the import ]
```

Default is **Skip**. The choice applies per row, with an "apply to all remaining" option.
Nothing is written until the operator confirms the whole plan.

## 8. Template

`[Download Excel Template]` produces a CSV (UTF-8 BOM) with:
- the eight importable headers in the order above
- three example rows, clearly marked as examples, with real Gujarati text
- a companion `INSTRUCTIONS` block covering: which fields are required, the five allowed
  statuses, how a Drive reference is written, that `Item ID` must be left blank for a new
  દ્રશ્ય, that `Index Number` and `Display Order` are different things, and how duplicates
  are handled.

Because the export is CSV rather than a multi-sheet workbook, the instructions ship as a
second downloadable file (`darshan-instructions.txt`) alongside the template, not as
"Sheet 2".

## 9. Frozen module signatures

`shared/domain/darshan-excel.js` (Agent B) — pure, no DOM, no network:

```js
export const EXCEL_COLUMNS;                 // ordered [{key, en, gu, importable, required}]
export function itemToRow(item);            // DarshanItem  -> string[]
export function rowToPatch(cells, columns); // -> { id?, index?, title?, caption?, driveId?, order?, status?, issues[] }
export function detectDarshanColumns(headerCells);  // -> { [key]: colIndex|null }
export function buildExcelPlan({ rows, headerRow, columns, existing, mode });
//   -> { entries:[{ rowNumber, id, action:'create'|'update'|'skip'|'error',
//                   patch, issues:[{severity,field,message}], conflict? }],
//        counts:{ total, create, update, skip, error } }
export function templateRows();             // -> string[][] including header
export function instructionsText();         // -> string
```

`shared/domain/xlsx-read.js` (Agent B) — browser-safe, zero dependencies:

```js
export function readXlsx(arrayBuffer);      // -> string[][]  (first worksheet, dense)
```

Ported from the proven Node reader in `scripts/lib/spreadsheet.mjs`: same ZIP+XML approach,
`DecompressionStream('deflate-raw')` instead of `zlib`, same failure message telling the
સંચાલક to save as CSV UTF-8 rather than guessing at a malformed file.
