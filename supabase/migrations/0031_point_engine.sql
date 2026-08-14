-- વર્ણી ધ્યાન — the ledger learns to say *why*, without forgetting anything it already said.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT 0021 BUILT, AND THE THREE THINGS IT CANNOT SAY
-- ════════════════════════════════════════════════════════════════════════════
--
-- 0021 gave this project a real ledger and a real guarantee. `point_transactions` is
-- append-only, has no write policy for anybody, and is written by exactly one revoked
-- function. The at-most-once rule lives in a unique constraint rather than in a check,
-- because a check cannot decide a race. All of that stands and none of it is undone here.
--
-- What it cannot express is a *second* award. The constraint is
--
--     unique (user_id, activity_date, level_id, activity_key)
--
-- so one યુવક, one IST day, one level, one activity is one row and one number. That is
-- exactly right for the rule 0021 was asked for — "an activity is worth its points once a
-- day" — and it makes three rules the સંચાલક has now asked for structurally impossible:
--
--   * **repeat points.** ૪.૧ passed a second time earning ૫૦ needs a second row under the
--     same key on the same day. The constraint refuses it, silently, as a duplicate.
--   * **tick points.** પુનરાવર્તન submitted twice in a day, each submission paying for the
--     દ્રશ્યો newly brought to mind, is several awards under `(3, 'revision')`.
--   * **a manual correction.** A સંચાલક crediting ૨૦૦ ગુણ is not an activity award. Filed
--     under the day's key it would occupy the slot and block the real one, and `points >= 0`
--     forbids taking any back.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION DOES NOT DO
-- ════════════════════════════════════════════════════════════════════════════
--
-- **It does not touch one existing row.** No UPDATE, no DELETE, no recomputation, no
-- backfill. Every column added below is nullable and is left NULL on every row that already
-- exists, and that is not an oversight — it is the definition:
--
--     award_kind IS NULL  ⇔  written before this migration  ⇔  legacy historical data
--
-- Inventing a value for a row nobody can now ask about would turn a fact into a guess, and
-- every screen would then report the guess with the same confidence as the fact. The panel
-- says "legacy" for those rows and says it plainly.
--
-- **It does not weaken the day rule.** The constraint is dropped and immediately recreated as
-- a *partial* unique index over the same four columns with the predicate
--
--     coalesce(award_kind, 'DAY_FIRST') = 'DAY_FIRST'
--
-- Legacy rows (NULL) and new day-scoped awards ('DAY_FIRST') therefore share one index
-- exactly as they share one rule today, and a યુવક cannot be paid twice for a day across the
-- deployment boundary. Dropping a constraint and building an equivalent index rewrites no
-- row and changes no value. Kinds that are *meant* to repeat — REPEAT, TICK, MANUAL — fall
-- outside the predicate and are deduplicated by `idempotency_key` instead.
--
-- **It does not reissue `activity_submit()` or `level4_attempts_award()`.** Both are long,
-- carefully argued functions whose reasoning belongs to 0021 and 0017, and reissuing them to
-- change an award would mean re-stating two hundred lines to alter four. Every new rule is
-- applied inside `award_points()`, which both of them already call and whose signature is
-- unchanged. The two writers keep working, unedited, and get the new behaviour.
--
-- **It does not change what an untouched project pays.** Every key added to
-- `settings['levels'].value.points` is optional and every absent key resolves to the
-- behaviour of the day before this ran. A project that never opens the new panel keeps the
-- awarding it had, byte for byte — `scripts/test-point-engine.mjs` §B asserts it rather than
-- assuming it, by driving the real writers and comparing the row column for column against
-- one written by 0021's own INSERT statement.

-- ================================================================ the ledger, widened

-- Seven nullable columns. Read the NULLs as "this row predates the question".
alter table public.point_transactions
  add column if not exists award_kind      text,
  add column if not exists rule_version    integer,
  add column if not exists reason          text,
  add column if not exists admin_id        uuid references public.profiles (id),
  add column if not exists idempotency_key text,
  add column if not exists event_ref       text,
  add column if not exists attempt_id      bigint;

comment on column public.point_transactions.award_kind is
  'DAY_FIRST | REPEAT | TICK | REVISION | MANUAL. NULL means the row was written before '
  '0031 and no kind was recorded — legacy historical data, never rewritten, never guessed.';

comment on column public.point_transactions.rule_version is
  'settings[''levels''].value.points.version at the moment of the award. The ledger still '
  'stores the number that was paid rather than a pointer to the rule (0021); this only lets '
  'the સંચાલક see which revision of the rules was in force. NULL on legacy rows.';

comment on column public.point_transactions.idempotency_key is
  'The dedupe key for every kind that is allowed to repeat. NULL for DAY_FIRST, whose '
  'at-most-once rule is the partial index point_transactions_day_unique instead.';

comment on column public.point_transactions.attempt_id is
  'activity_attempts.id or level4_attempts.id — the same value as source_id, repeated under '
  'a name the reporting functions can join on without first reading source. NULL on legacy '
  'rows and on manual adjustments.';

-- ── the day rule, unchanged in meaning ──────────────────────────────────────
--
-- `alter table ... drop constraint` removes the constraint *and* its index in one step, and
-- the partial index below re-establishes the identical rule over the identical rows. Between
-- the two statements the table is briefly unconstrained, which is safe because a migration
-- runs inside one transaction (scripts/db.mjs:96, scripts/lib/pgtest.mjs:145) and no other
-- session can insert into a table whose only writer is a function running in this one.
alter table public.point_transactions
  drop constraint if exists point_transactions_day_unique;

create unique index if not exists point_transactions_day_unique
  on public.point_transactions (user_id, activity_date, level_id, activity_key)
  where coalesce(award_kind, 'DAY_FIRST') = 'DAY_FIRST';

comment on index public.point_transactions_day_unique is
  '0021''s at-most-once rule, unchanged: one award per (યુવક, IST day, level, activity) for '
  'day-scoped kinds. Partial rather than total so that REPEAT, TICK and MANUAL — kinds whose '
  'whole purpose is to occur more than once — are governed by idempotency_key instead. '
  'coalesce() puts legacy rows (award_kind NULL) inside the predicate, so a new DAY_FIRST '
  'award cannot pay a day that was already paid before 0031.';

-- The universal dedupe key for everything the day index deliberately does not cover.
--
-- One index, every repeatable kind, because §13's list of ways a duplicate arrives — double
-- click, refresh, retry, timeout, mobile reconnect, concurrent request — is a list of ways
-- the *same* logical event arrives twice, and the answer to all six is the same: name the
-- event, and let the database refuse the second one. A check in the function would lose the
-- race, exactly as 0021:288-294 argues for the day rule.
create unique index if not exists point_transactions_idem_idx
  on public.point_transactions (idempotency_key)
  where idempotency_key is not null;

create index if not exists point_transactions_kind_date_idx
  on public.point_transactions (award_kind, activity_date desc);

create index if not exists point_transactions_attempt_idx
  on public.point_transactions (attempt_id)
  where attempt_id is not null;

-- ── the two checks that have to give a little ───────────────────────────────
--
-- Both are re-added rather than dropped, and both still hold in full for every row that is
-- not a manual correction. `add constraint` validates the whole table on the way in, so if a
-- single existing row failed either of these the migration would refuse to apply — which is
-- the check that no historical value has been disturbed, stated as a constraint.

alter table public.point_transactions
  drop constraint if exists point_transactions_points_check;

alter table public.point_transactions
  add constraint point_transactions_points_check
  check (points >= 0 or award_kind = 'MANUAL');

alter table public.point_transactions
  drop constraint if exists point_transactions_source_check;

alter table public.point_transactions
  add constraint point_transactions_source_check
  check (source in ('ACTIVITY_ATTEMPT', 'LEVEL4_ATTEMPT', 'MANUAL_ADJUSTMENT'));

-- A manual adjustment belongs to no level. 0 is that, and it is outside 1..4 so it can never
-- be confused with one; `activity_key` carries '' for the same reason.
alter table public.point_transactions
  drop constraint if exists point_transactions_level_id_check;

alter table public.point_transactions
  add constraint point_transactions_level_id_check
  check (level_id between 0 and 4);

-- Each of the three below is dropped before it is added, exactly like the three above it, and
-- the reason is worth stating because it was learned the hard way. `add constraint` has no
-- `if not exists`, so a file that only adds is a file that can be applied **once**. This
-- migration reached production, 0032 failed behind it on a reserved keyword, and re-running
-- 0031 to carry a later fix then stopped at 42710 — a migration that cannot be re-applied is a
-- migration that cannot be corrected. Dropping first costs one table validation and makes the
-- whole file idempotent, which is what every other statement here already is (`create or
-- replace`, `add column if not exists`, `create index if not exists`).
alter table public.point_transactions
  drop constraint if exists point_transactions_kind_check;

alter table public.point_transactions
  add constraint point_transactions_kind_check
  check (award_kind is null
         or award_kind in ('DAY_FIRST', 'REPEAT', 'TICK', 'REVISION', 'MANUAL'));

-- A kind that may repeat must carry the key that stops it repeating by accident, and a
-- manual row must say who and why. Stated as a constraint rather than trusted to the one
-- function that writes them, because the next writer will be written by somebody reading
-- the table and not the function.
alter table public.point_transactions
  drop constraint if exists point_transactions_repeatable_needs_key;

alter table public.point_transactions
  add constraint point_transactions_repeatable_needs_key
  check (award_kind is null
         or award_kind = 'DAY_FIRST'
         or idempotency_key is not null);

alter table public.point_transactions
  drop constraint if exists point_transactions_manual_needs_reason;

alter table public.point_transactions
  add constraint point_transactions_manual_needs_reason
  check (award_kind is distinct from 'MANUAL'
         or (admin_id is not null and length(btrim(coalesce(reason, ''))) > 0));

-- ================================================================ the rules

-- Everything `settings['levels'].value.points` now says, resolved, as one jsonb object.
--
-- Deliberately a *second* function rather than a wider `point_settings()`. That one returns
-- the four numbers and the લેવલ ૪ map, `point_value_for()` is built on it, and both are
-- mirrored branch-for-branch by `resolvePoints()`/`pointsFor()` in shared/domain/points.js.
-- Widening its return type would have meant dropping it, recreating it, and re-verifying
-- that mirror for a change that has nothing to do with the price of a level. The new keys
-- are a separate question and get a separate function; `resolvePointRules()` in the same JS
-- module is this one's mirror.
--
-- Every branch falls the way the day before this migration fell:
--
--   absent `version`        → 0            nothing is stamped differently
--   absent `effectiveFrom`  → null         every day is on or after "no date"
--   absent `disabled`       → '{}'         nothing is switched off
--   absent `repeat`         → disabled     a second pass earns nothing, as today
--   absent `tick.mode`      → 'ACTIVITY'   લેવલ ૩ pays its flat level3 value, as today
--
-- `= 'true'::jsonb` rather than truthiness, and `jsonb_typeof(...) = 'number'` rather than a
-- cast, for the reasons points.js:152-158 and 0021:390 give at length: the jsonb *string*
-- 'false' is truthy, and `Number(null)` is 0, so a loose test turns "nothing configured"
-- into a real value that pays real ગુણ.
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
    )
  );
$$;

revoke all on function public.point_rules() from public;

comment on function public.point_rules() is
  'The 0031 rule keys of settings[''levels''].value.points, resolved (repeat, tick, limits, '
  'effective date, disabled list, version). Mirrors resolvePointRules() in '
  'shared/domain/points.js branch for branch. Every absent key resolves to the behaviour of '
  '0021, so an untouched settings row pays exactly what it paid before.';

-- Is this rule live for this day?
--
-- Two questions in one, and both are about the *rule*, never about the યુવક: has the
-- સંચાલક switched this one off, and had the rule set taken effect by the day being paid.
-- The date compared is the attempt's own business day, not `now()` — a submission at ૨૩:૫૯
-- that commits at ૦૦:૦૦ belongs to the day it was made, which is the same reading
-- `level4_attempts_award()` takes of `new.at`.
create or replace function public.point_rule_live(p_level integer, p_key text, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
           when r.rules -> 'effectiveFrom' is not null
                and p_date < (r.rules ->> 'effectiveFrom')::date then false
           when r.rules -> 'disabled' @> to_jsonb(coalesce(p_key, '')) then false
           when r.rules -> 'disabled' @> to_jsonb('level' || coalesce(p_level, 0)::text) then false
           else true
         end
  from (select public.point_rules() as rules) r;
$$;

revoke all on function public.point_rule_live(integer, text, date) from public;

comment on function public.point_rule_live(integer, text, date) is
  'Whether the rule for this level/activity was switched on and had taken effect on this '
  'business day (0031). Disabling accepts either an activity code (''4.3'') or a level '
  '(''level2''), so a સંચાલક can stop one કસોટી or a whole ladder without blanking values '
  'he would then have to retype.';

-- ================================================================ the single writer

-- One row, or none. Everything above decides *what*; this decides *whether it is already
-- written*, and it decides it the only way that survives a race — by trying, and letting an
-- index refuse.
--
-- Two conflict targets, because there are two dedupe rules and pretending there is one would
-- mean either giving DAY_FIRST a synthetic key it does not need or giving REPEAT a day slot
-- it must not occupy:
--
--   p_idem is null  → day-scoped. Conflicts on point_transactions_day_unique, whose predicate
--                     this row satisfies. This is 0021's insert, unchanged in every respect.
--   p_idem given    → repeatable. Conflicts on point_transactions_idem_idx.
--
-- A zero is still never written, for 0021's reason and one more: a zero row carrying an
-- idempotency key would make the retry of a genuinely-zero award look like an award, and the
-- panel would show a payment of nothing.
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
  -- not paid him. MANUAL is the exception and only for a negative, which is a correction and
  -- is very much something that happened.
  if coalesce(p_points, 0) = 0 then
    return 0;
  end if;

  if p_points < 0 and p_kind <> 'MANUAL' then
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
  'The only writer of point_transactions since 0031 — award_points() and '
  'admin_award_manual_points() are its only callers. Deduplicates on the day index when '
  'p_idem is null and on idempotency_key otherwise, both with ON CONFLICT DO NOTHING and no '
  'existence check, because a check cannot decide a race (0021:288-294). Never writes a zero.';

-- ================================================================ the rules, applied

-- The function `activity_submit()` step 9 and `level4_attempts_award()` already call, with
-- the signature they already call it with. Every rule 0031 adds is applied in here, which is
-- why neither of those two functions is reissued: their reasoning is 0021's and 0017's, it
-- has not changed, and re-stating two hundred lines to alter four is how a carefully argued
-- function acquires a paragraph nobody meant.
--
-- What it now does, in order:
--
--   0. Is the rule live at all for this day? (effective date, disabled list)
--   1. લેવલ ૩ under a tick rule takes the tick branch and **does not** also take the flat
--      one. The mode is a choice between rules, not a stack of them — §12 offers "per tick
--      OR per revision OR another rule", and a યુવક paid ૩૦૦ for the day *and* ૧ per tick
--      would be paid twice for one act under two names.
--   2. Everything else takes 0021's day-scoped branch, unchanged.
--   3. લેવલ ૪ that found the day already paid tries the repeat rule, keyed by the attempt.
--
-- The return value is still "what was actually written", which `activity_submit` hands back
-- as `pointsAwarded` and shows to the યુવક. 0 is still not a failure.
create or replace function public.award_points(
  p_user    uuid,
  p_date    date,
  p_level   integer,
  p_key     text,
  p_source  text,
  p_source_id bigint,
  p_attempt integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rules      jsonb;
  key        text := coalesce(p_key, '');
  value_now  integer;
  written    integer := 0;
  mode       text;
  fresh      integer;
  paid_today integer;
  cap        integer;
  rep_value  integer;
  rep_limit  integer;
  rep_today  integer;
begin
  if p_user is null or p_date is null or p_level is null then
    return 0;
  end if;

  -- The off switch, and it has to be asked here rather than left to `point_value_for()`.
  --
  -- 0021's contract is that `enabled: false` is worth 0 **everywhere** — switching the system
  -- off must not require blanking four fields and must not leave a half-off state. That held
  -- while `point_value_for()` was the only source of a number, because it opens with
  -- `when not s.enabled then 0`. The તિક and repeat branches below read `point_rules()`
  -- instead, which resolves the new keys and knows nothing about `enabled`, so without this
  -- line a project with points switched off and a tick or repeat rule still configured would
  -- go on paying — and the repeat branch would pay on the *first* attempt, because it is
  -- reached whenever the day-scoped award wrote nothing and a disabled system always writes
  -- nothing. A scoring system nobody switched on is exactly what §J3 forbids.
  if not (select s.enabled from public.point_settings() s) then
    return 0;
  end if;

  if not public.point_rule_live(p_level, key, p_date) then
    return 0;
  end if;

  rules := public.point_rules();

  -- ── લેવલ ૩ under a tick rule ──────────────────────────────────────────────
  if p_level = 3 and (rules #>> '{tick,mode}') in ('TICK', 'REVISION') then
    mode := rules #>> '{tick,mode}';

    if mode = 'REVISION' then
      -- Per submission. The idempotency key is the attempt, so a retried submit pays once
      -- and a genuinely new નોંધાવો pays again — which is the whole difference between the
      -- two, and the only place in this file where the two are told apart.
      value_now := (rules #>> '{tick,perRevision}')::integer;
    else
      -- Per tick, and per tick **newly** brought to mind today.
      --
      -- Counted as: the distinct દ્રશ્યો named by this attempt, minus any the સંચાલક has
      -- withheld, minus every દ્રશ્ય already named by an *earlier* attempt of the same day.
      -- Without that last subtraction a યુવક submitting the same ૧૦૮ ticks five times is
      -- paid for ૫૪૦ ticks he made once, and the ledger would be describing a day that did
      -- not happen. `admin_withheld_scene_ids()` is the same authority 0029 uses, and is the
      -- most the database can know about the collection — membership of the manifest is a
      -- file it cannot read (0030's header).
      select count(*)::integer into fresh
      from (
        select distinct s.scene_id
        from public.activity_attempts a
        cross join lateral unnest(a.selected_scene_ids) as s(scene_id)
        where a.id = p_source_id
          and not (s.scene_id = any (public.admin_withheld_scene_ids()))
      ) mine
      where not exists (
        select 1
        from public.activity_attempts e
        cross join lateral unnest(e.selected_scene_ids) as t(scene_id)
        where e.user_id = p_user
          and e.activity_date = p_date
          and e.level_id = 3
          and e.activity_key = key
          and e.id < p_source_id
          and t.scene_id = mine.scene_id
      );

      value_now := fresh * (rules #>> '{tick,perTick}')::integer;

      -- The day's ceiling, if the સંચાલક set one. Read from the ledger rather than counted
      -- in the caller, so a second phone submitting at the same moment cannot spend the same
      -- headroom twice — whichever insert lands second sees the first one's row.
      cap := (rules #>> '{tick,dailyCap}')::integer;
      if cap > 0 then
        select coalesce(sum(t.points), 0)::integer into paid_today
        from public.point_transactions t
        where t.user_id = p_user
          and t.activity_date = p_date
          and t.award_kind = 'TICK';

        value_now := least(value_now, greatest(cap - paid_today, 0));
      end if;
    end if;

    return public.point_award(
      p_user, p_date, p_level, key, value_now,
      case when mode = 'TICK' then 'TICK' else 'REVISION' end,
      p_source, p_source_id, p_attempt,
      lower(mode) || ':' || coalesce(p_source_id, 0)::text
    );
  end if;

  -- ── 0021's rule, unchanged ────────────────────────────────────────────────
  value_now := coalesce(public.point_value_for(p_level, key), 0);

  if value_now > 0 then
    written := public.point_award(
      p_user, p_date, p_level, key, value_now,
      'DAY_FIRST', p_source, p_source_id, p_attempt, null
    );
  end if;

  if written > 0 then
    return written;
  end if;

  -- ── the repeat rule ───────────────────────────────────────────────────────
  --
  -- Reached only when the day-scoped award wrote nothing: either the day was already paid,
  -- or this level is worth nothing. લેવલ ૪ only, because "sitting the કસોટી again" is the
  -- act the સંચાલક asked to be able to price; a second દર્શન in a day is a different
  -- question and is left where 0021 put it.
  --
  -- "First" here keeps 0021's meaning — the first passing attempt **of that day**. Redefining
  -- it as the first of a lifetime would change what every existing project pays from the
  -- moment this deploys, for a rule nobody asked to have changed.
  if p_level <> 4 or not ((rules #> '{repeat,enabled}') = 'true'::jsonb) then
    return 0;
  end if;

  rep_value := coalesce(
    case when jsonb_typeof(rules #> '{repeat,byCode}' -> key) = 'number'
         then (rules #>> array['repeat', 'byCode', key])::integer end,
    (rules #>> '{repeat,default}')::integer,
    0
  );

  if rep_value <= 0 then
    return 0;
  end if;

  rep_limit := (rules #>> '{repeat,dailyLimit}')::integer;
  if rep_limit > 0 then
    select count(*)::integer into rep_today
    from public.point_transactions t
    where t.user_id = p_user
      and t.activity_date = p_date
      and t.award_kind = 'REPEAT';

    if rep_today >= rep_limit then
      return 0;
    end if;
  end if;

  return public.point_award(
    p_user, p_date, 4, key, rep_value, 'REPEAT',
    p_source, p_source_id, p_attempt,
    'repeat:' || coalesce(p_source_id, 0)::text
  );
end;
$$;

revoke all on function public.award_points(uuid, date, integer, text, text, bigint, integer) from public;

comment on function public.award_points(uuid, date, integer, text, text, bigint, integer) is
  'Applies the live point rules to one recorded event and returns what was written (0021, '
  'reissued 0031). Same signature, same callers — activity_submit() step 9 and the '
  'level4_attempts_award trigger, neither of which was reissued. Adds the તિક/પુનરાવર્તન '
  'branch for લેવલ ૩ and the repeat branch for લેવલ ૪; with no new rule configured it does '
  'exactly what 0021 did.';

-- ================================================================ manual adjustment

-- A સંચાલક may credit or debit a યુવક, and the record of it is a **new transaction**.
--
-- Never an UPDATE. §15 asks for it and it is also the only shape that survives being asked
-- about later: an edited row can say what the total is but not what happened, and the ledger
-- exists to answer the second question. A correction that was itself a mistake is corrected
-- by a third row, and all three stay.
--
-- SECURITY DEFINER over a table with no write policy, so the permission is stated here. It is
-- `settings.update` — the permission that already governs what points are worth. A role
-- trusted to set લેવલ ૪ to ૧૦,૦૦૦ ગુણ and a role trusted to hand out ૧૦,૦૦૦ ગુણ are the
-- same role, and inventing a narrower one would only mean two places to get wrong.
create or replace function public.admin_award_manual_points(
  p_user   uuid,
  p_points integer,
  p_reason text,
  p_date   date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor   uuid := auth.uid();
  day     date := coalesce(p_date, timezone('Asia/Kolkata', now())::date);
  written integer;
  total   bigint;
begin
  if actor is null then
    raise exception 'points_not_signed_in' using errcode = '42501';
  end if;

  if not public.has_permission('settings.update') then
    raise exception 'manual point adjustment requires settings.update'
      using errcode = '42501';
  end if;

  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception 'points_unknown_user' using errcode = '23503';
  end if;

  if p_points is null or p_points = 0 then
    raise exception 'Adjustment: enter a number of points other than zero.'
      using errcode = 'check_violation';
  end if;

  if abs(p_points) > 100000 then
    raise exception 'Adjustment: between -100000 and 100000 (got %).', p_points
      using errcode = 'check_violation';
  end if;

  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Adjustment: write a reason of at least 3 characters.'
      using errcode = 'check_violation';
  end if;

  -- A fresh uuid per call, so two deliberate adjustments of the same amount for the same
  -- reason are two rows. There is no client retry to collapse here: the panel awaits the
  -- reply and a lost one is re-entered by a human who can see the ledger.
  written := public.point_award(
    p_user, day, 0, '', p_points, 'MANUAL',
    'MANUAL_ADJUSTMENT', 0, 0,
    'manual:' || gen_random_uuid()::text,
    btrim(p_reason), actor
  );

  select coalesce(sum(t.points), 0) into total
  from public.point_transactions t
  where t.user_id = p_user;

  return jsonb_build_object(
    'awarded', written,
    'total',   total,
    'date',    day
  );
end;
$$;

revoke all on function public.admin_award_manual_points(uuid, integer, text, date) from public;
grant execute on function public.admin_award_manual_points(uuid, integer, text, date) to authenticated;

comment on function public.admin_award_manual_points(uuid, integer, text, date) is
  'Credits or debits a યુવક as a NEW transaction, never an edit (§15, 0031). Requires '
  'settings.update and records admin_id and reason, both of which the ledger''s '
  'point_transactions_manual_needs_reason constraint insists on. level_id 0 and an empty '
  'activity_key say "this belongs to no level", which is what a correction is.';

-- ================================================================ the bound, widened

-- `settings_check_points()`, reissued.
--
-- Every check 0021 wrote is here unchanged and in the same order — this function is the
-- guarantee behind `validatePoints()`, and a rule quietly dropped while adding another is
-- how a validator stops being one. What follows the original body is the new keys, held to
-- the same standard: refuse what `point_rules()` would silently correct, and name the bound
-- in every message, because `saveError()` puts this text in front of the સંચાલક.
--
-- All new keys are **optional**. An absent key is not a malformed one: a settings row written
-- before 0031 must still save unchanged, which is what lets the panel be deployed after the
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
    -- with `round((p ->> 'version')::numeric)::integer` (0031:236-238), so a version the
    -- validator let through above 2147483647 makes every later call to point_rules() raise
    -- `integer out of range` — and point_rules() is on the award path for every level, through
    -- point_rule_live() and award_points(). One number typed into one field would stop the
    -- whole project being paid, at every level, for everybody. The general rule this states:
    -- a bound the validator enforces must be inside the range of the type the resolver casts
    -- to, or the resolver's forgiveness is a raise.
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
    -- `point_rule_live()` casts this field with `::date` on **every award** (0031:330) — so a
    -- stored non-day raises 22008 for every submission at every level, for everybody, exactly
    -- as an unbounded `version` did through `::integer`. That is the same defect twice, and the
    -- rule it teaches is the one stated at the version ceiling above: a bound the validator
    -- enforces must be inside the range of the type the resolver casts to.
    --
    -- Tested by casting rather than by a bigger regex, because the calendar is not a regular
    -- language: leap years alone defeat any pattern, and Postgres already owns the answer.
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
    -- The સંચાલક is told now rather than discovering it in a week of unpaid પુનરાવર્તન.
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

  return new;
end;
$$;

revoke all on function public.settings_check_points() from public;

comment on function public.settings_check_points() is
  'Refuses a settings[''levels''].value.points write that the resolvers would silently zero '
  '(0021, extended 0031 for repeat/tick/limits/effective date/disabled). Mirrors '
  'validatePoints() and validatePointRules() in shared/domain/points.js message for message. '
  'Every 0031 key is optional, so a settings row written before this migration still saves.';
