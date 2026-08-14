-- વર્ણી ધ્યાન — the ledger learns to say *how often*, and to pay for a milestone.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT 0031 BUILT, AND THE TWO THINGS IT STILL CANNOT SAY
-- ════════════════════════════════════════════════════════════════════════════
--
-- 0031 widened the ledger so that a second award could exist at all: a partial day index for
-- day-scoped kinds, a universal `idempotency_key` index for every kind whose whole purpose is
-- to repeat, and one writer — `point_award()` — that decides a duplicate by trying and letting
-- an index refuse. All of that stands and none of it is undone here.
--
-- What it cannot express is a rule about a *count*:
--
--   * **"five દર્શન in a day is five awards."** 0031's day rule pays લેવલ ૧-૩ once per IST
--     day, which is exactly what 0021 was asked for and is exactly what some સંઘો now want
--     switched off. There is no key that says so, and the repeat branch is લેવલ ૪ only.
--   * **"and the fifth one is worth a bonus."** Nothing in the schema knows what a યુવક has
--     done in total, so no rule can fire on the tenth દર્શન, the hundredth દ્રશ્ય or the
--     thousandth ગુણ. A milestone is a fact about a history, and 0031 prices single events.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION DOES NOT DO
-- ════════════════════════════════════════════════════════════════════════════
--
-- **It does not touch one existing row.** No UPDATE, no DELETE, no recomputation, no backfill.
-- `award_kind IS NULL` is still the definition of a row written before 0031, and nothing here
-- reads a legacy row for any purpose but summing it.
--
-- **It does not change what an untouched project pays.** Every key added to
-- `settings['levels'].value.points` is optional, `earn` resolves to DAY_FIRST for every level
-- that does not name a mode, and a project with no rows in `point_bonus_rules` evaluates a
-- milestone loop over zero rules and writes nothing. `scripts/test-point-bonus.mjs` §B asserts
-- that rather than assuming it, by driving the real writers under 0031's own BASE
-- configuration and comparing the ledger column for column.
--
-- **It does not reissue `activity_submit()`, `level4_submit()` or `level4_attempts_award()`.**
-- 0031's argument is unchanged and is worth restating: their reasoning belongs to 0021 and
-- 0017, it has not changed, and re-stating two hundred lines to alter four is how a carefully
-- argued function acquires a paragraph nobody meant. Every rule this file adds is applied
-- inside `award_points()`, whose signature is unchanged and whose two callers are untouched.
--
-- **It does not touch the unlock or repeat-access machine.** `deriveStatuses`,
-- `level4_activity_states` and `level4_activity_progress` are not read and not written here.
-- What a યુવક may attempt is not a scoring question.
--
-- **Nothing in the engine is hardcoded.** No activity code, no item count, no threshold, no
-- point value, and no dependence on how many ladders there are: `award_points()` looks a
-- level's earning mode up as `'level' || p_level` and falls back to 0021's rule, so a fifth
-- ladder would be scored with no change here. A ૪.૫ published next month is priced, scored
-- and eligible for a milestone with no change either — asserted in §J of the suite, which
-- creates and publishes one.
--
-- The one place four levels are named is `point_rules()`'s `earn` block, and that is a mirror
-- rather than a count: `DEFAULT_EARN` in shared/domain/points.js enumerates the same four and
-- the two resolvers must return the same document, exactly as 0031's validator already matches
-- `^level[1-4]$` in the disabled list. Nothing reads that enumeration to decide how many
-- levels exist.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ONE VIEW IS REISSUED, AND IT HAS TO BE
-- ════════════════════════════════════════════════════════════════════════════
--
-- `public.activity_history` (0021:1226) joins `point_transactions` on
-- `(user_id, activity_date, level_id, activity_key)` and says in as many words that this is
-- safe *because* `point_transactions_day_unique` allows at most one such row. That stopped
-- being true in 0031 — two TICK rows on one day already multiply a યુવક's history entry — and
-- 0033 makes it ordinary: `earn: 'EVERY'` writes one row per submission and every level-scoped
-- BONUS row shares the same key. A row-multiplying LEFT JOIN does not drift, it duplicates:
-- five દર્શન would print the same day five times on a live screen.
--
-- So the join becomes a pre-aggregated LATERAL that returns exactly one row whatever the
-- ledger holds. Every existing column keeps its name, its position and its type; `bonus_points`
-- is **appended**, which `create or replace view` permits and which `ROW_COLUMNS` in
-- src/lib/history.js (which names its columns rather than selecting `*`) is unaffected by.
--
-- `my_point_summary()` (0021:1357) was checked for the same assumption and does not have it —
-- it is already `sum(t.points)` over the caller's own rows — so it is not reissued.

-- ================================================================ the sixth kind

-- BONUS joins DAY_FIRST, REPEAT, TICK, REVISION and MANUAL.
--
-- Dropped before it is added, like every constraint 0031 states, and for the reason 0031
-- learned the hard way: `add constraint` has no `if not exists`, so a file that only adds is a
-- file that can be applied once, and a migration that cannot be re-applied is a migration that
-- cannot be corrected. §A of the suite asserts this file applies twice and moves no row.
alter table public.point_transactions
  drop constraint if exists point_transactions_kind_check;

alter table public.point_transactions
  add constraint point_transactions_kind_check
  check (award_kind is null
         or award_kind in ('DAY_FIRST', 'REPEAT', 'TICK', 'REVISION', 'MANUAL', 'BONUS'));

-- A BONUS row is a repeatable kind, so `point_transactions_repeatable_needs_key` (0031) already
-- insists it carry an idempotency key, and that key is the whole of this file's no-double-pay
-- guarantee. Nothing else needs saying to the ledger.

-- ── and a bonus may be negative ─────────────────────────────────────────────
--
-- 0021 forbade a negative outright and 0031 admitted one for MANUAL alone, on the argument
-- that a correction is the only thing that takes ગુણ away. A milestone rule can be a
-- correction too — `bonus_points` is bounded -10000..10000 in `validateBonusRule()`
-- (shared/domain/points.js) precisely so that a સંચાલક can price a penalty as well as a
-- reward — and the two halves have to agree: a rule the panel accepts and the ledger refuses
-- is a rule that saves cleanly and then silently never pays, which is the worst outcome a
-- configuration field has.
--
-- Every other kind is still non-negative, and `point_award()` below still refuses a negative
-- for all of them. Zero is refused for a milestone by `point_bonus_rules_points_check`, not
-- here, because `enabled` is how a rule is switched off and a rule that pays nothing while
-- marked enabled is one the સંચાલક believes is working.
alter table public.point_transactions
  drop constraint if exists point_transactions_points_check;

alter table public.point_transactions
  add constraint point_transactions_points_check
  check (points >= 0 or award_kind in ('MANUAL', 'BONUS'));

-- `point_award()`, reissued for one word.
--
-- The whole body is 0031's, unchanged in every other respect — this is the only writer of the
-- ledger and a line altered while adding another is how a guarantee is lost. The change is the
-- negative test, which now admits BONUS beside MANUAL for the reason above. Both conflict
-- targets, both `on conflict ... do nothing`, still no existence check, still never a zero.
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
  -- not paid him.
  if coalesce(p_points, 0) = 0 then
    return 0;
  end if;

  if p_points < 0 and p_kind not in ('MANUAL', 'BONUS') then
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
  'The only writer of point_transactions since 0031, reissued 0033 to admit a negative BONUS '
  'beside a negative MANUAL. Deduplicates on the day index when p_idem is null and on '
  'idempotency_key otherwise, both with ON CONFLICT DO NOTHING and no existence check, because '
  'a check cannot decide a race (0021:288-294). Never writes a zero.';

-- ================================================================ the milestone rules

-- What the સંચાલક has decided is worth a bonus.
--
-- ── Why a table and not another key in the settings JSON ────────────────────
--
-- Every other rule in this system is a *value* — what લેવલ ૨ is worth, whether repeats pay —
-- and a value belongs in `settings['levels'].value.points` beside its neighbours. A milestone
-- is not a value; it is a **list the સંચાલક edits row by row**, and each row needs three
-- things a JSON array cannot give it:
--
--   * a stable identity. The idempotency key of every award this rule ever pays is built from
--     it (`bonus:<id>:<n>`), so an id that changed when the list was reordered would let a
--     milestone be paid a second time under a new name. A uuid primary key cannot be reordered
--     into a different rule.
--   * a per-row audit trail. `audit_setting` files one SETTINGS_UPDATED for the whole points
--     object; the trigger below files one entry per rule with its own before/after.
--   * a per-row grant. Reading which milestones exist is not the same permission as writing
--     them, and RLS expresses that on a table and cannot express it on one JSON field.
create table if not exists public.point_bonus_rules (
  id uuid primary key default gen_random_uuid(),

  -- The સંચાલક's own words. Shown against the award on the યુવક's history screen, which is
  -- why it is not optional: "+૨૦૦" with nothing beside it is a number he cannot account for.
  name text not null,

  -- NULL means "any level" and NULL means "every activity of that level". Two nullable scope
  -- columns rather than a required pair, because the three questions a સંચાલક actually asks —
  -- "every fifth દર્શન", "every fifth કસોટી passed", "every fifth anything" — are exactly the
  -- three shapes (level+activity, level, neither).
  level_id     integer,
  activity_key text,

  trigger_type text not null default 'COMPLETION_COUNT',
  threshold    integer not null,
  bonus_points integer not null,
  reward_mode  text not null default 'EVERY',
  enabled      boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

-- Columns added defensively so that a database which already has an earlier draft of this
-- table reaches the same shape. `if not exists` on every one, like every other alter in 0031.
alter table public.point_bonus_rules
  add column if not exists name         text,
  add column if not exists level_id     integer,
  add column if not exists activity_key text,
  add column if not exists trigger_type text,
  add column if not exists threshold    integer,
  add column if not exists bonus_points integer,
  add column if not exists reward_mode  text,
  add column if not exists enabled      boolean,
  add column if not exists created_at   timestamptz,
  add column if not exists updated_at   timestamptz,
  add column if not exists created_by   uuid;

-- Every constraint dropped before it is added, for the re-runnability reason above.

alter table public.point_bonus_rules drop constraint if exists point_bonus_rules_name_check;
alter table public.point_bonus_rules
  add constraint point_bonus_rules_name_check
  check (length(btrim(coalesce(name, ''))) > 0);

alter table public.point_bonus_rules drop constraint if exists point_bonus_rules_level_check;
alter table public.point_bonus_rules
  add constraint point_bonus_rules_level_check
  check (level_id is null or level_id between 1 and 4);

alter table public.point_bonus_rules drop constraint if exists point_bonus_rules_trigger_check;
alter table public.point_bonus_rules
  add constraint point_bonus_rules_trigger_check
  check (trigger_type in ('COMPLETION_COUNT', 'ITEM_COUNT', 'POINT_TOTAL'));

-- BONUS_THRESHOLD_MIN / BONUS_THRESHOLD_MAX in shared/domain/points.js, stated here as well so
-- that the panel and the database refuse the same values. A ceiling at all, because the
-- milestone is divided into the count on every award and a threshold nobody can reach is a
-- rule that saves and does nothing.
alter table public.point_bonus_rules drop constraint if exists point_bonus_rules_threshold_check;
alter table public.point_bonus_rules
  add constraint point_bonus_rules_threshold_check
  check (threshold between 1 and 100000);

-- BONUS_POINTS_MIN / BONUS_POINTS_MAX, and `<> 0` inside them.
--
-- **Negative is allowed on purpose**: a milestone may be a correction, and
-- `point_transactions_points_check` was widened above so that the ledger can hold what this
-- column can hold. Zero is refused, because `enabled` is how a rule is switched off and a rule
-- that pays nothing while marked enabled is a rule the સંચાલક believes is working.
alter table public.point_bonus_rules drop constraint if exists point_bonus_rules_points_check;
alter table public.point_bonus_rules
  add constraint point_bonus_rules_points_check
  check (bonus_points between -10000 and 10000 and bonus_points <> 0);

alter table public.point_bonus_rules drop constraint if exists point_bonus_rules_mode_check;
alter table public.point_bonus_rules
  add constraint point_bonus_rules_mode_check
  check (reward_mode in ('EVERY', 'FIRST_ONLY', 'HIGHEST_ONLY'));

-- The scan the award path makes on every submission: the enabled rules matching one scope.
-- Partial on `enabled`, because a switched-off rule is never evaluated and there is no reason
-- to carry it in the index a યુવક's નોંધાવો waits on.
create index if not exists point_bonus_rules_scope_idx
  on public.point_bonus_rules (level_id, activity_key)
  where enabled;

comment on table public.point_bonus_rules is
  'The સંચાલક''s milestone rules (0033) — "every fifth દર્શન is worth ૨૦૦ more". A table and '
  'not a settings key, because each rule needs a stable id: every award it pays is keyed '
  '''bonus:<id>:<n>'' and that key is what stops one milestone being paid twice. Read by '
  'award_points() through point_bonus_apply(); never itself a record of anything paid, which '
  'is why deleting a rule leaves its BONUS transactions standing.';

comment on column public.point_bonus_rules.level_id is
  'NULL means every level. A rule scoped to no level counts across the whole of what the યુવક '
  'has done, which is what "his hundredth act" means.';

comment on column public.point_bonus_rules.activity_key is
  '''darshan'', ''revision'', ''video'' or a લેવલ ૪ code such as ''4.1''. NULL means every '
  'activity of the scoped level. Keyed by code and never by a કસોટી''s uuid, for 0021''s '
  'reason: level4_clone_config() mints new uuids on every republication.';

comment on column public.point_bonus_rules.trigger_type is
  'COMPLETION_COUNT (completed લેવલ ૧-૩ submissions and passed કસોટીઓ), ITEM_COUNT (દ્રશ્યો '
  'brought to mind and કસોટી items correctly named) or POINT_TOTAL (the summed ledger). All '
  'three are lifetime figures in the rule''s scope — a milestone is a fact about a history.';

comment on column public.point_bonus_rules.reward_mode is
  'EVERY pays at every multiple of the threshold; FIRST_ONLY pays the first time it is '
  'reached and never again; HIGHEST_ONLY pays only when no enabled rule of the same scope and '
  'trigger with a higher threshold has also been reached. The last is the "cumulative OR '
  'highest milestone only" choice, made configurable rather than assumed.';

comment on column public.point_bonus_rules.bonus_points is
  '-10000..10000 and never 0 — BONUS_POINTS_MIN/MAX in shared/domain/points.js. Negative is '
  'allowed because a milestone may be a correction, which is why 0033 widened '
  'point_transactions_points_check to admit a negative BONUS beside a negative MANUAL. Zero is '
  'refused because `enabled` is how a rule is switched off.';

-- ── the updated_at stamp ────────────────────────────────────────────────────
--
-- On a trigger and not left to `admin_bonus_rule_save()`, because `settings.update` also opens
-- a direct PostgREST write to this table (below), and a column that is only correct when one
-- particular function wrote the row is a column nobody can trust.
create or replace function public.point_bonus_rules_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.point_bonus_rules_touch() from public;

drop trigger if exists point_bonus_rules_touch on public.point_bonus_rules;

create trigger point_bonus_rules_touch
  before update on public.point_bonus_rules
  for each row execute function public.point_bonus_rules_touch();

-- ── the audit trail ─────────────────────────────────────────────────────────
--
-- The shape `audit_scene()` and `audit_setting()` established in 0004: SECURITY DEFINER so the
-- insert passes audit_logs' RLS, `actor_id` from `auth.uid()` and never from an argument, and
-- a migration or seed (no session user) skipped rather than attributed to somebody.
--
-- DELETE is included, unlike 0004's two, because a deleted rule is the one change whose
-- evidence is otherwise gone: the rule row is the only place its name and threshold were
-- written down, and the BONUS transactions it paid survive it without carrying either.
create or replace function public.audit_point_bonus_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  act   text;
  b     jsonb;
  a     jsonb;
  tid   text;
begin
  if actor is null or not public.is_admin() then
    -- OLD and NEW are only touched under an explicit tg_op test, never as the second half of
    -- an `and`: PL/pgSQL does not promise left-to-right evaluation, and reading OLD during an
    -- INSERT raises "record old is not assigned yet" (0004:393-395).
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    act := 'BONUS_RULE_DELETED';
    b   := to_jsonb(old);
    tid := old.id::text;
  elsif tg_op = 'UPDATE' then
    act := 'BONUS_RULE_UPDATED';
    b   := to_jsonb(old);
    a   := to_jsonb(new);
    tid := new.id::text;
  else
    act := 'BONUS_RULE_CREATED';
    a   := to_jsonb(new);
    tid := new.id::text;
  end if;

  insert into public.audit_logs
    (actor_id, actor_role, action, resource_type, target_id, "before", "after")
  values
    (actor, public.effective_role()::text, act, 'point_bonus_rules', tid, b, a);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.audit_point_bonus_rule() from public;

drop trigger if exists audit_point_bonus_rules on public.point_bonus_rules;

create trigger audit_point_bonus_rules
  after insert or update or delete on public.point_bonus_rules
  for each row execute function public.audit_point_bonus_rule();

-- ── who may read and who may write ──────────────────────────────────────────
--
-- Reading an enabled rule is open to any signed-in યુવક, and that is a decision rather than a
-- convenience: a milestone he cannot see is a milestone he cannot aim at, and the row contains
-- no fact about any person. A **disabled** rule is not shown to him, because a rule the
-- સંચાલક has switched off is a draft and reads as a promise.
--
-- Writing is `settings.update` — the permission that already governs what points are worth.
-- 0031 made the same choice for `admin_award_manual_points()` and gave the reason: a role
-- trusted to set લેવલ ૪ to ૧૦,૦૦૦ ગુણ and a role trusted to hand out ૧૦,૦૦૦ ગુણ are the same
-- role, and inventing a narrower permission would only mean two places to get wrong. LEVEL4.md
-- §1 froze the matrix; nothing here opens it.
alter table public.point_bonus_rules enable row level security;

drop policy if exists "bonus rules readable"               on public.point_bonus_rules;
drop policy if exists "bonus rules insertable by permission" on public.point_bonus_rules;
drop policy if exists "bonus rules updatable by permission"  on public.point_bonus_rules;
drop policy if exists "bonus rules deletable by permission"  on public.point_bonus_rules;

create policy "bonus rules readable" on public.point_bonus_rules
  for select using (enabled or public.has_permission('settings.update'));

create policy "bonus rules insertable by permission" on public.point_bonus_rules
  for insert with check (public.has_permission('settings.update'));

create policy "bonus rules updatable by permission" on public.point_bonus_rules
  for update using (public.has_permission('settings.update'))
              with check (public.has_permission('settings.update'));

create policy "bonus rules deletable by permission" on public.point_bonus_rules
  for delete using (public.has_permission('settings.update'));

-- Belt and braces behind the policies, exactly as 0021 does for the ledger: Supabase's default
-- privileges grant every new table in `public` to anon, so without this RLS would be the only
-- thing standing there for a visitor with no session at all.
revoke insert, update, delete on public.point_bonus_rules from anon;

-- ================================================================ the rules, widened

-- `point_rules()`, reissued with one new key.
--
-- Every existing key is resolved by the identical expression 0031 wrote — this function is
-- what decides what a યુવક is paid, and a branch quietly altered while adding another is how
-- an award moves without anybody deciding it should. What follows is `earn` and nothing else.
--
--   `earn.levelN`   DAY_FIRST | EVERY | ONCE, absent ⇒ DAY_FIRST
--   `earn.tickCount` FRESH | ALL, absent ⇒ FRESH
--
-- The four level keys are written out, and that is a mirror rather than a hardcoded level
-- count: `DEFAULT_EARN` in shared/domain/points.js enumerates the same four, `resolvePointRules()`
-- returns the same document, and 0021's own `settings_check_points()` already enumerates
-- level1..level3 and matches `^level[1-4]$` in the disabled list. Two resolvers that must agree
-- key for key have to name the same keys.
--
-- **Nothing downstream depends on the number.** `award_points()` looks the mode up as
-- `'level' || p_level` and coalesces to DAY_FIRST, so a fifth ladder added tomorrow is scored
-- by 0021's rule with no change to this file — it simply has no mode of its own until somebody
-- adds one here and in the JavaScript beside it.
--
-- An unrecognised mode resolves to **DAY_FIRST** and never to the more generous reading: a typo
-- must not start paying a યુવક five times a day. `settings_check_points()` refuses the same
-- value outright, which is the resolver-forgives / validator-refuses split 0021 draws — and the
-- two are allowed to disagree about the same input for exactly that reason.
--
-- `jsonb_typeof(...) = 'string'` and an `in` list rather than a cast, for the reason
-- points.js:152-158 and 0021:390 give at length: a loose test turns "nothing configured" into a
-- real value that changes what real ગુણ are paid.
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
     from earn)
  );
$$;

revoke all on function public.point_rules() from public;

comment on function public.point_rules() is
  'The rule keys of settings[''levels''].value.points, resolved (repeat, tick, earn, limits, '
  'effective date, disabled list, version — 0031, extended 0033). Mirrors resolvePointRules() '
  'in shared/domain/points.js. Every absent key resolves to the behaviour of 0021: an absent '
  'earn.levelN is DAY_FIRST and an absent earn.tickCount is FRESH, so an untouched settings '
  'row pays exactly what it paid before, and a mode nobody defined resolves to DAY_FIRST '
  'rather than to the more generous reading. The four earn level keys mirror DEFAULT_EARN; '
  'award_points() looks its mode up by name and coalesces, so nothing decides how many levels '
  'exist from this list.';

-- ================================================================ counting a history

-- How far along one milestone rule's scope this યુવક is, right now.
--
-- Three questions behind one signature, because the three are the same question asked of three
-- tables and a rule names which. `p_level` NULL means every level and `p_key` NULL means every
-- activity of that level, which is exactly what a NULL scope column on the rule means.
--
-- **Lifetime, never windowed.** "His fiftieth દર્શન" is a fact about everything he has done;
-- a date window would make the same rule mean different things in January and in March, and
-- the milestone already carries its own permanence in the ledger.
--
-- **Counted the way 0032 counts, deliberately.** `admin_activity_counts()` is the સંચાલક's
-- answer to "how many દર્શન sessions" and this is the engine's, and two implementations of one
-- count drift apart the first time somebody fixes only one of them (§39). So: લેવલ ૧-૩ from
-- `activity_attempts` filtered by `activity_key`; લેવલ ૪ from `level4_attempts` filtered by
-- `passed`; ticks from the distinct non-withheld `selected_scene_ids`, subtracting the same
-- `admin_withheld_scene_ids()` (0029) that `award_points()`'s TICK branch subtracts.
--
-- Two readings this function fixes rather than leaves open, both documented because they are
-- the kind of choice a later reader would otherwise "correct":
--
--   * COMPLETION_COUNT counts **completed** લેવલ ૧-૩ submissions and **passed** કસોટીઓ. An
--     attempt that fell short is a practice, not a completion, and a milestone that counted it
--     would pay for pressing નોંધાવો.
--   * ITEM_COUNT is **the items the completions carried** — the દ્રશ્યો a completed પુનરાવર્તન
--     ticked and the items a passed કસોટી named — and not the number of sittings. It counts
--     the same events COMPLETION_COUNT counts, at the granularity of an item instead of an
--     act, which is what makes the two triggers explainable side by side on one panel.
--   * ITEM_COUNT is distinct **within an attempt** and additive across attempts. A lifetime
--     `count(distinct scene_id)` is bounded by the size of the collection, so "every 500
--     દ્રશ્યો" would be a rule that can never pay — a milestone must be reachable, and what a
--     યુવક brings to mind on Tuesday he brings to mind again on Wednesday.
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
      ), 0::bigint)
      + case when p_level is null or p_level = 4 then
          coalesce((
            select count(*)
            from public.level4_attempts la
            join public.level4_activities act on act.id = la.activity_id
            where la.user_id = p_user
              and la.passed
              and (p_key is null or act.code = p_key)
          ), 0::bigint)
        else 0::bigint end

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
          ), 0::bigint)
        else 0::bigint end

    -- The ledger, and the whole ledger: a legacy row is ગુણ he earned, and a BONUS row already
    -- paid is ગુણ he holds. Nothing here is excluded, because "how many ગુણ has he" has one
    -- answer and `sum(point_transactions.points)` is it — the same figure leaderboard() (0023)
    -- and admin_leaderboard() (0032) compute, never a second scoring system.
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
  'How far one યુવક is along a milestone rule''s scope (0033) — completed submissions and '
  'passed કસોટીઓ, દ્રશ્યો and કસોટી items, or summed ledger points. NULL p_level means every '
  'level and NULL p_key every activity. Lifetime, never windowed. Counts the same way '
  'admin_activity_counts() (0032) counts, so the engine and the report cannot disagree. Takes '
  'a p_user and is therefore granted to nobody.';

-- ================================================================ paying a milestone

-- Every enabled rule matching this event, evaluated, and one BONUS row per milestone earned.
--
-- ── Idempotency is the index, not a check (§14) ─────────────────────────────
--
-- Each award is keyed `bonus:<rule id>:<યુવક>:<milestone number>` and written through
-- `point_award()`, which inserts `on conflict (idempotency_key) do nothing`. That is the whole
-- of the guarantee, and it is deliberately not a "has this been paid?" query: a check cannot
-- decide a race, which is the argument 0021:288-294 already makes for the day rule and which
-- applies here with more force, because §13's list of ways a duplicate arrives — double click,
-- refresh, retry, timeout, mobile reconnect, two devices — is a list of ways the same event
-- arrives twice. The milestone number is a property of the count, not of when it was noticed,
-- so two concurrent submissions computing the same number both try to write one row and the
-- index refuses the second.
--
-- **The યુવક is in the key**, and leaving him out of it is a bug that hides itself.
-- `point_transactions_idem_idx` is a unique index on `idempotency_key` **alone** — it is not
-- scoped to a user, and it must not be, because that is what makes it able to refuse a
-- duplicate arriving on a second connection. A key of `bonus:<rule>:1` would therefore be
-- spent by whoever reached the milestone first, for the whole project: every later યુવક's
-- first milestone would be silently refused as a duplicate and nobody would see an error. It
-- was caught by a fixture whose committed award belonged to a different યુવક entirely, which
-- is the argument for running the suite against a real Postgres rather than reading the file.
-- `split_part(key, ':', 2)` still yields the rule id, so the reading functions are unaffected.
--
-- The loop therefore starts at 1 every time rather than at "the next unpaid one": already-paid
-- milestones cost one refused insert each and no correctness depends on knowing which they
-- were. That also means a rule created today pays every milestone the યુવક has **already**
-- passed, on his next qualifying act. That is the intended reading — a rule that silently
-- skipped the milestones he demonstrably reached would mean one thing for a new યુવક and
-- another for an old one — and each of them is still exactly one row, forever.
--
-- MILESTONE_CAP bounds one evaluation of one rule at 1000 rows. A threshold of 1 against a
-- POINT_TOTAL of a million is a misconfiguration and not a milestone list, and an unbounded
-- loop inside a યુવક's નોંધાવો is a submission that never returns. The remainder is paid on
-- his next act, one capful at a time.
--
-- ── What HIGHEST_ONLY means ─────────────────────────────────────────────────
--
-- "Only the highest threshold he has reached pays", and it is a statement about a **group** of
-- rules rather than about one: "highest" is meaningless on its own. The group is every enabled
-- rule sharing this rule's `(level_id, activity_key, trigger_type)` — the tier list a સંચાલક
-- sees on one row of his panel — and a HIGHEST_ONLY rule pays only when no rule in that group
-- has a higher threshold the same count has also reached. A rule alone in its group therefore
-- behaves exactly like FIRST_ONLY, which is the right answer and not a special case.
--
-- The panel prints the worked example, and this is it: rules of ૫, ૧૦ and ૨૦ on one scope, at
-- a count of ૧૯. EVERY pays the ૫-rule three times and the ૧૦-rule once; FIRST_ONLY pays the
-- ૫ and the ૧૦ once each; HIGHEST_ONLY pays the ૧૦ alone. §H pins all three.
--
-- The comparison is made at the moment of the event. A યુવક who crosses ૫, ૧૦ and ૨૦ in a
-- single act is paid for ૨૦ alone; one who crosses them a week apart was, at each of those
-- moments, at his highest, and the ledger is append-only so the earlier payments stand. That is
-- not an inconsistency to repair: an award already made is never revoked (§1 rule 4).
create or replace function public.point_bonus_apply(
  p_user      uuid,
  p_date      date,
  p_level     integer,
  p_key       text,
  p_source    text,
  p_source_id bigint,
  p_attempt   integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  MILESTONE_CAP constant integer := 1000;
  r        record;
  reached  bigint;
  earned   integer := 0;
  top      integer;
  m        integer;
begin
  if p_user is null or p_date is null or p_level is null then
    return 0;
  end if;

  for r in
    select b.id, b.level_id, b.activity_key, b.trigger_type, b.threshold,
           b.bonus_points, b.reward_mode
    from public.point_bonus_rules b
    where b.enabled
      and (b.level_id     is null or b.level_id = p_level)
      and (b.activity_key is null or b.activity_key = coalesce(p_key, ''))
    -- A total order, so two rules of equal threshold are always evaluated in the same
    -- sequence and the ledger's row order is a fact rather than a plan.
    order by b.threshold, b.id
  loop
    reached := public.point_bonus_count(p_user, r.trigger_type, r.level_id, r.activity_key);

    if reached < r.threshold then
      continue;
    end if;

    if r.reward_mode = 'EVERY' then
      top := least(reached / r.threshold, MILESTONE_CAP)::integer;
    elsif r.reward_mode = 'FIRST_ONLY' then
      top := 1;
    else
      if exists (
        select 1
        from public.point_bonus_rules s
        where s.enabled
          and s.trigger_type = r.trigger_type
          -- `is not distinct from`, never `=`: a NULL scope column means "any", and two rules
          -- that are both scoped to "any level" share a scope. `=` would answer NULL and the
          -- EXISTS would find nothing, so every tier would pay and HIGHEST_ONLY would be a
          -- second spelling of FIRST_ONLY.
          and s.level_id     is not distinct from r.level_id
          and s.activity_key is not distinct from r.activity_key
          and s.threshold    > r.threshold
          and reached       >= s.threshold
      ) then
        continue;
      end if;
      top := 1;
    end if;

    for m in 1 .. top loop
      earned := earned + public.point_award(
        p_user, p_date, p_level, coalesce(p_key, ''), r.bonus_points, 'BONUS',
        p_source, p_source_id, p_attempt,
        'bonus:' || r.id::text || ':' || p_user::text || ':' || m::text
      );
    end loop;
  end loop;

  return earned;
end;
$$;

revoke all on function public.point_bonus_apply(uuid, date, integer, text, text, bigint, integer)
  from public;

comment on function public.point_bonus_apply(uuid, date, integer, text, text, bigint, integer) is
  'Evaluates every enabled milestone rule matching one event and writes one BONUS row per '
  'milestone earned (0033). Called only by award_points(). Each row is keyed '
  '''bonus:<rule id>:<યુવક>:<milestone>'' and written through point_award() with ON CONFLICT DO '
  'NOTHING, so the same milestone cannot be paid twice by a refresh, a retry or two devices — '
  'the index decides it, not a check, because a check cannot decide a race (0021:288-294). The '
  'યુવક is part of the key because point_transactions_idem_idx is global: without him, the '
  'first man to reach a milestone would spend it for the whole project.';

-- ================================================================ the rules, applied

-- `award_points()`, reissued. Same signature, same two callers, neither of them touched.
--
-- What it now does, in order:
--
--   0. Is the rule live at all for this day? (enabled, effective date, disabled list)
--   1. લેવલ ૩ under a tick rule takes the tick branch and **not** the flat one, as in 0031.
--      New: `earn.tickCount` chooses between paying for દ્રશ્યો newly brought to mind today
--      (FRESH, 0031's rule) and paying for every valid દ્રશ્ય in the submission (ALL).
--   2. Everything else takes the flat branch, whose scope is now `earn.levelN`:
--        DAY_FIRST  0021's rule, unchanged, and the default for every level.
--        EVERY      one award per submission, keyed on the event, so five દર્શન is five awards
--                   and a retried submission is still one.
--        ONCE       one award per (યુવક, level, activity) for all time.
--   3. લેવલ ૪ under DAY_FIRST that found the day already paid tries the repeat rule (0031).
--   4. **Then the milestone rules, always** — including when the base award wrote nothing.
--      The count that decides a milestone grew whether or not this particular event was paid,
--      and a યુવક whose fifth દર્શન happened to be his second of the day has still done five.
--
-- ── Why EVERY and ONCE are filed under REPEAT ───────────────────────────────
--
-- `award_kind` names **how a row is deduplicated**, not what the સંચાલક called the mode:
-- DAY_FIRST is "the day index decides this one" and everything else is "idempotency_key
-- decides this one", which is what REPEAT has meant since 0031. A DAY_FIRST row carrying a key
-- would be worse than untidy — `point_award()` would arbitrate on `idempotency_key` while the
-- row also satisfies the day index's predicate, so the second submission of a day would raise
-- an unhandled 23505 instead of being paid. Which rule paid is still answerable: `event_ref`
-- and `idempotency_key` carry the prefix (`every:` / `once:` / `repeat:`), and `rule_version`
-- carries the configuration. A seventh kind would have meant a new label in every screen's
-- filter and byKind chart for a distinction only the settings row can explain.
--
-- The return value is still "what was actually written", and it now **includes the bonus**.
-- `activity_submit()` hands it straight back to the યુવક as `pointsAwarded`, and a bonus he
-- was paid but not shown is worse than a larger number he cannot immediately account for — the
-- history screen names the rule beside it. 0 is still not a failure.
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
  counting   text;
  earn_mode  text;
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
  -- 0031's reasoning, unchanged and now covering three more branches: `point_rules()` resolves
  -- the new keys and knows nothing about `enabled`, so without this line a project with points
  -- switched off and an `earn` mode or a milestone rule still configured would go on paying.
  -- A scoring system nobody switched on is what §J3 forbids.
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
      -- Per submission. The idempotency key is the attempt, so a retried submit pays once and
      -- a genuinely new નોંધાવો pays again.
      value_now := (rules #>> '{tick,perRevision}')::integer;
    else
      counting := coalesce(rules #>> '{earn,tickCount}', 'FRESH');

      if counting = 'ALL' then
        -- Every valid દ્રશ્ય this submission names, whether or not an earlier submission of
        -- the same day already named it. The distinct is still taken **within** the attempt —
        -- a client that posts the same id twice has ticked it once — and the withheld ones are
        -- still subtracted, because a દ્રશ્ય the સંચાલક has taken out of the collection is not
        -- one that may be paid.
        select count(*)::integer into fresh
        from (
          select distinct s.scene_id
          from public.activity_attempts a
          cross join lateral unnest(a.selected_scene_ids) as s(scene_id)
          where a.id = p_source_id
            and not (s.scene_id = any (public.admin_withheld_scene_ids()))
        ) mine;
      else
        -- 0031's rule, unchanged: દ્રશ્યો newly brought to mind today. The distinct દ્રશ્યો
        -- named by this attempt, minus any withheld, minus every one already named by an
        -- earlier attempt of the same day. Without that last subtraction a યુવક submitting the
        -- same ૧૦૮ ticks five times is paid for ૫૪૦ ticks he made once.
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
      end if;

      value_now := fresh * (rules #>> '{tick,perTick}')::integer;

      -- The day's ceiling, if the સંચાલક set one. Read from the ledger rather than counted in
      -- the caller, so a second phone submitting at the same moment cannot spend the same
      -- headroom twice.
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

    written := public.point_award(
      p_user, p_date, p_level, key, value_now,
      case when mode = 'TICK' then 'TICK' else 'REVISION' end,
      p_source, p_source_id, p_attempt,
      lower(mode) || ':' || coalesce(p_source_id, 0)::text
    );

    -- The tick rule is already a per-submission rule, so `earn.level3` has nothing to say to
    -- it: choosing between "per દ્રશ્ય" and "per નોંધાવો" is what `tick.mode` is, and stacking
    -- a second per-submission rule on top would pay twice for one act under two names (§G).
    return written + public.point_bonus_apply(
      p_user, p_date, p_level, key, p_source, p_source_id, p_attempt);
  end if;

  -- ── the flat branch, under the level's earning mode ───────────────────────
  --
  -- `'level' || p_level` and not a lookup in a list of four: the resolver does not enumerate
  -- the ladders and neither does this. A level with no key configured reads DAY_FIRST, which
  -- is 0021's rule and is what an untouched project gets at every level.
  earn_mode := coalesce(rules #>> array['earn', 'level' || p_level::text], 'DAY_FIRST');

  value_now := coalesce(public.point_value_for(p_level, key), 0);

  if value_now > 0 then
    if earn_mode = 'EVERY' then
      -- Keyed on the event, so a retried submission of ONE act still pays once while a genuine
      -- second act pays again. `p_source` is part of the key because `activity_attempts.id`
      -- and `level4_attempts.id` are independent bigserials that both start at 1 — the id
      -- alone is not unique across the two ladders, which is the same collision
      -- `attempt_history` (0021:1141) offsets by 2^62 to avoid.
      written := public.point_award(
        p_user, p_date, p_level, key, value_now, 'REPEAT',
        p_source, p_source_id, p_attempt,
        'every:' || coalesce(p_source, '') || ':' || coalesce(p_source_id, 0)::text
      );
    elsif earn_mode = 'ONCE' then
      -- Once per (યુવક, level, activity) for all time. The key carries all three because
      -- point_transactions_idem_idx is global — a key of 'once:1:video' would let the first
      -- યુવક to finish લેવલ ૧ spend it for everybody.
      written := public.point_award(
        p_user, p_date, p_level, key, value_now, 'REPEAT',
        p_source, p_source_id, p_attempt,
        'once:' || p_user::text || ':' || p_level::text || ':' || key
      );
    else
      -- 0021's rule, unchanged, arbitrated by the day index and carrying no key.
      written := public.point_award(
        p_user, p_date, p_level, key, value_now,
        'DAY_FIRST', p_source, p_source_id, p_attempt, null
      );
    end if;
  end if;

  -- ── the repeat rule ───────────────────────────────────────────────────────
  --
  -- Reached only under DAY_FIRST and only when the day-scoped award wrote nothing: either the
  -- day was already paid, or this level is worth nothing. લેવલ ૪ only, because "sitting the
  -- કસોટી again" is the act the સંચાલક asked to be able to price. Under EVERY the question
  -- does not arise — every submission has already been paid — and under ONCE a second award is
  -- precisely what the mode refuses.
  if written = 0
     and earn_mode = 'DAY_FIRST'
     and p_level = 4
     and (rules #> '{repeat,enabled}') = 'true'::jsonb then

    rep_value := coalesce(
      case when jsonb_typeof(rules #> '{repeat,byCode}' -> key) = 'number'
           then (rules #>> array['repeat', 'byCode', key])::integer end,
      (rules #>> '{repeat,default}')::integer,
      0
    );

    if rep_value > 0 then
      rep_limit := (rules #>> '{repeat,dailyLimit}')::integer;

      if rep_limit > 0 then
        select count(*)::integer into rep_today
        from public.point_transactions t
        where t.user_id = p_user
          and t.activity_date = p_date
          and t.award_kind = 'REPEAT';
      else
        rep_today := 0;
      end if;

      if rep_limit = 0 or rep_today < rep_limit then
        written := public.point_award(
          p_user, p_date, 4, key, rep_value, 'REPEAT',
          p_source, p_source_id, p_attempt,
          'repeat:' || coalesce(p_source_id, 0)::text
        );
      end if;
    end if;
  end if;

  -- The milestones, whatever the base award did. See step 4 in the header above.
  return written + public.point_bonus_apply(
    p_user, p_date, p_level, key, p_source, p_source_id, p_attempt);
end;
$$;

revoke all on function public.award_points(uuid, date, integer, text, text, bigint, integer) from public;

comment on function public.award_points(uuid, date, integer, text, text, bigint, integer) is
  'Applies the live point rules to one recorded event and returns what was written (0021, '
  'reissued 0031 and 0033). Same signature, same callers — activity_submit() step 9 and the '
  'level4_attempts_award trigger, neither of which was reissued. 0033 adds the per-level '
  'earning mode (DAY_FIRST | EVERY | ONCE), earn.tickCount for લેવલ ૩, and the milestone '
  'rules, which are evaluated on every event whether or not the base award wrote a row. The '
  'returned figure includes any bonus, because activity_submit() shows it to the યુવક and a '
  'bonus he was paid but not told about is worse than a number he has to account for.';

-- ================================================================ the bound, widened

-- `settings_check_points()`, reissued.
--
-- Every check 0021 and 0031 wrote is here unchanged and in the same order — this function is
-- the guarantee behind `validatePoints()`, and a rule quietly dropped while adding another is
-- how a validator stops being one. What follows the 0031 block is `earn`, held to the same
-- standard: refuse what `point_rules()` would silently correct, and name the allowed values in
-- every message, because `saveError()` puts this text in front of the સંચાલક.
--
-- `earn` is optional, like every 0031 key, so a settings row written before this migration
-- still saves unchanged — which is what lets the panel be deployed after the migration rather
-- than with it.
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
    -- enforces must be inside the range of the type the resolver casts to.
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
      -- Unknown keys are refused inside `earn`, exactly as they are inside `repeat` and
      -- `tick`: a typo the resolver would silently drop is a rule the સંચાલક typed and will
      -- never see take effect, which is worse than a save that explains itself. `^level[1-4]$`
      -- is the pattern 0031 already uses for the disabled list, and the panel rebuilds this
      -- object rather than merging into it, so a key outside the four is a mistake and not a
      -- survival from an older build.
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

  return new;
end;
$$;

revoke all on function public.settings_check_points() from public;

comment on function public.settings_check_points() is
  'Refuses a settings[''levels''].value.points write that the resolvers would silently zero '
  '(0021, extended 0031 for repeat/tick/limits/effective date/disabled and 0033 for earn). '
  'Mirrors validatePoints() and validatePointRules() in shared/domain/points.js message for '
  'message. Every 0031 and 0033 key is optional, so a settings row written before either '
  'migration still saves.';

-- ================================================================ the યુવક's own reading

-- His ledger, one row per payment, newest first, paged.
--
-- **No `p_user` parameter, at any price.** The caller is `auth.uid()` and nothing else: a
-- parameter is a value a browser chooses, and a SECURITY DEFINER function that took one would
-- be a way for one યુવક to read another's ledger — the entire thing §13 exists to prevent, and
-- the reason `award_points()` and `point_award()` are granted to nobody at all.
--
-- SECURITY DEFINER rather than 0021's invoker views, because this joins `point_bonus_rules`,
-- and a `security_invoker` function reading it would show a યુવક nothing for a rule the
-- સંચાલક has since switched off — the payment happened, and the name it was paid under is not
-- a secret. `my_point_summary()` (0021) stays invoker; it reads one table and needs nothing.
--
-- The order is `created_at desc, id desc` and the tiebreak is not decoration. `created_at
-- desc` alone is not a total order — two awards written by one submission share an instant to
-- the microsecond — and under OFFSET/LIMIT rows that swap across a page boundary are shown
-- twice or dropped entirely. That is the defect 0032 found in `admin_user_timeline()`, and the
-- fix is the same: end on a column that is unique by construction, which `id` is.
create or replace function public.my_point_history(
  p_from      date    default null,
  p_to        date    default null,
  p_page      integer default 0,
  p_page_size integer default 50
)
returns table (
  total_rows     bigint,
  id             bigint,
  activity_date  date,
  level_id       integer,
  activity_key   text,
  title          text,
  award_kind     text,
  points         integer,
  is_bonus       boolean,
  bonus_rule     text,
  attempt_number integer,
  created_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
begin
  -- A statement, not a predicate. The same lesson 0032's header states at length: a check that
  -- lives inside the query is not evaluated when the scan beneath it yields no rows, so a
  -- signed-out caller asking about a window nothing falls in would be answered with silence
  -- instead of a refusal.
  if uid is null then
    raise exception 'points_not_signed_in' using errcode = '42501';
  end if;

  return query
  with size as (
    select greatest(1, least(200, coalesce(p_page_size, 50))) as n,
           greatest(0, coalesce(p_page, 0))                   as pg
  ),
  mine as (
    select t.*
    from public.point_transactions t
    where t.user_id = uid
      and (p_from is null or t.activity_date >= p_from)
      and (p_to   is null or t.activity_date <= p_to)
  )
  select
    count(*) over ()::bigint,
    m.id,
    m.activity_date,
    m.level_id,
    m.activity_key,
    -- The કસોટી's current title from the PUBLISHED configuration, exactly as the point_ledger
    -- view (0021) and admin_point_transactions() (0032) resolve it: a code paid under version
    -- 3 may not exist in version 7, and a payment that happened must still print.
    coalesce(l4.title, '') as title,
    m.award_kind,
    m.points,
    -- coalesce, because award_kind is NULL on every row written before 0031 and NULL is not
    -- "no". A legacy row is not a bonus; it is a row from before the question was asked.
    coalesce(m.award_kind = 'BONUS', false) as is_bonus,
    coalesce(br.name, '') as bonus_rule,
    m.attempt_number,
    m.created_at
  from mine m
  left join lateral (
    select a.title
    from public.level4_activities a
    join public.level4_configs c on c.id = a.config_id and c.status = 'PUBLISHED'
    where a.code = m.activity_key and m.level_id = 4
    limit 1
  ) l4 on true
  left join lateral (
    -- The rule that paid it, recovered from the idempotency key, and empty when that rule has
    -- since been deleted. The ledger is append-only and a deleted rule does not un-pay
    -- anything, so the honest answer for an orphaned award is the payment without the name.
    --
    -- A CASE and never `where <regex> and b.id = <cast>`: Postgres does not promise
    -- left-to-right evaluation of AND, so the cast may run on a key that is not a uuid and
    -- raise 22P02 from inside a યુવક's history screen. An ordered CASE is the documented way
    -- to make a guard actually guard (0018:70-72).
    select b.name
    from public.point_bonus_rules b
    where b.id = (
      case when m.award_kind = 'BONUS'
                and m.idempotency_key ~ '^bonus:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:'
           then split_part(m.idempotency_key, ':', 2)::uuid end
    )
    limit 1
  ) br on true
  order by m.created_at desc, m.id desc
  -- Scalar subqueries, not `size.pg`: OFFSET and LIMIT are evaluated once for the whole
  -- statement and may not read a column of the FROM list.
  offset (select pg * n from size)
  limit  (select n from size);
end;
$$;

revoke all on function public.my_point_history(date, date, integer, integer) from public;
grant execute on function public.my_point_history(date, date, integer, integer) to authenticated;

comment on function public.my_point_history(date, date, integer, integer) is
  'The caller''s own ledger, paged, newest first (0033) — date, level, activity and its title, '
  'award kind, points, whether it is a bonus and which rule paid it. Keyed on auth.uid() and '
  'takes no p_user, because a p_user is a value a browser chooses. Ordered by (created_at, id) '
  'so the order is total and a page boundary cannot show a row twice.';

-- આજ સુધીના ગુણ, split by level and by whether a rule or a milestone paid them.
--
-- **Computed from the ledger, every time.** There is deliberately no stored total anywhere in
-- this schema and this function does not create one: a second copy of a number is a number
-- that can drift, and the only way to be sure a total is right is for it to be the sum. The
-- suite asserts that this reconciles exactly with `sum(point_transactions.points)`.
create or replace function public.my_point_totals()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid     uuid := auth.uid();
  out_doc jsonb;
begin
  if uid is null then
    raise exception 'points_not_signed_in' using errcode = '42501';
  end if;

  out_doc := (
    with mine as (
      select t.level_id, t.points, t.award_kind
      from public.point_transactions t
      where t.user_id = uid
    ),
    per as (
      select
        m.level_id,
        coalesce(sum(m.points) filter (where m.award_kind is distinct from 'BONUS'), 0)::bigint as base,
        coalesce(sum(m.points) filter (where m.award_kind = 'BONUS'), 0)::bigint               as bonus,
        coalesce(sum(m.points), 0)::bigint                                                     as total
      from mine m
      group by m.level_id
    )
    select jsonb_build_object(
      'levels', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'level', p.level_id,
                 'base',  p.base,
                 'bonus', p.bonus,
                 'total', p.total) order by p.level_id)
        from per p
      ), '[]'::jsonb),
      -- `is distinct from 'BONUS'` above puts a legacy row (award_kind NULL) into `base`,
      -- which is the honest place for it: it is not a milestone award, and it is certainly not
      -- nothing. Level 0 appears in the list when a સંચાલક has made a correction — a
      -- correction belongs to no level, which is what 0 says.
      'base',  (select coalesce(sum(p.base),  0) from per p),
      'bonus', (select coalesce(sum(p.bonus), 0) from per p),
      'total', (select coalesce(sum(p.total), 0) from per p)
    ));

  return out_doc;
end;
$$;

revoke all on function public.my_point_totals() from public;
grant execute on function public.my_point_totals() to authenticated;

comment on function public.my_point_totals() is
  'The caller''s own ગુણ per level — base, bonus and total — plus the grand total (0033). '
  'Computed from point_transactions on every call; there is no stored total in this schema and '
  'this does not add one, because a second copy of a number is a number that can drift. Keyed '
  'on auth.uid() and takes no p_user.';

-- ================================================================ the સંચાલક's side

-- Every milestone rule, with what it has actually paid.
--
-- The counts are joined from the ledger by the rule's own id prefix rather than stored on the
-- rule, for the reason `my_point_totals()` gives: a counter beside a rule is a second copy of
-- a fact the ledger already holds, and the two will disagree the first time an award is
-- written by anything but the panel.
create or replace function public.admin_bonus_rules()
returns table (
  id           uuid,
  name         text,
  level_id     integer,
  activity_key text,
  trigger_type text,
  threshold    integer,
  bonus_points integer,
  reward_mode  text,
  enabled      boolean,
  created_at   timestamptz,
  updated_at   timestamptz,
  awards       bigint,
  points_paid  bigint,
  earners      bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- A statement, not a CTE — 0032's header explains at length why the CTE form never runs, and
  -- it matters here for the sharpest version of the case: a project with no milestone rules
  -- yet returns no rows at all, and a guard living in the query would never be evaluated.
  perform public.admin_assert_progress_reader();

  return query
  select
    b.id, b.name, b.level_id, b.activity_key, b.trigger_type, b.threshold,
    b.bonus_points, b.reward_mode, b.enabled, b.created_at, b.updated_at,
    paid.awards, paid.points_paid, paid.earners
  from public.point_bonus_rules b
  left join lateral (
    select
      count(*)::bigint                        as awards,
      coalesce(sum(t.points), 0)::bigint      as points_paid,
      count(distinct t.user_id)::bigint       as earners
    from public.point_transactions t
    where t.award_kind = 'BONUS'
      and t.idempotency_key like 'bonus:' || b.id::text || ':%'
  ) paid on true
  order by b.level_id nulls first, b.activity_key nulls first, b.threshold, b.id;
end;
$$;

revoke all on function public.admin_bonus_rules() from public;
grant execute on function public.admin_bonus_rules() to authenticated;

comment on function public.admin_bonus_rules() is
  'Every milestone rule with how many times it has paid, how much, and to how many યુવકો '
  '(0033). Read only. The figures are joined from the ledger by the rule''s id prefix rather '
  'than stored on the rule, so there is no counter beside the money that can disagree with it.';

-- Create or amend one rule.
--
-- `settings.update` and not `progress.read`, and the difference is the whole point: reading
-- which milestones exist is reporting, and deciding that the fiftieth દર્શન is worth ૫૦૦ ગુણ
-- is pricing. 0031 settled this for `admin_award_manual_points()` with the same sentence — a
-- role trusted to set લેવલ ૪ to ૧૦,૦૦૦ ગુણ and a role trusted to hand out ૧૦,૦૦૦ ગુણ are the
-- same role.
--
-- Amending a rule does **not** reach back. Every award it has already paid keeps the number
-- that was paid, exactly as `point_transactions` keeps a number rather than a pointer to a
-- rule (0021), and raising the threshold from ૫ to ૧૦ does not un-pay the fifth. It does mean
-- the milestone numbering changes underneath the key: `bonus:<id>:2` at a threshold of ૫ was
-- his tenth act and at a threshold of ૧૦ is his twentieth. That is stated here rather than
-- worked around, because the alternative — a new id on every edit — would re-pay every
-- milestone the yuvak had already reached.
create or replace function public.admin_bonus_rule_save(
  p_id        uuid,
  p_name      text,
  p_level     integer,
  p_activity  text,
  p_trigger   text,
  p_threshold integer,
  p_points    integer,
  p_mode      text,
  p_enabled   boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  nm    text := btrim(coalesce(p_name, ''));
  act   text := nullif(btrim(coalesce(p_activity, '')), '');
  saved public.point_bonus_rules%rowtype;
begin
  if actor is null then
    raise exception 'points_not_signed_in' using errcode = '42501';
  end if;

  if not public.has_permission('settings.update') then
    raise exception 'editing a bonus rule requires settings.update' using errcode = '42501';
  end if;

  -- Every message names the bound, because `saveError()` in the panel puts this text in front
  -- of the સંચાલક and a refusal that says only "invalid" is one he works around.
  if length(nm) < 2 then
    raise exception 'Bonus rule: give it a name of at least 2 characters, so a યુવક can see why he was paid.'
      using errcode = 'check_violation';
  end if;

  if length(nm) > 60 then
    raise exception 'Bonus rule name: 60 characters or fewer (got %).', length(nm)
      using errcode = 'check_violation';
  end if;

  if p_level is not null and (p_level < 1 or p_level > 4) then
    raise exception 'Bonus rule: a level between 1 and 4, or none for every level (got %).', p_level
      using errcode = 'check_violation';
  end if;

  if coalesce(p_trigger, '') not in ('COMPLETION_COUNT', 'ITEM_COUNT', 'POINT_TOTAL') then
    raise exception 'Bonus rule: count COMPLETION_COUNT, ITEM_COUNT or POINT_TOTAL (got "%").',
      coalesce(p_trigger, '') using errcode = 'check_violation';
  end if;

  if coalesce(p_mode, '') not in ('EVERY', 'FIRST_ONLY', 'HIGHEST_ONLY') then
    raise exception 'Bonus rule: pay EVERY, FIRST_ONLY or HIGHEST_ONLY (got "%").',
      coalesce(p_mode, '') using errcode = 'check_violation';
  end if;

  -- BONUS_THRESHOLD_MIN / BONUS_THRESHOLD_MAX, the same pair point_bonus_rules_threshold_check
  -- states and the same pair validateBonusRule() states in shared/domain/points.js.
  if coalesce(p_threshold, 0) < 1 or p_threshold > 100000 then
    raise exception 'Bonus rule: the milestone is a whole number between 1 and 100000 (got %).',
      coalesce(p_threshold, 0) using errcode = 'check_violation';
  end if;

  -- Zero and nothing else. A negative milestone is a correction and is allowed — the ledger
  -- was widened for it — while zero is refused, because `enabled` is how a rule is switched
  -- off and a rule that pays nothing while marked enabled is a rule the સંચાલક believes is
  -- working.
  if coalesce(p_points, 0) = 0 then
    raise exception 'Bonus points: a milestone worth 0 pays nothing - switch the rule off instead.'
      using errcode = 'check_violation';
  end if;

  if p_points < -10000 or p_points > 10000 then
    raise exception 'Bonus points: between -10000 and 10000 (got %).', p_points
      using errcode = 'check_violation';
  end if;

  if p_id is null then
    insert into public.point_bonus_rules
      (name, level_id, activity_key, trigger_type, threshold, bonus_points, reward_mode,
       enabled, created_by)
    values
      (nm, p_level, act, p_trigger, p_threshold, p_points, p_mode,
       coalesce(p_enabled, true), actor)
    returning * into saved;
  else
    update public.point_bonus_rules b
       set name         = nm,
           level_id     = p_level,
           activity_key = act,
           trigger_type = p_trigger,
           threshold    = p_threshold,
           bonus_points = p_points,
           reward_mode  = p_mode,
           enabled      = coalesce(p_enabled, true)
     where b.id = p_id
    returning * into saved;

    if saved.id is null then
      raise exception 'Bonus rule: there is no rule with that id.' using errcode = '23503';
    end if;
  end if;

  return to_jsonb(saved);
end;
$$;

revoke all on function public.admin_bonus_rule_save(uuid, text, integer, text, text, integer,
                                                    integer, text, boolean) from public;
grant execute on function public.admin_bonus_rule_save(uuid, text, integer, text, text, integer,
                                                       integer, text, boolean) to authenticated;

comment on function public.admin_bonus_rule_save(uuid, text, integer, text, text, integer,
                                                 integer, text, boolean) is
  'Creates a milestone rule when p_id is null and amends it otherwise (0033). Requires '
  'settings.update — the permission that already governs what points are worth — and not '
  'progress.read, which only opens the reports. Amending never reaches back: every award '
  'already paid keeps the number that was paid.';

-- Remove a rule. **Not the awards it paid.**
--
-- `point_transactions` is append-only and has no delete policy for anybody, so this cannot
-- reach a BONUS row even if it wanted to — but the sentence is worth writing down because the
-- opposite is a natural expectation: a foreign key from the ledger to the rule, with a cascade,
-- would look tidy and would erase a યુવક's history the day a સંચાલક tidied his rule list. The
-- ledger stores what was paid, not a pointer to why (0021), and that is what makes an award
-- survive the rule. `my_point_history()` prints such a payment with an empty rule name rather
-- than hiding it.
--
-- Deleting is offered alongside `enabled = false`, which is what a સંચાલક usually wants: a
-- disabled rule stops paying and keeps its name against every award it made.
create or replace function public.admin_bonus_rule_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  gone  integer;
  kept  bigint;
begin
  if actor is null then
    raise exception 'points_not_signed_in' using errcode = '42501';
  end if;

  if not public.has_permission('settings.update') then
    raise exception 'deleting a bonus rule requires settings.update' using errcode = '42501';
  end if;

  if p_id is null then
    raise exception 'Bonus rule: which rule?' using errcode = 'check_violation';
  end if;

  -- Counted before the delete, so the figure returned is the one the સંચાલક is being told
  -- about rather than a second query's answer.
  select count(*) into kept
  from public.point_transactions t
  where t.award_kind = 'BONUS'
    and t.idempotency_key like 'bonus:' || p_id::text || ':%';

  delete from public.point_bonus_rules b where b.id = p_id;
  get diagnostics gone = row_count;

  return jsonb_build_object(
    'deleted',     gone > 0,
    'awardsKept',  kept
  );
end;
$$;

revoke all on function public.admin_bonus_rule_delete(uuid) from public;
grant execute on function public.admin_bonus_rule_delete(uuid) to authenticated;

comment on function public.admin_bonus_rule_delete(uuid) is
  'Deletes one milestone rule and NOTHING it paid (0033). Requires settings.update. The BONUS '
  'transactions stand: the ledger is append-only, an award is never revoked (§1 rule 4), and '
  'there is deliberately no foreign key from the ledger to this table that a cascade could '
  'follow. Returns how many awards were kept.';

-- ================================================================ the day's summary, fixed

-- `activity_history`, reissued — the same view, with a points column that cannot multiply.
--
-- 0021 wrote this as a LEFT JOIN onto `point_transactions` keyed on (યુવક, day, level,
-- activity) and said, correctly for the time, that `point_transactions_day_unique` guaranteed
-- at most one such row. 0031 ended that guarantee for લેવલ ૩ (two TICK rows in a day) and
-- લેવલ ૪ (a REPEAT beside a DAY_FIRST); 0033 makes it ordinary at every level, because
-- `earn: 'EVERY'` writes one row per submission and every level-scoped BONUS row carries the
-- same four columns.
--
-- A row-multiplying join does not drift, it duplicates: the same day's entry would print once
-- per payment, so five દર્શન would show five identical rows on a screen a યુવક reads every
-- day. The fix is a pre-aggregated LATERAL, which returns exactly one row whatever the ledger
-- holds and returns zeros when it holds nothing.
--
-- Every existing column keeps its name, its position and its type — `src/lib/history.js` names
-- them and `groupByDate()` in shared/domain/history.js consumes them — and `bonus_points` is
-- appended, which `create or replace view` permits and which a client selecting named columns
-- does not notice. `points` stays the FULL total including any bonus, so nothing that adds up
-- the column today starts under-reporting; the new column is a breakdown of it, not an
-- addition to it.
create or replace view public.activity_history
with (security_invoker = on) as
select
  d.user_id,
  d.activity_date,
  d.level_id,
  d.activity_key,
  ''::text as title,
  d.attempt_count,
  d.completed_items,
  d.total_items,
  d.status,
  coalesce(t.points, 0) as points,
  coalesce(t.bonus_points, 0) as bonus_points
from public.daily_activity_progress d
left join lateral (
  -- `::integer`, so the column keeps the type 0021 gave it: `sum(integer)` is bigint, and
  -- `create or replace view` refuses a changed type. A day's ledger cannot approach int4's
  -- ceiling — every value in it is bounded by 10000 and the day is bounded by the cap.
  select
    coalesce(sum(t2.points), 0)::integer as points,
    coalesce(sum(t2.points) filter (where t2.award_kind = 'BONUS'), 0)::integer as bonus_points
  from public.point_transactions t2
  where t2.user_id       = d.user_id
    and t2.activity_date = d.activity_date
    and t2.level_id      = d.level_id
    and t2.activity_key  = d.activity_key
) t on true

union all

select
  g.user_id,
  g.activity_date,
  4,
  g.activity_key,
  g.title,
  g.attempt_count,
  g.completed_items,
  g.total_items,
  g.status,
  coalesce(t.points, 0),
  coalesce(t.bonus_points, 0)
from (
  -- લેવલ ૪ has no `daily_activity_progress` row and is not given one: its permanent state
  -- lives in `level4_activity_progress`, which has no date column at all, and adding a daily
  -- mirror of it would be the first expression in this codebase by which midnight could reach
  -- a passed કસોટી. The day's summary is therefore aggregated from the attempts on read.
  --
  -- Grouped by `code` and not by `activity_id`, so that the row lines up with the ledger's
  -- key: two configurations' ૪.૧ are the same કસોટી as far as a day's payment is concerned.
  select
    att.user_id,
    timezone('Asia/Kolkata', att.at)::date as activity_date,
    coalesce(a.code, '')                   as activity_key,
    -- `max`, because grouping by code can span two configurations that titled ૪.૧
    -- differently. Presentation only — the code beside it is the identity.
    coalesce(max(a.title), '')             as title,
    count(*)::integer                      as attempt_count,
    max(att.selected_count)::integer       as completed_items,
    max(att.required_count)::integer       as total_items,
    case when bool_or(att.passed) then 'COMPLETED' else 'REVISION_REQUIRED' end as status
  from public.level4_attempts att
  -- LEFT for the archived-configuration reason attempt_history gives: `level4_activities`'
  -- read policy admits a PUBLISHED configuration or `settings.read`, and this view runs as the
  -- caller, so an inner join would delete a યુવક's own history from his own history page every
  -- time the સંચાલક published a new version.
  left join public.level4_activities a on a.id = att.activity_id
  group by att.user_id, timezone('Asia/Kolkata', att.at)::date, coalesce(a.code, '')
) g
left join lateral (
  select
    coalesce(sum(t2.points), 0)::integer as points,
    coalesce(sum(t2.points) filter (where t2.award_kind = 'BONUS'), 0)::integer as bonus_points
  from public.point_transactions t2
  where t2.user_id       = g.user_id
    and t2.activity_date = g.activity_date
    and t2.level_id      = 4
    and t2.activity_key  = g.activity_key
) t on true;

grant select on public.activity_history to authenticated;

comment on view public.activity_history is
  'A day per (યુવક, level, activity), across both ladders, with what it paid (0021, reissued '
  '0033). The shape normaliseHistoryRow() in shared/domain/history.js consumes. points is the '
  'SUM of the day''s ledger rows for that key through a pre-aggregated lateral, never a plain '
  'join: since 0031 a key can hold more than one payment, and a joined column would print the '
  'day once per payment. bonus_points is the milestone part of the same figure, appended so '
  'that a client naming its columns is unaffected. security_invoker.';
