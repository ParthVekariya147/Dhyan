# Admin progress data map - what is actually recorded

Written 2026-08-14, after an audit run against the live production database. This is a
reference for anyone building a progress or reporting screen in `admin/`. It says which
tables carry a યુવક's journey, who writes them, and what the database cannot answer at all.

Every structural claim below cites `file:line`. Row counts are production counts at the time
of the audit and are given so that "this table is empty" is a measurement rather than an
opinion.

---

## 1. The two progress systems

There are two. Only one of them is alive.

| | OLD (dead) | LIVE |
|---|---|---|
| Tables | `learning_state`, `learning_sessions` | `activity_attempts`, `daily_activity_progress`, `progress`, `level4_attempts`, `level4_activity_progress`, `point_transactions` |
| Created by | `0001_init.sql:69-90`, extended `0002_learning_fields.sql:7-14` | `0010_level4_activities.sql`, `0021_progress_history_points.sql`, `0025_level4_submit_idempotency.sql`, `0026_progress_level4_guard.sql` |
| Written by | `src/lib/learning.jsx:56-63` (client upsert) | `activity_submit()`, `level4_submit()`, `award_points()` - all SECURITY DEFINER |
| Reached from | `/learn` only (`src/App.jsx:598-609`) | every screen a યુવક actually uses |
| Production rows | **0** and **0** | 53 / 39 / 14 / 19 / 16 / 35 |

### 1.1 Why the old system is dead

`learning_state` and `learning_sessions` are written from exactly one place:
`saveState()` at `src/lib/learning.jsx:56-57` and `saveSession()` at
`src/lib/learning.jsx:59-63`. Both live inside the `LearningProvider` context, whose only
consumer is `src/modules/learning/LearningPage.jsx:3,24`, which is mounted by exactly one
route: `src/App.jsx:598-609`, `path="/learn"`.

Nothing links to that route.

- No `<Link to="/learn">` and no `navigate('/learn')` exists anywhere in `src/`.
- The home screen used to open it and no longer does - `src/pages/Home.jsx:171` records the
  removal in its own comment, and the primary button now goes to `LEVEL_CODE[1].to`
  (`src/pages/Home.jsx:183`).
- `/learn` is not in `DEFAULT_MOBILE_NAV` (`shared/domain/navigation.js:670-675`). It survives
  only as an opt-in destination a સંચાલક could attach to a custom nav button
  (`shared/domain/navigation.js:335-337`, seeded at
  `supabase/migrations/0028_custom_navigation.sql:178`).
- The comment at `shared/domain/navigation.js:329-333` still says the journey "is reached from
  the મુખપૃષ્ઠ and from nowhere else". That sentence is stale; `Home.jsx:171` contradicts it.

So the route is served, is reachable by typing the URL, and is reached by nothing else. The
production row counts agree: **`learning_state` 0 rows, `learning_sessions` 0 rows.**

### 1.2 Why the admin sees nothing

The admin `/progress` page reports on the dead tables exclusively.

- `admin/src/features/progress/pages/ProgressPage.jsx:4-5` imports `listProgress` and
  `pendingHotspots` from `learningService`, and `rememberedAtLeast` / `subZoneRegularity`
  from `reportService`.
- `admin/src/features/progress/services/reportService.js:43-44` -
  `const LEARNING = 'learning_state'; const SESSIONS = 'learning_sessions';`
- `admin/src/features/learning/services/learningService.js:54-55` - the same two constants.
- The queries: `learningService.js:59`, `:67`, `:89`, `:155`, `:204`, `:255`, `:280`;
  `reportService.js:100`, `:216`.
- `ProgressPage.jsx:501-502` tells the સંચાલક in its own copy that the numbers come from
  `learning_state` and `learning_sessions.submitted_at`.

Every one of those queries is against a table with no rows. The page is not broken; it is
pointed at a system nobody uses. The same is true of
`admin/src/features/dashboard/services/dashboardService.js:79`,
`admin/src/features/sessions/pages/SessionsPage.jsx` and
`admin/src/features/users/pages/UserDetailPage.jsx:33-34`.

### 1.3 The rule

**Do not rebuild the old system, and do not backfill it.**

There is nothing to backfill *from*: the two systems record different facts. `learning_state`
holds one lifetime row per યુવક with a stage enum and three id arrays;
`activity_attempts` holds one append-only row per submission per day with a business date, an
attempt number and an idempotency token. Deriving the first from the second would invent a
`current_stage` that no code path ever set, and would put data into tables that the live app
would immediately stop maintaining.

The correct fix is to re-point the admin reports at the live tables named in §2. The dead
tables stay where they are, empty, until somebody deletes them in a migration of their own.

---

## 2. Table by table

Every table in this section has RLS enabled. "Client can write" means: a browser holding an
ordinary `authenticated` token can reach the table through PostgREST and change a row.

### 2.1 `public.profiles`

`0001_init.sql:17-39`, plus `0004_rbac.sql:175-177` and `0027_smk_optional.sql:36`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | not null | PK, FK `auth.users(id) on delete cascade` |
| `smk` | text | **null** | UNIQUE, check `^[A-Z]{3}[0-9]{3}$`. Made nullable by `0027:36`; write-once thereafter (`0027:58-60`) |
| `name` | text | not null | check `length(trim(name)) > 0` |
| `email` | text | not null | immutable after insert (`0027:51-53`) |
| `mobile` | text | not null | UNIQUE, check `^[6-9][0-9]{9}$`, immutable (`0027:48-50`). Decides સંચાલક access |
| `zone_id` | text | not null | default `'surat'` |
| `sub_zone_id` | text | not null | check in `('vedroad','varachha','navsari')` |
| `like_answer` | boolean | not null | default false |
| `comment_answer` | boolean | not null | default false |
| `gate_passed_at` | timestamptz | null | |
| `level4_unlocked` | boolean | not null | default false. Guarded by `profiles_guard_level4()` (`0008:200-228`) |
| `created_at` | timestamptz | not null | default now(), immutable (`0027:61-63`) |
| `updated_at` | timestamptz | not null | default now(), stamped by `profiles_guard_immutable()` (`0027:64`) |
| `status` | text | not null | default `'ACTIVE'`, check in `('ACTIVE','SUSPENDED','DISABLED')` - `0004:175-177` |

- **PK** `(id)`. **Unique** `smk`, `mobile`. **FK** `id -> auth.users(id)`.
- **Indexes** - the PK and the two unique constraints only. No secondary index exists on this
  table in any migration.
- **Writes**: the browser, at registration and profile edit (`src/lib/auth.jsx`). Policies
  `0004:591-596` allow `id = auth.uid()` or `has_permission('users.update')`. Triggers
  `profiles_guard_immutable` (`0001:184-185`, replaced `0027:43-67`),
  `profiles_guard_level4` (`0008:226-228`), `profiles_guard_status` (`0017_profiles_guard_status.sql:75-76`),
  `profiles_guard_reserved_mobile` (`0024:233-234`).
- **Reads**: everything. `is_active_user()` (`0004:181-192`) gates every write RPC on
  `status = 'ACTIVE'`.
- **Client can write**: **yes**, own row.
- Production rows: **89**.

### 2.2 `public.progress`

`0001_init.sql:46-54`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `user_id` | uuid | not null | FK `profiles(id) on delete cascade` |
| `date` | date | not null | the IST business day |
| `level3_score` | integer | not null | default 0, check `>= 0` |
| `level4_score` | integer | not null | default 0, check `>= 0` |
| `updated_at` | timestamptz | not null | default now() |

- **PK** `(user_id, date)`. **Index** `progress_date_idx (date desc)` - `0001:60`.
- There is deliberately no `<= 108` ceiling (`0001:56-58`).
- **Writes - two of them, and they do not agree:**
  1. **The browser.** `progressRows()` at `src/lib/progress.js:219-229` builds
     `{ user_id, date, level3_score, updated_at }` and it is upserted at
     `src/lib/progress.js:366-368` (`onConflict: 'user_id,date'`) or, on page teardown, by the
     raw keepalive `fetch` at `src/lib/progress.js:255-269`. Allowed by
     `0004:605-610`.
  2. **`level4_submit()`**, at `0025:328-332`, which writes `level4_score` only, as
     `greatest(progress.level4_score, excluded.level4_score)`.
- **Triggers**: `progress_unlock_level4` / `progress_unlock_level4_upd` (`0008:165-175`) set
  `profiles.level4_unlocked` when `level3_score` crosses the threshold;
  `progress_guard_level4_score` (`0026:102-104`) pins `level4_score` to
  `greatest(new, old)` on UPDATE.
- **Reads**: `level4_gate_open(uuid)` (`0014:122-137`) - `level3_score >= gate_threshold`;
  the baseline read at `src/lib/progress.js:511-516`; the admin panel.
- **Client can write**: **yes**, `user_id` and `date` unrestricted as to date. This is
  `AUDIT.md:351` (finding F2), knowingly accepted, argued at `0008:36-42`.
- Production rows: **14**.

> **`level3_score` is not a trustworthy remembered count.** It is client-written and
> unguarded. One real production row holds `level3_score = 110`, above the live maximum of
> 108. `level4_score` is different: `0026` pins it, so it cannot be lowered by a stale tab.
> Use the expression in §5.1 instead.

### 2.3 `public.activity_attempts`

`0021_progress_history_points.sql:97-139`. Every લેવલ ૧-૩ submission, append-only.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | bigserial | not null | PK |
| `user_id` | uuid | not null | FK `profiles(id) on delete cascade` |
| `level_id` | integer | not null | check `between 1 and 3` |
| `activity_key` | text | not null | check in `('video','darshan','revision')` |
| `activity_date` | date | not null | IST business day, server-computed (`0021:780`) |
| `attempt_number` | integer | not null | check `> 0`, 1-based, server-computed |
| `selected_scene_ids` | text[] | not null | default `'{}'`. **No FK to `scenes`** - `0021:88-91` |
| `total_items` | integer | not null | default 0, check `>= 0`. Recorded, never looked up (`0021:168-170`) |
| `completed_items` | integer | not null | default 0, check `>= 0` |
| `status` | text | not null | check in `('COMPLETED','REVISION_REQUIRED')` |
| `client_token` | uuid | **null** | the caller's idempotency key |
| `submitted_at` | timestamptz | not null | default now() |

- **PK** `(id)`.
- **Unique** `activity_attempts_number_unique (user_id, level_id, activity_key, activity_date, attempt_number)` - `0021:129-130`.
- **Check** `activity_attempts_level_key_agree` - the pair must be one of
  `(1,'video')`, `(2,'darshan')`, `(3,'revision')` - `0021:137-138`.
- **Indexes**: `activity_attempts_token_idx (user_id, client_token) where client_token is not null` (unique, `0021:146-148`);
  `activity_attempts_user_date_idx (user_id, activity_date desc)` (`0021:154`);
  `activity_attempts_user_at_idx (user_id, submitted_at desc)` (`0021:155`).
- **Writes**: `activity_submit()` only - `0021:851-863`. One client call site:
  `src/lib/activity.js:184-190`.
- **Reads**: `attempt_history` view (`0021:1147-1210`); `activity_submit()`'s own recount
  (`0021:907-919`).
- **Client can write**: **no**. Read policy only (`0021:1411-1412`), and
  `revoke insert, update, delete ... from anon, authenticated` at `0021:1424`.
- Production rows: **53**.

> **Only level 3 carries per-item data.** `selected_scene_ids` is populated for
> `level_id = 3` (9 of 11 rows at audit, max 103 ids, `total_items` 108). Levels 1 and 2 carry
> an empty array and `total_items = 0`, because `recordActivity()` sends
> `{ selected: [], total: 0 }` at `src/lib/activity.js:211-212`, and because
> `activity_submit()` marks levels 1 and 2 COMPLETED unconditionally (`0021:826-827`). "Which
> images does this યુવક remember" is a **level 3** question and has no level 2 answer.

### 2.4 `public.daily_activity_progress`

`0021:190-217`. One row per (યુવક, day, level, activity). Recounted in full on every submit,
never incremented (`0021:176-180`).

| Column | Type | Null | Notes |
|---|---|---|---|
| `user_id` | uuid | not null | FK `profiles(id) on delete cascade` |
| `activity_date` | date | not null | |
| `level_id` | integer | not null | check `between 1 and 3` |
| `activity_key` | text | not null | check in `('video','darshan','revision')` |
| `total_items` | integer | not null | default 0, check `>= 0` |
| `completed_items` | integer | not null | default 0, check `>= 0`. The size of the day's **union**, not `max()` - `0021:927-946` |
| `completed_scene_ids` | text[] | not null | default `'{}'`. Union across the day's attempts |
| `attempt_count` | integer | not null | default 0, check `>= 0` |
| `status` | text | not null | default `'REVISION_REQUIRED'`, check in `('COMPLETED','REVISION_REQUIRED')`. `bool_or` over an append-only set, so it cannot demote (`0021:206-208`) |
| `started_at` | timestamptz | not null | default now(), `least()`-merged |
| `completed_at` | timestamptz | **null** | first COMPLETED attempt, coalesced and never moved (`0021:228-231`) |
| `updated_at` | timestamptz | not null | default now() |

- **PK** `(user_id, activity_date, level_id, activity_key)` - `0021:216`.
- **Index** `daily_activity_progress_user_date_idx (user_id, activity_date desc)` - `0021:219-220`.
- **No FK** other than `user_id`.
- **Writes**: `activity_submit()` step 8 only - `0021:920-962`.
- **Reads**: the `activity_history` view (`0021:1226-1292`).
- **Client can write**: **no**. `0021:1414-1415` and `0021:1425`.
- There is **no reset job**. A new IST day simply has no row (`0021:182-185`).
- Production rows: **39**.

### 2.5 `public.level4_attempts`

`0010_level4_activities.sql:213-227`, plus `client_token` from `0025:76-77`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | bigserial | not null | PK |
| `user_id` | uuid | not null | FK `profiles(id) on delete cascade` |
| `activity_id` | uuid | not null | FK `level4_activities(id) on delete cascade` |
| `config_id` | uuid | not null | FK `level4_configs(id) on delete cascade` |
| `selected_scene_ids` | text[] | not null | default `'{}'`. **Already intersected** with the activity's effective items (`0010:219-222`, `0025:264-267`) |
| `selected_count` | integer | not null | check `>= 0` |
| `required_count` | integer | not null | check `>= 0` |
| `passed` | boolean | not null | `selected_n >= required_n and required_n > 0` (`0025:274`) |
| `at` | timestamptz | not null | default now() |
| `client_token` | uuid | **null** | `0025:76-77` |

- **PK** `(id)`. **No** `attempt_number` column - it is derived by `row_number()` in the
  `attempt_history` view (`0021:1197-1202`).
- **Indexes**: `level4_attempts_user_idx (user_id, at desc)` (`0010:229`);
  `level4_attempts_activity_idx (activity_id, at desc)` (`0010:230`);
  `level4_attempts_token_idx (user_id, client_token) where client_token is not null` (unique, `0025:87-89`).
- **Writes**: `level4_submit()` only - `0025:284-288`. One client call site:
  `src/lib/level4.js:720-738`, from `src/modules/level4/ActivityTestPage.jsx:268`.
- **Trigger**: `level4_attempts_award` - AFTER INSERT `when (new.passed)`, `0021:1096-1100`,
  which is how લેવલ ૪ is paid.
- **Client can write**: **no**. `0010:1379-1380` read policy, `0010:1387` revoke.
- Production rows: **19**.

### 2.6 `public.level4_activity_progress`

`0010:182-199`. One row per (યુવક, activity), only for activities he has touched.

| Column | Type | Null | Notes |
|---|---|---|---|
| `user_id` | uuid | not null | FK `profiles(id) on delete cascade` |
| `activity_id` | uuid | not null | FK `level4_activities(id) on delete cascade` |
| `config_id` | uuid | not null | FK `level4_configs(id) on delete cascade`. Denormalised (`0010:186-188`) |
| `status` | text | not null | default `'IN_PROGRESS'`, check in `('IN_PROGRESS','REVISION_REQUIRED','COMPLETED')` |
| `attempt_count` | integer | not null | default 0, check `>= 0` |
| `revision_count` | integer | not null | default 0, check `>= 0` |
| `completed_at` | timestamptz | **null** | first pass, coalesced, never moved (`0025:316`) |
| `updated_at` | timestamptz | not null | default now() |

- **PK** `(user_id, activity_id)` - `0010:198`.
- **Indexes**: `level4_progress_activity_idx (activity_id)` (`0010:201`);
  `level4_progress_config_idx (config_id, user_id)` (`0010:202`).
- **Writes**: `level4_submit()` (`0025:302-318`) and `level4_mark_revision()`
  (`0010:873-880`). Nothing else.
- **Reads**: `level4_activity_states()` (`0012_level4_repeat_access.sql:98-100`),
  `level4_covered_scene_ids()` (`0010:319-322`),
  `level4_completed_activity_ids()` (`0010:386-392`).
- **Client can write**: **no**. `0010:1376-1377` read policy, `0010:1386` revoke.
- **LOCKED and AVAILABLE are not in this table** and never are - `0010:178-181`.
- Production rows: **16**.

### 2.7 `public.level4_activities`

`0010:111-143`, plus `required_count` from `0016_level4_one_attempt.sql:47-49`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | not null | PK, default `gen_random_uuid()` |
| `config_id` | uuid | not null | FK `level4_configs(id) on delete cascade` |
| `code` | text | not null | check `^[0-9]+\.[0-9]+$`. `'4.1'`. The stable identity across republication (`0010:115-117`, `0021:253-257`) |
| `title` | text | not null | default `''` |
| `description` | text | not null | default `''` |
| `position` | integer | not null | check `> 0`. Presentation order, and therefore the unlock order |
| `active` | boolean | not null | default true. Withheld, not deleted (`0010:126-128`) |
| `created_at` | timestamptz | not null | default now() |
| `updated_at` | timestamptz | not null | default now(), stamped by `level4_activities_stamp` (`0010:1134`) |
| `required_count` | integer | **null** | check `null or >= 1`. NULL means "all of them" (`0016:51-54`) |

- **Unique** `level4_activities_code_unique (config_id, code)` (`0010:134`);
  `level4_activities_position_unique (config_id, position) deferrable initially deferred` (`0010:141-142`).
- **Index** `level4_activities_config_idx (config_id, position)` - `0010:145`.
- **Writes**: the admin panel, `admin/src/features/level4/**`, under
  `has_permission('settings.update')` (`0010:1327-1338`), and `level4_clone_config()`
  (`0010:1028`). Frozen once the config is PUBLISHED by `level4_guard_editable()`
  (`0010:1183-1232`).
- **Reads**: `level4_effective_items()`, `level4_activity_states()`, `level4_submit()`,
  `attempt_history` (LEFT JOIN, `0021:1209`), `point_ledger` (`0021:1321-1329`).
- **Client can write**: only a સંચાલક holding `settings.update`. A યુવક can read a PUBLISHED
  config's activities (`0010:1318-1325`).
- Production rows: **32** across 9 configs. The PUBLISHED config (version 7) has 4 active
  activities, 4.1 to 4.4, 27 items each.
- Its membership table is `public.level4_activity_items` (`0010:157-167`), PK
  `(activity_id, scene_id)`, no FK to `scenes` (`0010:169-172`).

### 2.8 `public.level4_configs`

`0010:69-90`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | not null | PK, default `gen_random_uuid()` |
| `version` | integer | not null | UNIQUE |
| `status` | text | not null | default `'DRAFT'`, check in `('DRAFT','VALIDATED','PUBLISHED','ARCHIVED')` |
| `title` | text | not null | default `''` |
| `require_gate` | boolean | not null | default true. **Superseded** - see below |
| `gate_threshold` | integer | not null | default 80, check `>= 0`. **Superseded** - see below |
| `created_at` | timestamptz | not null | default now() |
| `created_by` | uuid | null | FK `profiles(id)` |
| `updated_at` | timestamptz | not null | default now(). Also the concurrency token (`0010:103-106`) |
| `updated_by` | uuid | null | FK `profiles(id)` |
| `published_at` | timestamptz | null | |
| `published_by` | uuid | null | FK `profiles(id)` |

- **Unique index** `level4_one_published on (status) where status = 'PUBLISHED'` - `0010:96-97`.
  At most one PUBLISHED row, ever.
- **Superseded columns.** Since `0014_level4_gate_setting.sql` the gate is
  `settings['levels'].value.level4Gate`, not a property of the configuration.
  `level4_gate_open(uuid)` reads `level4_gate_setting()` (`0014:122-137`), and the
  two-argument form checks only that the config exists (`0014:153-162`, and its own comment at
  `0014:166-169` says `p_config` is IGNORED). **Do not report `require_gate` or
  `gate_threshold` from this table** - they no longer decide anything.
- **Writes**: the admin panel under `settings.update` (`0010:1308-1313`), plus
  `level4_publish()` (`0010:915`) and `level4_clone_config()` (`0010:1028`). Trigger
  `level4_configs_stamp` (`0010:1118`), `level4_configs_guard` (`0010:1172`),
  `audit_level4_configs` (`0010:1282`).
- **No delete policy.** Versions are archived, never removed (`0010:1315-1316`).
- **Client can write**: no, unless સંચાલક with `settings.update`. A યુવક may read only the
  PUBLISHED row (`0010:1305-1306`).
- Production rows: **9**. Published version: **7**.

### 2.9 `public.point_transactions`

`0021:246-311`. The ledger. Append-only, and the only table that is money.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | bigserial | not null | PK |
| `user_id` | uuid | not null | FK `profiles(id) on delete cascade` |
| `activity_date` | date | not null | IST business day |
| `level_id` | integer | not null | check `between 1 and 4` |
| `activity_key` | text | not null | default `''`. `'video'`/`'darshan'`/`'revision'` for 1-3, `level4_activities.code` for 4 |
| `points` | integer | not null | check `>= 0`. The number that was paid, not a pointer to the rule (`0021:243-245`) |
| `source` | text | not null | check in `('ACTIVITY_ATTEMPT','LEVEL4_ATTEMPT')` |
| `source_id` | bigint | not null | **Polymorphic, no FK** - `activity_attempts.id` or `level4_attempts.id` (`0021:237-241`) |
| `attempt_number` | integer | not null | default 0. Recorded only; nothing decides from it |
| `created_at` | timestamptz | not null | default now() |

- **Unique** `point_transactions_day_unique (user_id, activity_date, level_id, activity_key)` -
  `0021:309-310`. This constraint, not any function, is the at-most-once-per-day guarantee.
  `activity_key` is `not null default ''` precisely so that NULLs cannot make the key distinct
  from itself (`0021:259-261`).
- **Indexes**: `point_transactions_user_date_idx (user_id, activity_date desc)` (`0021:313`);
  `point_transactions_user_at_idx (user_id, created_at desc)` (`0021:314`).
- **Writes**: `award_points()` only - `0021:688-694`. Zero client call sites; the function is
  `revoke all ... from public` with no grant (`0021:702`).
- **Reads**: `point_ledger` view (`0021:1308-1329`), `my_point_summary()` (`0021:1357-1380`).
- **Client can write**: **no**. `0021:1417-1418` read policy, `0021:1425` revoke.
- Production rows: **35**.

---

## 3. The chain

Each hop names the table and the column that actually carries it.

```
   યુવક
    │  profiles.id  (= auth.uid())    profiles.status must be 'ACTIVE'   0004:181-192
    │
    ├─ લેવલ ૧  વિડિયો ─────────────────────────────────────────────────────────────
    │    EntryGate.jsx:113-115  recordActivity(ACTIVITY_KEY.VIDEO)
    │    → activity_submit(1, 'video', [], 0, token)          src/lib/activity.js:184
    │    → activity_attempts   level_id=1 · activity_key='video'
    │                          selected_scene_ids='{}' · total_items=0
    │                          status='COMPLETED' unconditionally      0021:826-827
    │
    ├─ લેવલ ૨  દર્શન ───────────────────────────────────────────────────────────────
    │    DarshanPage.jsx:75     recordActivity(ACTIVITY_KEY.DARSHAN)
    │    → activity_attempts   level_id=2 · activity_key='darshan'
    │                          selected_scene_ids='{}' · total_items=0
    │
    ├─ લેવલ ૩  પુનરાવર્તન ──────────────────────────────────────────────────────────
    │    LevelPage.jsx:221-228  submitActivity({ selected: [...P.ticked3], total })
    │            total ← useScenes().total  (useScenes.js:258, scenes.length)
    │    → activity_attempts   level_id=3 · activity_key='revision'
    │                          selected_scene_ids=<the ticked ids>   ← THE ONLY per-item data
    │                          total_items=108 · completed_items=|distinct ids|
    │                          status = COMPLETED when completed_n >= total_n   0021:828-831
    │    → progress.level3_score  ALSO written separately by the client
    │                             progress.js:219-229 → :366-368
    │
    │        level3_score >= gate_threshold
    │            ├→ profiles.level4_unlocked := true    trigger 0008:165-175
    │            └→ level4_gate_open(uid) = true        0014:122-137
    │
    └─ લેવલ ૪  કસોટીઓ ─────────────────────────────────────────────────────────────
         level4_configs (status='PUBLISHED', one row)     0010:96-97
           └─ level4_activities (code '4.1'…, position, active, required_count)
                └─ level4_activity_items (activity_id, scene_id, position)
                     └─ level4_effective_items()  minus withheld scenes   0010:273-289

         ActivityTestPage.jsx:268 → level4_submit(activity_id, selected, token)
                                        src/lib/level4.js:720-738
           ├─ selected ∩ effective_items          0025:264-267
           ├─ passed := selected_n >= required_n and required_n > 0      0025:274
           ├─ level4_attempts        (+ selected_scene_ids, selected_count,
           │                            required_count, passed, at, client_token)
           ├─ level4_activity_progress.status
           │     passed → 'COMPLETED'   (never demoted, 0025:312-315)
           │     else   → 'REVISION_REQUIRED'
           │     attempt_count += 1 · completed_at coalesced
           └─ progress.level4_score := greatest(old, count(distinct today's ticks))  0025:320-332

  ─── passed / failed / revision ──────────────────────────────────────────────────
     લેવલ ૧-૩   activity_attempts.status          'COMPLETED' | 'REVISION_REQUIRED'
     લેવલ ૪     level4_attempts.passed            boolean
                level4_activity_progress.status   'IN_PROGRESS' | 'REVISION_REQUIRED' | 'COMPLETED'
                level4_activity_progress.revision_count   ← level4_mark_revision()  0010:873-880

  ─── daily history ───────────────────────────────────────────────────────────────
     activity_submit() step 8 recounts the whole day       0021:907-962
       → daily_activity_progress (user_id, activity_date, level_id, activity_key)
           completed_scene_ids = union across the day
           completed_items     = |that union|
           attempt_count       = count(*) of the day's attempts
           status              = bool_or(attempt.status = 'COMPLETED')
     લેવલ ૪ has NO daily table. There is no date column on level4_activity_progress
     at all, which is what makes midnight structurally unable to reach it   0021:187-189

  ─── points ──────────────────────────────────────────────────────────────────────
     લેવલ ૧-૩   activity_submit() step 9, only when att.status='COMPLETED'   0021:970-975
     લેવલ ૪     trigger level4_attempts_award AFTER INSERT when (new.passed)  0021:1096-1100
                  keyed by level4_activities.code, not activity_id            0021:1053-1059
       both → award_points(user, date, level, key, source, source_id, attempt)
                → point_transactions, ON CONFLICT DO NOTHING over
                  point_transactions_day_unique                               0021:688-694
```

---

## 4. The write paths

Five writers reach a progress table. Three are server-side and unforgeable; two are the
browser.

### 4.1 `activity_submit()` - server, the only writer of a લેવલ ૧-૩ attempt

`0021:723-1014`.

```sql
public.activity_submit(
  p_level    integer,
  p_activity text,
  p_selected text[],
  p_total    integer,
  p_token    uuid default null
) returns jsonb
language plpgsql security definer set search_path = public
```

`revoke all ... from public` then `grant execute ... to authenticated` (`0021:1013-1014`).
Called from `src/lib/activity.js:184-190`, and from nowhere else.

Guarantees:

1. Signed in and `is_active_user()`, else `activity_not_signed_in` / `activity_not_active`
   (`0021:754-760`). SECURITY DEFINER bypasses RLS, so this check is the gate.
2. The `(level, activity)` pair is one of the three, else `activity_unknown` (`0021:767-772`).
3. **The business day is the server's**, `timezone('Asia/Kolkata', now())::date`, never taken
   from the caller (`0021:780`).
4. **Idempotent** on `p_token`: a replay returns the original attempt and creates nothing
   (`0021:790-797`, and the `unique_violation` handler at `0021:867-883`).
5. `selected` is deduped and blank-stripped; `total_n := greatest(p_total, completed_n, 0)`,
   so under-reporting the total cannot fake a completion (`0021:807-817`).
6. `attempt_number` is computed inside the INSERT, retried up to 5 times against
   `activity_attempts_number_unique` (`0021:847-890`).
7. `daily_activity_progress` is **recounted in full** and never incremented (`0021:907-962`).
8. Points only for a COMPLETED attempt (`0021:970-975`).

Returns `{ attemptNumber, activityDate, completedItems, totalItems, status, pointsAwarded,
todayPoints, totalPoints }` (`0021:1000-1009`).

### 4.2 `level4_submit()` - server, the only writer of a લેવલ ૪ attempt

`0025:169-362`. The 2-argument form from `0010`/`0012`/`0016`/`0017` is dropped at `0025:167`
so PostgREST cannot see two candidates.

```sql
public.level4_submit(
  p_activity_id uuid,
  p_selected    text[],
  p_token       uuid default null
) returns jsonb
language plpgsql security definer set search_path = public
```

`grant execute ... to authenticated` (`0025:362`). Called from `src/lib/level4.js:720-738`.

Guarantees:

1. Signed in and active (`0025:198-204`).
2. **Replay first, before any access test** (`0025:213-221`) - a retry of an accepted
   submission is never re-judged, so a moved gate cannot take back a passed કસોટી.
3. The activity is active and belongs to the PUBLISHED config, else `level4_not_published`
   (`0025:223-233`).
4. Gate and sequential unlock, both skipped if he has already passed it
   (`0025:237-259`) - `level4_gate_closed`, `level4_locked`.
5. `selected` is intersected with `level4_effective_items()`, so the row can never disagree
   with `selected_count` beside it (`0025:261-270`).
6. `passed := selected_n >= required_n and required_n > 0` (`0025:274`).
7. The attempt is always recorded; the `unique_violation` handler replays (`0025:283-299`).
8. **A COMPLETED progress row is never demoted** (`0025:312-315`); `completed_at` is coalesced.
9. `progress.level4_score` is counted from the day's attempts and merged with `greatest`
   (`0025:320-332`).

### 4.3 `award_points()` - server, the only writer of the ledger

`0021:660-702`.

```sql
public.award_points(
  p_user      uuid,
  p_date      date,
  p_level     integer,
  p_key       text,
  p_source    text,
  p_source_id bigint,
  p_attempt   integer
) returns integer
language plpgsql security definer set search_path = public
```

`revoke all ... from public` and **no grant at all** (`0021:702`). It takes a `p_user`, so an
execute grant would be a way for one યુવક to pay another. Its only callers are
`activity_submit()` (`0021:971-974`) and the `level4_attempts_award` trigger
(`0021:1078-1086`).

Guarantees:

- Resolves the value through `point_value_for()` and returns 0 without writing anything when
  the value is `<= 0` (`0021:682-686`). **No zero row is ever written.**
- One INSERT with `on conflict (user_id, activity_date, level_id, activity_key) do nothing`
  and **deliberately no existence check** (`0021:688-694`). The unique constraint decides the
  race; the function only reports which side of it it landed on.
- Returns what was actually written - 0 both when the day is already paid and when the value
  is 0. A second completed attempt earning 0 is not a failure (`0021:299-308`).

### 4.4 The `progress` upsert - browser

`src/lib/progress.js:219-229` builds the row:

```js
export function progressRows(uid, outbox, at = new Date().toISOString()) {
  return Object.entries(outbox).map(([date, s]) => ({
    user_id: uid,
    date,
    level3_score: s.l3,
    updated_at: at,
  }));
}
```

Two transports, same URL and same policy:

- `supabase.from('progress').upsert(rows, { onConflict: 'user_id,date' })` -
  `src/lib/progress.js:366-368`
- a raw `fetch` with `keepalive: true` and
  `Prefer: 'resolution=merge-duplicates,return=minimal'` for page teardown -
  `src/lib/progress.js:255-269`

What it guarantees: **almost nothing.** The policy is `user_id = auth.uid()` with no date
restriction (`0004:605-610`), so any past date can be rewritten, and `level3_score` is
whatever the browser sends. This is `AUDIT.md:351`.

What it no longer does: `level4_score` is deliberately **not** in the payload
(`src/lib/progress.js:192-218` explains why), and `progress_guard_level4_score()`
(`0026:74-104`) pins the column against a stale client anyway.

### 4.5 The `learning_state` upsert - browser, dead

`src/lib/learning.jsx:56-63`:

```js
const saveState = (uid, s) =>
  supabase.from('learning_state').upsert(toStateRow(uid, s), { onConflict: 'user_id' });

const saveSession = (uid, sessionId, fields) =>
  supabase.from('learning_sessions').upsert(
    { id: sessionId, user_id: uid, ...fields },
    { onConflict: 'id' }
  );
```

`toStateRow()` (`src/lib/learning.jsx:33-43`) sends
`user_id, current_stage, session_id, remembered_item_ids, pending_item_ids,
mastered_item_ids, completed_sessions, total_at_submit, updated_at`.
`saveState` is called at `learning.jsx:239, 348, 376, 403`; `saveSession` at
`learning.jsx:340-345, 368-373, 401`.

Allowed by `0004:616-624`. It guarantees nothing and, per §1, it never runs: both tables have
0 rows in production.

---

## 5. Canonical definitions

Real SQL, against real column names. `$1` is the યુવક's `profiles.id`.

### 5.1 `remembered_count` - distinct level-3 scene ids, lifetime

**This, and not `progress.level3_score`.**

```sql
select count(distinct s.scene_id)::integer as remembered_count
from public.activity_attempts a
cross join lateral unnest(a.selected_scene_ids) as s(scene_id)
where a.user_id = $1
  and a.level_id = 3;
```

For everyone at once:

```sql
select a.user_id,
       count(distinct s.scene_id)::integer as remembered_count
from public.activity_attempts a
cross join lateral unnest(a.selected_scene_ids) as s(scene_id)
where a.level_id = 3
group by a.user_id;
```

For one day only, add `and a.activity_date = $2`, or read
`daily_activity_progress.completed_scene_ids` for that day, which is the same union already
computed (`0021:946-947`).

### 5.2 `level4_passed` - distinct activities with a passing attempt

```sql
select count(distinct t.activity_id)::integer as level4_passed
from public.level4_attempts t
where t.user_id = $1
  and t.passed;
```

### 5.3 `level4_completed` - distinct activities with status COMPLETED

```sql
select count(*)::integer as level4_completed
from public.level4_activity_progress p
where p.user_id = $1
  and p.status = 'COMPLETED';
```

> The app's own notion of "completed" is wider. `level4_completed_activity_ids(uid, config)`
> (`0010:372-400`) also credits an activity whose every effective દ્રશ્ય is contained in the
> યુવક's covered set, so a republished configuration does not restart him. That function is
> `revoke all ... from public` with no grant (`0010:402`), so a report cannot call it as
> `authenticated`; either query it as the owner or state which of the two definitions the
> report is using.

### 5.4 `level4_attempts` - how many times he sat a કસોટી

```sql
select count(*)::integer as level4_attempts
from public.level4_attempts t
where t.user_id = $1;
```

Per activity, which is what `level4_activity_progress.attempt_count` already holds:

```sql
select t.activity_id, count(*)::integer as attempts
from public.level4_attempts t
where t.user_id = $1
group by t.activity_id;
```

### 5.5 `level4_revision_required`

```sql
select count(*)::integer as level4_revision_required
from public.level4_activity_progress p
where p.user_id = $1
  and p.status = 'REVISION_REQUIRED';
```

`revision_count` is a different number - how many times he opened the revision screen, via
`level4_mark_revision()` (`0010:873-880`):

```sql
select coalesce(sum(p.revision_count), 0)::integer as revision_opens
from public.level4_activity_progress p
where p.user_id = $1;
```

### 5.6 `level1_status` / `level2_status` / `level3_status`

Today, per level:

```sql
select d.level_id,
       d.activity_key,
       d.status,            -- 'COMPLETED' | 'REVISION_REQUIRED'
       d.attempt_count,
       d.completed_items,
       d.total_items,
       d.completed_at
from public.daily_activity_progress d
where d.user_id = $1
  and d.activity_date = timezone('Asia/Kolkata', now())::date
order by d.level_id;
```

A missing row means "not done today". There is no reset job, so absence is the whole of the
daily reset (`0021:182-185`).

Lifetime "has he ever done this level":

```sql
select
  exists (select 1 from public.activity_attempts a
          where a.user_id = $1 and a.level_id = 1) as level1_ever,
  exists (select 1 from public.activity_attempts a
          where a.user_id = $1 and a.level_id = 2) as level2_ever,
  exists (select 1 from public.activity_attempts a
          where a.user_id = $1 and a.level_id = 3 and a.status = 'COMPLETED')
                                                    as level3_completed_ever;
```

### 5.7 `last_active_at`

The યુવક touched three writers, so the honest answer is the greatest of three.

```sql
select nullif(
         greatest(
           coalesce((select max(a.submitted_at) from public.activity_attempts a
                     where a.user_id = p.id), '-infinity'::timestamptz),
           coalesce((select max(t.at) from public.level4_attempts t
                     where t.user_id = p.id), '-infinity'::timestamptz),
           coalesce((select max(g.updated_at) from public.progress g
                     where g.user_id = p.id), '-infinity'::timestamptz)
         ),
         '-infinity'::timestamptz
       ) as last_active_at
from public.profiles p
where p.id = $1;
```

NULL means "never recorded anything". `progress.updated_at` is included because
`src/lib/progress.js:224-227` sets it explicitly on every flush so it cannot stall at the
first write of the day; it is also the only signal for a યુવક who ticked but never submitted.

### 5.8 `points_total`

```sql
select coalesce(sum(t.points), 0)::bigint as points_total
from public.point_transactions t
where t.user_id = $1;
```

Today:

```sql
select coalesce(sum(t.points), 0)::bigint as points_today
from public.point_transactions t
where t.user_id = $1
  and t.activity_date = timezone('Asia/Kolkata', now())::date;
```

A યુવક's own client gets both from `my_point_summary()` (`0021:1357-1380`), which is
SECURITY INVOKER and filters `user_id = auth.uid()` (`0021:1367`). A સંચાલક must **not** call
it - it would return the sum of every યુવક labelled as his own (`0021:1349-1353`). Use the
fragments above with `has_permission('progress.read')` instead.

---

## 6. What the database cannot answer

Be honest about these on any screen that shows them.

### 6.1 The content total (108)

**Derived, never stored.** The pipeline is `src/lib/useScenes.js:241-249`:

```js
return withDisplayIndex(
  [...ALL_SCENES, ...created]
    .filter((s) => { const row = byId.get(s.id); return !row || !isWithheld(row); })
    .map((s) => applyOverlay(s, byId.get(s.id)))
    .filter(isLearnable)
);
```

and the total is `scenes.length` at `src/lib/useScenes.js:258`, never a literal
(`ORDERING.md:202`, rule 2).

The live 108 is: **109** entries in `content/darshan.json` (verified), minus **2** withheld by
`public.scenes` overlay rows whose `status` is outside `{PUBLISHED, ACTIVE}` (darshan-083 and
darshan-106; the gate is `VISIBLE` at `src/lib/useScenes.js:22-24`), plus **1** admin-created
row that has no manifest entry and passes both gates (darshan-112, via `sceneRowEntry()`,
`shared/domain/darshan.js:187`).

**Postgres cannot compute this.** `isLearnable()` (`shared/domain/darshan.js:54`) requires a
`t`/caption and a `url`, and both live in the manifest, which is a file the database cannot
see. `0010:268-272` states this explicitly and is why the level 4 selection engine validates
learnability in the panel rather than in SQL.

**Fallback for a report:** use `max(activity_attempts.total_items)` for `level_id = 3`, which
is what the client actually reported at submit time and is why the column is stored rather
than looked up (`0021:93-96`, `0021:168-170`). Never hardcode 108, and never derive a total
from `count(*)` on `public.scenes` - that table is a **sparse overlay** with a row only for
દર્શન a સંચાલક has edited (`ORDERING.md:44-46`).

### 6.2 Per-image data for levels 1 and 2

**Not recorded, anywhere.** `recordActivity()` sends `{ selected: [], total: 0 }`
(`src/lib/activity.js:211-212`), so `activity_attempts.selected_scene_ids` is `'{}'` and
`total_items` is 0 for `level_id in (1, 2)`. `activity_submit()` marks them COMPLETED
unconditionally (`0021:826-827`), and `daily_activity_progress.completed_items` is therefore
0 for them too (`0021:942-944`).

**Fallback:** levels 1 and 2 can only be reported as repetitions - `attempt_count` and
`submitted_at`. `summariseRow()` in `shared/domain/history.js` already renders them that way
(`0021:942-944` names it). A screen asking "which images does he remember" must say **level 3**
and must read `activity_attempts.selected_scene_ids`.

### 6.3 Levels 1 and 2 can be silently lost

Both call sites fire and forget. `src/pages/EntryGate.jsx:113-116` does a dynamic import and
does not await the promise; `src/modules/darshan/DarshanPage.jsx:75` is
`recordActivity(...).catch(() => {})`. A failed network call leaves no row and no error.
So a missing level 1 or level 2 attempt is not proof the યુવક did not do it.

### 6.4 `progress.level3_score` is not a count of anything trustworthy

Client-written, unguarded, any past date (`0004:605-610`, `AUDIT.md:351`). One production row
holds 110 against a live maximum of 108. `0026:63-72` explains why it was deliberately left
lowerable: un-ticking a mis-tick has to work. **Fallback:** §5.1.

### 6.5 `displayIndex` is not in the database

Derived on read by `withDisplayIndex()` and stored nowhere -
`DARSHAN_DATA_CONTRACT.md:22-23`, `ORDERING.md:26,29-32`. The database has
`scenes.index` (the printed number) and `scenes."order"` (the સંચાલક's position), and the
overlay is sparse so both are frequently absent. A SQL report that prints a number beside a
દ્રશ્ય is printing the wrong one. **Fallback:** join scene ids in the client, where
`useScenes()` has already sequenced them.

### 6.6 LOCKED and AVAILABLE are not stored

See §7. **Fallback:** `level4_activity_states()` (`0012_level4_repeat_access.sql:71-123`),
which is `revoke all ... from public` with no grant (`0012_level4_repeat_access.sql:125`) and
therefore not callable as `authenticated`; a panel report must either query as the owner or
re-derive the branches itself in the exact order at `0012_level4_repeat_access.sql:107-117`.

### 6.7 `level4_attempts` has no attempt number

There is no such column. It is derived by
`row_number() over (partition by user_id, activity_id order by at, id)` in the
`attempt_history` view (`0021:1197-1202`), and again by `count(*)` inside
`level4_attempts_award()` (`0021:1072-1076`). Use the view, not a hand-rolled count.

### 6.8 What a યુવક got *wrong* in લેવલ ૪ is only half recorded

`level4_attempts.selected_scene_ids` is the submission **already intersected** with the
activity's effective items (`0010:219-222`, `0025:264-267`). A દ્રશ્ય he ticked that is not in
the કસોટી leaves no trace. The un-ticked remainder is computable
(`level4_effective_items(activity_id)` minus `selected_scene_ids`) but only as of *now*,
because the activity's membership may have changed since.

### 6.9 There is no duration anywhere

No table records how long anything took. The only temporal facts are
`activity_attempts.submitted_at`, `level4_attempts.at`,
`daily_activity_progress.started_at` / `completed_at`, and
`level4_activity_progress.completed_at`. `started_at` is `min(submitted_at)` of the day's
attempts (`0021:950`), not the moment the screen opened - it cannot be used as a session
start.

### 6.10 Things I could not find

- **No per-scene "mastered" concept in the live system.** `learning_state.mastered_item_ids`
  exists (`0001:74`) and is dead. Nothing in the live tables distinguishes "remembered once"
  from "remembered repeatedly" except by counting attempts per scene id yourself.
- **No stored `zone`/`sub_zone` on any progress table.** `daily_activity_progress`,
  `activity_attempts` and the level 4 tables carry only `user_id`; a sub-zone report must join
  `profiles`. `learningService.js:83` and `reportService.js:63-64` already note this for the
  dead tables, and it is equally true of the live ones.
- **`level4_configs.require_gate` / `gate_threshold`** are still in the table and decide
  nothing since `0014`. I could not find any live reader of either column.

---

## 7. Terminology

Four status vocabularies. Two are stored, one is stored but effectively unused, one is never
stored at all.

| Vocabulary | Values | Defined at | Stored? |
|---|---|---|---|
| `activity_attempts.status` | `COMPLETED` · `REVISION_REQUIRED` | `0021:119` | yes |
| `daily_activity_progress.status` | `COMPLETED` · `REVISION_REQUIRED` | `0021:209-210` | yes, default `REVISION_REQUIRED` |
| `level4_activity_progress.status` | `IN_PROGRESS` · `REVISION_REQUIRED` · `COMPLETED` | `0010:190-191` | yes, default `IN_PROGRESS` |
| derived લેવલ ૪ card state | `LOCKED` · `AVAILABLE` (+ the three above) | `0012_level4_repeat_access.sql:107-117` | **never** |

Notes that matter when writing a report:

- **`IN_PROGRESS` is not among the attempt words on purpose.** An attempt is a submission, and
  a submission is finished by definition (`0021:116-118`). The two ladders share the same two
  words deliberately so one history column can render both (`0021:115-118`,
  `0021:1181-1183`).
- **`level4_activity_progress.status = 'IN_PROGRESS'` has exactly one producer**, and it is not
  `level4_submit()`. `level4_submit()` always supplies `COMPLETED` or `REVISION_REQUIRED`
  (`0025:306`). `level4_mark_revision()` inserts without a `status`
  (`0010:873-876`), so the column DEFAULT applies. An `IN_PROGRESS` row therefore means
  "he opened the revision screen for a કસોટી he has never submitted".
- **`LOCKED` and `AVAILABLE` are never stored** - `0010:178-181` says so and gives the reason:
  storing a lock would mean rewriting every row whenever the સંચાલક reorders, and being wrong
  in between. They are computed by `level4_activity_states()`
  (`0012_level4_repeat_access.sql:71-123`), whose branch order is the rule and is not
  interchangeable (`0012_level4_repeat_access.sql:61-66`):

  ```
  COMPLETED  first   earned is earned
  gate       next    a યુવક who has not reached લેવલ ૪ sees a locked page
  position   next    ક્રમ, for everything ahead of him
  explicit   next    REVISION_REQUIRED / IN_PROGRESS, what his own row says
  AVAILABLE  last    nothing stands in the way
  ```

  Mirrored by `withStatuses()` in `src/lib/level4.js` and `deriveStatuses()` in
  `shared/domain/level4.js` (`0012_level4_repeat_access.sql:127-131`). A panel that re-derives
  these must follow the same order or it will re-lock a passed કસોટી after a reorder.
- Content status is a fifth, separate vocabulary and is unrelated to progress:
  `DRAFT · VALIDATED · PUBLISHED · ACTIVE · DISABLED` on `scenes`
  (`DARSHAN_DATA_CONTRACT.md:61-72`), and
  `DRAFT · VALIDATED · PUBLISHED · ARCHIVED` on `level4_configs` (`0010:72-73`).
- Account status is a sixth: `ACTIVE · SUSPENDED · DISABLED` on `profiles`
  (`0004:175-177`). `SUSPENDED` can still sign in and read, and can write nothing
  (`0004:179-180`).

---

## 10. Field -> source -> screen (0029, 0030)

Added when the reporting layer was built. Every figure the સંચાલક can see, and the exact
path it took to get there. If a number on screen is ever disputed, this table plus
`admin_verify_user_progress()` is how the argument is settled.

The functions live in `supabase/migrations/0029_admin_progress_report.sql` and
`supabase/migrations/0030_admin_progress_live_scenes.sql`. All are SECURITY DEFINER and all
open with `admin_assert_progress_reader()`, which raises `42501` unless the caller holds
both `progress.read` and `users.read`.

| Field | Table -> column | Calculation | Screen |
| :---- | :-------------- | :---------- | :----- |
| `remembered_count` | `activity_attempts.selected_scene_ids` (level 3) UNION `level4_attempts.selected_scene_ids` | distinct union, then intersected with the live collection | Progress table, user detail |
| `content_total` | none - see below | `cardinality(p_live_scene_ids)` | the denominator everywhere |
| `remembered_pct` | derived | `remembered / content_total * 100`, 2 dp | Progress table |
| `level1_status` | `activity_attempts.status` where `level_id = 1`, or `profiles.gate_passed_at` | COMPLETED if either says so | Progress table, detail |
| `level2_status` | `activity_attempts.status` where `level_id = 2` | `bool_or(status = 'COMPLETED')` | Progress table, detail |
| `level3_status` | `activity_attempts.status` where `level_id = 3` | `bool_or(status = 'COMPLETED')` | Progress table, detail |
| `level4_passed` | `level4_attempts.passed` | `count(distinct activity_id) filter (where passed)` | Progress table, detail |
| `level4_attempts` | `level4_attempts` | `count(*)` | Progress table, detail |
| `level4_unlocked` / `_completed` / `_revision` | `level4_activity_states(user, config)` | counted off that function's status, never re-derived | Progress table, detail |
| `gate_open` | `level4_gate_open(user)` -> `progress.level3_score` vs `settings['levels'].level4Gate` | unchanged from 0014 | Progress table, detail |
| `city_id` | `profiles.zone_id` | labelled by `zoneNameEn()` | Progress table, filters |
| `zone_id` | `profiles.sub_zone_id` | labelled by `subZoneNameEn()` | Progress table, filters |
| `last_active_at` | `activity_attempts.submitted_at`, `level4_attempts.at` | `greatest()` of the two | Progress table |
| `points_total` | `point_transactions.points` | `sum()` | detail |
| `sceneDetail[]` | both attempt tables | per દ્રશ્ય first tick, last tick, how many times | detail "View details" |

### 10.1 The denominator is not in this database

`content/darshan.json` is a file Postgres cannot read, and `public.scenes` is a *sparse*
overlay on it (`0010:167`) - it withholds some દ્રશ્યો and adds others. The live collection
is the manifest overlaid, gated by `isWithheld` then `isLearnable`, and sequenced by
`withDisplayIndex()`. All of that is `shared/domain/darshan.js`, and it runs in the browser.

So the panel computes it with `admin/src/lib/liveScenes.js` - **the same four functions
`src/lib/useScenes.js` calls**, not a second definition - and passes the resulting id array
into every reporting function as `p_live_scene_ids`. With it, "remembered" is an exact
intersection with what the યુવક can see today. Without it (an older panel build), the
functions fall back to `admin_content_total()` and an exclusion of only what `public.scenes`
knows is withheld, which is less precise and is reported as `contentSource:
'server-estimate'` so a screen can say so.

Today that resolves to **108**: 109 manifest entries, less `darshan-083` and `darshan-106`
withheld, plus `darshan-112` created in the panel.

### 10.2 Why a યુવક can read 107 of 108 having submitted 108

Because the collection moved under him. Four real accounts show exactly this:

```
submitted 108  ->  counted 107  ->  withheld [darshan-111]  missing [darshan-112]
```

He ticked `darshan-111`, which has since been withheld, and has never seen `darshan-112`,
which was created after he finished. Both halves are true and neither is an error.
`admin_verify_user_progress(user, live_ids)` returns exactly that breakdown, with the two
identities `counted + withheld + unknown = submitted` and `counted + missing = total`
returned as booleans so the panel asserts them rather than trusting them.

### 10.3 What is deliberately not reported

- **No per-image figure for levels 1 and 2.** Neither records scene ids: every લેવલ ૧ and
  લેવલ ૨ attempt in production carries an empty `selected_scene_ids` and `total_items = 0`,
  because watching the વિડિયો and doing દર્શન are not per-દ્રશ્ય acts. Those levels report
  status and attempt counts, which is all that was ever recorded.
- **`progress.level3_score` is never used as the remembered count.** It is upserted straight
  from the browser with no guard (`0026` pinned `level4_score` and deliberately left this
  writable), and one production row carries `110` against a collection of 108. It is still
  read for one thing only, because that is what the rule is defined on: the લેવલ ૪ gate.
