-- વર્ણી ધ્યાન — every પ્રયાસ becomes a row, and a finished one is paid once a day.
--
-- What this adds
-- --------------
-- Three tables, and nothing that rewrites anything already here:
--
--   `activity_attempts`         every લેવલ ૧-૩ submission, ever. Append-only.
--   `daily_activity_progress`   today's state, recounted from those attempts.
--   `point_transactions`        what a યુવક was paid, and when. Append-only.
--
-- With them: `activity_submit()`, which is the only way a લેવલ ૧-૩ attempt ever exists;
-- `award_points()`, which is the only writer of the ledger; a resolver and a BEFORE-check
-- trigger over `settings['levels'].value.points`; an AFTER trigger that pays a passed કસોટી;
-- three `security_invoker` views a history screen reads; and one summary RPC.
--
-- Why this shape and not the obvious one
-- --------------------------------------
-- The obvious shape is a `points` column on `progress` and an `attempts` counter beside it,
-- both incremented by the client. Three separate things go wrong with it, and each is a
-- reason one of the tables below exists.
--
-- **A counter cannot be audited and cannot be repaired.** `progress` says where a યુવક is;
-- it cannot say how he got there, so a disputed figure has nothing to be checked against.
-- 0010 made exactly this argument for `level4_attempts` — "the progress row says where he
-- is, and these rows say how he got there" — and `activity_attempts` is that argument
-- applied to the three levels that never got it. Everything else on this page is derived
-- from those rows, so a wrong answer is a wrong query rather than a corrupt column.
--
-- **An incremented counter is inflated by the network.** A submit that times out is retried,
-- and a counter that was incremented before the response was lost is now one too high with
-- nothing able to notice. So `daily_activity_progress` is **recounted** from the day's
-- attempts on every write and never incremented — the same sentence 0017:177-181 wrote about
-- `progress.level4_score`, for the same reason, and `activity_attempts.client_token` closes
-- the remaining half of it by making the retried submit not create a second attempt at all.
--
-- **Points cannot be a property of an attempt.** Since 0017 an unlocked કસોટી may be sat
-- without limit, and લેવલ ૩ may be submitted as often as a યુવક likes. "Points per completed
-- attempt" therefore pays ૩૦૦ for pressing નોંધાવો eleven times. The brief's §18 asks for
-- one award per activity per business day and asks for it in the database, so the guarantee
-- is a unique constraint on the ledger — `(user_id, activity_date, level_id, activity_key)` —
-- and not a check in any function. See the long comment on that constraint below.
--
-- Mirrored, not reinvented
-- ------------------------
-- `point_settings()`, `point_value_for()` and `settings_check_points()` mirror
-- `resolvePoints()`, `pointsFor()` and `validatePoints()` in shared/domain/points.js branch
-- for branch, including which way each malformed value falls. The pairing is the one 0018
-- established for the slideshow and 0014 for the લેવલ ૪ gate: a resolver that forgives, so a
-- યુવક's નોંધાવો never fails for a field he cannot see, and a validator that refuses, so the
-- સંચાલક is told at the moment he mistypes. A value the validator accepts is a value the
-- resolver returns unchanged, and that equivalence is what keeps the panel's fields and the
-- ledger's awards the same numbers.
--
-- What this does NOT change
-- -------------------------
-- * **`level4_submit()` is not rewritten.** Not one line. લેવલ ૪'s award is an AFTER INSERT
--   trigger on `level4_attempts` with `when (new.passed)`, so the paying happens beside the
--   attempt rather than inside the function that records it. 0017 is the third statement of
--   લેવલ ૪'s attempt policy and reissuing it here to add two lines would make this migration
--   the fourth, silently, over a question it has no opinion about.
-- * **`level4_attempts`, `level4_activity_progress`, `level4_activity_states()` and the
--   unlock tables.** Untouched. In particular a new IST day still cannot re-lock a કસોટી:
--   `level4_activity_progress` has no date column, and nothing added here gives it one.
-- * **`progress`.** Still written by લેવલ ૩ and by `level4_submit()`, still the source of the
--   સંચાલક dashboard's daily score, still the thing 0008's unlock trigger watches. The tables
--   below sit beside it and none of them is read by anything that reads `progress` today.
-- * **The permission matrix.** No new permission and no new role. Reading someone else's
--   history is `progress.read`; pricing an activity is `settings.update`. `permissions_for()`
--   is not reissued — LEVEL4.md §1 froze that matrix and this migration has no cause to open
--   it, because both questions it asks are questions those two permissions already name.
-- * **`settings_check_slideshow` (0018) and `settings_check_mobile_nav` (0019).** The trigger
--   added here sits alongside them rather than replacing either: the three examine different
--   keys and all three run on every settings write.
-- * **What anything already deployed pays.** `DEFAULT_POINTS` is off with every level at
--   zero, and this migration seeds no settings row. A project that applies it and never opens
--   the panel keeps the app it had yesterday, which had no points at all.

-- ================================================================ the history table

-- Every લેવલ ૧-૩ submission, kept, passed or not.
--
-- This is `level4_attempts` for the other three levels, and it is deliberately the same
-- shape: an attempt is a submission, a submission has always already happened, and the row
-- is never updated after it is written. `daily_activity_progress` below and every view at the
-- bottom of this file are derived from these rows, so there is exactly one place a disputed
-- figure can be checked against.
--
-- `selected_scene_ids` is `text[]` with no foreign key to `public.scenes`, for the reason
-- 0010's header gives at length: `public.scenes` is a sparse overlay, a દ્રશ્ય nobody has
-- edited has no row there, and a FK would reject the majority of honest selections. Do not
-- "fix" this by adding the constraint.
--
-- `total_items` is stored on the row rather than looked up, and that is what makes an old day
-- keep reading ૮૨/૧૦૮ after the collection grows to ૧૦૯. §62 forbids a count of દ્રશ્યો
-- living outside `useScenes()`; a count that was *recorded at the moment of the attempt* is
-- not a second opinion about how many there are, it is a fact about what was asked that day.
create table public.activity_attempts (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,

  level_id     integer not null check (level_id between 1 and 3),
  activity_key text not null check (activity_key in ('video', 'darshan', 'revision')),

  -- The IST business day, written by the server and never accepted from a caller. See step 2
  -- of activity_submit() for why that is not a convenience.
  activity_date date not null,

  -- Which repetition of this activity, on this day, this row is. 1-based, server-computed.
  attempt_number integer not null check (attempt_number > 0),

  selected_scene_ids text[] not null default '{}',
  total_items        integer not null default 0 check (total_items >= 0),
  completed_items    integer not null default 0 check (completed_items >= 0),

  -- The same two words `level4_activity_progress` uses (0010:190-191), deliberately, so one
  -- history screen can render a લેવલ ૩ attempt and a લેવલ ૪ attempt in the same column without
  -- translating between two vocabularies. IN_PROGRESS is not among them: an attempt is a
  -- submission, and a submission is finished by definition.
  status text not null check (status in ('COMPLETED', 'REVISION_REQUIRED')),

  -- The caller's idempotency key, and nullable because an old client will not send one.
  client_token uuid,

  submitted_at timestamptz not null default now(),

  -- One row per repetition per day. This is what makes `attempt_number` a fact rather than a
  -- hope: two concurrent submits that both read the same `max()` collide here, and one of
  -- them is sent back through the retry in activity_submit() step 6 to read the number again.
  constraint activity_attempts_number_unique
    unique (user_id, level_id, activity_key, activity_date, attempt_number),

  -- The pair, not the two halves. `level_id` and `activity_key` are each checked above so
  -- that a malformed write is *named* in the error, but the rule is the pairing: a row
  -- claiming લેવલ ૩ did a 'video' would be counted by every view here and priced by
  -- `point_value_for(3, ...)`, and the ledger's day-key would then name an activity that does
  -- not exist. activity_submit() step 1 refuses it too; this is the floor under that.
  constraint activity_attempts_level_key_agree
    check ((level_id, activity_key) in ((1, 'video'), (2, 'darshan'), (3, 'revision')))
);

-- §31, and it is a database guarantee rather than a convention: a submit whose response was
-- lost and which the phone retries carries the same token, finds this index, and is refused —
-- so activity_submit() returns the original attempt instead of creating a second one. Partial
-- on `client_token is not null` because a client that sends no token gets no protection and
-- must not, for that reason, collide with every other tokenless attempt.
create unique index activity_attempts_token_idx
  on public.activity_attempts (user_id, client_token)
  where client_token is not null;

-- The two orders a history screen actually asks for: "what did I do, newest day first" and
-- "what happened most recently". They are different indexes because `activity_date` is the
-- business day and `submitted_at` is the instant, and a late-evening submit crossing IST
-- midnight puts them on either side of each other.
create index activity_attempts_user_date_idx on public.activity_attempts (user_id, activity_date desc);
create index activity_attempts_user_at_idx   on public.activity_attempts (user_id, submitted_at desc);

comment on table public.activity_attempts is
  'Every લેવલ ૧-૩ submission, append-only (0021). Written only by activity_submit(); there is '
  'no insert, update or delete policy for any client role, which is what makes an attempt '
  'unforgeable rather than merely inconvenient to forge (§37). daily_activity_progress and '
  'every history view are derived from these rows and never the other way round.';

comment on column public.activity_attempts.client_token is
  'The caller''s idempotency key (§31). A retried submit carrying the same token returns the '
  'original attempt unchanged instead of creating a second one — enforced by '
  'activity_attempts_token_idx, not by the function being careful.';

comment on column public.activity_attempts.total_items is
  'How many દ્રશ્યો were asked for at the moment of the attempt, recorded rather than looked '
  'up. This is what keeps an old day reading ૮૨/૧૦૮ after the collection grows to ૧૦૯.';

-- ================================================================ today's state

-- One row per (યુવક, day, level, activity) — what he has done today, and nothing else.
--
-- **Derived by recounting, never incremented.** Every column below is a property of the day's
-- `activity_attempts` rows, recomputed in full by activity_submit() step 8 on every write.
-- That is 0017:177-181's rule and its whole reasoning: counted from the attempts themselves
-- rather than incremented, so a retry, a double submit or a lost response cannot inflate it —
-- the answer is a property of the day's rows, not of how many times the function ran.
--
-- The daily reset lives here and is not a delete. A new IST day simply has no row yet, so
-- "find or create today" returns an empty one while yesterday's sits untouched beside it
-- (§25). There is no cron job and there must not be one: a job whose purpose is to delete
-- yesterday is a job that will one day delete today.
--
-- Nothing here reaches `level4_activity_progress`. That table has no date column at all, so
-- there is no expression in this schema by which midnight could reach a passed કસોટી — a
-- structural guarantee rather than a rule somebody has to remember.
create table public.daily_activity_progress (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  activity_date date not null,
  level_id      integer not null check (level_id between 1 and 3),
  activity_key  text not null check (activity_key in ('video', 'darshan', 'revision')),

  total_items     integer not null default 0 check (total_items >= 0),
  completed_items integer not null default 0 check (completed_items >= 0),

  -- The union of every દ્રશ્ય ticked across the day's attempts, not the last attempt's list.
  -- A યુવક who covers ૪૦ this morning and a different ૪૦ this afternoon has covered ૮૦ today,
  -- and a column holding only the latest submission would say ૪૦.
  completed_scene_ids text[] not null default '{}',

  attempt_count integer not null default 0 check (attempt_count >= 0),

  -- REVISION_REQUIRED is the default because an empty row means "started, not finished".
  -- It cannot demote: the recount uses bool_or() over an append-only set, so once any attempt
  -- on the day was COMPLETED this column is COMPLETED for as long as the row exists.
  status text not null default 'REVISION_REQUIRED'
         check (status in ('COMPLETED', 'REVISION_REQUIRED')),

  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),

  primary key (user_id, activity_date, level_id, activity_key)
);

create index daily_activity_progress_user_date_idx
  on public.daily_activity_progress (user_id, activity_date desc);

comment on table public.daily_activity_progress is
  'આજની સ્થિતિ — one row per (યુવક, day, level, activity), recounted in full from '
  'activity_attempts on every submit and NEVER incremented (0021, following 0017:177-181). '
  'A new IST day has no row rather than a cleared one; there is no reset job. Written only '
  'by activity_submit().';

comment on column public.daily_activity_progress.completed_at is
  'The first COMPLETED attempt of the day, coalesced on every recount and therefore never '
  'moved. §1 rule 4: a ધ્યાન already done is never taken away, and that includes the moment '
  'it was done.';

-- ================================================================ the ledger

-- What a યુવક was paid, and when. Append-only, and the only table that is money.
--
-- No foreign key on `source_id`, because it has two parents: `activity_attempts.id` for
-- લેવલ ૧-૩ and `level4_attempts.id` for લેવલ ૪, which `source` distinguishes. A polymorphic
-- pointer is a real cost and it is the smaller one here — the alternative is two ledgers,
-- and then `my_point_summary()` and every total on every screen is a UNION that somebody
-- will one day write half of.
--
-- `points` stores the number that was paid rather than a pointer to the rule that decided
-- it, and that is deliberate: lowering the configured value tomorrow changes what tomorrow
-- pays and cannot reach back. §1 rule 4 — nothing here revokes an award.
create table public.point_transactions (
  id      bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,

  activity_date date    not null,
  level_id      integer not null check (level_id between 1 and 4),

  -- 'video' / 'darshan' / 'revision' for લેવલ ૧-૩, and `level4_activities.code` — '4.1' — for
  -- લેવલ ૪. `code` is what 0010 promises to keep stable across configurations, which is why
  -- the ledger is keyed by it and not by the activity's uuid: `level4_clone_config()` writes
  -- new activity rows on every republication, so a uuid key would orphan itself the first
  -- time the સંચાલક published anything.
  --
  -- NOT NULL with a '' default, and that is load-bearing rather than tidy: the unique
  -- constraint below is over four columns, and NULLs in a unique constraint are distinct from
  -- each other, so a nullable key would let the same day be paid twice.
  activity_key text not null default '',

  points integer not null check (points >= 0),

  source    text not null check (source in ('ACTIVITY_ATTEMPT', 'LEVEL4_ATTEMPT')),
  source_id bigint not null,

  -- Which repetition earned it. Recorded for the history screen and for a disputed award;
  -- nothing decides anything from it. Defaults to 0 for a row whose source cannot say.
  attempt_number integer not null default 0,

  created_at timestamptz not null default now(),

  -- ──────────────────────────────────────────────────────────────────────────────
  -- THE no-duplicate guarantee. Read this before changing anything on this page.
  -- ──────────────────────────────────────────────────────────────────────────────
  --
  -- **A યુવક earns an activity's points at most once per business day**, and the rule is this
  -- constraint rather than a check in `award_points()`, in `activity_submit()`, or in the
  -- browser. §18 asks for it in the database and is right to.
  --
  -- Why it has to be here. Since 0017 an unlocked કસોટી may be sat again without limit, and
  -- લેવલ ૩ accepts a નોંધાવો as often as a યુવક cares to press it. Every other place this
  -- rule could live is a place that can be bypassed or that can lose a race:
  --
  --   * in the app — `settings` and every RPC are reachable through PostgREST with an
  --     ordinary token and no obligation to go anywhere near src/. 0018 already wrote the
  --     sentence: a disabled control is not a rule.
  --   * in `award_points()` as a SELECT-then-INSERT — two submits landing in the same
  --     millisecond both see no row, both insert, and the યુવક is paid twice. A unique
  --     constraint is the only construct in Postgres that decides that race rather than
  --     observing it, which is why the insert below is `on conflict ... do nothing` over
  --     this constraint and contains no existence check at all.
  --   * as a daily total capped somewhere — that is a different rule. It would let ૪.૧ and
  --     ૪.૨ steal each other's budget, and it could not answer "what was I paid for દર્શન
  --     on Tuesday", which is the question the history screen is built to answer.
  --
  -- Two directions follow from it and are worth stating plainly, because both look like bugs
  -- from the outside:
  --
  --   * a **failed** attempt earns nothing and does not consume the day's award. A યુવક at
  --     ૯૬/૧૦૮ this morning and ૧૦૮/૧૦૮ this afternoon is paid once, this afternoon —
  --     §23's own worked example, where attempt #2 earns +0 and attempt #3 earns +300.
  --     `award_points()` writes no zero row, so nothing is consumed by the morning.
  --   * a **second** completed attempt earns nothing, and its `pointsAwarded` is 0. That is
  --     not a failure and the screens must not word it as one; he has practised twice, which
  --     `attempt_count` records and `summariseRow()` renders as "૨ વાર".
  constraint point_transactions_day_unique
    unique (user_id, activity_date, level_id, activity_key)
);

create index point_transactions_user_date_idx on public.point_transactions (user_id, activity_date desc);
create index point_transactions_user_at_idx   on public.point_transactions (user_id, created_at desc);

comment on table public.point_transactions is
  'ગુણ — append-only, written only by award_points() (0021). At most one row per (યુવક, IST '
  'day, level, activity), enforced by point_transactions_day_unique, which is what makes '
  'points un-farmable given that attempts are unlimited since 0017 (§18). A row stores the '
  'number that was paid, not a pointer to the rule, so a later change to the setting cannot '
  'reach back and nothing here ever revokes an award (§1 rule 4).';

comment on column public.point_transactions.source_id is
  'activity_attempts.id when source = ACTIVITY_ATTEMPT, level4_attempts.id when source = '
  'LEVEL4_ATTEMPT. Deliberately no foreign key: it has two parents.';

-- ================================================================ the configured value

-- `settings['levels'].value.points` as the row holds it right now.
--
-- Mirrors `resolvePoints()` in shared/domain/points.js branch for branch, including which way
-- each malformed value falls:
--
--   absent / not an object   → everything off and zero. Nothing configured pays nothing;
--                              never the panel's suggested ૧૦૦/૨૦૦/૩૦૦, because a default
--                              that pays is a scoring system nobody switched on.
--   `enabled` not exactly    → off. Unlike the લેવલ ૪ gate (0014), whose absent `require`
--   JSON `true`                means "required", the safe direction here is *not* to pay.
--   a level that is not a    → 0 for that level alone. A partially-typed row is ordinary; a
--   JSON number                silent total blackout because one field is text is not.
--   out of range (0..10000)  → 0, **not clamped**. This differs from the slideshow (0018) on
--                              purpose: clamping a dwell of 90 to 60 still gives a slideshow,
--                              but clamping a mistyped ૩૦૦૦૦૦ to ૧૦૦૦૦ pays a number nobody
--                              chose. Refusing to pay is the only answer that cannot be wrong
--                              in the સંચાલક's favour by accident.
--   `level4` not an object   → `{"default": 0}`.
--   a level4 key that is not → dropped. A stray key cannot be a કસોટી, so it cannot be worth
--   an activity code           anything. The pattern is `level4_activities.code`'s own
--                              (0010:118).
--
-- The nested CASE, everywhere, and never `jsonb_typeof(x) = 'number' and (x)::numeric > ...`:
-- Postgres does not promise left-to-right evaluation of AND, so the cast in a second arm may
-- run even when the first arm is false, and `('"three hundred"'::jsonb ->> 'level1')::numeric`
-- raises. An ordered CASE is the documented way to make a guard actually guard (0018:70-72).
-- It matters more here than it did there: this runs inside `activity_submit()`, so an
-- exception would reach a યુવક as a failed નોંધાવો over a field he cannot see.
--
-- Rounding before the range test, not after, because `whole()` in points.js does exactly
-- that: `Math.round(n)` and then the bound. 10000.4 is therefore ૧૦૦૦૦ on both sides rather
-- than 0 on one of them. (`round()` here breaks halves away from zero where JS breaks them
-- upward; the validator below refuses fractions outright, so the two can only disagree about
-- a row no panel wrote.)
--
-- SECURITY DEFINER and revoked from `public` with no grant, for the reason 0014 gives about
-- `level4_gate_setting()`: it must answer identically for every caller, and it returns
-- configuration and nothing about any person. Its callers are the definer functions below,
-- which run as the owner and need no grant.
create or replace function public.point_settings()
returns table (enabled boolean, level1 integer, level2 integer, level3 integer, level4 jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with raw as (
    select s.value -> 'points' as p
    from public.settings s
    where s.key = 'levels'
  ),
  four as (
    select case when jsonb_typeof(p -> 'level4') = 'object' then p -> 'level4' else '{}'::jsonb end as v
    from raw
  )
  select
    -- `= 'true'::jsonb`, not truthiness: the stored value is jsonb, and the *string* 'false'
    -- is a truthy value in every language that would be tempted to test it loosely.
    coalesce((select (p -> 'enabled') = 'true'::jsonb from raw), false),

    coalesce((select case when jsonb_typeof(p -> 'level1') = 'number' then
                       case when round((p ->> 'level1')::numeric) between 0 and 10000
                            then round((p ->> 'level1')::numeric)::integer end
                     end from raw), 0),

    coalesce((select case when jsonb_typeof(p -> 'level2') = 'number' then
                       case when round((p ->> 'level2')::numeric) between 0 and 10000
                            then round((p ->> 'level2')::numeric)::integer end
                     end from raw), 0),

    coalesce((select case when jsonb_typeof(p -> 'level3') = 'number' then
                       case when round((p ->> 'level3')::numeric) between 0 and 10000
                            then round((p ->> 'level3')::numeric)::integer end
                     end from raw), 0),

    -- Normalised here rather than in `point_value_for()`, so that the map handed onward is
    -- already the map `resolvePoints()` returns: a numeric `default` that always exists, and
    -- activity codes only. `default` is built first and the coded keys are merged over it,
    -- which is also what stops a literal key named 'default' arriving twice.
    coalesce(
      (
        select jsonb_build_object(
                 'default',
                 coalesce(
                   case when jsonb_typeof(f.v -> 'default') = 'number' then
                     case when round((f.v ->> 'default')::numeric) between 0 and 10000
                          then round((f.v ->> 'default')::numeric)::integer end
                   end,
                   0
                 )
               )
               || coalesce(
                    (
                      select jsonb_object_agg(n.key, n.num)
                      from (
                        select e.key,
                               case when jsonb_typeof(e.value) = 'number' then
                                 case when round((e.value #>> '{}')::numeric) between 0 and 10000
                                      then round((e.value #>> '{}')::numeric)::integer end
                               end as num
                        from jsonb_each(f.v) e
                        where e.key <> 'default'
                          and e.key ~ '^[0-9]+\.[0-9]+$'
                      ) n
                      where n.num is not null
                    ),
                    '{}'::jsonb
                  )
        from four f
      ),
      jsonb_build_object('default', 0)
    );
$$;

revoke all on function public.point_settings() from public;

comment on function public.point_settings() is
  'What each level is worth right now, from settings[''levels''].value.points (0021). Mirrors '
  'resolvePoints() in shared/domain/points.js branch for branch, including how each malformed '
  'value falls — out of range is 0 and is deliberately NOT clamped. Defaults to points off '
  'and every level zero, so a project that never opens the panel keeps the app it had.';

-- What this one activity is worth, as a number the ledger can store.
--
-- Mirrors `pointsFor()`. Two rules carry the weight:
--
--   * `enabled: false` is worth 0 everywhere. Switching the system off must not require
--     blanking four fields and must not leave a half-off state where લેવલ ૩ still pays.
--   * an unlisted કસોટી falls to `level4.default`. The સંચાલક creates activities whenever he
--     likes; a new ૪.૫ nobody has priced is worth what લેવલ ૪ is worth, not nothing — a zero
--     there would look identical to a deliberate "this one is free".
--
-- Revoked with no grant, like everything else that reads configuration on the award path.
-- The panel gets the same numbers by resolving the settings row it already fetches.
create or replace function public.point_value_for(p_level integer, p_key text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
           when not s.enabled then 0
           when p_level = 1 then s.level1
           when p_level = 2 then s.level2
           when p_level = 3 then s.level3
           when p_level = 4 then
             coalesce(
               -- Nested CASE again, and for the same reason as above: `->>` on a key holding
               -- a JSON string would otherwise be cast.
               case when jsonb_typeof(s.level4 -> coalesce(p_key, '')) = 'number'
                    then round((s.level4 ->> coalesce(p_key, ''))::numeric)::integer end,
               case when jsonb_typeof(s.level4 -> 'default') = 'number'
                    then round((s.level4 ->> 'default')::numeric)::integer end,
               0
             )
           else 0
         end
  from public.point_settings() s;
$$;

revoke all on function public.point_value_for(integer, text) from public;

comment on function public.point_value_for(integer, text) is
  'What one activity is worth right now (0021). Mirrors pointsFor() in '
  'shared/domain/points.js: points off is 0 everywhere, and an unpriced લેવલ ૪ કસોટી falls '
  'to level4.default rather than to nothing. p_key is level4_activities.code for level 4 and '
  'is ignored for levels 1-3.';

-- ================================================================ the bound

-- Refuses what `point_settings()` above would silently zero.
--
-- The resolver/validator split shared/domain/settings.js draws, for the reason it gives: a
-- stored row must always yield an awardable map, but a સંચાલક typing '300' into a field
-- should be told it is text rather than watch લેવલ ૩ quietly stop paying.
--
-- And it is a trigger rather than only a panel check because `settings` is writable through
-- PostgREST by anyone `has_permission('settings.update')` admits, with no obligation to go
-- anywhere near admin/src. A curl could otherwise put `{"level3": 300000}` in this row and
-- every યુવક who finishes પુનરાવર્તન tomorrow would be paid nothing at all — the resolver
-- refusing the out-of-range value exactly as designed, with nothing on any screen to say why.
--
-- Only `key = 'levels'`, and only when `points` is actually present in the incoming value.
-- `?` tests for the key rather than for a non-null value, so `{"points": null}` is caught as
-- the malformed write it is instead of slipping through as "absent".
--
-- Every message names the bound. `saveError()` in the panel puts this text in front of the
-- સંચાલક, and a constraint that says only "violates check constraint" is a constraint the
-- next person works around.
create or replace function public.settings_check_points()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v     jsonb;
  four  jsonb;
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

  -- `validatePoints()` asks for a real boolean, not for truthiness. An absent switch is not
  -- "off" here: the સંચાલક is saving a points configuration and has to have said which.
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

  -- Every key is examined, not only the ones a panel would write. A stray key that the
  -- resolver would drop is refused here, because a value the સંચાલક typed and cannot see
  -- taking effect is worse than a save that explains itself.
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

  -- Last, exactly as validatePoints() does it: a `level4` with no default is a map in which
  -- every કસોટી the સંચાલક has not yet priced is worth an unstated amount, and there is no
  -- safe guess at what he meant.
  if jsonb_typeof(four -> 'default') <> 'number' then
    raise exception 'Level 4 points: set a default for activities with no value of their own.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.settings_check_points() from public;

drop trigger if exists settings_check_points on public.settings;

-- BEFORE, so a refused write never reaches the row — and never reaches `audit_setting`
-- either, which would otherwise file an entry for a change that did not happen. Ordering
-- against the audit trigger does not arise: this one is BEFORE and that one is AFTER. It sits
-- alongside `settings_check_slideshow` (0018) and `settings_check_mobile_nav` (0019) rather
-- than replacing either; the three examine different keys and all three run.
create trigger settings_check_points
  before insert or update on public.settings
  for each row execute function public.settings_check_points();

comment on function public.settings_check_points() is
  'Refuses a settings[''levels''].value.points write that resolvePoints() would silently zero '
  '(0021). Mirrors validatePoints() in shared/domain/points.js message for message. The panel '
  'validates the same rules for the wording; this is the guarantee, because settings is '
  'writable through PostgREST by anyone has_permission(''settings.update'') admits without '
  'going near admin/src.';

-- ================================================================ the only writer of the ledger

-- Pay this activity for this day, if it has not been paid already.
--
-- The whole of §18 is these fifteen lines, and almost all of the work is done by the `on
-- conflict ... do nothing`. There is deliberately **no existence check** before the insert:
-- a SELECT-then-INSERT would let two submits landing in the same millisecond both see no row
-- and both write one, and no amount of care in the caller closes that. The unique constraint
-- decides the race; this function only reports which side of it it landed on.
--
-- A zero is not written. `points >= 0` allows a zero row and nothing produces one, because
-- there is nothing to record: a level worth nothing, or a points system switched off, has not
-- paid a યુવક ૦ — it has not paid him. Writing the row anyway would also be actively harmful,
-- since it would occupy the day's unique key and mean that switching points *on* at noon paid
-- nobody who had already finished that morning.
--
-- Returns what was actually written, which is 0 both when the day is already paid and when
-- the value is 0. The caller shows that number to the યુવક, and 0 is not a failure — see the
-- second direction noted on point_transactions_day_unique.
--
-- SECURITY DEFINER because it writes a table with no insert policy for anybody, and revoked
-- with no grant because it takes a `p_user`: an execute grant would be a way for one યુવક to
-- pay another, or himself, which is the entire thing the ledger exists to prevent (§13, the
-- same reasoning 0008 applies to `has_earned_level4`). Its only callers are the two writers
-- below, which run as the owner.
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
  value_now integer;
  written   integer;
begin
  if p_user is null or p_date is null or p_level is null then
    return 0;
  end if;

  value_now := coalesce(public.point_value_for(p_level, coalesce(p_key, '')), 0);

  if value_now <= 0 then
    return 0;
  end if;

  insert into public.point_transactions
    (user_id, activity_date, level_id, activity_key, points, source, source_id, attempt_number)
  values
    (p_user, p_date, p_level, coalesce(p_key, ''), value_now, p_source, p_source_id,
     coalesce(p_attempt, 0))
  on conflict (user_id, activity_date, level_id, activity_key) do nothing
  returning points into written;

  -- DO NOTHING returns no row when it conflicts, so `written` is null and the day was already
  -- paid. That is the ordinary case for a second completed attempt, not an error.
  return coalesce(written, 0);
end;
$$;

revoke all on function public.award_points(uuid, date, integer, text, text, bigint, integer) from public;

comment on function public.award_points(uuid, date, integer, text, text, bigint, integer) is
  'The only writer of point_transactions (0021). Pays point_value_for() once per (યુવક, IST '
  'day, level, activity) and returns what was actually written — 0 when the day is already '
  'paid and 0 when the value is 0, in which case no row is written at all. The at-most-once '
  'rule is point_transactions_day_unique, not this function; there is no existence check here '
  'on purpose, because a check cannot decide a race.';

-- ================================================================ the only writer of an attempt

-- લેવલ ૧, ૨ or ૩ was practised. Record it, recount the day, pay it if it finished.
--
-- The only way an `activity_attempts` row ever exists. The table has a read policy and no
-- insert, update or delete policy for any client role, so — exactly as 0010 §37 argued for
-- `level4_attempts` — a યુવક cannot PATCH himself a COMPLETED row, because there is no write
-- path to take. This is that whole guarantee.
--
-- Errors are raised as bare identifiers (`activity_unknown`, …) in the shape level4_submit()
-- established, so the client maps them to Gujarati wording in one place rather than parsing
-- prose out of a Postgres message.
create or replace function public.activity_submit(
  p_level    integer,
  p_activity text,
  p_selected text[],
  p_total    integer,
  p_token    uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid          uuid := auth.uid();
  today        date;
  att          public.activity_attempts%rowtype;
  replayed     boolean := false;
  sel          text[];
  completed_n  integer;
  total_n      integer;
  new_status   text;
  awarded      integer := 0;
  tries        integer := 0;
  today_points bigint;
  total_points bigint;
begin
  -- 0. Who, and whether he may write anything at all.
  --
  --    `is_active_user()` is asked here rather than left to a policy because this function is
  --    SECURITY DEFINER and therefore not subject to RLS: a SUSPENDED account can still sign
  --    in and read its own history (0004), and this is what stops it recording anything new.
  if uid is null then
    raise exception 'activity_not_signed_in';
  end if;

  if not public.is_active_user() then
    raise exception 'activity_not_active';
  end if;

  -- 1. The level and the activity agree. Each of the three levels has exactly one activity,
  --    and the pair is what the ledger's day-key is built from — a submission claiming લેવલ ૩
  --    did a 'video' would be priced by `point_value_for(3, ...)` and filed under a key no
  --    screen can render. `activity_attempts_level_key_agree` is the floor under this; this
  --    is the message.
  if p_level is null or p_activity is null
     or not ((p_level = 1 and p_activity = 'video')
          or (p_level = 2 and p_activity = 'darshan')
          or (p_level = 3 and p_activity = 'revision')) then
    raise exception 'activity_unknown';
  end if;

  -- 2. The business day is the **server's**, in IST, and is never accepted from the caller
  --    (§4, §30). A date parameter would be a parameter: a phone with its clock set to
  --    yesterday would be paid again for yesterday, every day, and the ledger's at-most-once
  --    constraint would be enforcing the rule perfectly over a day the yuvak chose. The same
  --    expression appears in `level4_attempts_award()` and in the views below; if the project
  --    ever leaves Asia/Kolkata, those are the four places.
  today := timezone('Asia/Kolkata', now())::date;

  -- 3. Idempotency, before anything is written (§31).
  --
  --    A submit whose response was lost is retried by the phone with the same token. Without
  --    this the retry is a second attempt: `attempt_count` reads 2 for one practice, the day's
  --    recount is honest but describes something that did not happen, and the history screen
  --    shows a repetition the યુવક never made. The token index is what makes this a guarantee
  --    rather than a race — see the exception handler in step 6, which is where a retry that
  --    arrives *while* the first is still running lands.
  if p_token is not null then
    select * into att
    from public.activity_attempts a
    where a.user_id = uid
      and a.client_token = p_token;

    replayed := found;
  end if;

  if not replayed then
    -- 4. What was ticked: distinct, with nulls and blanks dropped. A client that sends
    --    duplicates or an empty string is buggy, not malicious, and failing the યુવક for it
    --    would break §1 rule 4 over something he did not do.
    --
    --    Unlike level4_submit() this does **not** intersect with a required list, because
    --    લેવલ ૩ has no fixed list to intersect with — the collection is the whole of દર્શન and
    --    `p_total` is what the client says was on the screen.
    select coalesce(array_agg(distinct s.scene_id), '{}'::text[])
      into sel
    from unnest(coalesce(p_selected, '{}'::text[])) as s(scene_id)
    where s.scene_id is not null
      and length(btrim(s.scene_id)) > 0;

    completed_n := coalesce(array_length(sel, 1), 0);

    -- `greatest`, so a client that under-reports the total cannot make a partial day read as
    -- complete: ticking ૮૨ while claiming a total of ૧૦ records a total of ૮૨, not ૧૦.
    total_n := greatest(coalesce(p_total, 0), completed_n, 0);

    -- 5. What it came to.
    --
    --    લેવલ ૧ and લેવલ ૨ carry no items at all — there is nothing to be part-way through a
    --    વિડિયો or a દર્શન, and the act *is* the completion. Giving them
    --    REVISION_REQUIRED because `total_items` is 0 would mark a યુવક as unfinished for
    --    having done exactly what was asked, which §1 rule 4 refuses and which would also
    --    mean neither level could ever be paid.
    if p_level in (1, 2) then
      new_status := 'COMPLETED';
    elsif total_n > 0 and completed_n >= total_n then
      new_status := 'COMPLETED';
    else
      new_status := 'REVISION_REQUIRED';
    end if;

    -- 6 & 7. The attempt number, and the attempt.
    --
    --    Computed inside the INSERT rather than read into a variable first, so it is the
    --    server's answer and not something a caller can supply (§10, §30). One statement is
    --    still not atomic against a concurrent submit — Postgres reads the row's snapshot at
    --    statement start, so two submits arriving together can both see the same `max()` — and
    --    `activity_attempts_number_unique` is what turns that into a refusal instead of two
    --    rows both calling themselves attempt #3. The retry then reads the number again.
    --
    --    Five tries, because the loop only spins while another submit for the *same* યુવક,
    --    level, activity and day is committing, which is a queue of a phone against itself.
    --    A sixth collision means something is wrong that retrying will not fix, so the
    --    exception is re-raised rather than swallowed into a silent no-op.
    loop
      tries := tries + 1;

      begin
        insert into public.activity_attempts
          (user_id, level_id, activity_key, activity_date, attempt_number,
           selected_scene_ids, total_items, completed_items, status, client_token, submitted_at)
        select
          uid, p_level, p_activity, today,
          coalesce(max(a.attempt_number), 0) + 1,
          sel, total_n, completed_n, new_status, p_token, now()
        from public.activity_attempts a
        where a.user_id = uid
          and a.level_id = p_level
          and a.activity_key = p_activity
          and a.activity_date = today
        returning * into att;

        exit;

      exception when unique_violation then
        -- Two different collisions arrive here and they mean opposite things.
        --
        -- The token index means the retry raced the original and the original won: the
        -- attempt exists, this call is a duplicate, and the correct answer is the one already
        -- recorded. That is §31 holding at the one moment a check in step 3 could not.
        if p_token is not null then
          select * into att
          from public.activity_attempts a
          where a.user_id = uid
            and a.client_token = p_token;

          if found then
            replayed := true;
            exit;
          end if;
        end if;

        -- Otherwise it is the attempt-number index and the answer is to count again.
        if tries >= 5 then
          raise;
        end if;
      end;
    end loop;
  end if;

  if not replayed then
    -- 8. The day's row, **recounted in full from the day's attempts and never incremented**.
    --
    --    0017:177-181's rule, and its reasoning verbatim: counted from the attempts themselves
    --    rather than incremented, so a retry, a double submit or a lost response cannot
    --    inflate it — the answer is a property of the day's rows, not of how many times this
    --    function ran. It is also self-repairing: a row that somehow drifted is corrected by
    --    the next submit, because nothing here reads the row's old values.
    --
    --    `completed_scene_ids` is the union across the day, not the last attempt's list: a
    --    યુવક who covers ૪૦ this morning and a different ૪૦ this afternoon has covered ૮૦
    --    today. `status` is bool_or over an append-only set, so it structurally cannot demote.
    --    `completed_at` is coalesced and therefore never moved — the first completion is the
    --    one that happened.
    with day as (
      select a.*
      from public.activity_attempts a
      where a.user_id = uid
        and a.activity_date = today
        and a.level_id = p_level
        and a.activity_key = p_activity
    ),
    ids as (
      select distinct s.scene_id
      from day d
      cross join lateral unnest(d.selected_scene_ids) as s(scene_id)
    )
    insert into public.daily_activity_progress
      (user_id, activity_date, level_id, activity_key,
       total_items, completed_items, completed_scene_ids, attempt_count, status,
       started_at, completed_at, updated_at)
    select
      uid, today, p_level, p_activity,
      coalesce(max(d.total_items), 0),
      /*
        The union's size, and NOT `max(completed_items)`.

        The two disagree exactly when they matter. A યુવક who submits ૪૦ this morning and a
        *different* ૪૦ this afternoon has brought ૮૦ દ્રશ્યો to mind today: `max()` reports
        ૪૦ and would leave this row saying ૪૦ while holding ૮૦ ids in the column beside it —
        a row that contradicts itself, and a history screen reading ૪૦/૧૦૮ off a day that
        covered ૮૦.

        Counted from the same `ids` CTE the array is built from, so the number and the list
        are two renderings of one fact and cannot drift. This is also precisely what
        `level4_submit` does for the day's લેવલ ૪ score — `count(distinct ticked.scene_id)`
        over the day's attempts (0017:182-187) — so both ladders answer "how much of the
        collection did he cover today" the same way.

        લેવલ ૧ and લેવલ ૨ carry no ids, so this is 0 for them, which is what `max()` gave
        too. Neither renders a coverage: `summariseRow()` sends a row with no items down its
        repetition branch and prints '૫ વાર'.
      */
      (select count(*) from ids i)::integer,
      coalesce((select array_agg(i.scene_id order by i.scene_id) from ids i), '{}'::text[]),
      count(*)::integer,
      case when bool_or(d.status = 'COMPLETED') then 'COMPLETED' else 'REVISION_REQUIRED' end,
      coalesce(min(d.submitted_at), now()),
      min(d.submitted_at) filter (where d.status = 'COMPLETED'),
      now()
    from day d
    on conflict (user_id, activity_date, level_id, activity_key) do update
      set total_items         = excluded.total_items,
          completed_items     = excluded.completed_items,
          completed_scene_ids = excluded.completed_scene_ids,
          attempt_count       = excluded.attempt_count,
          status              = excluded.status,
          started_at          = least(daily_activity_progress.started_at, excluded.started_at),
          completed_at        = coalesce(daily_activity_progress.completed_at, excluded.completed_at),
          updated_at          = now();

    -- 9. The award, only for a finished attempt.
    --
    --    A REVISION_REQUIRED attempt earns nothing **and consumes nothing**, because
    --    award_points() is not called at all: §23's worked example, where the morning's
    --    ૯૬/૧૦૮ leaves the afternoon's ૧૦૮/૧૦૮ free to be paid. A second COMPLETED attempt
    --    calls it and gets 0 back, which is the day already paid and is not a failure.
    if att.status = 'COMPLETED' then
      awarded := public.award_points(
        uid, att.activity_date, att.level_id, att.activity_key,
        'ACTIVITY_ATTEMPT', att.id, att.attempt_number
      );
    end if;
  else
    -- A replay reports what that attempt was paid at the time, read back from the ledger
    -- rather than recomputed: the configured value may have changed since, and the honest
    -- answer to "what did this submission earn" is the number in the row it wrote.
    select t.points into awarded
    from public.point_transactions t
    where t.source = 'ACTIVITY_ATTEMPT'
      and t.source_id = att.id;

    awarded := coalesce(awarded, 0);
  end if;

  -- 10. Both totals come from the ledger, already summed. §20 forbids deriving the lifetime
  --     figure by walking the day's UI events, and handing back a sum is what makes doing so
  --     unnecessary. `today` here is the current business day even on a replay whose attempt
  --     belongs to an earlier one — the question "how many points do I have today" is about
  --     now, while `activityDate` below is about the attempt.
  select
    coalesce(sum(t.points) filter (where t.activity_date = today), 0),
    coalesce(sum(t.points), 0)
  into today_points, total_points
  from public.point_transactions t
  where t.user_id = uid;

  return jsonb_build_object(
    'attemptNumber',  att.attempt_number,
    'activityDate',   att.activity_date,
    'completedItems', att.completed_items,
    'totalItems',     att.total_items,
    'status',         att.status,
    'pointsAwarded',  awarded,
    'todayPoints',    today_points,
    'totalPoints',    total_points
  );
end;
$$;

revoke all on function public.activity_submit(integer, text, text[], integer, uuid) from public;
grant execute on function public.activity_submit(integer, text, text[], integer, uuid) to authenticated;

comment on function public.activity_submit(integer, text, text[], integer, uuid) is
  'The only way a લેવલ ૧-૩ attempt exists (0021). Records the attempt, recounts the day from '
  'the day''s attempts (never increments), and awards points only for a COMPLETED one. The '
  'business date is the server''s IST date, never the caller''s (§4, §30); the attempt number '
  'is computed in the insert, never supplied (§10); and a repeat call carrying the same '
  'p_token returns the original attempt unchanged instead of creating a second (§31). Neither '
  'activity_attempts nor daily_activity_progress has an insert or update policy for any '
  'client role, so there is no second path to keep in step with this one (§37).';

-- ================================================================ the લેવલ ૪ hook

-- A passed કસોટી is paid, and `level4_submit()` is not rewritten to do it.
--
-- **This is why 0017 stands untouched.** લેવલ ૪'s attempt policy has now been set three times
-- (0012 unlimited, 0016 one, 0017 unlimited again), and the wording of that function is the
-- record of the last of those decisions. Reissuing it here to add two lines would make this
-- migration the fourth statement of a rule it has no opinion about, and the next person
-- reading `git log` would have to open a points migration to find out whether the attempt
-- policy had changed. An AFTER trigger reacting to a validated write is the same shape 0008
-- used for the unlock, and it keeps the two questions in the two files that answer them.
--
-- `when (new.passed)` is on the trigger rather than an `if` in the body, so a failed attempt
-- does not even call the function — which is most of them, on a table every લેવલ ૪ submission
-- writes to.
--
-- The date is the attempt's own IST day, `timezone('Asia/Kolkata', new.at)::date`, not
-- `now()`: a passing attempt at ૨૩:૫૯ that commits at ૦૦:૦૦ belongs to the day he sat it.
create or replace function public.level4_attempts_award()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  act_code text;
  nth      integer;
begin
  -- The ledger is keyed by `code` and not by `activity_id`, because
  -- `level4_clone_config()` writes new activity rows on every republication and a uuid key
  -- would orphan itself the first time the સંચાલક published anything. '4.1' in version 3 is
  -- '4.1' in version 4, which is the identity a payment belongs to.
  select a.code into act_code
  from public.level4_activities a
  where a.id = new.activity_id;

  -- An activity that cannot be named cannot be priced, and must not be filed under '' — that
  -- empty key would occupy the day's unique slot and block the real award. The FK on
  -- level4_attempts.activity_id makes this unreachable; it is here so that if it ever becomes
  -- reachable the failure is "not paid" rather than "paid, wrongly, and blocking".
  if act_code is null or act_code = '' then
    return null;
  end if;

  -- Which repetition of this કસોટી this row is, counted rather than stored, since 0017 keeps
  -- no such column. Recorded on the ledger row for the history screen; nothing decides
  -- anything from it.
  select count(*)::integer into nth
  from public.level4_attempts att
  where att.user_id = new.user_id
    and att.activity_id = new.activity_id
    and (att.at, att.id) <= (new.at, new.id);

  perform public.award_points(
    new.user_id,
    timezone('Asia/Kolkata', new.at)::date,
    4,
    act_code,
    'LEVEL4_ATTEMPT',
    new.id,
    nth
  );

  return null; -- AFTER trigger: the return value is ignored.
end;
$$;

revoke all on function public.level4_attempts_award() from public;

drop trigger if exists level4_attempts_award on public.level4_attempts;

create trigger level4_attempts_award
  after insert on public.level4_attempts
  for each row
  when (new.passed)
  execute function public.level4_attempts_award();

comment on function public.level4_attempts_award() is
  'Pays a passed કસોટી, from an AFTER INSERT trigger on level4_attempts rather than from '
  'inside level4_submit() (0021). That function is 0017''s statement of લેવલ ૪''s attempt '
  'policy and is deliberately not reissued here. The award is once per (યુવક, IST day, '
  'level4_activities.code) — keyed by code, because clone_config writes new activity uuids on '
  'every republication.';

-- ================================================================ the read surfaces
--
-- Three views, all `security_invoker = on`, which is the load-bearing option and the same one
-- 0011 argues for at length. Without it a view runs with its *owner's* rights and every
-- યુવક's attempts and payments would be readable by anyone permitted to select from it —
-- a hole straight through §13, opened by a reporting convenience. With it, the policies at the
-- bottom of this file apply to whoever is asking: a યુવક sees his own rows, and a સંચાલક
-- holding `progress.read` sees everyone's, which is exactly what he could already read from
-- the tables.
--
-- **And therefore none of them may call a revoked SECURITY DEFINER helper.** 0011:36-46: a
-- security_invoker view runs as the caller, so `point_settings()`, `point_value_for()` and
-- `award_points()` — all revoked from `authenticated` on purpose — would raise for every
-- યુવક who opened his history. The one predicate that would otherwise have been factored out
-- is therefore inlined below and written out three times:
--
--     timezone('Asia/Kolkata', <ts>)::date
--
-- Keep it in step with `activity_submit()` step 2 and with `level4_attempts_award()`. If the
-- project ever leaves IST, those are the places. Points are read from `point_transactions`
-- rather than recomputed, which is not only cheaper but correct: the ledger stores what was
-- paid, and recomputing would report what *would* be paid today.

-- Every પ્રયાસ a યુવક has ever made, both ladders in one list.
--
-- The two id spaces cannot collide, and the reason they cannot is arithmetic rather than
-- luck. `activity_attempts.id` and `level4_attempts.id` are independent bigserials and both
-- start at 1, so a plain union would give two rows the same key and any client keying a list
-- by `id` would render one of them and drop the other. A `source` column was the alternative
-- and was refused because the column list is what every consumer destructures and a nullable
-- discriminator invites `if (row.source === ...)` in places that should not care.
--
-- So લેવલ ૪ ids are offset into a disjoint range: **+2^62 = 4611686018427387904**. Above it,
-- every id is a `level4_attempts` row; below it, an `activity_attempts` row. bigint's ceiling
-- is 2^63-1, so the offset range holds 2^62 લેવલ ૪ attempts, and the un-offset range holds
-- 2^62 લેવલ ૧-૩ ones — at a thousand attempts a second it would take a hundred million years
-- to meet in the middle. The id is a stable key for a list, and nothing decides anything from
-- its magnitude.
create or replace view public.attempt_history
with (security_invoker = on) as
select
  a.id,
  a.user_id,
  a.activity_date,
  a.level_id,
  a.activity_key,
  -- Empty for લેવલ ૧-૩, and deliberately not the Gujarati label. `ACTIVITY_LABEL` in
  -- shared/domain/history.js is what `normaliseHistoryRow()` falls back to, and putting the
  -- same three words in a view would make the wording of a screen a thing that takes a
  -- migration to change. લેવલ ૪ is the opposite case: the સંચાલક named that કસોટી himself, so
  -- the title is data and has to travel with the row.
  ''::text as title,
  a.attempt_number,
  a.completed_items,
  a.total_items,
  a.status,
  a.selected_scene_ids,
  a.submitted_at
from public.activity_attempts a

union all

select
  x.id + 4611686018427387904,
  x.user_id,
  timezone('Asia/Kolkata', x.at)::date,
  4,
  coalesce(x.code, ''),
  coalesce(x.title, ''),
  x.attempt_number,
  x.selected_count,
  x.required_count,
  -- The same two words the other half uses, so one column renders both ladders (§ the note
  -- on ATTEMPT_STATUS in shared/domain/points.js).
  case when x.passed then 'COMPLETED' else 'REVISION_REQUIRED' end,
  x.selected_scene_ids,
  x.at
from (
  select
    att.id,
    att.user_id,
    att.at,
    att.passed,
    att.selected_count,
    att.required_count,
    att.selected_scene_ids,
    a.code,
    a.title,
    -- 0017 keeps no attempt number on the row, so it is derived: "which time was this". Over
    -- (user, activity) rather than over the day, because a કસોટી's repetitions are a sequence
    -- in his own history and not a property of a Tuesday. `att.id` breaks ties, so two
    -- attempts sharing a timestamp still get a stable order.
    (row_number() over (partition by att.user_id, att.activity_id order by att.at, att.id))::integer
      as attempt_number
  from public.level4_attempts att
  -- LEFT, and this is not defensive padding. `level4_activities`' read policy (0010) is
  -- `has_permission('settings.read') OR the configuration is PUBLISHED`, and this view runs
  -- as the caller — so a યુવક's attempt against a since-ARCHIVED configuration joins to a row
  -- he cannot see. An inner join would silently delete his own history from his own history
  -- page every time the સંચાલક published a new version. He keeps the row, without a title.
  left join public.level4_activities a on a.id = att.activity_id
) x;

grant select on public.attempt_history to authenticated;

comment on view public.attempt_history is
  'Every પ્રયાસ, લેવલ ૧-૩ and લેવલ ૪ in one list (0021). security_invoker, so RLS on the two '
  'underlying tables is what filters it. લેવલ ૪ ids are offset by 2^62 so the two bigserial '
  'id spaces cannot collide. Read-only, derived, and never written.';

-- One row per (યુવક, day, level, activity) — a day's summary, with what it paid.
--
-- This is what `groupByDate()` in shared/domain/history.js consumes, and its columns are that
-- function's fields. `points` comes from a LEFT JOIN so an unpaid day reads 0 rather than
-- null: an unpaid day is a real and ordinary thing — a second completed attempt, a level
-- priced at zero, points switched off — and a null there would propagate through `sum()` on
-- the client and turn a day's total into nothing at all.
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
  coalesce(t.points, 0) as points
from public.daily_activity_progress d
left join public.point_transactions t
  on  t.user_id       = d.user_id
  and t.activity_date = d.activity_date
  and t.level_id      = d.level_id
  and t.activity_key  = d.activity_key

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
  coalesce(t.points, 0)
from (
  -- લેવલ ૪ has no `daily_activity_progress` row and is not given one: its permanent state
  -- lives in `level4_activity_progress`, which has no date column at all, and adding a daily
  -- mirror of it would be the first expression in this codebase by which midnight could reach
  -- a passed કસોટી. The day's summary is therefore aggregated from the attempts on read.
  --
  -- Grouped by `code` and not by `activity_id`, so that the row lines up with the ledger's
  -- key: two configurations' ૪.૧ are the same કસોટી as far as a day's payment is concerned,
  -- which is the whole reason the ledger is keyed by code.
  select
    att.user_id,
    timezone('Asia/Kolkata', att.at)::date as activity_date,
    coalesce(a.code, '')                   as activity_key,
    -- `max`, because grouping by code can span two configurations that titled ૪.૧
    -- differently. Presentation only — the code beside it is the identity, and a day whose
    -- two attempts straddled a republication is rare enough that showing one of the two
    -- titles is better than splitting his day into two rows.
    coalesce(max(a.title), '')             as title,
    count(*)::integer                      as attempt_count,
    max(att.selected_count)::integer       as completed_items,
    max(att.required_count)::integer       as total_items,
    case when bool_or(att.passed) then 'COMPLETED' else 'REVISION_REQUIRED' end as status
  from public.level4_attempts att
  -- LEFT for the archived-configuration reason given on attempt_history above.
  left join public.level4_activities a on a.id = att.activity_id
  group by att.user_id, timezone('Asia/Kolkata', att.at)::date, coalesce(a.code, '')
) g
left join public.point_transactions t
  on  t.user_id       = g.user_id
  and t.activity_date = g.activity_date
  and t.level_id      = 4
  and t.activity_key  = g.activity_key;

grant select on public.activity_history to authenticated;

comment on view public.activity_history is
  'A day per (યુવક, level, activity), across both ladders, with what it paid (0021). The '
  'shape normaliseHistoryRow() in shared/domain/history.js consumes. points is LEFT JOINed '
  'from point_transactions, so an unpaid day reads 0 and never null. security_invoker.';

-- The ledger, as a screen reads it: every payment, newest first, with a name against it.
--
-- The title is looked up rather than stored, and only for લેવલ ૪, from the PUBLISHED
-- configuration. A ledger row keeps its `code` — that is the identity, and it is what makes
-- the row still meaningful after five republications — while the words beside it are whatever
-- that કસોટી is called today. `limit 1` because `level4_one_published` (0010) already
-- guarantees at most one published configuration; it is here so this degrades to a
-- wrong-but-single title rather than a "more than one row returned" error if that index is
-- ever dropped.
create or replace view public.point_ledger
with (security_invoker = on) as
select
  t.id,
  t.user_id,
  t.activity_date,
  t.level_id,
  t.activity_key,
  coalesce(n.title, '') as title,
  t.attempt_number,
  t.points,
  t.created_at
from public.point_transactions t
left join lateral (
  select a.title
  from public.level4_activities a
  join public.level4_configs c on c.id = a.config_id
  where t.level_id = 4
    and a.code = t.activity_key
    and c.status = 'PUBLISHED'
  limit 1
) n on true;

grant select on public.point_ledger to authenticated;

comment on view public.point_ledger is
  'point_transactions with the કસોટી''s current name against each લેવલ ૪ row (0021). The row '
  'stores the code, which is stable across republications; the title is resolved from the '
  'PUBLISHED configuration on read, so a renamed કસોટી reads by its new name without the '
  'ledger being rewritten. security_invoker.';

-- ================================================================ the summary

-- આજના ગુણ and કુલ ગુણ, both already summed.
--
-- SECURITY **INVOKER** — the default, written out here as an absence rather than a keyword,
-- and there is no `set search_path` either, both deliberately. The pattern is 0003's
-- `stage_breakdown()`: the function is a convenience over a GROUP BY that PostgREST cannot
-- express, never a way around a policy, so RLS on `point_transactions` applies to the caller
-- exactly as it would to a direct select.
--
-- The `user_id = auth.uid()` filter is nonetheless load-bearing and is not redundant with
-- that policy. The policy admits `has_permission('progress.read')` as well, so without this
-- line a સંચાલક calling `my_point_summary()` would get the sum of every યુવક in the project
-- labelled as his own — a number that is not wrong so much as meaningless, on a function
-- whose name promises otherwise. It is `my_`, and this is what makes that true.
--
-- §20: both figures arrive already summed, and there is no path here or in
-- `normalisePointSummary()` that adds a row to a total.
create or replace function public.my_point_summary()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'today',
    coalesce((
      select sum(t.points)
      from public.point_transactions t
      where t.user_id = auth.uid()
        -- The same IST expression as everywhere else on this page; see the note above the
        -- views. "Today" is the business day, so a યુવક looking at his phone at ૦૦:૩૦ sees a
        -- fresh day rather than one that turned over at UTC midnight six hours ago.
        and t.activity_date = timezone('Asia/Kolkata', now())::date
    ), 0),
    'total',
    coalesce((
      select sum(t.points)
      from public.point_transactions t
      where t.user_id = auth.uid()
    ), 0)
  );
$$;

grant execute on function public.my_point_summary() to authenticated;

comment on function public.my_point_summary() is
  'The caller''s own {today, total} points (0021). SECURITY INVOKER, so RLS on '
  'point_transactions filters it; the explicit user_id = auth.uid() is what stops a સંચાલક '
  'holding progress.read from reading the whole project''s total as his own. Consumed by '
  'normalisePointSummary() in shared/domain/history.js.';

-- ================================================================ rls

alter table public.activity_attempts        enable row level security;
alter table public.daily_activity_progress  enable row level security;
alter table public.point_transactions       enable row level security;

-- Read your own, or read everyone's with `progress.read` — the exact idiom 0010:1376-1380
-- uses for `level4_activity_progress`, and the same permission, so the સંચાલક's per-યુવક
-- history sits behind the permission he already holds to see the daily score beside it.
--
-- **And no write policy, for anyone.** Not a narrow one — none. RLS denies any command it has
-- no policy for, so INSERT, UPDATE and DELETE are refused for `authenticated` no matter what
-- the row says, and the SECURITY DEFINER functions above (which run as the owner and are
-- therefore not subject to RLS) are the only way a row here is ever written. That is the
-- difference between these tables and `profiles.level4_unlocked`, which 0008 had to defend
-- with a guard trigger precisely because its policy let the client write the column at all.
--
-- It applies with particular force to `point_transactions`: an UPDATE policy on a ledger,
-- however narrow, is a ledger a યુવક can rewrite, and a DELETE policy is one he can rewrite
-- twice by writing it again afterwards.

create policy "own activity attempts readable" on public.activity_attempts
  for select using (user_id = auth.uid() or public.has_permission('progress.read'));

create policy "own daily activity readable" on public.daily_activity_progress
  for select using (user_id = auth.uid() or public.has_permission('progress.read'));

create policy "own point transactions readable" on public.point_transactions
  for select using (user_id = auth.uid() or public.has_permission('progress.read'));

-- Belt and braces behind the missing policies: Supabase's default privileges grant every new
-- table in `public` to anon and authenticated, so RLS is otherwise the only thing standing
-- there. Revoking the privilege as well means a mistake in a future migration — an added
-- policy, a disabled RLS — still does not open a write path from a browser.
revoke insert, update, delete on public.activity_attempts       from anon, authenticated;
revoke insert, update, delete on public.daily_activity_progress from anon, authenticated;
revoke insert, update, delete on public.point_transactions      from anon, authenticated;

-- The sequences go with them: no client inserts, so no client needs a sequence.
revoke usage, select on sequence public.activity_attempts_id_seq  from anon, authenticated;
revoke usage, select on sequence public.point_transactions_id_seq from anon, authenticated;
