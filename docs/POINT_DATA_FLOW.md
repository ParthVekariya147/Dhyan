# Point data flow — where every ગુણ comes from

The audit the milestone work was built on. Written from a read of `src/`, `admin/src/`,
`shared/domain/` and migrations 0001-0033; every structural claim cites `file:line`.

Its purpose is to answer one question before anything is changed: **for each level, which
user action produces which row in which table, and which of those rows is authoritative?**

---

## The flow, as it actually runs

```text
ADMIN                                  YUVAK
  │                                      │
  ▼                                      ▼
settings['levels'].value.points     USER ACTION
point_bonus_rules  (0033)                │
  │                                      ▼
  │                              SUBMISSION  (activity_submit / level4_submit)
  │                                      │
  │                                      ▼
  │                              THE EVENT ROW  ← authoritative
  │                              activity_attempts | level4_attempts
  │                                      │
  └──────────────►  award_points()  ◄────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        BASE TRANSACTION      BONUS TRANSACTION
              └──────────┬──────────┘
                         ▼
                  point_transactions        ← append-only ledger
                         │
        ┌────────────────┼────────────────┬──────────────┐
        ▼                ▼                ▼              ▼
  activity_history   my_point_*      leaderboard()   admin_* readers
   /history          history+totals   /leaderboard    panel + Excel
```

**One writer.** `award_points()` is the only function that creates a point row, and exactly
two things call it: `activity_submit()` step 9 (`0021:975`) and the `level4_attempts_award`
trigger (`0021:1043`). It is `revoke all from public` with no grant to anybody, so there is no
path from a browser to the ledger at all.

---

## Per level: action → event row

| Level | Component | Call | Event row | Response used? |
|---|---|---|---|---|
| 1 video | `src/pages/EntryGate.jsx:109-118` | `recordActivity(VIDEO)` → `activity_submit` | `activity_attempts` | **discarded** (`:117`) |
| 2 દર્શન | `src/modules/darshan/DarshanPage.jsx:72-76` | `recordActivity(DARSHAN)` → `activity_submit` | `activity_attempts` | **discarded** (`:75`) |
| 3 નોંધાવો | `src/modules/levels/LevelPage.jsx:214-240` | `submitActivity({selected, total})` → `activity_submit` | `activity_attempts` + `selected_scene_ids[]` | rendered in full |
| 4 કસોટી | `src/modules/level4/ActivityTestPage.jsx:243-284` | `submitAttempt()` → `level4_submit` | `level4_attempts` | rendered, then re-read |

`activity_submit` is wrapped in exactly one place, `src/lib/activity.js:184-190`, and its
normaliser (`:130-144`) does read `pointsAwarded`, `todayPoints` and `totalPoints` back.

**Three gaps worth naming, because they shape what a યુવક can see:**

1. **Levels 1 and 2 throw the reply away.** Points earned there are invisible until `/history`.
2. **`level4_submit` returns no points field at all** (`src/lib/level4.js:737-752`). The award is
   an AFTER INSERT trigger, not part of the submit's return value, so a યુવક is never told what
   a કસોટી earned him at the moment he earns it. A Level 4 bonus is therefore only ever visible
   on the history screen.
3. **`+ગુણ` appears in one place in the whole app** — `LevelPage.jsx:407-409` — and only when
   the figure is above zero.

---

## What is authoritative, and what is not

**Server-authoritative:** every attempt row, attempt number, business date, status, pass/fail,
`level4_score`, every point value, every rank. `activity_submit` ignores a `p_total` smaller
than what arrived; `level4_submit` intersects submitted ids with `level4_effective_items()`
before scoring.

**Client-authoritative — the complete list** (`grep` over `src/`, five writes):

| Where | Column |
|---|---|
| `src/lib/progress.js:366-368` and `:257-267` | `progress.level3_score` |
| `src/lib/learning.jsx:57` | `learning_state` stage and id lists |
| `src/lib/learning.jsx:60-63` | `learning_sessions` item ids |
| `src/lib/auth.jsx:548` | `profiles.gate_passed_at` and the two gate answers |

Nothing on the client writes a point value anywhere — `src/lib/activity.js:14-19` notes there is
no column for one to arrive in. `progressRows()` (`progress.js:219-229`) deliberately omits
`level4_score`; the 40-line comment above it records the data-loss bug that taught them to.

---

## Nothing is counted from a hardcoded number

- **The લેવલ ૩ collection** is `content/darshan.json` sorted, overlaid by `public.scenes`, gated
  by `isWithheld` **then** `isLearnable`, and renumbered by `withDisplayIndex()` —
  `src/lib/useScenes.js:165-250`, gates at `shared/domain/darshan.js:45,54`. The size is
  `scenes.length` (`useScenes.js:258`) and **there is no literal 108 anywhere in `src/`**. The
  manifest currently holds 109, which is where the "108 vs 109" wording comes from.
- **લેવલ ૪ activities and item counts** come from `level4_published_config()` and
  `level4_state()`, fetched as a pair (`src/lib/level4.js:444-449`). The activity count is
  `activities.length`; per-activity items are `sceneIds` intersected with the live collection
  (`ActivityTestPage.jsx:225-231`). No configured total exists, and LEVEL4.md forbids one.
- **The panel prices લેવલ ૪ from `admin_point_activities()`**, which reads the *published*
  configuration, so a `4.5` appears the moment it is published with no code change.

---

## The unlock machine — read, never changed

Two mirrored implementations: `deriveStatuses()` (`shared/domain/level4.js:224-269`, the pure
mirror of SQL `level4_activity_states()`) and `withStatuses()` (`src/lib/level4.js:344-370`, the
one the app runs). Both share a five-branch order that is **not interchangeable**:

1. `done` → `COMPLETED` — asked first, so neither the gate nor position can take back a pass
2. `!gateOpen` → `LOCKED`
3. anything below unfinished → `LOCKED`
4. explicit `REVISION_REQUIRED` / `IN_PROGRESS` → passed through
5. otherwise → `AVAILABLE`

There is no repeat branch, deliberately: a `COMPLETED` કસોટી is simply not `LOCKED`, so it may be
opened again indefinitely, and `level4_submit` holds no attempt limit (0017). What a later
attempt cannot do is *lower* anything.

**Scoring must never touch this.** What a યુવક may attempt is an access question; what he is paid
for it is a scoring question, and 0031/0033 keep every scoring change inside `award_points()`.

---

## The reading surfaces, and the assumption 0033 had to repair

| Surface | Reads | Note |
|---|---|---|
| `/history` "મારી પ્રગતિ" | `activity_history` view, `my_point_summary()` | `src/lib/history.js:137,253,344` |
| `/leaderboard` | `leaderboard(p_period)` | once per (period, uid) per visit, ref-cached |
| panel | the seven `admin_*` readers of 0032 | each guarded by a `perform`, never a CTE |
| `point_ledger` | — | exists (0021:1308-1331), granted, and **no client read it** |

`activity_history` joined `point_transactions` on `(user, day, level, activity_key)` and
0021:1240-1244 says this is safe *because* `point_transactions_day_unique` guarantees at most one
payment per that key per day. 0033 removes that guarantee twice — `earn: EVERY` writes a row per
submission, and a level-scoped BONUS row shares the same key — so the join would have
**multiplied the history rows**: five દર્શન would have shown the same day five times. The view is
reissued in 0033 to sum instead of join. This is the clearest example of why the audit came
first: nothing in the new code was wrong, and a live screen would have broken anyway.

---

## Gujarati conventions any new screen inherits

No i18n library and no central strings module — text is inline, with three structured
exceptions: page descriptions (`shared/domain/journey.js`), finishing moments
(`shared/domain/milestones.js` — *wording*, not a points engine, despite the filename), and
vocabulary constants (`shared/domain/history.js:64-94`). Errors live in per-module tables beside
their caller and attach `.gu`.

Numerals go through `gu()` (`shared/domain/constants.js:142-143`), display only. Note the panel's
`gu()` (`admin/src/lib/format.js:21`) is the **identity function** on purpose, so a સંચાલક can
copy-paste — never import across.

Tone rules that constrain every new string: never `નિષ્ફળ` (`REVISION_REQUIRED` is `થોડું બાકી`),
nothing red, no streaks, no count of what is missing, no comparison outside `/leaderboard`, empty
states phrased forward, and **never a `+૦`**.
