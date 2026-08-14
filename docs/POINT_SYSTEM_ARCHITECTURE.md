# Activity history, points, exams and leaderboard — architecture report

Written before implementation, from a read of all 31 migrations, `src/`, `admin/src/`,
`shared/domain/` and `scripts/`. Every structural claim cites `file:line`.

The headline finding is worth stating first, because it changes what needs building:

> **Most of the raw event history this task asks for is already recorded correctly.**
> `activity_attempts` (0021) and `level4_attempts` (0010/0025) are append-only, one row per
> submission, many rows per user per day. The gaps are not in event capture. They are in the
> **point ledger's shape**, in the **rule configuration**, and in the **admin read surfaces**.

---

## A. What events are currently stored

| Event | Table | One row per | Verdict |
|---|---|---|---|
| Level 1 completion (both boxes ticked) | `activity_attempts` | submission | ✅ full history |
| Level 2 Darshan session | `activity_attempts` | session | ✅ full history — §5 already satisfied |
| Level 3 revision submission (નોંધાવો) | `activity_attempts` | submission, with `selected_scene_ids[]` | ✅ full history — §6 mostly satisfied |
| Level 3 tick → daily score | `progress` | user+day (upsert) | ⚠️ collapsed by design, client-authoritative |
| Level 4 exam attempt | `level4_attempts` | attempt, with `passed`, `selected_count`, `required_count` | ✅ full history — §7 mostly satisfied |
| Level 4 revision marker | `level4_activity_progress.revision_count` | user+activity | ⚠️ counter only, no event rows |
| Point award | `point_transactions` | **user+day+level+activity_key** | ❌ collapsed — see §B1 |

`activity_attempts` constraints, verbatim (`0021_progress_history_points.sql:129,146`):

```sql
constraint activity_attempts_number_unique
  unique (user_id, level_id, activity_key, activity_date, attempt_number)

create unique index activity_attempts_token_idx
  on public.activity_attempts (user_id, client_token) where client_token is not null;
```

The day is in the key only *together with* `attempt_number`, so N submissions on one day are
N rows numbered 1..N. `client_token` deduplicates a *retry of one logical submission* only.
`level4_attempts` has no natural key at all beyond the token index — it is pure append.

So §43's acceptance test — 5 Darshan events, 3 revision events, 3 exam attempts all
distinguishable — **passes against the schema as it stands today.**

## B. What is missing

### B1. The ledger cannot express a per-attempt award

`0021:309`:

```sql
constraint point_transactions_day_unique
  unique (user_id, activity_date, level_id, activity_key)
```

At most one award per user per IST day per level per activity. That is deliberate and well
argued (`0021:274-308`): attempts are unlimited since 0017, so without it points are farmable.

But it makes three requested rules **structurally unrepresentable**:

* §11 repeat points — a second pass of 4.1 earning 50 needs a second row for the same key/day.
* §12 tick-wise points — several revision submissions in a day each paying for new ticks.
* §15 manual adjustment — an admin credit is not an activity award and must not occupy the
  day's slot.

There is also no `reason`, no rule identity, no `first/repeat/manual` discriminator, and
`points integer not null check (points >= 0)` forbids a negative correction.

### B2. Rule configuration is four numbers and a map

`settings['levels'].value.points` resolves (`shared/domain/points.js:193`) to
`{enabled, level1, level2, level3, level4:{default,'4.x'}}` and nothing else. Missing: repeat
points, tick mode, daily limits, effective dates, per-rule enable/disable, rule version.

### B3. No admin surfaces

Absent: `/admin/points` (any of §36's nine sections), an org-wide transaction browser (§24),
a chronological timeline (§22), a daily history page (§23), a leaderboard viewer with
city/zone filters (§16/§38), and a manual-adjustment form (§15).

### B4. Progress report is missing five columns

`admin_progress_report` (0030) returns 30 columns but not: Darshan session count, revision
session count, tick count, all-level attempt count, or leaderboard rank.

**Resolved.** `admin_activity_counts()` (0032) carries all five, and the panel merges them onto
the page the report returned — see the 0032 note in §I for why it is a second function rather
than five more columns. One detail is a rule and not an implementation choice: `rank` is null
for a યુવક who has earned nothing, and the column prints `-`. "Not ranked" and "last place" are
different claims, and only one of them is true.

## C. Which table contains each event — see table A.

## D. Which existing tables can be reused

**All of them.** `activity_attempts` and `level4_attempts` are reused as-is for history;
`point_transactions` is reused as *the* ledger and extended with nullable columns;
`daily_activity_progress`, `progress` and `level4_activity_progress` stay as the derived
aggregates they are. **No new event table is needed** — §26's condition ("if an existing table
already captures an event correctly: USE IT") is met for every level.

## E. Where points are generated

Exactly two writers, both server-side, both `SECURITY DEFINER`, both calling one function:

1. `activity_submit()` step 9 (`0021:975`) — only when `att.status = 'COMPLETED'`.
2. `level4_attempts_award()` (`0021:1043`) — `AFTER INSERT ON level4_attempts WHEN (new.passed)`.

Both call `award_points(...)` (`0021:660`), which is `revoke all from public` with **no grant
to anybody**. The browser has no path to the ledger: `point_transactions` has a read policy
and no write policy, and `insert, update, delete` are revoked from `anon, authenticated`
along with the sequence. Confirmed from the client side too — `src/` contains zero inserts
into `point_transactions` and no RPC that awards.

## F. Where the leaderboard is calculated

One function, `leaderboard(p_period)` (`0023`), `SECURITY DEFINER`, granted to
`authenticated`. It is `sum(point_transactions.points)` filtered by an IST period bound,
inner-joined to `profiles` on `status = 'ACTIVE'`, ranked with `rank() over (order by total
desc)` for the printed place and `row_number() over (order by total desc, name, user_id)` for
a deterministic cut. It returns **no user_id, ever**. There is no competing score computation
anywhere — §16 is already satisfied in the engine and needs only admin controls.

## G. Frontend-derived data

* `progress.level3_score` — the **only** client-authoritative score write in the app
  (`src/lib/progress.js:366`, upsert on `user_id,date`). Guarded by a load-time floor and by
  `bank()`, but a second device can still write a lower value (`progress.js:161-163`).
* `profiles.gate_passed_at` — client stamps the timestamp, once (`src/lib/auth.jsx:538`).
* Level unlock display, `enough` on the exam page — courtesy checks, never the authority.

## H. Server-authoritative data

Attempt rows, attempt numbers, dates, statuses, pass/fail, `level4_score`, every point value,
every rank. `activity_submit` ignores a `p_total` smaller than what arrived; `level4_submit`
intersects the submitted ids with `level4_effective_items()` before scoring.

## I. What needs to be added

**Migration 0031 — the point engine.** *(Written; this paragraph now describes what the file
does rather than what was planned.)* Extend `point_transactions` with **seven** nullable
columns (`award_kind`, `rule_version`, `reason`, `admin_id`, `idempotency_key`, `event_ref`,
`attempt_id`); replace the day constraint with a **partial** unique index carrying the
identical predicate for day-scoped awards only; add a universal unique index on
`idempotency_key`; relax the non-negative check for manual rows only; extend
`settings_check_points()` for the new rule keys; add `point_award()` as the single writer and
`point_rules()` / `point_rule_live()` as the resolvers; reissue `award_points()` to apply the
tick and repeat rules; add `admin_award_manual_points()`.

Two corrections to the plan, both deliberate and both argued in the migration's own header:

* **`point_settings()` is not extended.** The 0031 keys are resolved by a *separate*
  `point_rules()`, so the existing function keeps its existing shape and its existing callers.
* **`activity_submit()` and `level4_attempts_award()` are not reissued.** Every new rule is
  applied inside `award_points()`, which both already call with the signature they already use.
  0031:446-450 gives the reason: their reasoning is 0021's and 0017's and has not changed, and
  re-stating two hundred lines to alter four is how a carefully argued function acquires a
  paragraph nobody meant.

**Migration 0032 — admin reporting.** *(Written.)* `admin_point_transactions()`,
`admin_user_timeline()`, `admin_daily_activity()`, `admin_leaderboard()`,
`admin_points_overview()` and `admin_point_activities()`.

`admin_progress_report()` is **not** reissued. The five missing columns of §B4 come from a
separate `admin_activity_counts(p_users, p_from, p_to)` instead, and `p_users` is a *page* of
ids rather than a filter: the report has already decided who is on the screen, and asking a
second function to re-derive that predicate is two implementations of one filter that drift
apart the first time somebody fixes only one of them. Four of the five are counts over other
tables and the fifth is a window function over the whole ledger, so a સંચાલક reading the
identity columns should not pay for a rank he is not looking at. The panel therefore makes the
second call only when one of those five columns is switched on, and merges the answer per
user id.

**Shared domain.** *(Written.)* `shared/domain/points.js` gained the new keys following the
established five-part pattern (`X_KEY`, bounds, frozen `DEFAULT_X`, forgiving `resolveX`,
refusing `validateX`): `TICK_MODE`, the four new bound pairs, `DEFAULT_POINT_RULES`,
`resolvePointRules()`, `validatePointRules()`, `isPointRuleLive()` and `repeatValueFor()`.
Covered by `scripts/test-point-rules.mjs` (623 assertions).

The asymmetry between the two halves is the design and not an inconsistency to reconcile:
`resolvePointRules()` mirrors `point_rules()`, which substitutes the default for anything
out of range or wrongly typed, while `validatePointRules()` mirrors `settings_check_points()`,
which *refuses* the same input. One exists so a bad stored row cannot stop the awarding; the
other exists so a bad row cannot be stored. Both must be mirrored, and they are allowed to
disagree about the same input.

**Admin UI.** `/admin/points` with the nine sections of §36; timeline and daily-history views;
five new columns in the existing report/column-chooser/Excel pipeline.

## J. What must remain untouched

1. **Every existing `point_transactions` row.** No UPDATE, no DELETE, no recomputation, no
   backfill of the new columns. `award_kind IS NULL` **is** the definition of a legacy row.
2. **`point_transactions_day_unique`'s semantics.** The replacement partial index carries the
   predicate `coalesce(award_kind,'DAY_FIRST') = 'DAY_FIRST'`, so legacy rows and new
   day-scoped awards share one index exactly as they share one rule today. Dropping a
   constraint and creating an equivalent index rewrites no row.
3. **Default behaviour.** Every new rule key defaults to reproducing today's awarding exactly.
   An untouched settings row must produce byte-identical awards after 0031 — this is a test,
   not an aspiration.
4. **`journey.js` / `level4.js` `deriveStatuses` branch order** and `level4_activity_states`
   — the unlock and repeat-access machine. Not touched.
5. **`level4_submit` steps 1-4** — 0017's attempt policy, reissued verbatim by 0025.
6. `progress`, `daily_activity_progress`, `level4_activity_progress` shapes.
7. `leaderboard()`'s privacy contract — rows carry a name and a number, never a user id.

---

## The rule set

`settings['levels'].value.points`, existing keys unchanged, new keys all optional:

```jsonc
{
  "enabled": true, "level1": 100, "level2": 200, "level3": 300,
  "level4": { "default": 100, "4.1": 100 },      // ← unchanged, still the first-award price

  "version": 3,                                   // stamped on new awards; audit reads settings
  "repeat":  { "enabled": false, "default": 0, "dailyLimit": 0, "4.1": 50 },
  "tick":    { "mode": "ACTIVITY", "perTick": 0, "perRevision": 0, "dailyCap": 0 },
  "effectiveFrom": null,                          // ISO day; awards before it use no new rule
  "disabled": []                                  // ["4.3"] or ["level2"] switches one rule off
}
```

Absent ⇒ today's behaviour, for every one of them.

Three notes on this block, each of which was wrong in an earlier draft of this document and is
now stated from `settings_check_points()` and `point_rules()` rather than from the plan:

* **There is no `limits` key.** An earlier draft proposed one. Nothing reads it and nothing
  validates it, so it would save silently and do nothing — the worst possible outcome for a
  configuration field. Daily ceilings are `repeat.dailyLimit` (0..1000, 0 = no limit) and
  `tick.dailyCap` (0..100000, 0 = no cap), and those two are the whole of it.
* **Per-કસોટી repeat overrides are flat keys inside `repeat`**, beside `enabled`, `default` and
  `dailyLimit` — exactly as `level4` carries `"4.1"` beside `default`. A nested `byCode` object
  is *refused* by the trigger. `point_rules()` nonetheless **returns** them nested under
  `repeat.byCode`, which makes the resolved shape and the stored shape different documents: the
  resolved one is for reading, and feeding it back to a save drops every override and is
  rejected. `resolvePointRules()` in `shared/domain/points.js` mirrors both halves of that.
* **Unknown keys are rejected inside `repeat` and `tick`, and accepted at the top level of
  `points`.** So a future top-level key survives a round trip through the panel, and a typo
  inside `tick` does not.

## Award kinds

| `award_kind` | Idempotency | Written by |
|---|---|---|
| `NULL` | — | **legacy, pre-0031. Never written again.** |
| `DAY_FIRST` | partial unique index on (user, date, level, key) | `activity_submit`, `level4_attempts_award` |
| `REPEAT` | `idempotency_key = 'repeat:' \|\| source_id` | `level4_attempts_award` |
| `TICK` | `idempotency_key = 'tick:' \|\| source_id` | `activity_submit` |
| `REVISION` | `idempotency_key = 'revision:' \|\| source_id` | `activity_submit` |
| `MANUAL` | `idempotency_key = 'manual:' \|\| uuid` | `admin_award_manual_points` |

`points >= 0` still holds for every kind except `MANUAL`, which may be negative.

`REVISION` is a fifth kind and not a variant of `TICK`: `tick.mode` chooses between paying per
દ્રશ્ય brought to mind and paying per નોંધાવો, and the ledger records which of the two was in
force by the name it files the row under. Both are written by the same branch of
`award_points()`, which is why their keys are built by one expression
(`lower(mode) || ':' || source_id`).

## Order of work

Backend first, per §29: migrations → RLS → RPCs → engine → leaderboard → admin services →
admin UI → Excel → tests → production reconciliation.

---

## What testing found — six defects, and the two rules behind them

`scripts/test-point-engine.mjs` (329 assertions, real Postgres in Docker) and
`scripts/test-point-rules.mjs` (660, pure logic) were written against this document. Six things
they found are worth keeping, because four of them were invisible to review.

**0032 did not apply at all.** `returns table (… position integer …)` — `position` is a reserved
column-name keyword — failed at CREATE FUNCTION time, so nothing in that file had ever existed on
any database. Two further `FROM x, guard LEFT JOIN y ON …x…` constructions were also invalid.
A migration nobody has run is not a migration.

**The authorisation guard never ran, and every reader was open to any signed-in યુવક.**
0032 wrote `with guard as (select public.admin_assert_progress_reader())` and joined `guard` into
the FROM list of `language sql` functions. The planner inlines a single-reference CTE, prunes the
target entry nothing selects from, and **the function is never called.** Measured before the fix:
an ordinary યુવક and a `CONTENT_MANAGER` each got 50 ledger rows, the full leaderboard with user
ids, the overview and the activity list. 0029/0030 escaped this only because they are `plpgsql`
and call the guard with `perform`, which is a statement and cannot be pruned.

All seven functions are now `plpgsql`, calling `perform public.admin_assert_progress_reader();`
before anything else, with every CTE body unchanged. A WHERE-clause guard was considered and
rejected: it is not evaluated when the scan beneath it yields no rows, so
`admin_user_timeline(<a યુવક with nothing>)` would have answered an unauthorised caller with
silence rather than a refusal. **An authorisation check must be a statement that runs, not a
predicate that may be optimised away or never reached.**

**`points.enabled = false` stopped meaning zero.** `point_value_for()` opens with
`when not s.enabled then 0`, but the new tick and repeat branches read `point_rules()`, which
knows nothing about `enabled`. With the system switched *off*, a tick rule still paid, and the
repeat branch paid on the *first* attempt too — because it is reached whenever the day award
wrote nothing, and a disabled system always writes nothing. A global switch has to be checked in
every branch that can pay, not only in the one that used to be the only branch.

**Two casts were wider than their validators**, and this is the rule worth carrying forward:

> **A bound the validator enforces must be inside the range of the type the resolver casts to,
> or the resolver's forgiveness is a raise.**

`version` had no ceiling while `point_rules()` cast it `::integer`; `effectiveFrom` was validated
as a *format* while `point_rule_live()` cast it `::date`, so `'2026-13-45'` saved cleanly. Either
one made **every** subsequent read of the rules raise — and `point_rules()` is on the award path
for every level through `point_rule_live()` and `award_points()`. One number, or one date, typed
into one field would have stopped the whole project being paid, for everybody. Both are now
refused by `settings_check_points()`; the date is checked by casting inside a nested block and
catching, because the calendar is not a regular language and Postgres already owns the answer.

**A paged timeline could show a row twice and another not at all.** `admin_user_timeline()`
ordered by `at desc` with no tiebreak, which is not a total order: a દર્શન session and the કસોટી
submitted in the same instant may come back either way round on either request, and under
OFFSET/LIMIT rows that swap across a page boundary are duplicated or dropped. Now ordered by
`at desc, level_id desc, activity_key desc, attempt_number desc`.

Two behaviours were *confirmed correct* rather than fixed, and are pinned by tests so they are not
"repaired" later: `admin_activity_counts()`'s rank and points total are lifetime figures while its
other six columns respect the date window (0032 says rank is deliberately project-wide), and
`admin_user_timeline()` shows no points against a legacy attempt, because `attempt_id` is NULL on
every pre-0031 row and §J1 forbids the backfill that would fill it.

---

# 0033 — milestones, and how often an activity may be paid

Two additions, one table and one settings key, both built so an untouched project keeps paying
exactly what it paid.

**`earn` — the earning mode, per level.** `settings['levels'].value.points.earn` holds
`DAY_FIRST | EVERY | ONCE` for each level plus `tickCount: FRESH | ALL` for લેવલ ૩.
`DAY_FIRST` and `FRESH` are 0021's rules and the default for every absent key, so the migration
changes nothing on the day it deploys; `EVERY` is what makes "5 દર્શન in one afternoon = 5 × ૨૦૦"
true, and it is the સંચાલક's decision rather than the code's. An unrecognised mode resolves to
`DAY_FIRST` and is refused by the validator — the resolver never reads a typo as the more generous
reading.

**`point_bonus_rules` — milestones.** A table rather than more JSON, because rules are a list
edited row by row and each needs a stable id to key idempotency on. Scope is
`(level_id, activity_key)` with null meaning "any"; `trigger_type` counts completions, items or
points; `reward_mode` is `EVERY` (every multiple), `FIRST_ONLY`, or `HIGHEST_ONLY` (of the enabled
rules sharing `(level_id, activity_key, trigger_type)`, only the highest threshold reached pays).
Awards land as `award_kind = 'BONUS'`, and deleting a rule never removes what it has paid.

## Four things testing forced, three of which were wrong in the plan

**1. The milestone key must name the યુવક.** The design said key each bonus
`'bonus:' || rule_id || ':' || milestone_number`. `point_transactions_idem_idx` is unique on
`idempotency_key` **alone**, across the whole table — so the first યુવક to reach a milestone would
have consumed it *for the entire project*, and everybody after him would silently never be paid.
The key is `'bonus:' || rule_id || ':' || user_id || ':' || n`. Found by a failing test, not by
reading, and it is the sharpest illustration of why an idempotency key has to be read together
with the index that enforces it: the key looked complete on its own.

**2. `EVERY` and `ONCE` are filed under `REPEAT`, not `DAY_FIRST`.** An award kind names *how a
row is deduplicated*, not what it was for. A second submission of the day written as `DAY_FIRST`
with an idempotency key would meet the partial unique index and raise an unhandled 23505. Which
mode paid stays recoverable from the key's prefix (`every:` / `once:` / `repeat:`).

**3. A global switch has to be checked in every branch that can pay.** `point_value_for()` opens
with `when not s.enabled then 0`, but 0031's tick and repeat branches read `point_rules()`, which
knows nothing about `enabled`. Measured with points **off**: a tick rule still paid, and the
repeat branch paid on the *first* attempt too — because it is reached whenever the day award wrote
nothing, and a disabled system always writes nothing.

**4. `activity_history` had to be reissued.** Its `points` column LEFT JOINed the single
`point_transactions` row for a (user, day, level, activity), and 0021:1240-1244 says that is safe
*because* the day-unique constraint guarantees one. `EVERY` and level-scoped bonuses both remove
that guarantee, so the join would have **multiplied the rows** — five દર્શન showing the same day
five times on a live screen. Now a sum. Nothing in the new code was wrong; the old screen would
have broken anyway, which is the argument for auditing before building.

## Re-applying migrations: replay the tail as a set

`scripts/test-point-engine.mjs` §A re-applies the point migrations to prove they are re-runnable —
the property production needed when 0032 failed behind 0031. Its first version replayed 0031 and
0032 and stopped, which **downgraded the engine**: 0033 reissues five of those objects, so every
group after that point was asserting against a reverted build while staying green. It now replays
every migration from 0031 on, in filename order, and then asserts the newest engine is still in
place.

The same rule holds operationally: **these files are re-applied as a set, in order, never one out
of the middle.** 0031 re-adds a `point_transactions_kind_check` that does not allow `BONUS`, and
`add constraint` validates the whole table — so re-running 0031 alone against a database that has
paid a bonus fails outright. Loudly, which is the right failure, but it is a repair that has to be
done in one sequence.
