# લેવલ ૪ — Dynamic Sub-Level System · FROZEN CONTRACT

> **This file is the contract between five agents building Level 4 in parallel.**
> Table names, column names, RPC signatures and JS export signatures below are **frozen**.
> An agent that needs to change one must say so in its report — it must not change it
> unilaterally, because four other agents are compiling against it.

Written 2026-08-12, against the repository as of commit `65e0eee`.

---

## 0. The four product decisions this is built on

Asked and answered before a line was written. They are not open:

| # | Decision |
|---|---|
| 1 | **Level 4 becomes a container.** The current flat 1→N list with the `'જવાબ જુઓ'` reveal is **removed**. `/level/4` shows activity cards (૪.૧, ૪.૨, …). |
| 2 | **Completion is permanent *and* the day is still scored.** Passing ૪.૧ unlocks ૪.૨ forever — midnight never takes it back. Every attempt also writes `progress.level4_score` for the IST day, so the સંચાલક dashboard keeps working unchanged. |
| 3 | **The gate is the સંચાલક's to set.** `require_gate` + `gate_threshold` live on the configuration. Default `true` / `80`, which reproduces today's behaviour exactly. Migration 0008's trigger is **not touched**. |
| 4 | **Version change carries over by item coverage.** A new activity counts as already complete when every દ્રશ્ય in it was covered by activities the યુવક already passed. Nothing is lost and nothing is falsely credited. |

---

## 1. What already exists (do not rebuild, do not break)

| Thing | Where | Note |
|---|---|---|
| Master દર્શન — content | `content/darshan.json`, `src/lib/scenes.js` | `ALL_SCENES` / `SCENES`, sorted by `order ?? n` |
| Master દર્શન — admin overlay | `public.scenes` (**`id` is `text`, the stable identity**) | **Sparse.** A દ્રશ્ય the સંચાલક never edited has **no row**. |
| Effective collection, યુવક side | `src/lib/useScenes.js` → `useScenes()` | manifest + overlay + two gates. `{ scenes, total, loading }` |
| Effective collection, admin side | `admin/…/darshan/services/darshanService.js` → `listDarshan()` | |
| Daily score | `public.progress (user_id, date, level3_score, level4_score)` | PK `(user_id, date)` |
| Level 4 unlock flag | `profiles.level4_unlocked`, trigger in `0008` | **Untouched by this work** |
| RBAC | `public.has_permission(text)`, `shared/domain/permissions.js` | **Reused. No new permission is added.** |
| Audit | `public.audit_logs` + triggers | Reused |
| Gujarati numerals | `src/lib/scenes.js` → `gu()`, `admin/src/lib/format.js` → `gu()` | |

### ⚠️ The sparse-overlay consequence

`level4_activity_items.scene_id` is **`text` with NO foreign key to `public.scenes`.** A FK
would reject every દ્રશ્ય the સંચાલક has never edited — which is most of them. "Invalid
item" (§7 D) is therefore validated against the **effective collection** in
`shared/domain/level4-selection.js`, in the admin UI, at save and at publish. This is a
deliberate, documented trade — do not "fix" it by adding the FK.

---

## 2. Database — `supabase/migrations/0010_level4_activities.sql` (Agent 1 owns)

### 2.1 Tables

```sql
public.level4_configs
  id             uuid primary key default gen_random_uuid()
  version        integer not null unique
  status         text not null default 'DRAFT'
                 check (status in ('DRAFT','VALIDATED','PUBLISHED','ARCHIVED'))
  title          text not null default ''
  require_gate   boolean not null default true
  gate_threshold integer not null default 80 check (gate_threshold >= 0)
  created_at timestamptz not null default now()
  created_by uuid references public.profiles(id)
  updated_at timestamptz not null default now()
  updated_by uuid references public.profiles(id)
  published_at timestamptz
  published_by uuid references public.profiles(id)
-- at most one published config, ever:
create unique index level4_one_published on public.level4_configs (status)
  where status = 'PUBLISHED';

public.level4_activities
  id          uuid primary key default gen_random_uuid()
  config_id   uuid not null references public.level4_configs(id) on delete cascade
  code        text not null check (code ~ '^[0-9]+\.[0-9]+$')     -- '4.1'
  title       text not null default ''
  description text not null default ''
  position    integer not null check (position > 0)
  active      boolean not null default true
  created_at, updated_at timestamptz not null default now()
  unique (config_id, code)                                        -- §7 C
  unique (config_id, position) deferrable initially deferred      -- reorder in one tx

public.level4_activity_items
  activity_id uuid not null references public.level4_activities(id) on delete cascade
  scene_id    text not null                    -- NO FK. See §1 above.
  position    integer not null check (position > 0)
  primary key (activity_id, scene_id)          -- §7 A, within an activity
  unique (activity_id, position) deferrable initially deferred

public.level4_activity_progress
  user_id     uuid not null references public.profiles(id) on delete cascade
  activity_id uuid not null references public.level4_activities(id) on delete cascade
  config_id   uuid not null references public.level4_configs(id) on delete cascade
  status      text not null default 'IN_PROGRESS'
              check (status in ('IN_PROGRESS','REVISION_REQUIRED','COMPLETED'))
  attempt_count  integer not null default 0 check (attempt_count >= 0)
  revision_count integer not null default 0 check (revision_count >= 0)
  completed_at timestamptz
  updated_at   timestamptz not null default now()
  primary key (user_id, activity_id)
-- LOCKED and AVAILABLE are DERIVED, never stored. No row = not started.

public.level4_attempts
  id          bigserial primary key
  user_id     uuid not null references public.profiles(id) on delete cascade
  activity_id uuid not null references public.level4_activities(id) on delete cascade
  config_id   uuid not null references public.level4_configs(id) on delete cascade
  selected_scene_ids text[] not null default '{}'
  selected_count integer not null check (selected_count >= 0)
  required_count integer not null check (required_count >= 0)
  passed      boolean not null
  at          timestamptz not null default now()
```

### 2.2 The derivation rules — frozen, and mirrored in JS

```
covered(user)   = union of item scene_ids of EVERY activity the user has an explicit
                  COMPLETED progress row for — any config, any version.
                  (This is what makes decision #4 work.)

completed(u, a) = explicit COMPLETED row  OR  (items(a) ≠ ∅ AND items(a) ⊆ covered(u))

gateOpen(u, c)  = (NOT c.require_gate)
                  OR exists (select 1 from progress
                             where user_id = u and level3_score >= c.gate_threshold)

status(u, a)    = LOCKED  if NOT gateOpen
                | COMPLETED if completed(u, a)
                | LOCKED  if any active activity at a lower position is not completed
                | REVISION_REQUIRED / IN_PROGRESS  if an explicit row says so
                | AVAILABLE  otherwise
```

### 2.3 RPCs — the only write path for a યુવક

All `security definer`, `set search_path = public`, `grant execute … to authenticated`.

| Function | Returns | Notes |
|---|---|---|
| `level4_published_config()` | `jsonb` or `null` | the PUBLISHED config + active activities + ordered `sceneIds`. No DRAFT ever leaves the database through this (§9). |
| `level4_state()` | `jsonb` | `auth.uid()`'s derived state for the published config. Never takes a uid argument. |
| `level4_submit(p_activity_id uuid, p_selected text[])` | `jsonb` | **the only way an attempt exists.** See below. |
| `level4_mark_revision(p_activity_id uuid)` | `jsonb` | `revision_count + 1`, same lock checks |
| `level4_publish(p_config_id uuid)` | `jsonb` | `has_permission('settings.update')`; atomic; audited |
| `level4_clone_config(p_config_id uuid)` | `uuid` | `has_permission('settings.update')`; deep copy → new DRAFT, `version = max+1` |

**`level4_submit` — the server-side checks that make §37 real.** In order, each raising a
distinct `errcode`/message so the client can tell them apart:

1. activity exists, is `active`, and belongs to the **PUBLISHED** config → else `level4_not_published`
2. `gateOpen` → else `level4_gate_closed`
3. every active activity at a lower `position` is `completed` → else `level4_locked`
4. `required := items(activity)`; `selected := distinct(p_selected) ∩ required`
5. `passed := (|selected| = |required| AND |required| > 0)`
6. insert `level4_attempts`
7. upsert `level4_activity_progress`: `attempt_count + 1`;
   `status := 'COMPLETED', completed_at := now()` if passed, else `'REVISION_REQUIRED'`.
   **A COMPLETED row is never demoted** — a later failed attempt on a passed activity
   leaves the status alone (§1 rule 4: a ધ્યાન already done is never taken away).
8. **daily score (decision #2):** upsert `public.progress` for
   `(now() at time zone 'Asia/Kolkata')::date` with
   `level4_score := greatest(existing, count(distinct scene_id across today's attempts))`.
   `greatest`, always — never lower a banked score.
9. returns `{"passed","selectedCount","requiredCount","status","attemptCount","nextActivityId"}`

### 2.4 RLS

| Table | Read | Write |
|---|---|---|
| `level4_configs`, `_activities`, `_activity_items` | `has_permission('settings.read')` **OR** the config is `PUBLISHED` | `has_permission('settings.update')` |
| `level4_activity_progress`, `level4_attempts` | own row, **or** `has_permission('progress.read')` | **nobody.** No INSERT/UPDATE policy for `authenticated` at all — the SECURITY DEFINER RPCs are the only writers. That is the whole point. |

---

## 3. JavaScript contracts — frozen signatures

### 3.1 `shared/domain/level4.js` — Agent 1

```js
export const L4_CONFIG_STATUS   = { DRAFT, VALIDATED, PUBLISHED, ARCHIVED }   // string enum
export const L4_ACTIVITY_STATUS = { LOCKED, AVAILABLE, IN_PROGRESS, REVISION_REQUIRED, COMPLETED }
export const DEFAULT_GATE_THRESHOLD          // = LEVEL4_UNLOCK_THRESHOLD, re-exported
export const activityCode      = (levelId, position) => string      // (4, 1) -> '4.1'
export const nextActivityCode  = (activities, levelId = 4) => string
export function toConfig(row)                 // snake_case row -> camelCase model
export function toActivity(row)
export function deriveStatuses({ activities, progressRows, coveredSceneIds, gateOpen })
  // pure JS mirror of §2.2, for optimistic UI. The database is still the authority.
```

### 3.2 `shared/domain/level4-selection.js` — Agent 3 (pure, no React, no Supabase)

```js
export function expandRange(collection, fromIndex, toIndex)   // -> sceneId[]
export function autoDivide(sceneIds, parts)                   // -> sceneId[][]  covers all, no gap, no overlap
export function findDuplicates(assignments)   // [{activityKey, sceneIds}] -> [{sceneId, activityKeys[]}]
export function findMissing(assignments, collection)          // -> sceneId[]
export function findInvalid(assignments, collection)          // -> sceneId[]  (unknown / not learnable / withheld)
export function validateAssignment({ assignments, collection, requireFullCoverage })
  // -> { ok, errors: [{code, gu, en, sceneIds?, activityKeys?}], warnings: [...] }
export function orderSceneIds(sceneIds, collection)           // stable, by collection order (§26)
export function searchScenes(collection, query)               // index number or વર્ણન substring
export function summarise(sceneIds, collection)               // -> { count, fromIndex, toIndex, contiguous }
```

`collection` is always `[{ id, index, order, t, url, ... }]` — exactly what `useScenes()`
and `listDarshan()` hand back. **No function in this file may reference a total, a count of
activities, or a code such as `'4.1'`.**

### 3.3 `src/lib/level4.js` — Agent 5 · the ONLY Supabase surface on the યુવક side

```js
export function useLevel4()
  // { loading, error, retry, config, activities, gateOpen, gateThreshold, allComplete }
  // activities: [{ id, code, title, description, position, sceneIds,
  //                status, attemptCount, revisionCount, completedAt }]
export function useLevel4Activity(activityId)
  // { loading, error, activity, scenes, status, canOpen }
  // `scenes` = full દર્શન entries for the activity, in configured order (§26)
export async function submitAttempt(activityId, selectedSceneIds)
  // -> { passed, selectedCount, requiredCount, status, nextActivityId }
export async function markRevision(activityId)
```

**Agent 4 makes no Supabase call of its own.** Everything goes through these.

### 3.4 `admin/src/features/level4/services/level4Service.js` — Agent 2

```js
listConfigs()                      getConfig(configId)
createConfig({ title, requireGate, gateThreshold })
updateConfig(configId, patch)      cloneConfig(configId)
publishConfig(configId)            archiveConfig(configId)
createActivity(configId, { code, title, description, position })
updateActivity(activityId, patch)  deleteActivity(activityId)
reorderActivities(configId, orderedActivityIds)
setActivityItems(activityId, sceneIds)   // replaces membership; position = array order
```

---

## 4. Routes

**યુવક** (Agent 4 owns `src/App.jsx`):

| Path | Component | Owner |
|---|---|---|
| `/level/4` | `src/modules/level4/Level4Page.jsx` — the activity cards | Agent 4 |
| `/level/4/:activityId` | `src/modules/level4/ActivityTestPage.jsx` — number + checkbox only | Agent 4 |
| `/level/4/:activityId/revision` | `src/modules/level4/RevisionPage.jsx` — image + વર્ણન | Agent 5 |

`/level/3` is unchanged. No route per sub-level, ever (§42).

**સંચાલક** (Agent 2 owns `admin/src/App.jsx`, `admin/src/app/AdminShell.jsx`):

| Path | Component | Gate |
|---|---|---|
| `/levels/4` | `Level4ListPage` | `settings.read` |
| `/levels/4/config/:configId` | `Level4EditorPage` | `settings.read` (mutations need `settings.update`) |

NAV entry: `{ to: '/levels/4', label: 'Level 4', icon: '⌗', need: 'settings.read' }`

---

## 5. File ownership — nobody edits another agent's file

| Agent | Owns (creates / edits) |
|---|---|
| **1 — Data** | `supabase/migrations/0010_level4_activities.sql`, `shared/domain/level4.js` |
| **2 — Admin builder** | `admin/src/features/level4/**`, `admin/src/App.jsx`, `admin/src/app/AdminShell.jsx` |
| **3 — Selection engine** | `shared/domain/level4-selection.js`, `scripts/test-level4.mjs` |
| **4 — યુવક Level 4** | `src/modules/level4/Level4Page.jsx`, `src/modules/level4/ActivityTestPage.jsx`, `src/modules/level4/level4.css`, `src/App.jsx`, `src/modules/levels/LevelPage.jsx`, `src/pages/Home.jsx` |
| **5 — Revision + progress** | `src/lib/level4.js`, `src/modules/level4/RevisionPage.jsx` |
| **Integration (Claude)** | `package.json`, `LEVEL4.md`, `PLAN.md`, `ADMIN.md`, final wiring |

### 🔒 Files NOBODY touches

`src/lib/progress.js` · `src/lib/auth.jsx` · `src/lib/stages.js` · `src/lib/learning.jsx` ·
`src/lib/useScenes.js` · `src/lib/scenes.js` · `shared/domain/permissions.js` ·
`shared/domain/darshan.js` · `supabase/migrations/0001`–`0009` ·
`src/modules/darshan/**` · `src/modules/learning/**` · `netlify/**` · `scripts/build-darshan.mjs`

If your work seems to require one of these, **stop and report it** — do not edit it.

---

## 6. Rules every agent obeys

1. **No hard-coded totals.** Never `110`, `109`, `108`, `const TOTAL =`, `if (total === …)`.
   Counts come from the collection or from the activity's own item list.
2. **No hard-coded activity codes.** Never `if (code === '4.1')`. Behaviour is data-driven.
3. **No answer on the test screen** (§12, §13). `ActivityTestPage` renders the index number
   and a checkbox. It must not import a scene's `t`, `url`, `imageUrl` or `driveId` —
   not hidden by CSS, *not fetched at all*.
4. **Pass = every required item checked** (§15). No correctness comparison anywhere.
5. **Revision uses the existing image pipeline.** Reuse the દર્શન card/lightbox approach —
   `entry.url` for the feed, `w2560` for the lightbox. **No PDF. No thumbnails. No re-encode.**
   Current image eager, next prefetched, rest lazy (§32).
6. **યુવક UI is entirely Gujarati**, numerals through `gu()`. **સંચાલક panel is English**,
   matching every existing admin page.
7. **ફક્ત આનંદ, નિરાશા નહીં** (§1 rule 4). An incomplete attempt is an invitation to revise,
   never a failure, never red, never a count of what is missing.
8. **Nothing red on the યુવક side.** Reuse the existing token palette in `src/index.css`.
9. Comment *why*, in the voice of the surrounding code. Match its density and idiom.
10. Do not run `git commit`, `git push`, or any migration against the live database.
