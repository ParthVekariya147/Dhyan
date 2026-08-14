# લેવલ ૩ as repeated પુનરાવર્તન — the draft, the revision, the catalogue and the pace rule

What `supabase/migrations/0035_level3_revisions.sql` changed, why each piece is where it is, and
what has to be done by hand before any of it does anything. Written from a read of 0021, 0029,
0031, 0033, 0034 and 0035, of `src/lib/level3.js`, `src/lib/progress.js`, `shared/domain/`, the
panel's points cards and `scripts/`. Every structural claim carries `file:line`.

Line numbers are against those files as they stand today. 0035 is a 2,300-line file that is still
settling, so where a number has drifted the **function, table, policy or trigger name beside it is
the durable anchor** — every citation below names one.

The headline, because it decides how the whole file reads:

> **The report was "લેવલ ૩ sometimes saves and sometimes does not". Four separate faults produce
> that one symptom, and only one of them is about saving** (`0035:8-9`). The feature looked
> random because it worked on a full collection of ૧૦૮ and silently paid nothing otherwise.

And the second headline, because it decides what deploying this means:

> **Applying 0035 changes nothing.** The catalogue is empty until `npm run catalog` runs, the
> pace rule is off until a number is typed into the panel, and `tick.mode` is `ACTIVITY` until a
> સંચાલક changes it. Every branch this migration adds is skipped in that state (`0035:2309-2311`).

---

## 1. The four root causes

Stated in full at the top of the migration (`0035:11-30`). They are independent, and fixing any
three of them would have left the symptom intact.

| # | Fault | Where it lived |
|---|---|---|
| 1 | **A partial પુનરાવર્તન was never paid at all.** `activity_submit()` calls `award_points()` only when `status = 'COMPLETED'`, and લેવલ ૩ is COMPLETED only when `completed_n >= total_n` — all ૧૦૮. Ticking ૫૦ and pressing નોંધાવો reached the award engine **zero times**, under every configuration, including the per-તિક rule that exists precisely to pay partials. | `0021:970-975`, `0021:828-832` |
| 2 | **Ticking wrote no event.** A tick was a localStorage write flushed to `progress`, which holds one integer, `level3_score`. No attempt row, no ledger row, no દ્રશ્ય ids. A યુવક who ticked ૫૦ and walked away left nothing any report or board could see. | `src/lib/progress.js:31-35`, `:223` |
| 3 | **The ticked set existed only on one handset.** Nothing server-side held "what is ticked right now", so a refresh on a second phone restored a *score floor* and no boxes. | `src/lib/progress.js:164` (`scoreOf`) |
| 4 | **Nothing could tell સાધના from a scroll.** લેવલ ૨ records a દર્શન when the foot of the list is half on screen — true after a four-second flick — and લેવલ ૩ measured nothing whatsoever. | `src/modules/darshan/DarshanFeed.jsx:118-132` |

---

## 2. The flow, as it actually runs

```text
ADMIN                                          YUVAK
  │                                              │
  ▼                                              ▼
settings['levels'].value.points            checkbox  (LevelPage → useLevel3Session)
  ├── tick.mode / tick.perTick                    │  src/lib/level3.js:456
  ├── earn.tickCount                              │  debounced 2.5s, ceiling 12s (:63-70)
  └── points.pace.secondsPerTick                  ▼
                                          level3_draft_save(p_scene_ids)   0035:1201
scene_catalog  ◄── npm run catalog                │  · stores the ids as sent
  0035:139                                        │  · adds now() − updated_at to engaged_ms
  │                                               │  · discards a gap > pace.maxGapSeconds
  │                                               ▼
  │                                       level3_drafts    ← ONE row per યુવક, not an event
  │                                         0035:457       · scene_ids[], engaged_ms
  │                                               │        · no points, no history, no number
  │                                               │
  │                                   નોંધાવો ────┤──── ફરી શરૂ કરો (level3_reset → the same call)
  │                                               ▼
  │                                       level3_finalize(p_client_token)  0035:1456
  │                                               │   → level3_commit()    0035:1287
  │                                               ▼
  │                                       activity_attempts   ← THE EVENT, immutable
  │                                         attempt_number = the પુનરાવર્તન number
  │                                         selected_scene_ids[], engaged_ms, status
  │                                               │
  └──────────────────────►  award_points()  ◄─────┘   0035:523  (reissued, same signature)
                                 │                     · ids ∩ live_scene_ids()
                                 │                     · least(fresh, admin_content_total())
                                 │                     · least(fresh, engaged/secondsPerTick)
                                 ▼
                           point_award()  ──► point_transactions   ← append-only, ONE writer
                                                   award_kind = 'TICK' | 'REVISION'
                                                   idem key = 'tick:<attempt id>'
                                                   │
        ┌──────────────────────┬───────────────────┼─────────────────────┐
        ▼                      ▼                   ▼                     ▼
  activity_history       my_point_history     leaderboard()      admin_level3_report()
  /history               0033:1504            0023:424           0035:2053 → ProgressPage
  0033:1963                                                      → Excel export (xlsx)
```

Two entries into `award_points()` and not one, because `activity_submit()` is **not** reissued
(`0035:105-110`) — it is 0021's statement of what an attempt is:

* `level3_commit()` calls it directly (`0035:1428`), which is the path every નોંધાવો takes now.
* The `activity_attempts_level3_award` AFTER INSERT trigger (`0035:835-867`) catches the attempts
  `activity_submit()` skips — `status <> 'COMPLETED'` — for any handset still running a bundle
  cached before this change. Its WHEN clause is exactly that condition, so the two never overlap;
  overlapping them would have made `pointsAwarded` read 0 on screen for everybody, because the
  second call to a keyed award is an idempotent no-op (`0035:824-829`).

Both are keyed on `tick:<attempt id>`, so a payment happens once whichever arrives first.

---

## 3. What was already there, and what is new

**Reused, unchanged, and deliberately not duplicated:**

| Thing | Where | Why it needed nothing |
|---|---|---|
| The cumulative rule — ૫૦ then ૪૦ is ૯૦, then ૩૦ is ૧૨૦, no cap | `0033:986-1063`, the `TICK` branch under `earn.tickCount = 'ALL'` (`0033:994`) | Already implemented and already tested; `scripts/test-point-bonus.mjs` asserts ૧૦૮ then ten more is ૧૧૮ |
| The revision number | `activity_attempts.attempt_number`, scoped to (યુવક, level, activity, day), 0021 | Already the per-day sequence, already computed server-side inside the INSERT |
| The per-revision history | `activity_attempts`, append-only, carrying `selected_scene_ids` | Already what every history view, every admin report and `point_bonus_count()` read |
| The ledger | `point_transactions`, one INSERT site (`point_award()`) | §18 and §24 forbid a second one, and `docs/POINT_DATA_FLOW.md` records single-writer as the property that must not break |
| Withholding | `admin_withheld_scene_ids()` (`0029:197`) | Already subtracted from every tick count |
| The collection's size | `admin_content_total()` (`0029:150`) | Already the server's own number, derived from 180 days of attempts |

**So there is no new points table, no new history table and no second scoring computation in
0035** (`0035:44-47`). What is genuinely new:

| New | Where | What it is for |
|---|---|---|
| `public.scene_catalog` | `0035:139-155` | The list of valid દ્રશ્ય ids. Ids only — never a copy of the દર્શન |
| `scene_catalog_ready()`, `live_scene_ids()`, `scene_catalog_sync()` | `0035:161`, `:179`, `:210` | Is it filled; the catalogue minus the withheld; the wholesale replace |
| `public.level3_drafts` | `0035:457-500` | The **unfinished** પુનરાવર્તન. One row per યુવક, not per session |
| `activity_attempts.engaged_ms` | `0035:420-432` | Server-measured attention, NULL when unmeasured |
| `point_pace()` + the `settings_check_pace` trigger | `0035:287`, `:334` | The pace numbers, resolved and validated, under their own key |
| `level3_draft_get/save/commit/finalize/reset`, `level3_snapshot`, `my_level3_summary` | `0035:1126`-`:1554` | Open, autosave, finish, start again, and one document the page renders |
| `activity_attempts_level3_award` trigger | `0035:835` | Pays the partials `activity_submit()` skips |
| `admin_level3_report()`, `admin_user_level3_detail()` | `0035:2053`, `:2164` | The panel's per-યુવક figures and one યુવક's full history |

`award_points()`, `daily_record_points()` and `daily_record_save()` are **reissued** — same
signatures, same callers — which is what 0031 and 0033 both did to `award_points()` for this same
kind of change (`0035:101-104`).

---

## 4. The catalogue — the check 0021 said it could not make

`activity_submit()` says so in its own comment:

> "Unlike `level4_submit()` this does **not** intersect with a required list, because લેવલ ૩ has
> no fixed list to intersect with" — `0021:804-806`

That was true. The collection is `content/darshan.json`, a file in the browser bundle;
`public.scenes` holds only the rows a સંચાલક has touched. Postgres could exclude a *withheld*
દ્રશ્ય but had no way to refuse an id it had never heard of, so five hundred invented ids counted
as five hundred ticks (`0035:81-86`).

Three properties keep the fix from becoming a new way to break:

1. **An empty catalogue checks nothing.** Every membership test is conditional on
   `scene_catalog_ready()` (`0035:161-169`, used at `0035:587` and `0035:977`). Until the first
   sync runs, behaviour is exactly what it was. A migration that silently stopped paying every
   યુવક until a build step ran would be the worst failure available here.
2. **`admin_content_total()` is the backstop either way** (`0035:645-654`). Even with no
   catalogue, no submission can be paid for more દ્રશ્યો than the collection is known to hold.
3. **An empty payload is refused**, SQLSTATE 23514 (`0035:242-245`). Accepting one would empty the
   catalogue and stop every તિક being paid, which is too expensive to allow by accident.

**The catalogue carries every id the manifest contains, not only the ones a યુવક can see today.**
Both of `useScenes()`'s gates — `isWithheld` (`src/lib/useScenes.js:22-24`) and then `isLearnable`
(`shared/domain/darshan.js:54`) — are answered elsewhere and at read time: `live_scene_ids()` is
*the catalogue minus* `admin_withheld_scene_ids()`, evaluated per statement (`0035:179-189`), and
`applyOverlay()` re-derives `active` from a વર્ણન written in the panel
(`shared/domain/darshan.js:93-100`). Filtering here instead would delete a દ્રશ્ય from the
catalogue when a સંચાલક withholds it at noon, and restoring it at one o'clock would leave the
server unable to recognise its own id until somebody re-ran a Node script.

`display_index` rides along, nullable, filled from `withDisplayIndex()`
(`shared/domain/darshan.js:290`) so a report printing "દ્રશ્ય ૪૨" need not ask a browser what ૪૨
means (`0035:131-138`). It is advisory: the **id** is what every check turns on.

Writing is `scene_catalog_sync()` and nothing else — SECURITY DEFINER, `darshan.update`
(`0035:219-221`), whole-list replace inside one transaction so the catalogue is never momentarily
empty (`0035:199-209`). RLS is on with a read policy for any signed-in caller and **no write
policy at all** (`0035:2263-2288`).

---

## 5. The pace rule — "૫૦ ટિક માટે ૫૦ સેકંડ"

One તિક is worth one second of attention, at whatever rate the સંચાલક set:

```text
paid ticks = least( valid ticks, (engaged seconds + graceSeconds) / secondsPerTick )
```

Integer division throughout (`0035:679-682`), so a part-second buys nothing and the arithmetic is
the arithmetic a યુવક can do in his head. At `secondsPerTick = 1, graceSeconds = 0`:

| Ticks | Measured attention | Paid | Recorded |
|---|---|---|---|
| ૫૦ | ૫૦ s | **૫૦** | ૫૦ |
| ૫૦ | ૪૫ s | **૪૫** | ૫૦ |
| ૧૦૮ | ૧૨ s | **૧૨** | ૧૦૮ |
| ૧૦૮ | ૩ min | **૧૦૮** | ૧૦૮ |

Every one of those rows is an assertion in `scripts/test-level3-revisions.mjs` §F.

**It is a cap and never a gate**, and that is a decision rather than an accident (`0035:58-64`,
restated at `0035:656-661`). A gate — "under the time, pay nothing" — punishes a યુવક who was
thirty seconds quick exactly as hard as one who flicked to the bottom, and §1 rule 4 refuses that
reading. The સાધના is never erased either way: all ૧૦૮ ticks are still stored on the attempt row,
only some of them are unpaid.

**The seconds are counted by this database and never by the handset.** There is no `p_engaged_ms`
parameter anywhere in 0035 and there must not be one (§17). `level3_draft_save()` accumulates the
gap between one autosave and the next against its own `now()`, and discards any gap longer than
`pace.maxGapSeconds` (`0035:1232-1237`) — a phone left open on a bus counts as nothing. The RLS
policy on `level3_drafts` is **select only** for exactly this reason: "an own-row UPDATE policy
would hand the યુવક `engaged_ms`, and `engaged_ms` is the pace rule" (`0035:2274-2282`).

Three further details worth knowing:

* **NULL does not bind.** `engaged_ms` is NULL for any attempt written by `activity_submit()`,
  which is not reissued. That is read as "unmeasured", and an unmeasured attempt is paid without a
  pace check (`0035:414-419`). Treating NULL as zero seconds would stop paying every યુવક who had
  not yet reloaded — a worse failure than a transitional gap that closes itself.
* **Per-તિક mode only.** `REVISION` mode prices a submission rather than a દ્રશ્ય, so a rule
  written per તિક has nothing to say about it (`0035:667-669`).
* **The numbers live under `points.pace`, not inside `tick`.** `settings_check_points()` refuses
  unknown keys inside `tick` (`0033:1387-1388`), so widening it would mean reissuing a
  three-hundred-line trigger that guards every level's pricing. `point_pace()` and
  `settings_check_pace()` are a second resolver and a second trigger instead (`0035:271-276`),
  mirrored in JS by `resolvePointPace()` (`shared/domain/points.js:1140-1168`).

Defaults, each falling back to the behaviour of the day before it existed (`0035:278-286`):
`secondsPerTick` 0 (no rule), `graceSeconds` 0, `maxGapSeconds` **180** — not 0, because 0 would
mean no time could ever accumulate.

---

## 6. The reconciliation that would otherwise have undone all of it

0034's `daily_record_save()` forces `sum(ledger for the day) == the record's total` by writing one
compensating `DAILY_ADJUST` row, and it prices લેવલ ૩ from `daily_activity_counts` as a **distinct
set of દ્રશ્યો for the day**. Together those two facts are a trap (`0035:116-121`): ૫૦ then ૪૦
accumulates to ૯૦ in the ledger, the record computes ૫૦ distinct દ્રશ્યો, and the first save of
the /daily form writes **-૪૦**. The feature would unwind the moment a યુવક opened a screen that
has nothing to do with it.

The fix is a division of ownership rather than a new sum:

* `daily_record_points()` returns 0 for લેવલ ૩ whenever `tick.mode` is TICK or REVISION
  (`0035:1609-1611`).
* `daily_record_save()` excludes `TICK` and `REVISION` rows from the base it reconciles against
  (`0035:1946-1951`), and adds them back into the day's **stored** total (`0035:1953-1959`,
  `:2000-2005`) — so 0034's guarantee holds exactly as before.
* The panel still shows what was actually paid rather than the 0 (`0035:1890-1900`).

`tick.mode = 'ACTIVITY'`, levels ૧, ૨ and ૪, and the twenty-four hour window are untouched.

---

## 7. Turning it on — the two settings

Nothing above changes what any project pays until a સંચાલક changes two things (`0035:2300-2311`):

1. **`settings['levels'].value.points.tick.mode = 'TICK'` with `perTick` above 0, and
   `earn.tickCount = 'ALL'`.** That is the ૫૦ + ૪૦ = ૯૦ rule, and it predates 0035. The panel
   already has both controls: `admin/src/features/points/components/Level3Card.jsx` for the mode
   and the per-તિક value, `EarningModeCard.jsx` for the FRESH/ALL question.
2. **`settings['levels'].value.points.pace.secondsPerTick` above 0**, for the pace rule —
   `admin/src/features/points/components/PaceCard.jsx`.

Until then `tick.mode` is ACTIVITY, `secondsPerTick` is 0, and every branch 0035 adds is skipped.
That is deliberate: a migration that started charging or refusing on the day it was applied would
be deciding policy that belongs to a person.

There is a third step that is **not** a setting and is easy to forget: **run the catalogue sync.**
Until it runs, an invented id is still counted as a tick (bounded only by `admin_content_total()`),
which is exactly the state a project is in between applying 0035 and running the script.

---

## 8. Running the sync, and the tests

### The catalogue sync

```bash
npm run catalog:dry                              # what would be sent; opens no connection
SUPABASE_DB_PASSWORD=… npm run catalog           # the real thing
SUPABASE_DB_PASSWORD=… npm run catalog -- --as <uuid>    # impersonate a named સંચાલક
npm run catalog -- --file some/other/darshan.json
```

`scripts/sync-scene-catalog.mjs` reads `content/darshan.json`, numbers it through
`withDisplayIndex()`, and calls `scene_catalog_sync()` once. It refuses an unreadable, non-array
or empty manifest before opening a connection, with the same reasoning the SQL uses. It prints how
many ids were sent, how many the function stored, how many were already catalogued, and what
`live_scene_ids()` now returns — and it prints no credential, no connection string and no name,
mobile or email of the account it signed as.

Because `scene_catalog_sync()` checks `has_permission('darshan.update')`, which reads `auth.uid()`
from `request.jwt.claims`, connecting as the database owner is not enough — superuser bypasses
*grants*, never a `raise exception` in a function body. The script therefore impersonates, the way
`scripts/lib/pgtest.mjs:195-213` does, picking a candidate from `admin_profiles` (ACTIVE) and
`bootstrap_admins` (`0024:88-94`) and asking the database itself which of them qualifies. No list
of privileged mobiles is copied into the script — 0024 exists because such a list in the wrong
place was an unclaimed SUPER_ADMIN account.

**Re-run it after every `npm run darshan` that adds a દ્રશ્ય.** Ids are never removed from the
manifest (ORDERING.md §1), so in practice a sync only ever adds.

Connection targets and their fallbacks are `scripts/db.mjs`'s, unchanged. This is not
`db.mjs migrate` and must not be confused with it: production's `schema_migrations` lists only
0001-0003 while the schema is far ahead (`scripts/db.mjs:78-89`), so 0035 itself is applied by
name, `node scripts/db.mjs apply 0035_level3_revisions.sql`.

### The test suites

```bash
npm run test:level3      # scripts/test-level3-revisions.mjs alone
npm test                 # the whole chain, level3 last
```

Both need Docker: the suite runs `docker run postgres:16`, applies `supabase/test/prelude.sql` and
every migration in filename order, then drives the real writers (`scripts/lib/pgtest.mjs:68-180`).
No test calls `award_points()` by hand.

**Set `VARNI_PGTEST_NAME` and `VARNI_PGTEST_PORT` if there is any chance of two runs overlapping.**
`startDatabase()` opens with `docker rm -f` on the container name, so a second suite started
alongside the first does not share a container — it **destroys** the first one's mid-run, and the
first dies several hundred assertions in with `Connection terminated unexpectedly`, naming no
cause (`scripts/lib/pgtest.mjs:31-43`). Port 54833 is known-good on this machine; the default
55433 falls inside a range Windows reserves for Hyper-V on some hosts, where the bind fails with
EACCES and reads as a permissions problem.

```bash
# bash
VARNI_PGTEST_NAME=varni-l3 VARNI_PGTEST_PORT=54833 npm run test:level3
```

```powershell
# PowerShell
$env:VARNI_PGTEST_NAME='varni-l3'; $env:VARNI_PGTEST_PORT='54833'; npm run test:level3
```

The suite fakes only the *starting point* of the clock: it moves `level3_drafts.updated_at`
backwards and then calls the real `level3_draft_save()`, which measures the gap against its own
`now()` exactly as it would in production (`scripts/test-level3-revisions.mjs:23-32`).

---

## 9. What was left alone, and should stay that way

Not reissued, on purpose (`0035:105-110`, `:2262-2268`): `activity_submit()`, `level4_submit()`,
`settings_check_points()`, `point_rules()`, the unlock machine (`level4_gate_open()`,
`deriveStatuses`, `level4_activity_states`), `progress.level3_score` and its absent guard, and
every row already in `point_transactions`.

`progress.level3_score` is still written by the handset and is still what the લેવલ ૪ gate reads.
0035 does not move that, because who may reach લેવલ ૪ is an **access** question and 0031/0033 both
keep scoring changes out of it. The consequence is a division of labour worth stating once:

* `src/lib/progress.js` owns **the day** — one integer, a monotonic floor, phone-first.
* `src/lib/level3.js` owns **the session** — the ticked ids, the autosave, the snapshot. It never
  writes `progress`, and `progress` never learns what is ticked (`src/lib/level3.js:33-34`).
* Neither computes a point value or measures a second. Both are the server's.

Two things the client half is deliberately not trusted with, and which are enforced in SQL rather
than in React: the idempotency of નોંધાવો (three defences in order — the client token, an empty
draft, and the award key; `0035:1270-1286`) and the meaning of ફરી શરૂ કરો. **A reset is a save,
never a delete** (`0035:1504-1510`): `level3_reset()` is `level3_finalize()`, so the ticks standing
when he presses it are finished into their own event and paid, and only then does the board clear.
There is no code path in 0035 that removes an attempt, removes a ledger row, or lowers a total.
