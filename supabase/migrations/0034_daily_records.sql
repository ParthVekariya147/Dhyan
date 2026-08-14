-- વર્ણી ધ્યાન — the day the યુવક says he had, and the ledger made to agree with it.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT IS MISSING, AND WHY IT CANNOT BE BUILT OUT OF WHAT IS THERE
-- ════════════════════════════════════════════════════════════════════════════
--
-- Everything this project knows about a day is an **event**. `activity_attempts` records a
-- લેવલ ૧-૩ નોંધાવો, `level4_attempts` records a કસોટી, and `point_transactions` records what
-- each of those was paid. There is no row anywhere that says "this is my day" — no place a
-- યુવક may state that he did દર્શન three times when the phone was only open for two, and no
-- place a સંચાલક may read a self-reported figure beside an observed one and tell them apart.
--
-- Three tables look like they could be that place and none of them is:
--
--   * `daily_activity_progress` (0021:190-215) is already one row per (યુવક, day, level,
--     activity) and is the right *shape*. It is also **entirely derived** — recomputed in full
--     from the day's attempts on every submit — and it carries no points. A column a યુવક
--     writes there would be erased by the next recount.
--   * `progress` (0001:46-60) is per (યુવક, day) and is the only user-writable per-day table in
--     the schema. It is also the one that has already lost data: 0026 exists solely because a
--     second tab could write back a stale `level4_score`, and its header (0026:48-51) is the
--     argument this file leans on twice. A points-bearing record built there inherits the trap.
--   * `point_transactions` is money, is append-only, has one INSERT site and no UPDATE or
--     DELETE path for anybody. It cannot hold an editable figure and must not learn how.
--
-- So: a new table, user-writable, one row per (યુવક, IST day), holding what he **reports**
-- beside what the app **recorded**, with the window in which he may still change his mind.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE ONE IDEA THIS FILE IS BUILT ON
-- ════════════════════════════════════════════════════════════════════════════
--
-- **Nothing in this system can change a day's total, and nothing here learns to.**
--
-- A record whose total moves from ૧૪૩૦ to ૧૬૩૦ does not restate anything. It writes ONE more
-- ledger row for the difference, which is the doctrine 0031 already states in as many words
-- (0031:669-674): *"A correction that was itself a mistake is corrected by a third row, and
-- all three stay."* The row is written through `point_award()` — still the only INSERT site in
-- the schema — under a seventh award kind, `DAILY_ADJUST`, and it may be negative, because a
-- યુવક who corrects ૩ back down to ૨ is making a correction and a correction is subtraction.
--
-- The consequence is the guarantee the rest of the system needs:
--
--     sum(point_transactions.points) for (યુવક, day)  ==  daily_activity_records.total_points
--
-- **by construction**, on every save, in the same transaction. History, the board and the
-- સંચાલક's report all read the ledger; the record is the only thing that reads a stored total;
-- and the two are equal because the save makes them equal before it returns.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE 24-HOUR WINDOW — the schema's first time-bounded mutability rule
-- ════════════════════════════════════════════════════════════════════════════
--
-- `edit_until = first_submitted_at + interval '24 hours'`, and there is no precedent anywhere
-- in this schema to copy. What exists is *state*-based freezing (`level4_guard_editable()`),
-- write-once column guards (`profiles_guard_immutable()`) and a monotonic pin
-- (`progress_guard_level4_score()`, 0026). None of them is about the clock. So the reasoning
-- is written out here rather than assumed:
--
-- **From the first submission, never from midnight and never from `activity_date + 1 day`.**
-- A યુવક who fills his day in at ૨૩:૫૦ would otherwise get ten minutes, and one who fills it
-- in the next morning would get none at all. The window is a property of when he *spoke*, not
-- of the day he spoke about — which also means a record may be opened for a past date and
-- still get its full day to be corrected. Bounding how far back he may reach is a separate
-- decision, with no setting behind it yet, and inventing one here would be inventing policy.
--
-- **A BEFORE UPDATE trigger, not a policy**, for 0026's stated reason and both halves of it:
--
--   * a policy sees only the NEW row, so it cannot express "unchanged since" — and the whole
--     rule here is a comparison of `now()` against a value that is already on the OLD row;
--   * a policy does not apply to `service_role`, and a trigger does. A window a service key
--     walks through is not a window.
--
-- The trigger is also the only reason the column list below is safe to expose. RLS gives the
-- યુવક an own-row UPDATE policy because the user-owned idiom (`progress`, 0004:602-610) is
-- what these tables are; the trigger then says that there is nothing on the row he may move.
-- The policy states the ownership and the trigger states the ownership's limits, and it takes
-- both, because a grant alone would leave `edit_until` writable by the person it binds.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION DOES NOT DO
-- ════════════════════════════════════════════════════════════════════════════
--
-- **It does not touch one existing ledger row.** No UPDATE, no DELETE, no recomputation, no
-- backfill. `award_kind IS NULL` still means "written before 0031" and still means nothing
-- else. §K of scripts/test-daily-records.mjs asserts the three pre-0031 fixtures are column
-- for column what they were after everything in this file has run.
--
-- **It does not change what an untouched project pays.** `dailyMax` is optional and absent
-- means no maximum; a project with no daily record has no `DAILY_ADJUST` row and no changed
-- award; `point_bonus_count()` falls back to the event tables for every (day, level, activity)
-- that has no record, which is every one of them until somebody saves. Asserted, not assumed.
--
-- **It does not reissue `activity_submit()`, `level4_submit()` or `level4_attempts_award()`.**
-- Their reasoning belongs to 0021 and 0017 and has not changed. As in 0031 and 0033, every
-- change lands inside functions those three already call.
--
-- **It does not touch the unlock or repeat-access machine.** `deriveStatuses`,
-- `level4_activity_states` and the gate are untouched. What a યુવક may attempt is an access
-- question; what he is paid is a scoring question, and this file is only ever the second.
--
-- **It adds no second editing surface for the rules.** `point_config_versions` below only
-- *records* what the `settings` row already says. The સંચાલક still edits one row in one place.
--
-- **It adds no second INSERT site into the ledger.** `point_award()` is reissued for one word,
-- exactly as 0033 reissued it for one word, and remains the only writer.
--
-- ════════════════════════════════════════════════════════════════════════════
-- A CONSEQUENCE WORTH STATING BEFORE SOMEBODY DISCOVERS IT
-- ════════════════════════════════════════════════════════════════════════════
--
-- The compensating row is ONE row for the whole day, filed under `level_id = 0` and an empty
-- `activity_key` — the same "belongs to no level" 0031 gave a manual adjustment, and for the
-- same reason: the difference is a fact about the day, not about any one ladder. So the day's
-- **total** agrees everywhere, and `activity_history`'s per-activity `points` column does not
-- include the adjustment. A screen that adds up the per-activity column and calls the result
-- the day's total was already wrong for a MANUAL row and is wrong here for the same reason.
-- `daily_record_get()` returns the per-level figures the record itself computed, which is what
-- the new screen should print, and the day's total is `sum(point_transactions.points)`.

-- ================================================================ the seventh kind

-- DAILY_ADJUST joins DAY_FIRST, REPEAT, TICK, REVISION, MANUAL and BONUS.
--
-- Dropped before it is added, like every constraint 0031 and 0033 state, and for the reason
-- 0031 learned the hard way: `add constraint` has no `if not exists`, so a file that only adds
-- is a file that can be applied once, and a migration that cannot be re-applied is a migration
-- that cannot be corrected. §0 of the suite asserts this file applies twice and moves no row.
alter table public.point_transactions
  drop constraint if exists point_transactions_kind_check;

alter table public.point_transactions
  add constraint point_transactions_kind_check
  check (award_kind is null
         or award_kind in ('DAY_FIRST', 'REPEAT', 'TICK', 'REVISION', 'MANUAL', 'BONUS',
                           'DAILY_ADJUST'));

-- A day's correction may take ગુણ away.
--
-- 0021 forbade a negative outright, 0031 admitted one for MANUAL and 0033 for BONUS. The
-- argument is unchanged and applies here with the least ambiguity of the three: a યુવક who
-- reported ૩ દર્શન and corrects himself to ૨ is owed ૨ દર્શન worth of ગુણ, and the only way
-- to reach that figure on an append-only ledger is to add a row for the difference.
alter table public.point_transactions
  drop constraint if exists point_transactions_points_check;

alter table public.point_transactions
  add constraint point_transactions_points_check
  check (points >= 0 or award_kind in ('MANUAL', 'BONUS', 'DAILY_ADJUST'));

-- A fourth source. `ACTIVITY_ATTEMPT` and `LEVEL4_ATTEMPT` name an event table;
-- `MANUAL_ADJUSTMENT` names a person; `DAILY_RECORD` names the form the યુવક filled in, which
-- is a fourth kind of thing and needs a fourth name rather than a borrowed one.
alter table public.point_transactions
  drop constraint if exists point_transactions_source_check;

alter table public.point_transactions
  add constraint point_transactions_source_check
  check (source in ('ACTIVITY_ATTEMPT', 'LEVEL4_ATTEMPT', 'MANUAL_ADJUSTMENT', 'DAILY_RECORD'));

-- `point_transactions_repeatable_needs_key` (0031:188-192) is left exactly as it is, and it
-- already binds this kind: DAILY_ADJUST is not DAY_FIRST, so it must carry an idempotency key.
--
-- The key is `daily:<record id>:<version>` and it is deliberately **not** built from an
-- attempt id. Every existing key for a repeatable kind is (0033:1057, :1086, :1142), and both
-- ways of reusing that shape are wrong: an existing attempt's key would be refused as a
-- duplicate the first time a યુવક edited a day he had also submitted through the app, and
-- minting a fake `activity_attempts` row per edit would create a second scoring system — a
-- forged event that every count, every history view and `point_bonus_count()` would then treat
-- as a real one. The record and its version name the save, which is the thing being
-- deduplicated, and nothing else has to be invented to say so.

-- `point_award()`, reissued for one word.
--
-- The whole body is 0033's, unchanged in every other respect — this is the only writer of the
-- ledger and a line altered while adding another is how a guarantee is lost. The change is the
-- negative test, which now admits DAILY_ADJUST beside MANUAL and BONUS. Both conflict targets,
-- both `on conflict ... do nothing`, still no existence check, still never a zero.
create or replace function public.point_award(
  p_user      uuid,
  p_date      date,
  p_level     integer,
  p_key       text,
  p_points    integer,
  p_kind      text,
  p_source    text,
  p_source_id bigint,
  p_attempt   integer,
  p_idem      text default null,
  p_reason    text default null,
  p_admin     uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  written integer;
  ver     integer;
begin
  if p_user is null or p_date is null or p_kind is null then
    return 0;
  end if;

  -- Nothing to record. A rule worth 0, or one switched off, has not paid a યુવક ૦ — it has
  -- not paid him. A reconciliation of zero is likewise not a correction: the ledger already
  -- says what the record says, and a zero row would be a payment of nothing.
  if coalesce(p_points, 0) = 0 then
    return 0;
  end if;

  if p_points < 0 and p_kind not in ('MANUAL', 'BONUS', 'DAILY_ADJUST') then
    return 0;
  end if;

  select (public.point_rules() ->> 'version')::integer into ver;

  if p_idem is null then
    insert into public.point_transactions
      (user_id, activity_date, level_id, activity_key, points, source, source_id,
       attempt_number, award_kind, rule_version, reason, admin_id, idempotency_key,
       event_ref, attempt_id)
    values
      (p_user, p_date, p_level, coalesce(p_key, ''), p_points, p_source,
       coalesce(p_source_id, 0), coalesce(p_attempt, 0), p_kind, ver, p_reason, p_admin,
       null, p_source || ':' || coalesce(p_source_id, 0)::text, p_source_id)
    on conflict (user_id, activity_date, level_id, activity_key)
      where coalesce(award_kind, 'DAY_FIRST') = 'DAY_FIRST'
    do nothing
    returning points into written;
  else
    insert into public.point_transactions
      (user_id, activity_date, level_id, activity_key, points, source, source_id,
       attempt_number, award_kind, rule_version, reason, admin_id, idempotency_key,
       event_ref, attempt_id)
    values
      (p_user, p_date, p_level, coalesce(p_key, ''), p_points, p_source,
       coalesce(p_source_id, 0), coalesce(p_attempt, 0), p_kind, ver, p_reason, p_admin,
       p_idem, p_idem, p_source_id)
    on conflict (idempotency_key) where idempotency_key is not null
    do nothing
    returning points into written;
  end if;

  return coalesce(written, 0);
end;
$$;

revoke all on function public.point_award(uuid, date, integer, text, integer, text, text,
                                          bigint, integer, text, text, uuid) from public;

comment on function public.point_award(uuid, date, integer, text, integer, text, text,
                                       bigint, integer, text, text, uuid) is
  'The only writer of point_transactions since 0031, reissued 0033 for BONUS and 0034 for '
  'DAILY_ADJUST, both of which may be negative. Deduplicates on the day index when p_idem is '
  'null and on idempotency_key otherwise, both with ON CONFLICT DO NOTHING and no existence '
  'check, because a check cannot decide a race (0021:288-294). Never writes a zero.';

-- ================================================================ the record

-- One row per (યુવક, IST day). What he says his day was, and the window he may still say it in.
--
-- Every column below is **server-owned**. The યુવક reaches this table through
-- `daily_record_save()` and nothing else; the own-row INSERT and UPDATE policies exist because
-- the user-owned idiom is what this table is, and `daily_record_guard()` below is what makes
-- them honest — an INSERT is pinned to the server's values and an UPDATE that is not the
-- function's is refused outright.
create table if not exists public.daily_activity_records (
  id uuid primary key default gen_random_uuid(),

  user_id       uuid not null references public.profiles (id) on delete cascade,
  activity_date date not null,

  -- The window. `first_submitted_at` never moves once written — it is the instant the record
  -- came into existence and the whole window is measured from it — and `edit_until` is its
  -- only derived value.
  first_submitted_at timestamptz not null default now(),
  last_updated_at    timestamptz not null default now(),
  edit_until         timestamptz not null default (now() + interval '24 hours'),

  -- Stamped when the window is first *noticed* to have closed, and stamped with `edit_until`
  -- rather than with the moment of noticing: the record locked when the window closed, not
  -- when somebody next signed in. NULL while the record is still open.
  locked_at timestamptz,

  status text not null default 'OPEN',

  -- Bumped on every accepted save, and load-bearing rather than informational: it is half the
  -- ledger's idempotency key, so one save can write at most one compensating row and a retried
  -- save of the same version writes none.
  version integer not null default 1,

  total_base_points  integer not null default 0,
  total_bonus_points integer not null default 0,
  total_points       integer not null default 0
);

-- Re-runnability: the table may already exist from an earlier apply of this file, in which
-- case `create table if not exists` above did nothing at all. Every column is therefore also
-- stated as an `add column if not exists`, which is what makes a corrected 0034 able to reach
-- a database that already carries the first one.
alter table public.daily_activity_records
  add column if not exists id                 uuid not null default gen_random_uuid(),
  add column if not exists user_id            uuid,
  add column if not exists activity_date      date,
  add column if not exists first_submitted_at timestamptz not null default now(),
  add column if not exists last_updated_at    timestamptz not null default now(),
  add column if not exists edit_until         timestamptz not null default (now() + interval '24 hours'),
  add column if not exists locked_at          timestamptz,
  add column if not exists status             text not null default 'OPEN',
  add column if not exists version            integer not null default 1,
  add column if not exists total_base_points  integer not null default 0,
  add column if not exists total_bonus_points integer not null default 0,
  add column if not exists total_points       integer not null default 0;

alter table public.daily_activity_records
  drop constraint if exists daily_activity_records_day_unique;

alter table public.daily_activity_records
  add constraint daily_activity_records_day_unique unique (user_id, activity_date);

alter table public.daily_activity_records
  drop constraint if exists daily_activity_records_status_check;

alter table public.daily_activity_records
  add constraint daily_activity_records_status_check check (status in ('OPEN', 'LOCKED'));

alter table public.daily_activity_records
  drop constraint if exists daily_activity_records_version_check;

alter table public.daily_activity_records
  add constraint daily_activity_records_version_check check (version > 0);

-- The window is derived and the constraint says so. A row whose `edit_until` does not sit
-- after its own `first_submitted_at` is a row whose window was written by hand.
alter table public.daily_activity_records
  drop constraint if exists daily_activity_records_window_check;

alter table public.daily_activity_records
  add constraint daily_activity_records_window_check check (edit_until > first_submitted_at);

-- The stored total is the sum of its two halves, stated as a constraint rather than trusted to
-- the one function that writes them, because the next writer will be written by somebody
-- reading the table and not the function (0031's phrasing, and its reason).
alter table public.daily_activity_records
  drop constraint if exists daily_activity_records_total_check;

alter table public.daily_activity_records
  add constraint daily_activity_records_total_check
  check (total_points = total_base_points + total_bonus_points);

create index if not exists daily_activity_records_user_date_idx
  on public.daily_activity_records (user_id, activity_date desc);

create index if not exists daily_activity_records_date_idx
  on public.daily_activity_records (activity_date desc);

-- The index behind `daily_record_status()`: "which of my records are still open" is asked once
-- per sign-in by every યુવક in the project.
create index if not exists daily_activity_records_open_idx
  on public.daily_activity_records (user_id, edit_until)
  where status = 'OPEN';

comment on table public.daily_activity_records is
  'એક દિવસની નોંધ — one row per (યુવક, IST day): what he reports his day was, what it is '
  'worth, and the 24-hour window from his first submission in which he may still change it '
  '(0034). Written only by daily_record_save(); every column is server-owned and '
  'daily_record_guard() refuses a direct client UPDATE of any of them.';

comment on column public.daily_activity_records.first_submitted_at is
  'The instant the record was first saved. The whole edit window is measured from here — never '
  'from midnight and never from activity_date + 1 day, so a યુવક who fills his day in at ૨૩:૫૦ '
  'gets the same day to correct it as one who fills it in at ૦૯:૦૦. Never moves.';

comment on column public.daily_activity_records.edit_until is
  'first_submitted_at + 24 hours. Enforced by daily_record_guard(), a BEFORE UPDATE trigger '
  'and not a policy, because a policy sees only the new row and does not apply to service_role '
  '(0026:48-51).';

comment on column public.daily_activity_records.locked_at is
  'When the window closed, stamped lazily by daily_record_status() at the next sign-in and '
  'stamped with edit_until rather than with the moment of noticing. NULL while open. There is '
  'no cron job and there must not be one: a job whose purpose is to close yesterday is a job '
  'that will one day close today (0021''s reasoning about the daily reset).';

comment on column public.daily_activity_records.version is
  'Incremented on every accepted save. Half of the ledger idempotency key '
  '''daily:<record>:<version>'', which is what makes one save write at most one compensating '
  'row and a retried save write none.';

comment on column public.daily_activity_records.total_points is
  'total_base_points + total_bonus_points, and equal by construction to '
  'sum(point_transactions.points) for this (યુવક, day) — daily_record_save() writes the '
  'compensating row that makes it so before it returns. The only stored total in this schema.';

-- ================================================================ the per-level detail

-- Normalised, one row per (record, level, activity) — deliberately NOT one jsonb blob on the
-- record above.
--
-- A blob cannot be filtered on ("every યુવક who reported ૩ or more દર્શન"), cannot be indexed
-- usefully, cannot be constrained, and would put the reported count of લેવલ ૨ at a jsonb path
-- that every reader would have to spell correctly. The સંચાલક's report asks exactly the
-- questions a blob cannot answer, so the detail is rows.
create table if not exists public.daily_activity_counts (
  record_id uuid not null references public.daily_activity_records (id) on delete cascade,

  level_id     integer not null,
  activity_key text not null default '',

  -- The two numbers, side by side, which is the whole point of the table. A યુવક may report
  -- more than the app observed — ધ્યાન done away from the phone still happened — and the
  -- સંચાલક must be able to see that a figure rests on self-report rather than have it look
  -- identical to an observed one.
  reported_count integer not null default 0,
  recorded_count integer not null default 0,
  verified       boolean not null default true,

  points integer not null default 0,

  -- લેવલ ૩'s evidence: the દ્રશ્યો behind the count, deduplicated and with the સંચાલક's
  -- withheld ones removed. Stored for any level whose payload names them, because the column
  -- is about the *unit the report was expressed in* and not about a level number.
  scene_ids text[] not null default '{}',

  primary key (record_id, level_id, activity_key)
);

alter table public.daily_activity_counts
  add column if not exists record_id      uuid,
  add column if not exists level_id       integer,
  add column if not exists activity_key   text not null default '',
  add column if not exists reported_count integer not null default 0,
  add column if not exists recorded_count integer not null default 0,
  add column if not exists verified       boolean not null default true,
  add column if not exists points         integer not null default 0,
  add column if not exists scene_ids      text[] not null default '{}';

alter table public.daily_activity_counts
  drop constraint if exists daily_activity_counts_reported_check;

alter table public.daily_activity_counts
  add constraint daily_activity_counts_reported_check check (reported_count >= 0);

alter table public.daily_activity_counts
  drop constraint if exists daily_activity_counts_recorded_check;

alter table public.daily_activity_counts
  add constraint daily_activity_counts_recorded_check check (recorded_count >= 0);

-- `verified` is a derived fact and not an opinion, so it is stated as a constraint: a row is
-- verified exactly when the યુવક claimed no more than the app saw. Written by
-- daily_record_save() and held to its definition here, so that a future writer cannot mark a
-- self-reported figure as observed.
alter table public.daily_activity_counts
  drop constraint if exists daily_activity_counts_verified_check;

alter table public.daily_activity_counts
  add constraint daily_activity_counts_verified_check
  check (verified = (reported_count <= recorded_count));

alter table public.daily_activity_counts
  drop constraint if exists daily_activity_counts_level_check;

alter table public.daily_activity_counts
  add constraint daily_activity_counts_level_check check (level_id between 1 and 4);

create index if not exists daily_activity_counts_level_idx
  on public.daily_activity_counts (level_id, reported_count desc);

comment on table public.daily_activity_counts is
  'The per-level detail of one day''s record (0034): reported beside recorded, whether the two '
  'agree, what the level was worth, and — for a report expressed in દ્રશ્યો — the deduplicated '
  'scene ids behind the count. Rows and not a jsonb blob, because the સંચાલક''s report filters '
  'on exactly these numbers.';

comment on column public.daily_activity_counts.reported_count is
  'What the યુવક says he did. Trusted above what the app recorded — ધ્યાન done away from the '
  'phone still happened — and bounded only by the admin-configured dailyMax for the level.';

comment on column public.daily_activity_counts.recorded_count is
  'What the app observed for this (level, activity) on this day, measured in the same unit the '
  'report was expressed in: distinct દ્રશ્યો when the payload named scene ids, completed '
  'submissions and passed કસોટીઓ otherwise.';

comment on column public.daily_activity_counts.verified is
  'reported_count <= recorded_count. False marks a figure that rests on self-report, which the '
  'સંચાલક''s report shows as such rather than printing it as an observed one.';

comment on column public.daily_activity_counts.scene_ids is
  'The distinct દ્રશ્યો behind the count, with admin_withheld_scene_ids() (0029) removed. '
  'Deduplicated on the way in, so the same tick sent twice is one tick and the count derived '
  'from the list cannot double.';

-- ================================================================ the audit trail

-- Every change to a record, as its own row. Append-only, no update and no delete path.
--
-- Separate from `audit_logs` (0001, 0004) on purpose. That table is the સંચાલક's trail —
-- `actor_id` is NOT NULL and references a profile, every writer skips a change made with no
-- session, and its policies admit only an administrator. This trail is about a યુવક changing
-- his own day, is read by him as well as by the સંચાલક, and has a shape of its own: an old
-- count, a new count, and the money either side. Forcing it into `audit_logs.meta` would make
-- "what did he change on Tuesday" a jsonb scan.
create table if not exists public.daily_activity_updates (
  id bigserial primary key,

  record_id uuid not null references public.daily_activity_records (id) on delete cascade,

  -- Repeated from the record rather than joined, so that the trail can be read and filtered
  -- without the record — including for a row whose record a future cascade removed.
  user_id  uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid references public.profiles (id),

  at      timestamptz not null default now(),
  version integer not null,
  action  text not null default 'UPDATED',

  -- NULL level_id marks the **head** row: one per save, carrying the day as a whole. The
  -- per-level rows carry a level. The head row is also the one that carries the client's
  -- token, which is what makes the partial unique index below able to name a save.
  level_id     integer,
  activity_key text not null default '',

  old_count  integer,
  new_count  integer,
  old_points integer,
  new_points integer,

  client_token uuid
);

alter table public.daily_activity_updates
  add column if not exists record_id    uuid,
  add column if not exists user_id      uuid,
  add column if not exists actor_id     uuid,
  add column if not exists at           timestamptz not null default now(),
  add column if not exists version      integer,
  add column if not exists action       text not null default 'UPDATED',
  add column if not exists level_id     integer,
  add column if not exists activity_key text not null default '',
  add column if not exists old_count    integer,
  add column if not exists new_count    integer,
  add column if not exists old_points   integer,
  add column if not exists new_points   integer,
  add column if not exists client_token uuid;

alter table public.daily_activity_updates
  drop constraint if exists daily_activity_updates_action_check;

alter table public.daily_activity_updates
  add constraint daily_activity_updates_action_check
  check (action in ('CREATED', 'UPDATED'));

-- §31's idempotency, as an index rather than as a function being careful.
--
-- One head row per save carries the token, so this is unique over (યુવક, token) exactly once
-- per save. `daily_record_save()` also *asks* whether the token has been seen, and returns the
-- record unchanged when it has — that is what answers the ordinary retry politely. The index
-- is what decides the race the question cannot: two taps landing in the same millisecond both
-- see no row, both proceed, and the second insert is refused, which rolls its whole
-- transaction back. A refused duplicate and a paid duplicate are not equally bad outcomes, and
-- this is the direction 0021:288-294 argues for at length.
create unique index if not exists daily_activity_updates_token_idx
  on public.daily_activity_updates (user_id, client_token)
  where client_token is not null and level_id is null;

create index if not exists daily_activity_updates_record_idx
  on public.daily_activity_updates (record_id, id);

create index if not exists daily_activity_updates_user_at_idx
  on public.daily_activity_updates (user_id, at desc);

comment on table public.daily_activity_updates is
  'Every change to a daily record, append-only (0034): who, when, which level, old count → new '
  'count and old points → new points. One head row per save (level_id NULL) carrying the day '
  'as a whole and the client token, plus one row per level whose count moved. No update or '
  'delete policy exists for anybody, સંચાલક included — a trail an actor can edit records '
  'nothing (0001''s phrasing about audit_logs, and its reason).';

comment on column public.daily_activity_updates.client_token is
  'The caller''s idempotency key, on the head row only. daily_activity_updates_token_idx makes '
  'a double-tapped save one save; daily_record_save() checks it first so that the ordinary '
  'retry gets the record back instead of an error.';

-- ================================================================ the configuration, dated

-- What `settings['levels'].value.points` said, each time it changed.
--
-- This closes a gap that is real and is already costing: `point_transactions.rule_version`
-- (0031:163) is **a bare integer pointing at nothing**. No table maps a version to the document
-- that produced it, so the only way to explain an award made in March is to replay `audit_logs`
-- jsonb by timestamp and hope the સંચાલક bumped the number. After this, a version resolves to
-- the document.
--
-- **This is not a second editing surface.** The `settings` row stays the one place a સંચાલક
-- edits the rules; this table is written by a trigger on that row and by nothing else, and has
-- no write policy for anybody. It records; it does not decide.
--
-- Append-only with one exception, and the exception is stated as a rule rather than left to
-- discipline: `effective_until` may move from NULL to a value, once, and no other column may
-- move at all. Closing a snapshot is a fact about when it stopped applying, not a change to
-- what it said. `daily_record_config_guard()` below is what makes that a guarantee.
create table if not exists public.point_config_versions (
  id bigserial primary key,

  -- The `version` field of the document, as `point_rules()` resolves it. NOT unique: a
  -- સંચાલક who edits the values without bumping the number produces a second snapshot under
  -- the same version, and refusing that would mean refusing his save. Two snapshots sharing a
  -- number are told apart by their dates, which is what the dates are for.
  version integer not null default 0,

  -- The document as stored, and the document as the resolvers read it. Both, because they are
  -- different questions: the first is what the સંચાલક typed and the second is what was
  -- actually in force, and the whole reason `point_rules()` exists is that those two differ.
  document jsonb not null default '{}'::jsonb,
  resolved jsonb not null default '{}'::jsonb,

  effective_from  timestamptz not null default now(),
  effective_until timestamptz,

  changed_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.point_config_versions
  add column if not exists version         integer not null default 0,
  add column if not exists document        jsonb not null default '{}'::jsonb,
  add column if not exists resolved        jsonb not null default '{}'::jsonb,
  add column if not exists effective_from  timestamptz not null default now(),
  add column if not exists effective_until timestamptz,
  add column if not exists changed_by      uuid,
  add column if not exists created_at      timestamptz not null default now();

alter table public.point_config_versions
  drop constraint if exists point_config_versions_window_check;

alter table public.point_config_versions
  add constraint point_config_versions_window_check
  check (effective_until is null or effective_until >= effective_from);

-- At most one open snapshot at a time — "what is in force right now" has one answer, and a
-- partial unique index is what makes that a fact rather than a convention.
create unique index if not exists point_config_versions_open_idx
  on public.point_config_versions ((true))
  where effective_until is null;

create index if not exists point_config_versions_version_idx
  on public.point_config_versions (version, effective_from desc);

comment on table public.point_config_versions is
  'An append-only snapshot of settings[''levels''].value.points, taken each time it changes '
  '(0034). Written only by point_config_snapshot(), a trigger on settings; there is no write '
  'policy for anybody and this is NOT a second place to edit the rules. It exists because '
  'point_transactions.rule_version was a bare integer pointing at nothing — after this, a '
  'version resolves to the document that produced it.';

comment on column public.point_config_versions.document is
  'The points object as the સંચાલક saved it. Never edited.';

comment on column public.point_config_versions.resolved is
  'The same document as point_rules() resolves it — what was actually in force. Stored beside '
  'the raw one because the two differ, which is the entire reason point_rules() exists.';

comment on column public.point_config_versions.effective_until is
  'NULL while this snapshot is the one in force. Stamped once, with the instant the next '
  'snapshot began. The only column on this table that may ever move, and it may only move from '
  'NULL — daily_record_config_guard() refuses everything else.';

-- ================================================================ the rules, widened

-- `point_rules()`, reissued with one new key.
--
-- Every existing key is resolved by the identical expression 0031 and 0033 wrote — this
-- function is what decides what a યુવક is paid, and a branch quietly altered while adding
-- another is how an award moves without anybody deciding it should. What follows is `dailyMax`
-- and nothing else.
--
--   `dailyMax.levelN`  the largest count a યુવક may report for that level in one day.
--                      **Absent means no maximum**, which is the behaviour of the day before
--                      this migration, and is why an untouched project is unaffected.
--
-- Read as `^level[0-9]+$` and aggregated, rather than written out as four keys. `earn` above
-- enumerates level1..level4 because `DEFAULT_EARN` in shared/domain/points.js enumerates the
-- same four and two resolvers that must agree key for key have to name the same keys. This one
-- has no such mirror to hold: a maximum is a number the સંચાલક typed against a ladder, and a
-- fifth ladder added tomorrow gets a maximum by being typed a maximum. Nothing in this file
-- decides how many levels there are.
--
-- A value outside 1..100000 resolves to absent, which is "no maximum". The validator refuses
-- the same value outright, which is the resolver-forgives / validator-refuses split 0021 draws
-- — and forgiving in the direction of "no maximum" is the safe one: a typo must not silently
-- clamp every યુવક's day to a number nobody meant. **0 is not a maximum**, it is a level
-- switched off, and `disabled` is how a level is switched off; the validator says so.
create or replace function public.point_rules()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with raw as (
    select case when jsonb_typeof(s.value -> 'points') = 'object'
                then s.value -> 'points' else '{}'::jsonb end as p
    from public.settings s
    where s.key = 'levels'
  ),
  r as (
    select coalesce((select p from raw), '{}'::jsonb) as p
  ),
  rep as (
    select case when jsonb_typeof(p -> 'repeat') = 'object'
                then p -> 'repeat' else '{}'::jsonb end as v
    from r
  ),
  tick as (
    select case when jsonb_typeof(p -> 'tick') = 'object'
                then p -> 'tick' else '{}'::jsonb end as v
    from r
  ),
  earn as (
    select case when jsonb_typeof(p -> 'earn') = 'object'
                then p -> 'earn' else '{}'::jsonb end as v
    from r
  ),
  dmax as (
    select case when jsonb_typeof(p -> 'dailyMax') = 'object'
                then p -> 'dailyMax' else '{}'::jsonb end as v
    from r
  )
  select jsonb_build_object(
    'version',
    coalesce((select case when jsonb_typeof(p -> 'version') = 'number'
                          then greatest(0, round((p ->> 'version')::numeric))::integer end
              from r), 0),

    -- A day, or null. A malformed date is null — "not yet in force" would stop every award
    -- on a typo, and "in force since forever" is what the field's absence already means.
    'effectiveFrom',
    (select case when jsonb_typeof(p -> 'effectiveFrom') = 'string'
                      and (p ->> 'effectiveFrom') ~ '^\d{4}-\d{2}-\d{2}$'
                 then to_jsonb((p ->> 'effectiveFrom')) end
     from r),

    'disabled',
    coalesce((select jsonb_agg(e.value)
              from r, jsonb_array_elements(
                     case when jsonb_typeof(r.p -> 'disabled') = 'array'
                          then r.p -> 'disabled' else '[]'::jsonb end) e
              where jsonb_typeof(e.value) = 'string'), '[]'::jsonb),

    'repeat', jsonb_build_object(
      'enabled',
      coalesce((select (v -> 'enabled') = 'true'::jsonb from rep), false),
      'default',
      coalesce((select case when jsonb_typeof(v -> 'default') = 'number' then
                         case when round((v ->> 'default')::numeric) between 0 and 10000
                              then round((v ->> 'default')::numeric)::integer end
                       end from rep), 0),
      'dailyLimit',
      coalesce((select case when jsonb_typeof(v -> 'dailyLimit') = 'number' then
                         case when round((v ->> 'dailyLimit')::numeric) between 0 and 1000
                              then round((v ->> 'dailyLimit')::numeric)::integer end
                       end from rep), 0),
      -- Per-કસોટી overrides, keyed by `code` and never by the activity's uuid, for the reason
      -- points.js:16-26 gives: `level4_clone_config()` mints new uuids on every republication,
      -- so a uuid-keyed rule orphans itself the first time the સંચાલક publishes.
      'byCode',
      coalesce((select jsonb_object_agg(n.key, n.num)
                from (select e.key,
                             case when jsonb_typeof(e.value) = 'number' then
                               case when round((e.value #>> '{}')::numeric) between 0 and 10000
                                    then round((e.value #>> '{}')::numeric)::integer end
                             end as num
                      from rep, jsonb_each(rep.v) e
                      where e.key ~ '^[0-9]+\.[0-9]+$') n
                where n.num is not null), '{}'::jsonb)
    ),

    'tick', jsonb_build_object(
      'mode',
      coalesce((select case when (v ->> 'mode') in ('ACTIVITY', 'TICK', 'REVISION')
                            then (v ->> 'mode') end from tick), 'ACTIVITY'),
      'perTick',
      coalesce((select case when jsonb_typeof(v -> 'perTick') = 'number' then
                         case when round((v ->> 'perTick')::numeric) between 0 and 10000
                              then round((v ->> 'perTick')::numeric)::integer end
                       end from tick), 0),
      'perRevision',
      coalesce((select case when jsonb_typeof(v -> 'perRevision') = 'number' then
                         case when round((v ->> 'perRevision')::numeric) between 0 and 10000
                              then round((v ->> 'perRevision')::numeric)::integer end
                       end from tick), 0),
      'dailyCap',
      coalesce((select case when jsonb_typeof(v -> 'dailyCap') = 'number' then
                         case when round((v ->> 'dailyCap')::numeric) between 0 and 100000
                              then round((v ->> 'dailyCap')::numeric)::integer end
                       end from tick), 0)
    ),

    -- 0033. DEFAULT_EARN's four levels and tickCount, each falling to the 0021 behaviour.
    'earn',
    (select jsonb_build_object(
       'level1', coalesce(case when (v ->> 'level1') in ('DAY_FIRST', 'EVERY', 'ONCE')
                               then (v ->> 'level1') end, 'DAY_FIRST'),
       'level2', coalesce(case when (v ->> 'level2') in ('DAY_FIRST', 'EVERY', 'ONCE')
                               then (v ->> 'level2') end, 'DAY_FIRST'),
       'level3', coalesce(case when (v ->> 'level3') in ('DAY_FIRST', 'EVERY', 'ONCE')
                               then (v ->> 'level3') end, 'DAY_FIRST'),
       'level4', coalesce(case when (v ->> 'level4') in ('DAY_FIRST', 'EVERY', 'ONCE')
                               then (v ->> 'level4') end, 'DAY_FIRST'),
       'tickCount', coalesce(case when (v ->> 'tickCount') in ('FRESH', 'ALL')
                                  then (v ->> 'tickCount') end, 'FRESH')
     )
     from earn),

    -- 0034. An empty object is the honest resolution of "no maximum anywhere", and every
    -- reader tests for the key's presence rather than for a sentinel number.
    'dailyMax',
    coalesce((select jsonb_object_agg(n.key, n.num)
              from (select e.key,
                           case when jsonb_typeof(e.value) = 'number' then
                             case when round((e.value #>> '{}')::numeric) between 1 and 100000
                                  then round((e.value #>> '{}')::numeric)::integer end
                           end as num
                    from dmax, jsonb_each(dmax.v) e
                    where e.key ~ '^level[0-9]+$') n
              where n.num is not null), '{}'::jsonb)
  );
$$;

revoke all on function public.point_rules() from public;

comment on function public.point_rules() is
  'The rule keys of settings[''levels''].value.points, resolved (repeat, tick, earn, dailyMax, '
  'limits, effective date, disabled list, version — 0031, extended 0033 and 0034). Mirrors '
  'resolvePointRules() in shared/domain/points.js. Every absent key resolves to the behaviour '
  'of the day before it was added: an absent earn.levelN is DAY_FIRST, an absent '
  'earn.tickCount is FRESH, and an absent dailyMax.levelN is no maximum at all — so an '
  'untouched settings row pays and bounds exactly what it did before.';

-- The largest count a યુવક may report for one level in one day, or NULL for no maximum.
--
-- A function rather than an expression repeated at each call site, because "absent means no
-- maximum" is a rule and a rule spelled out twice is a rule that will one day be spelled two
-- ways. NULL and not 0: 0 is a real maximum meaning "report nothing", and conflating the two
-- would make an unconfigured project refuse every save.
create or replace function public.daily_max_for(p_level integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when jsonb_typeof(r.rules #> array['dailyMax', 'level' || coalesce(p_level, 0)::text])
                    = 'number'
              then (r.rules #>> array['dailyMax', 'level' || coalesce(p_level, 0)::text])::integer
         end
  from (select public.point_rules() as rules) r;
$$;

revoke all on function public.daily_max_for(integer) from public;
grant execute on function public.daily_max_for(integer) to authenticated;

comment on function public.daily_max_for(integer) is
  'settings[''levels''].value.points.dailyMax.levelN, or NULL when the સંચાલક has set no '
  'maximum for that ladder (0034). Granted to authenticated so the new screen can bound its '
  'dropdown from the same authority that clamps the save - a disabled control is not a rule '
  '(0018), and this is the rule.';

-- ================================================================ the bound, widened

-- `settings_check_points()`, reissued.
--
-- Every check 0021, 0031 and 0033 wrote is here unchanged and in the same order — this
-- function is the guarantee behind `validatePoints()`, and a rule quietly dropped while adding
-- another is how a validator stops being one. What follows the 0033 block is `dailyMax`, held
-- to the same standard: refuse what `point_rules()` would silently correct, and name the bound
-- in every message, because `saveError()` puts this text in front of the સંચાલક.
--
-- `dailyMax` is optional, like every key added since 0021, so a settings row written before
-- this migration still saves unchanged — which is what lets the panel be deployed after the
-- migration rather than with it.
create or replace function public.settings_check_points()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v     jsonb;
  four  jsonb;
  rep   jsonb;
  tk    jsonb;
  ea    jsonb;
  dm    jsonb;
  fld   text;
  label text;
  n     numeric;
  e     record;
begin
  if new.key <> 'levels' or not (new.value ? 'points') then
    return new;
  end if;

  v := new.value -> 'points';

  if jsonb_typeof(v) <> 'object' then
    raise exception 'settings.points must be an object like {"enabled": true, "level1": 100, "level2": 200, "level3": 300, "level4": {"default": 100}}'
      using errcode = 'check_violation';
  end if;

  if jsonb_typeof(v -> 'enabled') <> 'boolean' then
    raise exception 'Points: turn the system on or off before saving.'
      using errcode = 'check_violation';
  end if;

  foreach fld in array array['level1', 'level2', 'level3'] loop
    label := 'Level ' || right(fld, 1);

    if jsonb_typeof(v -> fld) <> 'number' then
      raise exception '% points: enter a number.', label using errcode = 'check_violation';
    end if;

    n := (v ->> fld)::numeric;

    if n <> trunc(n) then
      raise exception '% points: enter a whole number.', label using errcode = 'check_violation';
    end if;

    if n < 0 or n > 10000 then
      raise exception '% points: between 0 and 10000 (got %).', label, n
        using errcode = 'check_violation';
    end if;
  end loop;

  four := v -> 'level4';

  if four is null or jsonb_typeof(four) <> 'object' then
    raise exception 'Level 4 points: expected a value for each activity.'
      using errcode = 'check_violation';
  end if;

  for e in select key, value from jsonb_each(four) loop
    label := case when e.key = 'default' then 'Level 4 default' else 'Level ' || e.key end;

    if e.key <> 'default' and e.key !~ '^[0-9]+\.[0-9]+$' then
      raise exception 'Level 4 points: "%" is not an activity code like 4.1.', e.key
        using errcode = 'check_violation';
    end if;

    if jsonb_typeof(e.value) <> 'number' then
      raise exception '% points: enter a number.', label using errcode = 'check_violation';
    end if;

    n := (e.value #>> '{}')::numeric;

    if n <> trunc(n) then
      raise exception '% points: enter a whole number.', label using errcode = 'check_violation';
    end if;

    if n < 0 or n > 10000 then
      raise exception '% points: between 0 and 10000 (got %).', label, n
        using errcode = 'check_violation';
    end if;
  end loop;

  if jsonb_typeof(four -> 'default') <> 'number' then
    raise exception 'Level 4 points: set a default for activities with no value of their own.'
      using errcode = 'check_violation';
  end if;

  -- ────────────────────────────────────────────────────── 0031's keys, all optional

  if v ? 'version' then
    if jsonb_typeof(v -> 'version') <> 'number'
       or (v ->> 'version')::numeric <> trunc((v ->> 'version')::numeric)
       or (v ->> 'version')::numeric < 0 then
      raise exception 'Points version: a whole number of 0 or more.'
        using errcode = 'check_violation';
    end if;

    -- The ceiling is int4's, and it is not decoration. `point_rules()` resolves this field
    -- with `round((p ->> 'version')::numeric)::integer`, so a version the validator let
    -- through above 2147483647 makes every later call to point_rules() raise `integer out of
    -- range` — and point_rules() is on the award path for every level. A bound the validator
    -- enforces must be inside the range of the type the resolver casts to, or the resolver's
    -- forgiveness is a raise.
    if (v ->> 'version')::numeric > 2147483647 then
      raise exception 'Points version: between 0 and 2147483647 (got %).',
        (v ->> 'version')::numeric using errcode = 'check_violation';
    end if;
  end if;

  if v ? 'effectiveFrom' and jsonb_typeof(v -> 'effectiveFrom') <> 'null' then
    if jsonb_typeof(v -> 'effectiveFrom') <> 'string'
       or (v ->> 'effectiveFrom') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Points start date: write it as YYYY-MM-DD, or leave it empty.'
        using errcode = 'check_violation';
    end if;

    -- The shape is not the value. '2026-13-45' matches the pattern above and is not a day, and
    -- `point_rule_live()` casts this field with `::date` on every award. Tested by casting
    -- rather than by a bigger regex, because the calendar is not a regular language.
    begin
      perform (v ->> 'effectiveFrom')::date;
    exception
      when others then
        raise exception 'Points start date: "%" is not a real date.', (v ->> 'effectiveFrom')
          using errcode = 'check_violation';
    end;
  end if;

  if v ? 'disabled' then
    if jsonb_typeof(v -> 'disabled') <> 'array' then
      raise exception 'Switched-off rules: expected a list like ["4.3", "level2"].'
        using errcode = 'check_violation';
    end if;

    for e in select value from jsonb_array_elements(v -> 'disabled') loop
      if jsonb_typeof(e.value) <> 'string'
         or ((e.value #>> '{}') !~ '^[0-9]+\.[0-9]+$'
             and (e.value #>> '{}') !~ '^level[1-4]$') then
        raise exception 'Switched-off rules: "%" is not an activity code like 4.3 or a level like level2.',
          (e.value #>> '{}') using errcode = 'check_violation';
      end if;
    end loop;
  end if;

  if v ? 'repeat' then
    rep := v -> 'repeat';

    if jsonb_typeof(rep) <> 'object' then
      raise exception 'Repeat points: expected a value for each activity.'
        using errcode = 'check_violation';
    end if;

    if rep ? 'enabled' and jsonb_typeof(rep -> 'enabled') <> 'boolean' then
      raise exception 'Repeat points: turn repeat awards on or off before saving.'
        using errcode = 'check_violation';
    end if;

    for e in select key, value from jsonb_each(rep) loop
      continue when e.key = 'enabled';

      if e.key <> 'default' and e.key <> 'dailyLimit'
         and e.key !~ '^[0-9]+\.[0-9]+$' then
        raise exception 'Repeat points: "%" is not an activity code like 4.1.', e.key
          using errcode = 'check_violation';
      end if;

      label := case
                 when e.key = 'default'    then 'Repeat default'
                 when e.key = 'dailyLimit' then 'Repeat daily limit'
                 else 'Repeat ' || e.key
               end;

      if jsonb_typeof(e.value) <> 'number' then
        raise exception '%: enter a number.', label using errcode = 'check_violation';
      end if;

      n := (e.value #>> '{}')::numeric;

      if n <> trunc(n) then
        raise exception '%: enter a whole number.', label using errcode = 'check_violation';
      end if;

      if e.key = 'dailyLimit' then
        if n < 0 or n > 1000 then
          raise exception '%: between 0 and 1000 (got %). 0 means no limit.', label, n
            using errcode = 'check_violation';
        end if;
      elsif n < 0 or n > 10000 then
        raise exception '%: between 0 and 10000 (got %).', label, n
          using errcode = 'check_violation';
      end if;
    end loop;
  end if;

  if v ? 'tick' then
    tk := v -> 'tick';

    if jsonb_typeof(tk) <> 'object' then
      raise exception 'Level 3 rule: expected a mode and its values.'
        using errcode = 'check_violation';
    end if;

    if tk ? 'mode' and (tk ->> 'mode') not in ('ACTIVITY', 'TICK', 'REVISION') then
      raise exception 'Level 3 rule: choose ACTIVITY, TICK or REVISION (got "%").',
        coalesce(tk ->> 'mode', '') using errcode = 'check_violation';
    end if;

    for e in select key, value from jsonb_each(tk) loop
      continue when e.key = 'mode';

      if e.key not in ('perTick', 'perRevision', 'dailyCap') then
        raise exception 'Level 3 rule: "%" is not one of perTick, perRevision, dailyCap.', e.key
          using errcode = 'check_violation';
      end if;

      label := case
                 when e.key = 'perTick'     then 'Points per tick'
                 when e.key = 'perRevision' then 'Points per revision'
                 else 'Level 3 daily cap'
               end;

      if jsonb_typeof(e.value) <> 'number' then
        raise exception '%: enter a number.', label using errcode = 'check_violation';
      end if;

      n := (e.value #>> '{}')::numeric;

      if n <> trunc(n) then
        raise exception '%: enter a whole number.', label using errcode = 'check_violation';
      end if;

      if e.key = 'dailyCap' then
        if n < 0 or n > 100000 then
          raise exception '%: between 0 and 100000 (got %). 0 means no cap.', label, n
            using errcode = 'check_violation';
        end if;
      elsif n < 0 or n > 10000 then
        raise exception '%: between 0 and 10000 (got %).', label, n
          using errcode = 'check_violation';
      end if;
    end loop;

    -- A mode that pays nothing is a mode that switches લેવલ ૩ off while looking configured.
    if (tk ->> 'mode') = 'TICK'
       and coalesce((tk ->> 'perTick')::numeric, 0) <= 0 then
      raise exception 'Level 3 rule: per-tick mode needs points per tick above 0.'
        using errcode = 'check_violation';
    end if;

    if (tk ->> 'mode') = 'REVISION'
       and coalesce((tk ->> 'perRevision')::numeric, 0) <= 0 then
      raise exception 'Level 3 rule: per-revision mode needs points per revision above 0.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- ────────────────────────────────────────────────────── 0033's key, also optional

  if v ? 'earn' then
    ea := v -> 'earn';

    if jsonb_typeof(ea) <> 'object' then
      raise exception 'Earning rule: expected a mode for each level, like {"level2": "EVERY"}.'
        using errcode = 'check_violation';
    end if;

    for e in select key, value from jsonb_each(ea) loop
      if e.key <> 'tickCount' and e.key !~ '^level[1-4]$' then
        raise exception 'Earning rule: "%" is not one of level1, level2, level3, level4 or tickCount.', e.key
          using errcode = 'check_violation';
      end if;

      if jsonb_typeof(e.value) <> 'string' then
        raise exception 'Earning rule: % must be written as text.', e.key
          using errcode = 'check_violation';
      end if;

      if e.key = 'tickCount' then
        if (e.value #>> '{}') not in ('FRESH', 'ALL') then
          raise exception 'Level 3 tick counting: choose FRESH or ALL (got "%").',
            (e.value #>> '{}') using errcode = 'check_violation';
        end if;
      elsif (e.value #>> '{}') not in ('DAY_FIRST', 'EVERY', 'ONCE') then
        raise exception 'Earning rule for %: choose DAY_FIRST, EVERY or ONCE (got "%").',
          e.key, (e.value #>> '{}') using errcode = 'check_violation';
      end if;
    end loop;
  end if;

  -- ────────────────────────────────────────────────────── 0034's key, also optional

  if v ? 'dailyMax' then
    dm := v -> 'dailyMax';

    if jsonb_typeof(dm) <> 'object' then
      raise exception 'Daily maximum: expected a number for each level, like {"level2": 5}.'
        using errcode = 'check_violation';
    end if;

    for e in select key, value from jsonb_each(dm) loop
      -- `^level[0-9]+$` and not `^level[1-4]$`, unlike `earn` above, and the difference is
      -- deliberate. `earn` has a mirror in shared/domain/points.js that enumerates exactly
      -- four modes; a maximum has no such mirror to keep in step, so a fifth ladder added
      -- tomorrow can be given a maximum without this validator being reissued to allow it.
      if e.key !~ '^level[0-9]+$' then
        raise exception 'Daily maximum: "%" is not a level like level2.', e.key
          using errcode = 'check_violation';
      end if;

      label := 'Daily maximum for ' || e.key;

      if jsonb_typeof(e.value) <> 'number' then
        raise exception '%: enter a number.', label using errcode = 'check_violation';
      end if;

      n := (e.value #>> '{}')::numeric;

      if n <> trunc(n) then
        raise exception '%: enter a whole number.', label using errcode = 'check_violation';
      end if;

      -- The floor is 1 and not 0, and it is the sharp end of this block. `point_rules()`
      -- resolves an out-of-range value to *absent*, and absent means no maximum — so a 0 saved
      -- here would read back as "unbounded" and the સંચાલક would have configured the exact
      -- opposite of what he typed. A level that should award nothing is switched off in
      -- `disabled`, which says so in the field's own name. Remove the key to lift the maximum.
      if n < 1 or n > 100000 then
        raise exception '%: between 1 and 100000 (got %). Remove the key for no maximum.',
          label, n using errcode = 'check_violation';
      end if;
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function public.settings_check_points() from public;

comment on function public.settings_check_points() is
  'Refuses a settings[''levels''].value.points write that the resolvers would silently zero '
  '(0021, extended 0031 for repeat/tick/limits/effective date/disabled, 0033 for earn and 0034 '
  'for dailyMax). Mirrors validatePoints() and validatePointRules() in shared/domain/points.js '
  'message for message. Every key added since 0021 is optional, so a settings row written '
  'before any of those migrations still saves.';

-- ================================================================ the snapshot

-- `point_config_versions`, written by a trigger on `settings` and by nothing else.
--
-- AFTER, not BEFORE: `point_rules()` reads the `settings` table, so the resolved document is
-- only correct once the new row is visible. The four BEFORE triggers already on this table
-- (`settings_check_slideshow`, `settings_check_mobile_nav`, `settings_check_points`,
-- `settings_check_leaderboard`) have all run and had their say by then, which is also what
-- makes it impossible for this table to record a document the validator refused.
--
-- Only `key = 'levels'`, and only when the `points` object actually moved — `is distinct from`
-- rather than `<>`, so a NULL on either side is a change and two absences are not. A save that
-- touched the leaderboard block and left points alone writes no snapshot, because nothing
-- about what a યુવક is paid changed.
create or replace function public.point_config_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  doc jsonb;
  was jsonb;
begin
  if new.key <> 'levels' then
    return new;
  end if;

  doc := case when jsonb_typeof(new.value -> 'points') = 'object'
              then new.value -> 'points' else '{}'::jsonb end;

  if tg_op = 'UPDATE' then
    was := case when jsonb_typeof(old.value -> 'points') = 'object'
                then old.value -> 'points' else '{}'::jsonb end;
    if was is not distinct from doc then
      return new;
    end if;
  end if;

  -- Close the snapshot that was in force. This is the only UPDATE this schema performs on
  -- point_config_versions and `daily_record_config_guard()` refuses every other one: stamping
  -- the end of a period is a fact about when it stopped applying, not a change to what it said.
  update public.point_config_versions
     set effective_until = now()
   where effective_until is null;

  insert into public.point_config_versions
    (version, document, resolved, effective_from, changed_by)
  values
    ((public.point_rules() ->> 'version')::integer, doc, public.point_rules(), now(), auth.uid());

  return new;
end;
$$;

revoke all on function public.point_config_snapshot() from public;

comment on function public.point_config_snapshot() is
  'Records settings[''levels''].value.points into point_config_versions each time it changes '
  '(0034). AFTER, because point_rules() reads the row it is resolving. Writes nothing when the '
  'points object did not move, so a save about the leaderboard leaves the points history '
  'alone. This records; it never decides — the settings row is still the one editing surface.';

drop trigger if exists point_config_snapshot on public.settings;

create trigger point_config_snapshot
  after insert or update on public.settings
  for each row execute function public.point_config_snapshot();

-- The append-only rule, as a rule.
--
-- A trigger and not a policy, because there is no policy to hang it on: this table has no
-- write policy for anybody and every write comes from a SECURITY DEFINER function, which RLS
-- does not apply to. The guarantee has to live where the write lands.
create or replace function public.daily_record_config_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Point configuration history is append-only - a snapshot is never deleted.'
      using errcode = 'check_violation';
  end if;

  if old.effective_until is not null then
    raise exception 'Point configuration history is append-only - this snapshot is already closed.'
      using errcode = 'check_violation';
  end if;

  if new.effective_until is null then
    raise exception 'Point configuration history is append-only - the only change allowed is closing a snapshot.'
      using errcode = 'check_violation';
  end if;

  if new.id is distinct from old.id
     or new.version is distinct from old.version
     or new.document is distinct from old.document
     or new.resolved is distinct from old.resolved
     or new.effective_from is distinct from old.effective_from
     or new.changed_by is distinct from old.changed_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Point configuration history is append-only - only effective_until may be stamped.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.daily_record_config_guard() from public;

comment on function public.daily_record_config_guard() is
  'Holds point_config_versions append-only (0034). The one permitted change is stamping '
  'effective_until on a snapshot that is still open; every other UPDATE and every DELETE is '
  'refused, including for the owner and for service_role, which is what a policy could not do.';

drop trigger if exists daily_record_config_guard on public.point_config_versions;

create trigger daily_record_config_guard
  before update or delete on public.point_config_versions
  for each row execute function public.daily_record_config_guard();

-- What is in force now, and what was in force then.
--
-- The reason `rule_version` stops being a bare integer. Two snapshots may share a version
-- number — a સંચાલક who edits values without bumping it produces exactly that — so the
-- answer is the LATEST snapshot carrying the number, and the row's own dates are what tell
-- two of them apart for anybody who needs to look closer.
create or replace function public.point_config_document(p_version integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'version',        c.version,
           'document',       c.document,
           'resolved',       c.resolved,
           'effectiveFrom',  c.effective_from,
           'effectiveUntil', c.effective_until
         )
  from public.point_config_versions c
  where c.version = p_version
  order by c.effective_from desc, c.id desc
  limit 1;
$$;

revoke all on function public.point_config_document(integer) from public;

comment on function public.point_config_document(integer) is
  'The document that produced a point_transactions.rule_version (0034). Before this table '
  'existed the column pointed at nothing and an old award could only be explained by replaying '
  'audit_logs jsonb by timestamp. Returns the latest snapshot carrying the number, because a '
  'સંચાલક who edits without bumping the version makes two of them.';

-- One snapshot of what is already in force, if there is a `levels` row and no snapshot yet.
--
-- Not a backfill and not a decision. Every award made from the moment this migration lands
-- stamps a `rule_version` that has to resolve to something, and the something is the document
-- that is in force at that moment — which nobody is about to re-save just to have it recorded.
-- Awards made *before* 0034 resolve to no document, which is the honest answer and is the same
-- doctrine `award_kind IS NULL` states: a fact nobody recorded is not a fact to be guessed.
--
-- Guarded by `not exists`, so applying this file twice writes one row and not two.
do $$
begin
  if exists (select 1 from public.settings where key = 'levels')
     and not exists (select 1 from public.point_config_versions) then
    insert into public.point_config_versions (version, document, resolved, effective_from)
    select (public.point_rules() ->> 'version')::integer,
           case when jsonb_typeof(s.value -> 'points') = 'object'
                then s.value -> 'points' else '{}'::jsonb end,
           public.point_rules(),
           now()
    from public.settings s
    where s.key = 'levels';
  end if;
end
$$;

-- ================================================================ the guards

-- The window, stated once.
--
-- A function and not a literal repeated at three call sites, because the interval is the rule
-- and a rule spelled out three times is a rule that will one day be spelled three ways. It is
-- deliberately **not** a setting: `dailyMax` is a maximum the સંચાલક decides for his સંઘ, and
-- the edit window is a promise the application makes to every યુવક about how long his own
-- word stays his. A configurable window would let one project silently be a different product.
create or replace function public.daily_record_window()
returns interval
language sql
immutable
as $$
  select interval '24 hours';
$$;

comment on function public.daily_record_window() is
  'The length of the edit window - 24 hours from the first submission (0034). One place, so '
  'daily_record_guard(), the reading functions and the suite cannot disagree about it.';

-- Who is writing, for the length of this transaction.
--
-- `set_config(..., true)` is transaction-local and is set by `daily_record_save()` and
-- `daily_record_seal()` immediately before their writes and cleared immediately after. A
-- browser cannot reach it: PostgREST runs one statement per request, so there is no way for a
-- client to set the flag and then issue an UPDATE under it. A `service_role` connection
-- speaking raw SQL could, and that is not a hole this file pretends to close — what it does
-- close is the one 0026 names, because the **window** below is checked whatever the flag says.
create or replace function public.daily_record_context()
returns text
language sql
stable
as $$
  select coalesce(current_setting('varni.daily_record', true), '');
$$;

comment on function public.daily_record_context() is
  'Which server function is writing a daily record right now, or the empty string for a direct '
  'client write (0034). Transaction-local, set only by daily_record_save() and '
  'daily_record_seal().';

-- The 24-hour rule, and the column ownership that makes it worth having.
--
-- A BEFORE UPDATE trigger and not a policy, for the two reasons 0026:48-51 gives and which are
-- the whole argument for this shape:
--
--   * **a policy sees only the NEW row.** The rule here is `now() >= old.edit_until`, which is
--     a statement about a value the policy is not shown. There is no `USING` clause that can
--     express it, and a `WITH CHECK` that tried would be comparing the row against itself.
--   * **a policy does not apply to service_role, and a trigger does.** A window that a service
--     key walks through is not a window, and the seed script, the admin panel's server side and
--     any future job all speak with that key.
--
-- On INSERT every column that describes the window is **pinned** rather than validated. That is
-- 0026's choice too, and for its reason: a client that sends `edit_until` is not attacking, it
-- is round-tripping a row it read, and failing his save would lose the counts it came for. The
-- server simply writes its own values over his. On UPDATE there is nothing on this row a client
-- legitimately moves, so an UPDATE that is not the save function's is refused outright — the
-- own-row policy states the ownership and this states the ownership's limits.
create or replace function public.daily_record_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  ctx text := public.daily_record_context();
begin
  if tg_op = 'INSERT' then
    -- Server-owned, every one of them, whatever arrived.
    new.first_submitted_at := now();
    new.edit_until         := now() + public.daily_record_window();
    new.last_updated_at    := now();
    new.locked_at          := null;
    new.status             := 'OPEN';

    if ctx <> 'save' then
      new.version            := 1;
      new.total_base_points  := 0;
      new.total_bonus_points := 0;
      new.total_points       := 0;
    end if;

    return new;
  end if;

  -- The lazy lock, from daily_record_seal(). Deliberately the only update this schema makes to
  -- a record whose window has closed, and narrowed to the two columns it is about.
  if ctx = 'seal' then
    if old.status <> 'OPEN' or now() < old.edit_until then
      raise exception 'Daily record: a record is sealed only after its window has closed.'
        using errcode = 'check_violation';
    end if;

    if new.user_id is distinct from old.user_id
       or new.activity_date is distinct from old.activity_date
       or new.first_submitted_at is distinct from old.first_submitted_at
       or new.edit_until is distinct from old.edit_until
       or new.version is distinct from old.version
       or new.total_base_points is distinct from old.total_base_points
       or new.total_bonus_points is distinct from old.total_bonus_points
       or new.total_points is distinct from old.total_points then
      raise exception 'Daily record: sealing a record moves nothing but its status.'
        using errcode = 'check_violation';
    end if;

    new.status    := 'LOCKED';
    -- The instant the window closed, not the instant somebody noticed it had.
    new.locked_at := old.edit_until;
    return new;
  end if;

  if ctx <> 'save' then
    raise exception 'Daily record: nothing on this row may be changed directly - save the day through daily_record_save().'
      using errcode = '42501';
  end if;

  -- ── the 24-hour rule ──────────────────────────────────────────────────────
  --
  -- Checked whatever the flag says and whoever the caller is. This is the line the whole file
  -- is built around and it has no bypass.
  if now() >= old.edit_until then
    raise exception 'Daily record: the 24-hour window for % closed at % - it can no longer be edited.',
      old.activity_date, old.edit_until using errcode = 'check_violation';
  end if;

  -- Immutable even for the save function. `first_submitted_at` and `edit_until` in particular:
  -- a save that moved either of them would be a save that extended its own window, and the
  -- next one would extend it again, forever.
  new.user_id            := old.user_id;
  new.activity_date      := old.activity_date;
  new.first_submitted_at := old.first_submitted_at;
  new.edit_until         := old.edit_until;
  new.locked_at          := old.locked_at;
  new.last_updated_at    := now();

  return new;
end;
$$;

revoke all on function public.daily_record_guard() from public;

comment on function public.daily_record_guard() is
  'The 24-hour edit window and the record''s column ownership (0034). BEFORE INSERT pins every '
  'window column to the server''s own value; BEFORE UPDATE refuses any write that is not '
  'daily_record_save() or daily_record_seal(), and refuses even those once now() >= '
  'edit_until. A trigger and not a policy because a policy sees only the new row and does not '
  'apply to service_role (0026:48-51).';

drop trigger if exists daily_record_guard on public.daily_activity_records;

create trigger daily_record_guard
  before insert or update on public.daily_activity_records
  for each row execute function public.daily_record_guard();

-- The same ownership, one table down.
--
-- `recorded_count`, `verified` and `points` are the three columns a યુવક must never write: the
-- first is what the app saw, the second is the comparison of the two, and the third is money.
-- A direct INSERT is pinned to their server values rather than refused, so a client that
-- creates a row it should not have created has created an empty one; a direct UPDATE is
-- refused, because there is nothing here he legitimately moves.
create or replace function public.daily_record_counts_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.daily_record_context() = 'save' then
    return new;
  end if;

  if tg_op <> 'INSERT' then
    raise exception 'Daily record: a level''s counts are changed by saving the day, never directly.'
      using errcode = '42501';
  end if;

  new.reported_count := greatest(coalesce(new.reported_count, 0), 0);
  new.recorded_count := 0;
  new.points         := 0;
  new.verified       := (new.reported_count <= new.recorded_count);

  -- Deduplicated even here, so the column's promise holds however the row arrived.
  new.scene_ids := coalesce(
    (select array_agg(distinct u.sid) from unnest(coalesce(new.scene_ids, '{}'::text[])) as u(sid)),
    '{}'::text[]);

  return new;
end;
$$;

revoke all on function public.daily_record_counts_guard() from public;

comment on function public.daily_record_counts_guard() is
  'Holds recorded_count, verified and points server-owned on daily_activity_counts (0034). A '
  'direct client INSERT is pinned to their server values; a direct client UPDATE is refused. '
  'Only daily_record_save() writes the real numbers.';

drop trigger if exists daily_record_counts_guard on public.daily_activity_counts;

create trigger daily_record_counts_guard
  before insert or update on public.daily_activity_counts
  for each row execute function public.daily_record_counts_guard();

-- ================================================================ the pricing

-- What one level's reported count is worth on one day, under the rules in force **on that day**.
--
-- **Not a second price list.** Every number this returns comes from `point_settings()`,
-- `point_value_for()` and `point_rules()` — the same three functions `award_points()` reads —
-- and every branch is named after the same vocabulary the સંચાલક configured: `earn.levelN`,
-- `tick.mode`, `tick.dailyCap`. What differs is only the granularity: `award_points()` prices
-- one event and this prices one day, because a daily record is a statement about a day and
-- there is no event to hang it on.
--
-- The branches, and why each falls the way it does:
--
--   `tick.mode = TICK`      the count is દ્રશ્યો, priced per તિક and bounded by `dailyCap`.
--                           The cap is applied to the day as a whole here rather than to the
--                           headroom left by earlier awards, which is the same figure — this
--                           IS the day.
--   `tick.mode = REVISION`  the count is નોંધાવો, priced per submission.
--   `earn.levelN = EVERY`   every act pays, so the day is count × value.
--   `earn.levelN = ONCE`    once per (યુવક, level, activity) for all time. A day that follows
--                           a day already paid for the same key is worth nothing, which is
--                           what the mode means and is checked against the ledger rather than
--                           against the records, because the ledger is where "already paid"
--                           is written down.
--   `earn.levelN = DAY_FIRST` 0021's rule and the default: the day pays once, however many
--                           times he did it.
--
-- The two gates above every branch are `award_points()`'s own, in the same order: the master
-- switch, then `point_rule_live()` against the **activity_date** and never against `now()`. A
-- record opened today for last Tuesday is priced by Tuesday's rules.
create or replace function public.daily_record_points(
  p_user  uuid,
  p_level integer,
  p_key   text,
  p_count integer,
  p_date  date
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  rules jsonb;
  key   text    := coalesce(p_key, '');
  n     integer := greatest(coalesce(p_count, 0), 0);
  mode  text;
  earn  text;
  val   integer;
  cap   integer;
begin
  if p_user is null or p_level is null or p_date is null or n = 0 then
    return 0;
  end if;

  if not (select s.enabled from public.point_settings() s) then
    return 0;
  end if;

  if not public.point_rule_live(p_level, key, p_date) then
    return 0;
  end if;

  rules := public.point_rules();

  if p_level = 3 and (rules #>> '{tick,mode}') in ('TICK', 'REVISION') then
    mode := rules #>> '{tick,mode}';

    if mode = 'TICK' then
      val := n * (rules #>> '{tick,perTick}')::integer;
    else
      val := n * (rules #>> '{tick,perRevision}')::integer;
    end if;

    cap := (rules #>> '{tick,dailyCap}')::integer;
    if cap > 0 then
      val := least(val, cap);
    end if;

    return greatest(val, 0);
  end if;

  earn := coalesce(rules #>> array['earn', 'level' || p_level::text], 'DAY_FIRST');
  val  := coalesce(public.point_value_for(p_level, key), 0);

  if val <= 0 then
    return 0;
  end if;

  if earn = 'EVERY' then
    return val * n;
  end if;

  if earn = 'ONCE' then
    -- Already paid on an earlier day means this day is worth nothing. BONUS rows are excluded
    -- because a milestone is not the activity's own award, and DAILY_ADJUST rows are excluded
    -- because they belong to no level and would match every key.
    if exists (
      select 1
      from public.point_transactions t
      where t.user_id = p_user
        and t.level_id = p_level
        and t.activity_key = key
        and t.activity_date < p_date
        and coalesce(t.award_kind, 'DAY_FIRST') not in ('BONUS', 'DAILY_ADJUST')
    ) then
      return 0;
    end if;
  end if;

  -- DAY_FIRST and ONCE alike: the day pays once.
  return val;
end;
$$;

revoke all on function public.daily_record_points(uuid, integer, text, integer, date) from public;

comment on function public.daily_record_points(uuid, integer, text, integer, date) is
  'What one level''s reported count is worth on one day, under the rules in force on that '
  'activity_date (0034). Reads point_settings(), point_rule_live(), point_value_for() and '
  'point_rules() — the same four award_points() reads — and applies the same earn/tick '
  'vocabulary at the granularity of a day instead of an event. It is not a second price list; '
  'there is no number in it that the સંચાલક did not type into the one settings row.';

-- What the app actually observed for this (day, level, activity).
--
-- Measured in the same unit the report was expressed in, which is what `p_by_scene` names. A
-- યુવક who reports "I brought ૬૦ દ્રશ્યો to mind" is claiming દ્રશ્યો and must be compared
-- against દ્રશ્યો; one who reports "I did દર્શન ૩ times" is claiming acts and must be compared
-- against acts. Comparing a count of one against a count of the other is how `verified` would
-- come to mean nothing.
--
-- The two-table split is `point_bonus_count()`'s (0033) and is the schema's own: `level_id` on
-- `activity_attempts` is checked `between 1 and 3` and `level4_attempts` has no level column at
-- all, so there is no expression in which લેવલ ૪ could be read from the first table.
create or replace function public.daily_record_recorded(
  p_user     uuid,
  p_date     date,
  p_level    integer,
  p_key      text,
  p_by_scene boolean
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    case when p_by_scene then
      coalesce((
        select count(distinct s.scene_id)
        from public.activity_attempts a
        cross join lateral unnest(a.selected_scene_ids) as s(scene_id)
        where a.user_id = p_user
          and a.activity_date = p_date
          and a.level_id = p_level
          and a.activity_key = coalesce(p_key, '')
          and a.status = 'COMPLETED'
          and not (s.scene_id = any (public.admin_withheld_scene_ids()))
      ), 0)
    else
      coalesce((
        select count(*)
        from public.activity_attempts a
        where a.user_id = p_user
          and a.activity_date = p_date
          and a.level_id = p_level
          and a.activity_key = coalesce(p_key, '')
          and a.status = 'COMPLETED'
      ), 0)
    end
    +
    case when p_level <> 4 then 0
         when p_by_scene then
      coalesce((
        select count(distinct s.scene_id)
        from public.level4_attempts la
        join public.level4_activities act on act.id = la.activity_id
        cross join lateral unnest(la.selected_scene_ids) as s(scene_id)
        where la.user_id = p_user
          and timezone('Asia/Kolkata', la.at)::date = p_date
          and la.passed
          and coalesce(act.code, '') = coalesce(p_key, '')
          and not (s.scene_id = any (public.admin_withheld_scene_ids()))
      ), 0)
    else
      coalesce((
        select count(*)
        from public.level4_attempts la
        join public.level4_activities act on act.id = la.activity_id
        where la.user_id = p_user
          and timezone('Asia/Kolkata', la.at)::date = p_date
          and la.passed
          and coalesce(act.code, '') = coalesce(p_key, '')
      ), 0)
    end
  )::integer;
$$;

revoke all on function public.daily_record_recorded(uuid, date, integer, text, boolean) from public;

comment on function public.daily_record_recorded(uuid, date, integer, text, boolean) is
  'What the app observed for one (યુવક, day, level, activity), in the unit the report was '
  'expressed in: distinct non-withheld દ્રશ્યો when p_by_scene, completed submissions and '
  'passed કસોટીઓ otherwise (0034). The two-table split is point_bonus_count()''s (0033) and '
  'is the schema''s own — activity_attempts.level_id is checked between 1 and 3.';

-- ================================================================ the record, read

-- One record and everything about it, as one jsonb document.
--
-- Shared by `daily_record_save()` and `daily_record_get()` so that the shape a save returns and
-- the shape a fetch returns are the same shape — a screen that had to normalise two documents
-- into one is a screen with a second copy of the rules in it.
--
-- `status` in the returned document is computed from the clock, never read from the column. The
-- column is stamped lazily, at the next sign-in, and would otherwise say OPEN for a record
-- whose window closed an hour ago. The stored value is returned beside it as `storedStatus` for
-- anybody who needs to know whether the seal has run.
create or replace function public.daily_record_snapshot(p_user uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r      public.daily_activity_records%rowtype;
  found_ boolean;
begin
  select * into r
  from public.daily_activity_records
  where user_id = p_user and activity_date = p_date;

  found_ := (r.id is not null);

  return jsonb_build_object(
    'date',   p_date,
    'exists', found_,

    'recordId', r.id,
    'version',  coalesce(r.version, 0),

    'status',       case when not found_ then 'NONE'
                         when now() >= r.edit_until then 'LOCKED'
                         else 'OPEN' end,
    'storedStatus', r.status,
    -- An explicit boolean beside the string, because a screen that had to interpret a vocabulary
    -- is a screen that will one day meet a token nobody told it about. **A day with no record is
    -- editable**: the twenty-four hours start at the first save, not at the start of the day, so
    -- there is nothing running yet and nothing to be late for. A day that has not happened is
    -- the one exception, and daily_record_save() refuses it for the same reason.
    'editable',
    case when p_date > timezone('Asia/Kolkata', now())::date then false
         when not found_ then true
         else now() < r.edit_until end,

    'firstSubmittedAt', r.first_submitted_at,
    'lastUpdatedAt',    r.last_updated_at,
    'editUntil',        r.edit_until,
    'lockedAt',         r.locked_at,

    -- **The figure the countdown trusts**, and the reason it is sent rather than left to be
    -- derived from `editUntil`: a handset whose clock is four minutes fast would lock the form
    -- four minutes early, and one four minutes slow would let a યુવક type into a day the server
    -- is about to refuse. A duration is the same number on every clock; an instant is not.
    -- Always a number, never null and never negative — 0 is what a closed record has.
    'remainingSeconds',
    case when not found_ or now() >= r.edit_until then 0
         else floor(extract(epoch from (r.edit_until - now())))::integer end,

    'totals', jsonb_build_object(
      'base',   coalesce(r.total_base_points, 0),
      'bonus',  coalesce(r.total_bonus_points, 0),
      'points', coalesce(r.total_points, 0)
    ),

    -- The same three figures and the two window fields, flat and in snake_case. Not redundancy
    -- for its own sake: the client reads across both conventions and pinning both here means one
    -- document that cannot be read two ways, rather than a mapping layer on the far side that
    -- would be a second place for the shape to be wrong.
    'base_points',       coalesce(r.total_base_points, 0),
    'bonus_points',      coalesce(r.total_bonus_points, 0),
    'total_points',      coalesce(r.total_points, 0),
    'edit_until',        r.edit_until,
    'locked_at',         r.locked_at,
    'remaining_seconds',
    case when not found_ or now() >= r.edit_until then 0
         else floor(extract(epoch from (r.edit_until - now())))::integer end,

    -- The reconciliation, returned rather than assumed. A screen never has to trust that the
    -- ledger agrees with the record — it can see that it does, and so can the suite.
    'ledgerPoints',
    coalesce((select sum(t.points)::integer
              from public.point_transactions t
              where t.user_id = p_user and t.activity_date = p_date), 0),

    'counts',
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'level',    c.level_id,
               'activity', c.activity_key,
               'reported', c.reported_count,
               'recorded', c.recorded_count,
               'verified', c.verified,
               'points',   c.points,
               'sceneIds', to_jsonb(c.scene_ids),
               -- **NULL when the સંચાલક set no maximum for this ladder**, never 0. A 0 would
               -- read as "the maximum is zero" and lock the field at nothing; an absent maximum
               -- is an unbounded one, and the screen renders the difference.
               'max',      public.daily_max_for(c.level_id),
               'reported_count', c.reported_count,
               'recorded_count', c.recorded_count
             ) order by c.level_id, c.activity_key)
      from public.daily_activity_counts c
      where c.record_id = r.id
    ), '[]'::jsonb),

    -- Every maximum the સંચાલક has set, so a screen opening a day that has no record yet — and
    -- therefore no per-level rows to read a maximum from — can still bound its controls from the
    -- same authority that clamps the save. A disabled control is not a rule (0018); this is the
    -- rule, and the control is drawn from it.
    'maximums', public.point_rules() -> 'dailyMax'
  );
end;
$$;

revoke all on function public.daily_record_snapshot(uuid, date) from public;

comment on function public.daily_record_snapshot(uuid, date) is
  'One daily record as a jsonb document - the window, the totals, the per-level counts and the '
  'ledger sum for the same day (0034). Shared by daily_record_save() and daily_record_get() so '
  'that a save and a fetch return the same shape. Takes a p_user and is therefore granted to '
  'nobody; both callers derive the યુવક from auth.uid().';

-- ================================================================ the one write path

-- Everything a save is, in one transaction, deriving the યુવક from `auth.uid()` and never from
-- a parameter.
--
-- **No `p_user`, at any price.** A parameter is a value a browser chooses, and a SECURITY
-- DEFINER function that took one would be a way for one યુવક to write another's day — the
-- entire thing §13 exists to prevent, and the reason `award_points()` and `point_award()` are
-- granted to nobody at all.
--
-- In order:
--
--   1. signed in, and an ACTIVE યુવક. Not a policy's job: this function runs as the owner.
--   2. the record, created or loaded, and refused if its window has closed.
--   3. the recorded counts, read from the event tables the app writes.
--   4. the reported counts, clamped to `dailyMax` and refused if negative.
--   5. the base points, from the rules in force on the activity_date.
--   6. the ledger, reconciled with ONE compensating row for the difference.
--   7. the milestones, through 0033's engine and never a second bonus path.
--   8. the audit rows.
--   9. the record's totals and its version.
--  10. the whole computed result, as the same document daily_record_get() returns.
--
-- Any failure rolls all of it back, because all of it is one statement inside one transaction.
-- There is no half-saved day and there is no ledger row without the record that explains it.
create or replace function public.daily_record_save(
  p_date         date  default null,
  p_counts       jsonb default '[]'::jsonb,
  p_client_token uuid  default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor    uuid := auth.uid();
  today    date := timezone('Asia/Kolkata', now())::date;
  day      date := coalesce(p_date, timezone('Asia/Kolkata', now())::date);
  payload  jsonb := '[]'::jsonb;
  rec      public.daily_activity_records%rowtype;
  created  boolean := false;
  new_ver  integer;
  e        record;
  ids      text[];
  by_scene boolean;
  cnt      integer;
  cap      integer;
  rec_cnt  integer;
  pts      integer;
  old_cnt  integer;
  old_pts  integer;
  target   integer := 0;
  ledger   integer;
  delta    integer;
  bonus    integer := 0;
  before_  integer;
  result   jsonb;
begin
  -- ── 1. who is asking ──────────────────────────────────────────────────────
  if actor is null then
    raise exception 'daily_record_not_signed_in' using errcode = '42501';
  end if;

  if not public.is_active_user() then
    raise exception 'daily_record_not_active' using errcode = '42501';
  end if;

  -- A day he has not lived yet is not a day he can report. The other end is deliberately open:
  -- the window is a property of when he spoke, so a record may be opened for an old day, and
  -- bounding how far back he may reach is policy with no setting behind it yet.
  if day > today then
    raise exception 'Daily record: % is in the future - a day cannot be reported before it happens.', day
      using errcode = 'check_violation';
  end if;

  -- ── the retry, answered before anything is written ────────────────────────
  --
  -- The ordinary duplicate — a double tap, a refresh, a lost response the phone retried — is
  -- answered here with the record itself, which is what the caller wanted in the first place.
  -- The true race is decided by daily_activity_updates_token_idx at the end and is refused
  -- rather than paid twice, because a check cannot decide a race (0021:288-294).
  if p_client_token is not null
     and exists (select 1 from public.daily_activity_updates u
                 where u.user_id = actor and u.client_token = p_client_token
                   and u.level_id is null) then
    return public.daily_record_snapshot(actor, day);
  end if;

  -- ── the payload, checked before a row moves ───────────────────────────────
  --
  -- **A list of rows, never an object keyed by level.** `{"1": 0, "2": 3}` is the shape a screen
  -- reaches for first and it cannot carry this day: `daily_activity_counts` is keyed by
  -- (record, level, **activity**) because લેવલ ૪ is several કસોટીઓ under one ladder, and a map
  -- from a level number to a count has nowhere to say which of them ૨ belongs to. The other way
  -- out — deriving the activity key from the level number — would mean writing 'video',
  -- 'darshan' and 'revision' into this file, which is exactly the hardcoding 0021 owns and this
  -- one must not repeat. So it is refused loudly rather than read as an empty list, because a
  -- shape mismatch that silently zeroed a યુવક's day would be the worst failure available here.
  if p_counts is not null and jsonb_typeof(p_counts) <> 'array' then
    raise exception 'Daily record: counts must be a list like [{"level": 2, "activity": "darshan", "count": 3}], not an object keyed by level - a level alone cannot say which કસોટી a લેવલ ૪ count belongs to.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from jsonb_array_elements(coalesce(p_counts, '[]'::jsonb)) el
             where jsonb_typeof(el.value) <> 'object') then
    raise exception 'Daily record: each entry must be an object like {"level": 2, "activity": "darshan", "count": 3}.'
      using errcode = 'check_violation';
  end if;

  -- Normalised to one spelling before anything reads it. The client may write `level` or
  -- `level_id`, `activity` or `activity_key`, `count` or `reported`, `sceneIds` or `scene_ids` —
  -- liberality about names costs one pass here and saves a mapping layer on the far side, which
  -- would be a second place for the shape to be wrong. It is liberality about **names** only:
  -- the shape above is not negotiable.
  select coalesce(jsonb_agg(jsonb_build_object(
           'level',    coalesce(el.value -> 'level',    el.value -> 'level_id'),
           'activity', coalesce(el.value -> 'activity', el.value -> 'activity_key'),
           'count',    coalesce(el.value -> 'count',    el.value -> 'reported',
                                el.value -> 'reported_count'),
           'sceneIds', coalesce(el.value -> 'sceneIds', el.value -> 'scene_ids')
         )), '[]'::jsonb)
    into payload
  from jsonb_array_elements(coalesce(p_counts, '[]'::jsonb)) el;

  -- `coalesce(jsonb_typeof(...), 'absent')`, never the bare comparison. `->` on a missing key is
  -- SQL NULL, `jsonb_typeof(NULL)` is NULL, and `NULL <> 'number'` is NULL rather than true — so
  -- the bare form silently passes an entry with no level at all, which then fails four hundred
  -- lines later as a not-null violation on a column the યુવક never heard of.
  if exists (select 1 from jsonb_array_elements(payload) el
             where coalesce(jsonb_typeof(el.value -> 'level'), 'absent') <> 'number') then
    raise exception 'Daily record: each entry needs a level.'
      using errcode = 'check_violation';
  end if;

  -- The bound is the ledger's own (point_transactions_level_id_check), not a new one invented
  -- here: a count that could never be paid is not a count worth storing.
  if exists (select 1 from jsonb_array_elements(payload) el
             where round((el.value ->> 'level')::numeric) not between 1 and 4) then
    raise exception 'Daily record: a level must be one the ledger can pay.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from jsonb_array_elements(payload) el
             where jsonb_typeof(el.value -> 'count') = 'number'
               and round((el.value ->> 'count')::numeric) < 0) then
    raise exception 'Daily record: a count cannot be negative.'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(payload) el
    group by round((el.value ->> 'level')::numeric)::integer,
             coalesce(el.value ->> 'activity', '')
    having count(*) > 1
  ) then
    raise exception 'Daily record: the same level and activity appears more than once.'
      using errcode = 'check_violation';
  end if;

  perform set_config('varni.daily_record', 'save', true);

  -- ── 2. the record ─────────────────────────────────────────────────────────
  select * into rec
  from public.daily_activity_records
  where user_id = actor and activity_date = day
  for update;

  if rec.id is null then
    insert into public.daily_activity_records (user_id, activity_date)
    values (actor, day)
    returning * into rec;
    created := true;
    new_ver := rec.version;
  else
    -- The floor under this is daily_record_guard(), which refuses the UPDATE below whatever
    -- this branch decides. It is stated here as well so that the યુવક is told why rather than
    -- being shown a trigger's message about a row.
    if now() >= rec.edit_until then
      raise exception 'Daily record: the 24-hour window for % closed at % - it can no longer be edited.',
        rec.activity_date, rec.edit_until using errcode = 'check_violation';
    end if;
    new_ver := rec.version + 1;
  end if;

  before_ := coalesce(rec.total_points, 0);

  -- ── 3-5. every level named by the payload, and every level the record already had ────
  --
  -- The union is what makes a removal a change rather than a silence: a યુવક who deletes
  -- લેવલ ૨ from his day is saying it was 0, and a loop over the payload alone would leave
  -- yesterday's ૩ standing and paid.
  for e in
    with sent as (
      select round((el.value ->> 'level')::numeric)::integer as lvl,
             coalesce(el.value ->> 'activity', '')           as akey,
             case when jsonb_typeof(el.value -> 'count') = 'number'
                  then round((el.value ->> 'count')::numeric)::integer end as cnt,
             case when jsonb_typeof(el.value -> 'sceneIds') = 'array'
                  then el.value -> 'sceneIds' end as ids
      from jsonb_array_elements(payload) el
    ),
    held as (
      select c.level_id as lvl, c.activity_key as akey, null::integer as cnt, null::jsonb as ids
      from public.daily_activity_counts c
      where c.record_id = rec.id
        and not exists (select 1 from sent s where s.lvl = c.level_id and s.akey = c.activity_key)
    )
    select * from sent
    union all
    select * from held
    order by lvl, akey
  loop
    -- The દ્રશ્યો, deduplicated and with the withheld ones removed. The same tick sent twice
    -- is one tick, and a દ્રશ્ય the સંચાલક has taken out of the collection is not one that may
    -- be counted — admin_withheld_scene_ids() (0029) is the same authority award_points()'s
    -- TICK branch subtracts.
    if e.ids is null then
      ids := '{}'::text[];
      by_scene := false;
    else
      select coalesce(array_agg(distinct t.sid), '{}'::text[]) into ids
      from jsonb_array_elements_text(e.ids) as t(sid)
      where nullif(btrim(t.sid), '') is not null
        and not (t.sid = any (public.admin_withheld_scene_ids()));
      by_scene := true;
    end if;

    -- When the payload names દ્રશ્યો the ids ARE the count, because they are more specific
    -- than a number beside them: a client that sent ૧૦૮ and named ૪૦ has named ૪૦. When it
    -- names none, the number stands on its own — a યુવક may say he brought ૬૦ to mind without
    -- being asked to list them.
    if by_scene then
      cnt := cardinality(ids);
    else
      cnt := greatest(coalesce(e.cnt, 0), 0);
    end if;

    -- ── 4. the maximum, if the સંચાલક set one ───────────────────────────────
    cap := public.daily_max_for(e.lvl);
    if cap is not null and cnt > cap then
      cnt := cap;
      -- The દ્રશ્યો are trimmed with the count, so the evidence never says more than the
      -- number it backs. Ordered, so the trim is a fact rather than whatever the array
      -- happened to hold first.
      if by_scene then
        select coalesce(array_agg(q.sid order by q.sid), '{}'::text[]) into ids
        from (select u.sid from unnest(ids) as u(sid) order by u.sid limit cap) q;
      end if;
    end if;

    rec_cnt := public.daily_record_recorded(actor, day, e.lvl, e.akey, by_scene);
    pts     := public.daily_record_points(actor, e.lvl, e.akey, cnt, day);

    select c.reported_count, c.points into old_cnt, old_pts
    from public.daily_activity_counts c
    where c.record_id = rec.id and c.level_id = e.lvl and c.activity_key = e.akey;

    insert into public.daily_activity_counts
      (record_id, level_id, activity_key, reported_count, recorded_count, verified, points, scene_ids)
    values
      (rec.id, e.lvl, e.akey, cnt, rec_cnt, cnt <= rec_cnt, pts, ids)
    on conflict (record_id, level_id, activity_key) do update
      set reported_count = excluded.reported_count,
          recorded_count = excluded.recorded_count,
          verified       = excluded.verified,
          points         = excluded.points,
          scene_ids      = excluded.scene_ids;

    target := target + pts;

    -- ── 8a. the audit, one row per level that actually moved ────────────────
    if old_cnt is distinct from cnt or old_pts is distinct from pts then
      insert into public.daily_activity_updates
        (record_id, user_id, actor_id, version, action, level_id, activity_key,
         old_count, new_count, old_points, new_points)
      values
        (rec.id, actor, actor, new_ver,
         case when created then 'CREATED' else 'UPDATED' end,
         e.lvl, e.akey, old_cnt, cnt, old_pts, pts);
    end if;
  end loop;

  -- ── 6. the ledger, reconciled ─────────────────────────────────────────────
  --
  -- The day's non-BONUS sum is what the base award currently stands at, whatever wrote it —
  -- an auto-award from `activity_submit()`, a legacy row from before 0031, a manual correction
  -- by the સંચાલક, or an earlier version of this very record. `target` is what the record now
  -- says the day is worth. The difference is one row.
  --
  -- **Never an UPDATE and never a DELETE.** 0031:669-674: a correction that was itself a
  -- mistake is corrected by a third row, and all three stay. The delta may be negative, which
  -- is why `point_transactions_points_check` was widened above.
  select coalesce(sum(t.points), 0)::integer into ledger
  from public.point_transactions t
  where t.user_id = actor
    and t.activity_date = day
    and coalesce(t.award_kind, 'DAY_FIRST') <> 'BONUS';

  delta := target - ledger;

  if delta <> 0 then
    -- level 0 and an empty activity_key: the difference is a fact about the day and not about
    -- any one ladder, which is the same "belongs to no level" 0031 gave a manual adjustment.
    -- The key is the record and its version — never an attempt id, because every existing
    -- repeatable key is one (0033:1057, :1086, :1142) and reusing one would be refused as a
    -- duplicate while minting a fake attempt would create a second scoring system.
    perform public.point_award(
      actor, day, 0, '', delta, 'DAILY_ADJUST',
      'DAILY_RECORD', 0, 0,
      'daily:' || rec.id::text || ':' || new_ver::text,
      'Daily record ' || day::text || ' v' || new_ver::text
    );
  end if;

  -- ── 7. the milestones, through 0033's engine ──────────────────────────────
  --
  -- `point_bonus_apply()` and not a second bonus path. The two gates it normally sits behind
  -- are `award_points()`'s and have to be restated here, in the same order, because this is a
  -- second caller and not a second engine: a project with points switched off must not start
  -- paying milestones because a form was filled in.
  if (select s.enabled from public.point_settings() s) then
    for e in
      select c.level_id as lvl, c.activity_key as akey
      from public.daily_activity_counts c
      where c.record_id = rec.id and c.reported_count > 0
      order by c.level_id, c.activity_key
    loop
      if public.point_rule_live(e.lvl, e.akey, day) then
        perform public.point_bonus_apply(actor, day, e.lvl, e.akey, 'DAILY_RECORD', 0, 0);
      end if;
    end loop;
  end if;

  select coalesce(sum(t.points), 0)::integer into bonus
  from public.point_transactions t
  where t.user_id = actor and t.activity_date = day and t.award_kind = 'BONUS';

  -- ── 9. the totals and the version ─────────────────────────────────────────
  update public.daily_activity_records
     set total_base_points  = target,
         total_bonus_points = bonus,
         total_points       = target + bonus,
         version            = new_ver,
         status             = 'OPEN'
   where id = rec.id;

  -- ── 8b. the head row ──────────────────────────────────────────────────────
  insert into public.daily_activity_updates
    (record_id, user_id, actor_id, version, action, level_id, activity_key,
     old_count, new_count, old_points, new_points, client_token)
  values
    (rec.id, actor, actor, new_ver,
     case when created then 'CREATED' else 'UPDATED' end,
     null, '', null, null, before_, target + bonus, p_client_token);

  perform set_config('varni.daily_record', '', true);

  result := public.daily_record_snapshot(actor, day);

  return result;
end;
$$;

revoke all on function public.daily_record_save(date, jsonb, uuid) from public;
grant execute on function public.daily_record_save(date, jsonb, uuid) to authenticated;

comment on function public.daily_record_save(date, jsonb, uuid) is
  'The one write path for a daily record (0034). Derives the યુવક from auth.uid() and never '
  'from a parameter; creates or edits the day inside its 24-hour window; clamps each reported '
  'count to the admin-configured dailyMax; prices the day from the rules in force on that '
  'activity_date; reconciles the ledger with ONE compensating DAILY_ADJUST row through '
  'point_award(); re-evaluates milestones through point_bonus_apply(); writes the audit rows; '
  'and returns the same document daily_record_get() returns. p_client_token makes a double tap '
  'one save. All of it in one transaction, so there is no half-saved day.';

-- ================================================================ the lazy lock

-- Stamp `status` and `locked_at` on every record whose window has closed.
--
-- There is no cron job and there must not be one, for 0021's reason about the daily reset: a
-- job whose purpose is to close yesterday is a job that will one day close today. So the seal
-- runs at the moments somebody asks — the યુવક's sign-in check, and every સંચાલક report — and
-- the column is stamped with `edit_until` rather than with the instant of noticing, because the
-- record locked when the window closed and not when anybody looked.
--
-- `p_user` NULL means every યુવક, which is what the સંચાલક's report needs: a panel that
-- compared its own browser clock against `edit_until` would be deciding a server question on a
-- client, and two phones in two time zones would disagree about whether a day was still open.
-- The work is bounded by `daily_activity_records_open_idx`, a partial index over exactly the
-- rows this touches, so a project with nothing to seal pays for one index probe.
create or replace function public.daily_record_seal(p_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  perform set_config('varni.daily_record', 'seal', true);

  update public.daily_activity_records r
     set status = 'LOCKED'
   where r.status = 'OPEN'
     and r.edit_until <= now()
     and (p_user is null or r.user_id = p_user);

  get diagnostics n = row_count;

  perform set_config('varni.daily_record', '', true);

  return n;
end;
$$;

revoke all on function public.daily_record_seal(uuid) from public;

comment on function public.daily_record_seal(uuid) is
  'Stamps status LOCKED and locked_at on every daily record whose 24-hour window has closed '
  '(0034). NULL p_user means every યુવક. Called by daily_record_get(), daily_record_status() '
  'and both admin readers, so that status and locked_at are authoritative and no screen has to '
  'compare its own clock against edit_until. locked_at is set to edit_until by '
  'daily_record_guard() - the record locked when the window closed, not when somebody noticed.';

-- ================================================================ the યુવક's own reading

-- One day: the record, its per-level counts (reported AND recorded), its points, and the
-- window state.
--
-- **No `p_user` parameter**, for the reason `my_point_history()` gives (0033) and this file
-- gives at `daily_record_save()`: a parameter is a value a browser chooses.
--
-- VOLATILE rather than STABLE, and deliberately: it seals the caller's expired records first,
-- so that the `status` and `locked_at` it returns are facts and not a reading of the clock the
-- caller would then have to repeat. PostgREST calls a volatile function with POST, which the
-- client library handles; the alternative is a screen that says OPEN about a record the server
-- would refuse.
create or replace function public.daily_record_get(p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  day   date := coalesce(p_date, timezone('Asia/Kolkata', now())::date);
begin
  if actor is null then
    raise exception 'daily_record_not_signed_in' using errcode = '42501';
  end if;

  perform public.daily_record_seal(actor);

  return public.daily_record_snapshot(actor, day);
end;
$$;

revoke all on function public.daily_record_get(date) from public;
grant execute on function public.daily_record_get(date) to authenticated;

comment on function public.daily_record_get(date) is
  'The caller''s own daily record for one date - the window state, the totals, and every '
  'level''s reported and recorded count side by side (0034). No p_user, because a p_user is a '
  'value a browser chooses. Seals expired records first, so status, locked_at and '
  'remainingSeconds are the server''s answer rather than something the client works out.';

-- The sign-in check: which of my days are still open, and for how long.
--
-- Today and yesterday are named separately because they are the two the screen always asks
-- about — a યુવક signing in this morning has a day to fill in and a day he may still correct —
-- and `open` carries every still-open record including those two, because a record opened for
-- an older day is still open and a list that quietly omitted it would be a list he could not
-- act on.
create or replace function public.daily_record_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  today date;
begin
  if actor is null then
    raise exception 'daily_record_not_signed_in' using errcode = '42501';
  end if;

  today := timezone('Asia/Kolkata', now())::date;

  perform public.daily_record_seal(actor);

  return jsonb_build_object(
    'today',     public.daily_record_snapshot(actor, today),
    'yesterday', public.daily_record_snapshot(actor, today - 1),

    'open',
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'date',             r.activity_date,
               'recordId',         r.id,
               'status',           'OPEN',
               'editable',         true,
               'version',          r.version,
               'editUntil',        r.edit_until,
               'remainingSeconds', floor(extract(epoch from (r.edit_until - now())))::integer,
               'points',           r.total_points
             ) order by r.activity_date desc)
      from public.daily_activity_records r
      where r.user_id = actor and now() < r.edit_until
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.daily_record_status() from public;
grant execute on function public.daily_record_status() to authenticated;

comment on function public.daily_record_status() is
  'The login-time check (0034): the caller''s record for today and for yesterday, plus every '
  'still-open record with how long remains on each. Seals expired records first, so a record '
  'reported OPEN here is one the server will still accept a save for.';

-- ================================================================ the milestone count, widened

-- `point_bonus_count()`, reissued so that a milestone follows the reported counts.
--
-- 0033 counted COMPLETION_COUNT and ITEM_COUNT from the event tables, which was the only place
-- a count existed. A યુવક may now report more than the app observed, and a milestone measured
-- against events alone would mean two different things for two યુવકો who did the same amount of
-- ધ્યાન — one of them near his phone and one of them not. §7's decision is that counts are
-- trusted, and a trigger that ignored them would be quietly disagreeing with it.
--
-- **The record speaks for the (day, level, activity) it names, and only for that.** The event
-- rows for a (day, level, activity) a record covers are excluded and the record's
-- `reported_count` stands in their place; every other day and every other activity is counted
-- from the events exactly as 0033 counted it. So a project with no daily records answers
-- byte-identically to 0033 — asserted in §K, not assumed — and a record that covers only
-- લેવલ ૨ does not silence લેવલ ૧ on the same day.
--
-- ITEM_COUNT takes the same substitution but only for a level whose report named દ્રશ્યો.
-- `reported_count` is a count of acts unless the payload carried ids, and letting a count of
-- acts stand in for a count of items would make one trigger mean two different things.
-- POINT_TOTAL is untouched and needs no change: it is the ledger's own sum, and the
-- reconciliation above has already made the ledger agree with the record.
create or replace function public.point_bonus_count(
  p_user    uuid,
  p_trigger text,
  p_level   integer,
  p_key     text
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select case p_trigger

    when 'COMPLETION_COUNT' then
      coalesce((
        select count(*)
        from public.activity_attempts a
        where a.user_id = p_user
          and a.status = 'COMPLETED'
          and (p_level is null or a.level_id = p_level)
          and (p_key   is null or a.activity_key = p_key)
          and not exists (
            select 1
            from public.daily_activity_counts dc
            join public.daily_activity_records dr on dr.id = dc.record_id
            where dr.user_id       = a.user_id
              and dr.activity_date = a.activity_date
              and dc.level_id      = a.level_id
              and dc.activity_key  = a.activity_key
          )
      ), 0::bigint)
      + case when p_level is null or p_level = 4 then
          coalesce((
            select count(*)
            from public.level4_attempts la
            join public.level4_activities act on act.id = la.activity_id
            where la.user_id = p_user
              and la.passed
              and (p_key is null or act.code = p_key)
              and not exists (
                select 1
                from public.daily_activity_counts dc
                join public.daily_activity_records dr on dr.id = dc.record_id
                where dr.user_id       = la.user_id
                  and dr.activity_date = timezone('Asia/Kolkata', la.at)::date
                  and dc.level_id      = 4
                  and dc.activity_key  = coalesce(act.code, '')
              )
          ), 0::bigint)
        else 0::bigint end
      + coalesce((
          select sum(dc.reported_count)
          from public.daily_activity_counts dc
          join public.daily_activity_records dr on dr.id = dc.record_id
          where dr.user_id = p_user
            and (p_level is null or dc.level_id = p_level)
            and (p_key   is null or dc.activity_key = p_key)
        ), 0::bigint)

    when 'ITEM_COUNT' then
      coalesce((
        select count(*)
        from (
          select distinct a.id, s.scene_id
          from public.activity_attempts a
          cross join lateral unnest(a.selected_scene_ids) as s(scene_id)
          where a.user_id = p_user
            and a.status = 'COMPLETED'
            and (p_level is null or a.level_id = p_level)
            and (p_key   is null or a.activity_key = p_key)
            and not (s.scene_id = any (public.admin_withheld_scene_ids()))
            and not exists (
              select 1
              from public.daily_activity_counts dc
              join public.daily_activity_records dr on dr.id = dc.record_id
              where dr.user_id       = a.user_id
                and dr.activity_date = a.activity_date
                and dc.level_id      = a.level_id
                and dc.activity_key  = a.activity_key
                and dc.scene_ids <> '{}'::text[]
            )
        ) ticked
      ), 0::bigint)
      + case when p_level is null or p_level = 4 then
          coalesce((
            select sum(la.selected_count)
            from public.level4_attempts la
            join public.level4_activities act on act.id = la.activity_id
            where la.user_id = p_user
              and la.passed
              and (p_key is null or act.code = p_key)
              and not exists (
                select 1
                from public.daily_activity_counts dc
                join public.daily_activity_records dr on dr.id = dc.record_id
                where dr.user_id       = la.user_id
                  and dr.activity_date = timezone('Asia/Kolkata', la.at)::date
                  and dc.level_id      = 4
                  and dc.activity_key  = coalesce(act.code, '')
                  and dc.scene_ids <> '{}'::text[]
              )
          ), 0::bigint)
        else 0::bigint end
      + coalesce((
          select sum(cardinality(dc.scene_ids))
          from public.daily_activity_counts dc
          join public.daily_activity_records dr on dr.id = dc.record_id
          where dr.user_id = p_user
            and dc.scene_ids <> '{}'::text[]
            and (p_level is null or dc.level_id = p_level)
            and (p_key   is null or dc.activity_key = p_key)
        ), 0::bigint)

    -- The ledger, and the whole ledger: a legacy row is ગુણ he earned and a BONUS row already
    -- paid is ગુણ he holds. Untouched by 0034 and needing nothing: the day's DAILY_ADJUST row
    -- is already in this sum, which is what makes the milestone agree with the record without
    -- this branch knowing that records exist.
    when 'POINT_TOTAL' then
      coalesce((
        select sum(t.points)
        from public.point_transactions t
        where t.user_id = p_user
          and (p_level is null or t.level_id = p_level)
          and (p_key   is null or t.activity_key = p_key)
      ), 0::bigint)

    else 0::bigint
  end;
$$;

revoke all on function public.point_bonus_count(uuid, text, integer, text) from public;

comment on function public.point_bonus_count(uuid, text, integer, text) is
  'How far one યુવક is along a milestone rule''s scope (0033, extended 0034). A daily record '
  'speaks for the (day, level, activity) it names and its reported_count replaces the events '
  'for exactly that key; every other day is counted from the events as before, so a project '
  'with no records answers exactly what 0033 answered. ITEM_COUNT takes the substitution only '
  'where the report named દ્રશ્યો, because reported_count is otherwise a count of acts. '
  'POINT_TOTAL is the ledger''s own sum and needed no change. Lifetime, never windowed.';

-- ================================================================ the સંચાલક's side

-- Every daily record, filtered and paged.
--
-- The guard is a **statement** and not a CTE, which is 0029's and 0030's idiom and is the only
-- form that works. 0032's header explains it at length and it is worth restating because the
-- consequence was live: written as `with guard as (select admin_assert_progress_reader())` and
-- joined into the FROM list, the CTE is referenced once so the planner inlines it, no column of
-- it is used so the target entry is pruned, and the function is never called at all — the
-- report then answered any signed-in યુવક. A guard in a WHERE clause is no better, because it
-- is not evaluated when the scan beneath it yields no rows, so a query about a યુવક with no
-- records would answer an unauthorised caller with silence rather than a refusal. A statement
-- before the query runs whatever the query returns.
--
-- **The seal runs first**, which is why this function is VOLATILE. The panel reads `status` and
-- `locked_at` and must not be asked to compare its own browser clock against `edit_until`: two
-- phones in two time zones would disagree about whether a day was still open, and the server
-- already knows.
--
-- The four per-level parameters and the eight per-level columns are the panel's contract, not
-- a belief about how many ladders there are. Nothing inside this function counts levels: the
-- columns are `filter`ed projections of `daily_activity_counts`, which is keyed by
-- `(record, level, activity)` and would carry a fifth rung the day one exists. Adding it here
-- would then be a projection to add, not a rewrite.
create or replace function public.admin_daily_records(
  p_search      text    default null,
  p_city        text    default null,
  p_zone        text    default null,
  p_from        date    default null,
  p_to          date    default null,
  p_min_points  integer default null,
  p_min_level1  integer default null,
  p_min_level2  integer default null,
  p_min_level3  integer default null,
  p_min_level4  integer default null,
  p_page        integer default 0,
  p_page_size   integer default 50
)
returns table (
  total_rows         bigint,
  user_id            uuid,
  name               text,
  smk                text,
  city_id            text,
  zone_id            text,
  record_date        date,
  level1_reported    integer,
  level1_recorded    integer,
  level2_reported    integer,
  level2_recorded    integer,
  level3_reported    integer,
  level3_recorded    integer,
  level4_reported    integer,
  level4_recorded    integer,
  reported_total     integer,
  recorded_total     integer,
  base_points        integer,
  bonus_points       integer,
  total_points       integer,
  first_submitted_at timestamptz,
  last_updated_at    timestamptz,
  edit_until         timestamptz,
  locked_at          timestamptz,
  status             text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  size integer := least(greatest(coalesce(p_page_size, 50), 1), 200);
  skip integer := greatest(coalesce(p_page, 0), 0) * size;
  term text    := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.admin_assert_progress_reader();

  perform public.daily_record_seal(null);

  return query
  with per_record as (
    select c.record_id,
           coalesce(sum(c.reported_count) filter (where c.level_id = 1), 0)::integer as l1r,
           coalesce(sum(c.recorded_count) filter (where c.level_id = 1), 0)::integer as l1d,
           coalesce(sum(c.reported_count) filter (where c.level_id = 2), 0)::integer as l2r,
           coalesce(sum(c.recorded_count) filter (where c.level_id = 2), 0)::integer as l2d,
           coalesce(sum(c.reported_count) filter (where c.level_id = 3), 0)::integer as l3r,
           coalesce(sum(c.recorded_count) filter (where c.level_id = 3), 0)::integer as l3d,
           coalesce(sum(c.reported_count) filter (where c.level_id = 4), 0)::integer as l4r,
           coalesce(sum(c.recorded_count) filter (where c.level_id = 4), 0)::integer as l4d,
           coalesce(sum(c.reported_count), 0)::integer as rep_all,
           coalesce(sum(c.recorded_count), 0)::integer as rec_all
    from public.daily_activity_counts c
    group by c.record_id
  ),
  filtered as (
    select r.id, r.user_id, r.activity_date, r.total_base_points, r.total_bonus_points,
           r.total_points, r.first_submitted_at, r.last_updated_at, r.edit_until,
           r.locked_at, r.status,
           p.name, p.smk, p.zone_id as city_id, p.sub_zone_id as zone_id,
           coalesce(pr.l1r, 0) as l1r, coalesce(pr.l1d, 0) as l1d,
           coalesce(pr.l2r, 0) as l2r, coalesce(pr.l2d, 0) as l2d,
           coalesce(pr.l3r, 0) as l3r, coalesce(pr.l3d, 0) as l3d,
           coalesce(pr.l4r, 0) as l4r, coalesce(pr.l4d, 0) as l4d,
           coalesce(pr.rep_all, 0) as rep_all, coalesce(pr.rec_all, 0) as rec_all
    from public.daily_activity_records r
    join public.profiles p on p.id = r.user_id
    left join per_record pr on pr.record_id = r.id
    where (p_from is null or r.activity_date >= p_from)
      and (p_to   is null or r.activity_date <= p_to)
      and (p_city is null or p.zone_id = p_city)
      and (p_zone is null or p.sub_zone_id = p_zone)
      and (p_min_points is null or r.total_points >= p_min_points)
      and (
        term is null
        or p.name   ilike '%' || term || '%'
        or p.mobile ilike '%' || term || '%'
        or p.email  ilike '%' || term || '%'
        or coalesce(p.smk, '') ilike '%' || term || '%'
      )
      and (p_min_level1 is null or coalesce(pr.l1r, 0) >= p_min_level1)
      and (p_min_level2 is null or coalesce(pr.l2r, 0) >= p_min_level2)
      and (p_min_level3 is null or coalesce(pr.l3r, 0) >= p_min_level3)
      and (p_min_level4 is null or coalesce(pr.l4r, 0) >= p_min_level4)
  )
  select
    count(*) over ()::bigint,
    f.user_id,
    f.name,
    f.smk,
    f.city_id,
    f.zone_id,
    f.activity_date,
    f.l1r, f.l1d,
    f.l2r, f.l2d,
    f.l3r, f.l3d,
    f.l4r, f.l4d,
    f.rep_all,
    f.rec_all,
    f.total_base_points,
    f.total_bonus_points,
    f.total_points,
    f.first_submitted_at,
    f.last_updated_at,
    f.edit_until,
    f.locked_at,
    f.status
  from filtered f
  -- A total order. `activity_date desc` alone would leave two records of the same day in
  -- whatever sequence the plan produced, and a pager over an unstable order repeats and drops
  -- rows between pages.
  order by f.activity_date desc, f.name, f.user_id
  offset skip
  limit size;
end;
$$;

revoke all on function public.admin_daily_records(text, text, text, date, date, integer,
  integer, integer, integer, integer, integer, integer) from public;
grant execute on function public.admin_daily_records(text, text, text, date, date, integer,
  integer, integer, integer, integer, integer, integer) to authenticated;

comment on function public.admin_daily_records(text, text, text, date, date, integer,
  integer, integer, integer, integer, integer, integer) is
  'Every daily record for the સંચાલક, filtered by search, city, zone, date range, minimum '
  'points and a minimum count per level, paged server-side with total_rows repeated on every '
  'row (0034). Opens with admin_assert_progress_reader() as a STATEMENT, never a CTE - see '
  '0032''s header for the security hole the CTE form was. Seals expired records first, so '
  'status and locked_at are the server''s answer and the panel never compares its own clock.';

-- One record, everything about it: the day, its levels, its trail and the money.
--
-- One jsonb document rather than four result sets, because the four are one screen and a panel
-- that had to issue four calls would render three of them against a record it had already
-- stopped showing. `record` carries the યુવક's name and place so the header needs no join of
-- its own.
create or replace function public.admin_daily_record_detail(p_user uuid, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
begin
  perform public.admin_assert_progress_reader();

  perform public.daily_record_seal(p_user);

  select r.id into rid
  from public.daily_activity_records r
  where r.user_id = p_user and r.activity_date = p_date;

  return jsonb_build_object(
    'record',
    (select jsonb_build_object(
              'recordId',         r.id,
              'userId',           r.user_id,
              'name',             p.name,
              'smk',              p.smk,
              'cityId',           p.zone_id,
              'zoneId',           p.sub_zone_id,
              'recordDate',       r.activity_date,
              'version',          r.version,
              'status',           r.status,
              'firstSubmittedAt', r.first_submitted_at,
              'lastUpdatedAt',    r.last_updated_at,
              'editUntil',        r.edit_until,
              'lockedAt',         r.locked_at,
              'basePoints',       r.total_base_points,
              'bonusPoints',      r.total_bonus_points,
              'totalPoints',      r.total_points,
              -- Returned rather than assumed, so the panel can show that the ledger and the
              -- record agree instead of being asked to believe it.
              'ledgerPoints',
              coalesce((select sum(t.points)::integer
                        from public.point_transactions t
                        where t.user_id = r.user_id and t.activity_date = r.activity_date), 0)
            )
     from public.daily_activity_records r
     join public.profiles p on p.id = r.user_id
     where r.id = rid),

    'levels',
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'level',    c.level_id,
               'activity', c.activity_key,
               'reported', c.reported_count,
               'recorded', c.recorded_count,
               'verified', c.verified,
               'points',   c.points,
               'sceneIds', to_jsonb(c.scene_ids)
             ) order by c.level_id, c.activity_key)
      from public.daily_activity_counts c
      where c.record_id = rid
    ), '[]'::jsonb),

    'audit',
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',          u.id,
               'at',          u.at,
               'actorId',     u.actor_id,
               'actorName',   coalesce(ap.name, ''),
               'version',     u.version,
               'action',      u.action,
               'level',       u.level_id,
               'activity',    u.activity_key,
               'oldCount',    u.old_count,
               'newCount',    u.new_count,
               'oldPoints',   u.old_points,
               'newPoints',   u.new_points
             ) order by u.id)
      from public.daily_activity_updates u
      left join public.profiles ap on ap.id = u.actor_id
      where u.record_id = rid
    ), '[]'::jsonb),

    'ledger',
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',           t.id,
               'levelId',      t.level_id,
               'activityKey',  t.activity_key,
               'points',       t.points,
               'source',       t.source,
               'awardKind',    t.award_kind,
               'ruleVersion',  t.rule_version,
               'reason',       t.reason,
               'isLegacy',     (t.award_kind is null),
               'createdAt',    t.created_at
             ) order by t.created_at, t.id)
      from public.point_transactions t
      where t.user_id = p_user and t.activity_date = p_date
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_daily_record_detail(uuid, date) from public;
grant execute on function public.admin_daily_record_detail(uuid, date) to authenticated;

comment on function public.admin_daily_record_detail(uuid, date) is
  'One daily record with its per-level counts, its full audit trail and the day''s ledger rows, '
  'as one jsonb document (0034). Opens with admin_assert_progress_reader() as a STATEMENT. '
  'isLegacy marks a ledger row written before 0031, whose kind and rule version were never '
  'recorded and must not be printed as though the fields were blank.';

-- The configuration history, with a name against each change.
--
-- An RPC as well as a readable table, and the RPC is the one the panel should call. An RLS
-- denial on a **table** returns zero rows, so a table-path read cannot tell "no versions yet"
-- from "you may not read this" — and a report that renders an empty list for an unauthorised
-- caller is §31's exact complaint. This raises 42501 instead. It also resolves `changed_by` to
-- a name, which is why it takes `users.read` as well: a name is a fact about a person.
create or replace function public.admin_point_config_versions(p_limit integer default 50)
returns table (
  id              bigint,
  version         integer,
  document        jsonb,
  resolved        jsonb,
  effective_from  timestamptz,
  effective_until timestamptz,
  changed_by      uuid,
  changed_by_name text,
  is_current      boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  size integer := least(greatest(coalesce(p_limit, 50), 1), 500);
begin
  perform public.admin_assert_progress_reader();

  return query
  select c.id,
         c.version,
         c.document,
         c.resolved,
         c.effective_from,
         c.effective_until,
         c.changed_by,
         coalesce(p.name, '') as changed_by_name,
         (c.effective_until is null) as is_current
  from public.point_config_versions c
  left join public.profiles p on p.id = c.changed_by
  order by c.effective_from desc, c.id desc
  limit size;
end;
$$;

revoke all on function public.admin_point_config_versions(integer) from public;
grant execute on function public.admin_point_config_versions(integer) to authenticated;

comment on function public.admin_point_config_versions(integer) is
  'Every recorded change to settings[''levels''].value.points, newest first, with the સંચાલક''s '
  'name against each (0034). Prefer this to selecting point_config_versions directly: an RLS '
  'denial on a table returns zero rows and cannot be told apart from "nothing here yet", and '
  '§31 asks for an authorisation error rather than an empty report.';

-- ================================================================ rls

alter table public.daily_activity_records enable row level security;
alter table public.daily_activity_counts  enable row level security;
alter table public.daily_activity_updates enable row level security;
alter table public.point_config_versions  enable row level security;

-- The user-owned idiom, exactly as `progress` has had it since 0004:602-610: read your own or
-- read everyone's with `progress.read`, insert and update your own row only and only while you
-- are an ACTIVE યુવક.
--
-- **And no delete policy, for anybody.** Not a narrow one — none. RLS denies any command it has
-- no policy for, so a DELETE is refused for `authenticated` no matter what the row says. A day
-- a યુવક can delete is a day he can re-report, and the ledger rows that paid for the first
-- version would still be standing.
--
-- The policies state the ownership; `daily_record_guard()` states its limits. It takes both,
-- and the trigger is the load-bearing half: an own-row UPDATE policy on its own would leave
-- `edit_until`, `version` and three points columns writable by the person they bind.

drop policy if exists "own daily record readable"  on public.daily_activity_records;
drop policy if exists "own daily record writable"  on public.daily_activity_records;
drop policy if exists "own daily record updatable" on public.daily_activity_records;

create policy "own daily record readable" on public.daily_activity_records
  for select using (user_id = auth.uid() or public.has_permission('progress.read'));

create policy "own daily record writable" on public.daily_activity_records
  for insert with check (user_id = auth.uid() and public.is_active_user());

create policy "own daily record updatable" on public.daily_activity_records
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_active_user());

-- Ownership one table down is the parent's ownership. The EXISTS is not a convenience: this
-- table has no `user_id` column of its own, and giving it one would be a second place for the
-- same fact to be written and therefore a second place for it to be wrong.
drop policy if exists "own daily counts readable"  on public.daily_activity_counts;
drop policy if exists "own daily counts writable"  on public.daily_activity_counts;
drop policy if exists "own daily counts updatable" on public.daily_activity_counts;

create policy "own daily counts readable" on public.daily_activity_counts
  for select using (exists (
    select 1 from public.daily_activity_records r
    where r.id = record_id
      and (r.user_id = auth.uid() or public.has_permission('progress.read'))
  ));

create policy "own daily counts writable" on public.daily_activity_counts
  for insert with check (public.is_active_user() and exists (
    select 1 from public.daily_activity_records r
    where r.id = record_id and r.user_id = auth.uid()
  ));

create policy "own daily counts updatable" on public.daily_activity_counts
  for update using (exists (
    select 1 from public.daily_activity_records r
    where r.id = record_id and r.user_id = auth.uid()
  ))
  with check (public.is_active_user() and exists (
    select 1 from public.daily_activity_records r
    where r.id = record_id and r.user_id = auth.uid()
  ));

-- The trail and the configuration history are **read-only to every client**. One select policy
-- each and nothing else, so INSERT, UPDATE and DELETE are refused by the absence of a policy
-- rather than by a narrow one somebody could later widen without noticing. Both are written by
-- SECURITY DEFINER functions and triggers, which run as the owner and are not subject to RLS.
drop policy if exists "own daily updates readable" on public.daily_activity_updates;

create policy "own daily updates readable" on public.daily_activity_updates
  for select using (user_id = auth.uid() or public.has_permission('progress.read'));

drop policy if exists "point config versions readable" on public.point_config_versions;

-- Open to any signed-in યુવક, and that is a decision rather than a convenience: the row holds
-- what the ladders are worth and no fact about any person, and a rule he cannot see is a rule
-- he cannot aim at. It is the same choice 0033 made for `point_bonus_rules`.
create policy "point config versions readable" on public.point_config_versions
  for select using (auth.uid() is not null);

-- Belt and braces behind the missing policies, and 0021's reasoning for it: Supabase's default
-- privileges grant every new table in `public` to anon and authenticated, so RLS is otherwise
-- the only thing standing there. Revoking the privilege as well means a mistake in a future
-- migration — an added policy, a disabled RLS — still does not open the path.
revoke delete on public.daily_activity_records from anon, authenticated;
revoke delete on public.daily_activity_counts  from anon, authenticated;
revoke insert, update, delete on public.daily_activity_updates from anon, authenticated;
revoke insert, update, delete on public.point_config_versions  from anon, authenticated;

-- `anon` has no business writing a day at all: a record belongs to a signed-in યુવક and every
-- policy above says `auth.uid()`, which is NULL for him.
revoke insert, update on public.daily_activity_records from anon;
revoke insert, update on public.daily_activity_counts  from anon;

-- The sequences go with them: no client inserts into these two, so no client needs them.
revoke usage, select on sequence public.daily_activity_updates_id_seq from anon, authenticated;
revoke usage, select on sequence public.point_config_versions_id_seq  from anon, authenticated;
