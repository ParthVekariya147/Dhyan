# Daily activity records, the 24-hour edit window, and how they meet the ledger

The §1 audit report, written before any code, from a read of every migration, `src/`,
`admin/src/`, `shared/domain/` and `scripts/`. Every structural claim carries `file:line`.

The headline, because it decides the whole design:

> **Nothing in this system can currently change a day's total.** `point_transactions` has one
> INSERT site, no UPDATE path, no DELETE path and no policy for either. A daily record whose
> total moves from ૧૪૩૦ to ૧૬૩૦ therefore cannot restate anything — it can only **add a
> compensating row**, which is the doctrine the schema already states in as many words
> (`0031:669-674`): *"A correction that was itself a mistake is corrected by a third row, and all
> three stay."*

---

## 1. Current source of truth

| Question | Answer | Where |
|---|---|---|
| Did the યુવક do the activity? | `activity_attempts` (levels 1-3), `level4_attempts` (level 4) — append-only, one row per submission | `0021:97-155`, `0010` |
| What was he paid? | `point_transactions` — append-only ledger | `0021:236+` |
| What is his day worth? | `sum(point_transactions.points)` for that IST `activity_date` | `0021:1362-1372` |
| Where does the board come from? | the same sum, windowed | `0023:502-517` |

## 2. Current write paths

**One INSERT site in the entire schema: `point_award()`.** Everything funnels through it.

```
activity_submit() step 9  ──┐
  (0021:970-975)            ├──► award_points() ──► point_award() ──► point_transactions
level4_attempts_award       ──┘   (0033:937)         (0033:166,179)
  trigger (0021:1096)                │
                                     └──► point_bonus_apply() ──► point_award()  [BONUS]
admin_award_manual_points() ─────────────────────────────────────► point_award()  [MANUAL]
```

Eight award shapes exist today: `DAY_FIRST`, `REPEAT` (carrying the `EVERY`, `ONCE` and level-4
repeat rules), `TICK`, `REVISION`, `BONUS`, `MANUAL`, and `NULL` for pre-0031 history.

Two gates sit above every one of them (`0033:975-981`): the master switch
`point_settings().enabled`, and `point_rule_live(level, key, date)`.

## 3. Current read paths

`my_point_summary()`, `my_point_history()`, `my_point_totals()`, the `activity_history` view,
`leaderboard()`, and 0032's seven `admin_*` readers. All derive from the ledger; none stores a
total. **There is no second scoring computation anywhere**, and that property is the one this
work must not break.

## 4. Which tables can be reused

| Table | Verdict |
|---|---|
| `activity_attempts`, `level4_attempts` | **Reuse read-only.** Every count, every history view and `point_bonus_count()` derive from them. Untouchable. |
| `daily_activity_progress` | **Reuse read-only.** Already one row per (યુવક, day, level, activity) — but *entirely derived*, recomputed from the day's attempts on every submit (`0021:920-962`), and carries no points. It is the shape a daily record wants and cannot be it. |
| `point_transactions` | **Reuse as the only ledger.** Extended with one new award kind and one new source. |
| `point_bonus_rules` | **Reuse.** 0033's milestone engine already does additive milestones. |
| `progress` | **Do not repurpose.** See below — it is the one trap in this audit. |

### `progress` is a trap, and the audit disagreed with itself about it

`public.progress` (`0001:46-60`) is per (user, date), has own-row `insert`/`update` RLS
(`0004:602-610`), and looks like free real estate for a daily record.

Two reads of the codebase contradict each other, and this must be resolved before anyone builds
on it:

* `src/lib/progress.js:255-268` and `:367-368` show **the browser upserting `level3_score`**,
  with a debounced flush loop and a keepalive path.
* `admin/.../reportService.js:29-35` states flatly that **"nothing in this codebase writes it"**.

The code is the stronger evidence; the comment is most likely stale. Either way the conclusion is
the same: `progress` is **the only user-writable per-day table in the schema, and it is also the
one that has already caused a silent data-loss bug** — 0026 exists solely because a second device
could write a lower `level4_score`, and its header (`0026:48-51`) explains why the fix had to be
a `BEFORE UPDATE` trigger rather than a policy. Building a points-bearing daily record on that
table would inherit the trap. **A new table is safer and is what this design uses.**

## 5. What has to be added

1. **A daily record table**, user-writable, one row per (યુવક, date), holding the *reported*
   count per level beside the *recorded* count, plus the window fields.
2. **A 24-hour edit window.** There is **no precedent anywhere in this schema** — a case-insensitive
   search for `edit_until`, `locked_at`, `edit_window`, `expires_at`, `interval '24` and a dozen
   variants returns nothing. What exists is *state*-based freezing (`level4_guard_editable()`,
   `0010:1183-1230`), write-once column guards (`profiles_guard_immutable()`), and a monotonic pin
   (`progress_guard_level4_score()`, `0026:74-104`). This is the schema's first **time**-bounded
   mutability rule and it must be enforced by a trigger, not a policy — a policy sees the new row
   and not the old one, and does not apply to `service_role`, which is exactly 0026's argument.
3. **A compensating award kind.** Every existing negative row is either `level_id = 0` (MANUAL,
   belonging to no level) or a BONUS keyed to a milestone number. Nothing writes a delta against
   `(user, date, level, activity)`. That is the new piece, and it must satisfy
   `point_transactions_repeatable_needs_key` (`0031:188-192`) by carrying an idempotency key.
4. **Per-activity configuration validity.** Today the ledger stamps a bare integer `rule_version`
   (`0033:163`) that **points at nothing** — no table maps a version to the document that produced
   it, and the only way to reconstruct an old configuration is to replay `audit_logs` jsonb by
   timestamp. `effectiveFrom` is a single project-wide date with no `effective_until` and no
   per-activity dates.
5. **A duration formatter.** Nothing in the repo formats hours+minutes; the nearest is
   `totalMinutes()` in `shared/domain/viewing-speed.js:98-109`, whose rule — *omit the line rather
   than print a confident zero* — carries over.

## 6. How the day reconciles — the mechanism

The user's decision was **events award, the form adjusts**, with counts trusted above what the app
recorded. So:

```
09:00  દર્શન submitted   ──► auto-award  +૨૦૦   (DAY_FIRST or EVERY, unchanged)
10:00  દર્શન submitted   ──► auto-award  +૨૦૦
       daily record prefilled: level 2 = ૨   (recorded = ૨, reported = ૨)

18:00  યુવક edits to ૩
       target base for the day  = ૩ × ૨૦૦ = ૬૦૦
       ledger's non-bonus sum   =           ૪૦૦
       delta                    =          +૨૦૦  ──► one DAILY_ADJUST row
```

The day's ledger sum then equals the daily record's computed total **by construction**, which is
what makes §39 — history equals leaderboard equals admin report — true rather than hoped for.
Nothing is rewritten; the ledger stays append-only; and the audit trail records ૨ → ૩ and
૧૪૩૦ → ૧૬૩૦ separately from the money.

Three consequences worth stating plainly:

* **A delta may be negative** (the યુવક corrects ૩ back down to ૨), so
  `point_transactions_points_check` must admit the new kind alongside `MANUAL` and `BONUS`.
* **`source` must gain a third value.** `point_transactions_source_check` allows only
  `ACTIVITY_ATTEMPT`, `LEVEL4_ATTEMPT`, `MANUAL_ADJUSTMENT` (`0031:153-154`).
* **The idempotency key cannot be the attempt id.** Every existing key for a repeatable kind is
  built from `activity_attempts.id` (`0033:1057`, `:1086`, `:1142`); reusing one would be refused
  as a duplicate, and minting a fake attempt per edit would create the second scoring system this
  design exists to avoid. The key is the record and its version.

## 7. Counts are trusted, and the trust is recorded

The decision is that a યુવક may report more than the app observed — activity done away from the
phone still happened. Two guardrails keep that honest without disbelieving him:

* Each level stores **`reported_count` beside `recorded_count`**, and a row is `verified` only
  when reported ≤ recorded. The admin report shows both, so a figure resting on self-report is
  visible as such rather than indistinguishable from an observed one.
* A **per-level daily maximum**, admin-configurable, bounds the dropdown — the requirement asked
  for exactly this in its first statement of the feature (*"0, 1, 2, 3 … N, પરંતુ આ maximum પણ
  dynamic/configurable રહેશે"*). Nothing is hardcoded; the maximum is a setting.

## 8. What must not change

1. Every existing `point_transactions` row. `award_kind IS NULL` is the definition of pre-0031
   history and nothing may touch one.
2. The unlock and repeat-access machine — `deriveStatuses`, `withStatuses`,
   `level4_activity_states`. What a યુવક may attempt is an access question; what he is paid is a
   scoring question, and §49 is explicit that points are a layer over progression, never a change
   to it.
3. `activity_submit()`, `level4_submit()` and `level4_attempts_award()` — not reissued. Every
   scoring change goes inside `award_points()`, as 0031 and 0033 both did.
4. `leaderboard()`'s privacy contract: a name and a number, never a user id.
5. The single-writer property. If a second function ever inserts into `point_transactions`, the
   reconciliation guarantee in §6 stops being provable.

## 9. Duplicate and legacy systems found

* **`learning_state` / `learning_sessions`** (0001) hold zero rows in production and nothing has
  written them for as long as the current levels have existed. Legacy. Not touched.
* **A naming collision.** `admin/src/features/points/pages/DailyActivityPage.jsx` already exists
  and is already called "Daily activity" — an admin-side, read-only, date-filtered report with
  CSV/Excel export. The admin half of this work is an **extension of that page**, not a new one,
  and the new user-facing screen needs a name that does not collide.
* **`public.progress`** — see §4. Adjacent, unused for its apparent purpose, and load-bearing for
  લેવલ ૩; left alone.

## 10. The acceptance bar for the new screen

`scripts/verify-mobile.mjs` tests six phone widths plus three wide, and asserts far more than "no
overflow": every element inside the viewport (not merely `scrollWidth`), every control ≥ 44px,
no text under 12px, inputs ≥ 16px against iOS focus zoom, `h1` between 18 and 28, and **validation
must not move the submit button by a single pixel**. It also enforces a **design-system
fingerprint**: `/register` and `/forgot-password` must produce numerically identical control
heights, radii, font sizes and container widths to `/login`.

That fingerprint loop only fits `.auth-wrap` forms. A daily-activity screen lives inside the app
shell, so `scripts/verify-nav.mjs` is its model — same widths, a stated DOM contract, tap targets
≥ 44px in **both** dimensions, and content never hidden behind the fixed bottom bar.

One detail that will bite: **the યુવક app contains no `<input type="date">` at all.** It would be
the first, and `forms.css` styles `.field input` without accounting for Chrome's native calendar
control, which has its own intrinsic sizing. It must be measured against `--control-h`, not
assumed.

---

# What was built, and what building it found

0034 applies, is re-runnable, and its suite is **164 passed, 0 failed**. The neighbouring suites
are unmoved: point-engine 332, point-bonus 174, point-rules 661, admin-progress 132, RLS 89.

## The date input was 52px against a 50px select

The prediction in §10 was right and the cause was smaller than expected: Chrome's UA stylesheet
puts `padding: 1px 0` on `::-webkit-datetime-edit`, and those were the two stray pixels. Three
further things had to be corrected — WebKit keeps an intrinsic width, centres the value where every
other control left-aligns it, and paints a near-black calendar glyph that is invisible on this
app's `#14100b` field. Measured after the fix: the date and the select are an identical
50 × 284 box at every width, and the "validation moves nothing" property holds at **0.00px**.

## The countdown is anchored to a duration, not to an instant

`remaining_seconds`, not `edit_until`. A handset clock four minutes fast would otherwise lock a
form four minutes early, and phones in this deployment are not reliably in sync. Each tick
recomputes from a stored deadline rather than decrementing, because a backgrounded tab has its
timers throttled or paused; a `visibilitychange` resync means the first frame after returning is
correct rather than a minute stale. The client never checks the window before submitting — the
server decides, and a refusal at the boundary re-reads the record so the screen shows what the
server thinks rather than what the phone believed.

## Three things the engine had to settle

**`p_counts` is an array, not a level→count map.** The client was written first and sent
`{"1": 0, "2": 3}`. That shape cannot say which કસોટી a લેવલ ૪ count belongs to, and the only way
to make it work would be to derive `'video'`/`'darshan'`/`'revision'` from a level number — putting
0021's vocabulary into a file with no business knowing it, and having nothing to say about ૪.૧.
0034 refuses a non-array **with a message naming the shape**, so this surfaced as a diagnosable
error rather than a યુવક's Saturday quietly saving as zero.

**`dailyMax`'s floor is 1, not 0.** `point_rules()` resolves an out-of-range number to *absent*,
and absent means "no maximum" — so a saved 0 would read back as unbounded, the exact opposite of
what was typed. A level meant to pay nothing is switched off in `disabled`, which already exists.

**Where the compensating row is filed.** It carries `level_id = 0`, so `activity_history`'s
per-activity `points` column does not include it while the **day total** does. That was already
true of MANUAL rows since 0031; DAILY_ADJUST makes it ordinary. The rule it implies is worth
stating: *the per-key column is not summable to a day total, and a screen that adds it up is
wrong.*

## Two gaps left open, honestly

**Re-saving an old day reprices it at today's values.** `point_value_for()` has no date dimension —
only the project-wide `effectiveFrom` does. Paid rows are never rewritten, so no history changes,
but the *target* a re-save reconciles toward is computed at current prices. `point_config_versions`
records what would be needed to fix this; a per-day price replay is a separate migration.

**Awards made before 0034 resolve to no configuration document.** One snapshot is seeded for what
is in force now, so everything from here forward resolves. Earlier awards are explained by the
number stored on the row, which is the same doctrine as `award_kind IS NULL`.

## Two defects in earlier migrations, reported and not changed

* **`point_bonus_apply()` is reachable only through `award_points()`**, so the two gates that must
  precede any award — the master switch and `point_rule_live()` — live in the *caller*. 0034 had to
  restate both. They belong inside `point_bonus_apply()`, and the third caller will get this wrong.
* **`rule_version` is stamped from `point_rules()` even for a `DAY_FIRST` row whose price came from
  `point_value_for()`** — two resolvers, one version number. Harmless today because both read the
  same settings row, but the number describes the rule *set* and not the value paid.
