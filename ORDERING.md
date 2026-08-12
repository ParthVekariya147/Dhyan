# માસ્ટર દર્શન — Order & Display Numbering · FROZEN CONTRACT

> Contract between four agents working in parallel. Signatures below are **binding**.
> An agent that believes one is wrong implements it as written and says so in its report.

Written 2026-08-12, on top of `LEVEL4.md`. Read that first — this does not replace it.

---

## 0. The three decisions this is built on

| # | Decision |
|---|---|
| 1 | **The yuvak's number is continuous, everywhere.** One number per દ્રશ્ય across દર્શન, લેવલ ૩, લેવલ ૪'s કસોટી and revision. લેવલ ૪.૨ configured as ૩૧–૫૦ shows ૩૧…૫૦ — never a local ૧–૨૦. |
| 2 | **The સંચાલક picks by that same number.** "From 1 To 30" in the લેવલ ૪ builder means the first 30 **active** દ્રશ્યો in the current order — exactly what the યુવક sees as ૧–૩૦. Each row also shows its source number in grey so a દ્રશ્ય can be traced back to the sheet. |
| 3 | **Withholding warns before it renumbers.** A confirm dialog states how many દ્રશ્યો will shift. He may still proceed — he is never surprised. |

---

## 1. The four concepts — never conflate them

```
id            stable, immutable, forever          'darshan-001'   ← already exists
sourceIndex   the original printed number         109             ← scenes.index / manifest n
position      the સંચાલક's order                   scenes."order"  ← what drag-and-drop writes
displayIndex  what the યુવક sees                   1 … N           ← DERIVED, never stored
```

**`displayIndex` is derived on read and stored nowhere.** The same reasoning as
`0011_level4_gate_view.sql`: a stored answer to a question whose inputs change is a cache
with no invalidation. Withholding one દ્રશ્ય would otherwise have to rewrite ~109 rows, and
a reactivation would have to rewrite them back.

### What is already true (do not rebuild)

- `id` is stable and is never renumbered — `darshan-001`, from the manifest
- deactivation is already soft — `scenes.active` / `scenes.status`, nothing is hard-deleted
- `level4_activity_items` already references દર્શન **by stable id** with its own `position`,
  so a global reorder cannot corrupt કસોટી membership. **Nothing in §ACTIVITY of the
  request needs building — verify it, do not rewrite it.**

### ⚠️ The sparse overlay, again

`public.scenes` has **no row** for a દ્રશ્ય the સંચાલક never edited (see `useScenes.js`'s
header). So `position` is frequently absent, and the canonical sort must fall back to
`sourceIndex`. Reordering has to *create* rows — see §3.

---

## 2. `shared/domain/darshan.js` — the one derivation · Agent A

Every screen in both apps gets its numbers from this and from nowhere else.

```js
/**
 * @param {Array} entries  merged દર્શન entries (manifest ⊕ overlay), any order
 * @returns {Array} a NEW array, canonically sorted, each entry extended with:
 *    sourceIndex  : number|null   entry.index ?? entry.n ?? null
 *    displayIndex : number|null   1..N across ACTIVE entries only; null when inactive
 */
export function withDisplayIndex(entries)
```

**Canonical sort — frozen.** `position ?? sourceIndex ?? Infinity`, ascending, tie-broken by
`id` ascending. Total and deterministic: two entries can never compare equal, so the order
is identical in both apps and on every render.

**Inactive entries are kept in the array, in place, with `displayIndex: null`.** They are
not dropped, because the સંચાલક's list must show them to reactivate them. The યુવક side
filters them out itself, as it already does.

`displayIndex` counts **only active entries**, so it is always `1 … (number of active)` with
no gaps — decision #1.

Also export:

```js
export const displayIndexOf = (sequenced, id) => number|null
```

---

## 3. `supabase/migrations/0012_darshan_reorder.sql` · Agent A

```sql
public.darshan_reorder(p_ids text[]) returns jsonb
```

`security definer`, `set search_path = public`, granted to `authenticated`, and it checks
`has_permission('darshan.update')` inside. Behaviour:

1. refuse unless permitted → `darshan_reorder_denied`
2. refuse a `p_ids` containing a duplicate → `darshan_reorder_duplicate`
3. set `"order"` = the id's 1-based position in `p_ids`, for every id in it
4. **upsert** — a દ્રશ્ય with no `scenes` row gets one, carrying `id` and `"order"` only.
   That is safe and must be commented as such: `caption` defaults `''` so `applyOverlay`
   keeps the manifest's વર્ણન, `index` stays null so the printed number is untouched, and
   `status` defaults `ACTIVE`, which is how a row-less દ્રશ્ય already behaves.
5. **atomic.** `scenes_order_unique` (0004) is a *partial* unique index and therefore cannot
   be `DEFERRABLE`, so a straight bulk update collides mid-permutation. Do it in two
   statements inside the one function body — park the affected rows on distinct negative
   orders, then write the final values. One transaction, so no caller ever observes the
   parked state.
6. write an `audit_logs` row, `DARSHAN_ORDER_CHANGED` (the action already exists in
   `shared/domain/audit.js`), `resource_type = 'scenes'`
7. return `{"reordered": <count>}`

Do **not** alter `scenes_index_unique` or `scenes_order_unique`, and do not touch
`sourceIndex`/`scenes.index` anywhere — reordering changes presentation, never identity.

---

## 4. યુવક app · Agent B

`useScenes()` is the single source and is where `withDisplayIndex()` is applied — after the
overlay and both gates, before the return. Its `scenes` therefore arrive already sequenced,
already sorted, active only. **Its public shape `{ scenes, total, loading }` does not change.**

Then, everywhere a number is printed, `s.displayIndex` replaces `s.n ?? s.index`:

| File | What changes |
|---|---|
| `src/lib/useScenes.js` | apply `withDisplayIndex()`; drop the local `.sort()` it now supersedes |
| `src/modules/darshan/DarshanCard.jsx` (+ `DarshanFeed`) | the number on the card |
| `src/modules/levels/LevelPage.jsx` | `n={...}` passed to `TickRow` |
| `src/modules/level4/ActivityTestPage.jsx` | its `numbering()` projection — **still `id → number` only**, LEVEL4.md rule 3 is untouched: no વર્ણન, no image, on that screen |
| `src/modules/level4/RevisionPage.jsx` | the number beside each image |
| `src/modules/level4/Level4Page.jsx` | the કસોટી card's range line (`દ્રશ્ય ૧–૩૦`) |

`gu()` still formats every one of them. Nothing else about these screens changes.

---

## 5. સંચાલક — drag & drop and the warning · Agent C

**`DarshanListPage`** gains drag-and-drop reordering of the master list.

- **No new dependency.** The project has none for this and is not getting one — use the
  HTML5 drag-and-drop API, and give every row a keyboard path too (↑/↓ buttons or
  `aria-grabbed` equivalent): a reorder that only works with a mouse is not finished.
- Dragging is a working copy. Nothing persists until **`Save Order`**, which sends the whole
  id list to `darshan_reorder()` in one call. `Cancel` restores.
- The list shows `displayIndex` as the row's number, with `sourceIndex` in grey beside it.
- Inactive દર્શન are visible, marked, and carry no display number.
- ~109 rows today and possibly 1000 later (LEVEL4.md rule 1) — do not assume a size.

**`DarshanDetailPage`** gains decision #3: withholding (or reactivating) a દ્રશ્ય first shows
a `ConfirmDialog` naming **how many દર્શન will be renumbered** — count it from the current
sequence, never a literal. Reuse the existing `ConfirmDialog`; do not write a new one.

---

## 6. Level 4 builder + selection engine · Agent D

The engine currently reads the **printed number** (`entry.index ?? entry.n`). Decision #2
changes that to `displayIndex` throughout `shared/domain/level4-selection.js`:

- `expandRange(collection, from, to)` — spans **display** numbers
- `searchScenes` — matches a display number (prefix), a source number, or વર્ણન text.
  Keep the Gujarati-digit parsing already there.
- `summarise` — `fromIndex`/`toIndex`/`contiguous` are **display** numbers; `contiguous`
  means the selection is an unbroken run of display numbers
- `findMissing` / `findInvalid` / `orderSceneIds` — unchanged in meaning, but ordering is
  the canonical sequence, i.e. `withDisplayIndex()`'s order

`collection` reaching the engine is **already sequenced** — the caller applies
`withDisplayIndex()`. The engine must not sort by `order ?? n` itself any more.

`admin/src/features/level4/**`: the picker rows show `displayIndex` prominently and
`sourceIndex` in grey (decision #2), and `Auto Divide` splits the sequenced list.

**`scripts/test-level4.mjs` must be updated and must still pass** — its fixtures encode the
old numbering. Update the fixtures, not the assertions' intent.

---

## 7. File ownership

| Agent | Owns |
|---|---|
| **A — derivation + SQL** | `shared/domain/darshan.js`, `supabase/migrations/0012_darshan_reorder.sql` |
| **B — યુવક rendering** | `src/lib/useScenes.js`, `src/modules/darshan/**`, `src/modules/levels/LevelPage.jsx`, `src/modules/levels/TickRow.jsx`, `src/modules/level4/{ActivityTestPage,RevisionPage,Level4Page}.jsx` |
| **C — સંચાલક list + warning** | `admin/src/features/darshan/pages/{DarshanListPage,DarshanDetailPage}.jsx`, `admin/src/features/darshan/services/darshanService.js`, `admin/src/features/darshan/darshan.css` (new, if needed) |
| **D — engine + L4 builder** | `shared/domain/level4-selection.js`, `scripts/test-level4.mjs`, `admin/src/features/level4/**` |

### 🔒 Nobody touches

`src/lib/progress.js` · `src/lib/auth.jsx` · `src/lib/level4.js` · `src/lib/scenes.js` ·
`shared/domain/permissions.js` · `shared/domain/level4.js` ·
`supabase/migrations/0001`–`0011` · `scripts/build-darshan.mjs` · `content/darshan.json` ·
`netlify/**`

The manifest and its builder are the **source** of `sourceIndex`. Reordering lives in the
overlay, never in the sheet.

---

## 8. Rules

1. **`items[i]` is never an identity.** Every operation keys on `id`. No `index + 1` as an
   identifier, ever.
2. **No hard-coded totals** — never `109`/`110`/`108`. Counts come from the collection.
3. **Reordering never mutates `id` or `sourceIndex`.** It writes `position` and nothing else.
4. **One canonical order.** No screen re-sorts for itself. If a screen needs a different
   order, that is a bug report, not a local `.sort()`.
5. Historical progress keeps referencing the same stable ids — nothing here rewrites
   `progress`, `level4_attempts` or `level4_activity_progress`.
6. યુવક UI is Gujarati via `gu()`; સંચાલક panel is English.
7. Comment *why*, in the voice of the surrounding code.
8. No `git commit`, no migration run against the live database.
9. Verify: `npm test`, `npm run build`, `npm run verify:separation`.
   `npm run verify`'s 3 image-CDN checks fail in this environment on a clean baseline —
   that is known and is not yours.
