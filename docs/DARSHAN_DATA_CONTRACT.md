# દર્શન data contract — FROZEN

Agreed before implementation. An agent that needs this to change must stop and say so
rather than working around it.

## 1. Identity — four separate things

Already established by `ORDERING.md` and `shared/domain/darshan.js`. Restated because the
Excel and import work touches all four and must not conflate them.

| Concept        | Where it lives                   | Mutable? | Example        |
| -------------- | -------------------------------- | -------- | -------------- |
| `id`           | `scenes.id` / manifest `id`      | never    | `darshan-027`  |
| `sourceIndex`  | `scenes.index` / manifest `n`    | admin    | `27`           |
| `position`     | `scenes."order"`                 | admin    | `14`           |
| `displayIndex` | derived by `withDisplayIndex()`  | derived  | `1…N`          |

- `id` is the database identity and the Excel join key. Never an array position, never the
  index number.
- Changing `sourceIndex` from 27 to 28 must not change `id`, and must not orphan progress,
  `level4_activity_items`, or any recorded attempt — all of which reference દર્શન by `id`.
- `displayIndex` is **derived on read and stored nowhere**. Nothing in this work may persist
  it. It is not an Excel column that can be imported.

## 2. The new field: `title`

**Migration:** `supabase/migrations/0013_darshan_title.sql` — owned by Agent A, and the only
new migration in this work.

```sql
alter table public.scenes
  add column if not exists title text not null default '';
```

- `not null default ''` mirrors `caption` (0001), so the existing empty-string convention
  holds: **empty means "not written yet", never "blank this scene's title"**. `applyOverlay`
  must treat it exactly as it treats `caption` — `if (scene.title) out.title = scene.title`.
- All 109 items ship with an empty title, by decision. The health report names them as a
  counted gap (`missingTitles`, `missingTitleIds`), the same way `missingCaptions` already
  works. They are filled in via one Excel round-trip.

### 2.1 The rule that must not be broken

`title` is **not** part of the content gate.

`isLearnable()` and `isNumbered()` in `shared/domain/darshan.js` currently require an image
and a `t`/`caption`. Adding `title` to either would withhold all 109 દર્શન from the યુવક app
the moment the column ships, and would renumber every `displayIndex` to null. Do not do it.

A missing title is reported, never enforced.

## 3. `caption` IS the description

The Excel "Description" column maps to `scenes.caption` / manifest `t`. The column is **not**
renamed: 153 passing tests, `applyOverlay`, `useScenes`, the Level 4 engine and the manifest
builder all read `caption`/`t`, and a rename buys nothing this work needs.

`DarshanItem` gains `title`. It keeps `caption`. Agents must not introduce a third spelling
(`description`, `desc`, `text`) in any domain or service module.

## 4. Status

Already in the schema (`0004_rbac.sql`), already enforced:

```
DRAFT · VALIDATED · PUBLISHED · ACTIVE · DISABLED
```

- `scenes_sync_status` derives `active := status in ('PUBLISHED','ACTIVE')` on every write.
  Nothing in this work writes `active` directly; write `status` and let the trigger follow.
- The યુવક app's visible set is `VISIBLE = {PUBLISHED, ACTIVE}` (`src/lib/useScenes.js`).
- Import may set status. Import may **not** invent a status outside the five.

## 5. Permissions — existing only, nothing new

The RBAC in `0004_rbac.sql` / `0006_darshan_create.sql` / `shared/domain/permissions.js` is
**frozen**. This work adds no permission and no role. Map onto what exists:

| Action                     | Permission         |
| -------------------------- | ------------------ |
| view list / detail / export | `darshan.read`    |
| download template           | `darshan.read`    |
| edit title/desc/index/order | `darshan.update`  |
| Excel import (apply)        | `darshan.update`  |
| reorder                     | `darshan.update`  |
| add દ્રશ્ય                    | `darshan.create`  |
| set / replace the image link | `darshan.update` |
| disable / withhold          | `darshan.disable` |

> **CORRECTION (2026-08-12, after Agent A's report).** An earlier draft of this table listed
> `darshan.publish` for the image row. **That permission no longer exists.**
> `0009_darshan_drive_direct.sql` deleted the encoder and folded it into `darshan.update`
> — "setting the link IS the edit" — and re-declared `permissions_for()` without it. `create
> or replace` means the last definition wins, so `darshan.publish` is returned by nothing and
> is absent from `shared/domain/permissions.js` too. **A control gated on it would be
> permanently disabled for every role, SUPER_ADMIN included.** The five current દર્શન
> permissions are exactly: `darshan.read`, `darshan.create`, `darshan.update`,
> `darshan.disable` — plus nothing else.

Do not add `darshan.import`, `darshan.export`, `darshan.validate`, `darshan.publish` or
`darshan.image.replace`.
Each maps cleanly onto a permission that already exists and is already enforced in RLS; a new
name would need a migration, a matching edit to the UI copy, and would be checked nowhere the
old one was not.

The UI copy (`shared/domain/permissions.js`) and the SQL matrix (`permissions_for()`) must
stay identical — `npm run seed:admin:check` reports drift. Neither file is edited in this work.

## 6. Where master data lives — unchanged

```
Drive folder ──npm run darshan──> content/darshan.json   (manifest: id, n, order, url, t, driveId, file)
                                          │
public.scenes  (overlay: title, caption, index, order, status, image_url, drive_id)
                                          │
                          applyOverlay() ─┴─> one merged scene
                                          │
                        withDisplayIndex() ──> displayIndex 1…N
```

- The manifest is the master for **imagery and the sheet's original text**.
- `public.scenes` is the master for **everything a સંચાલક edits**, and rows may exist with no
  manifest entry (`sceneRowEntry`, 0006).
- `applyOverlay()` is the single merge point. Both apps go through it. Do not add a second.

## 7. `DarshanItem` — the shape after this work

```js
{
  id, index, order, active, status, reason,
  title,            // NEW — '' when not yet written
  caption,          // the description
  imageUrl, fullUrl, thumbUrl, driveId, file,
  source, updatedAt,
  sourceIndex, displayIndex,   // added by withDisplayIndex()
}
```
