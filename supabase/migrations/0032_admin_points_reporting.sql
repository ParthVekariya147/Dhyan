-- વર્ણી ધ્યાન — the સંચાલક's side of the ledger.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT THIS FILE IS FOR
-- ════════════════════════════════════════════════════════════════════════════
--
-- 0031 made the ledger able to say why a યુવક was paid. Nothing yet lets a સંચાલક ask.
-- Five reading functions, all `SECURITY DEFINER`, all opened by the same permission check
-- 0029 established, and all aggregating **in Postgres**:
--
--     admin_point_transactions()  §24  the ledger itself, filtered and paged
--     admin_user_timeline()       §22  one યુવક's day, in the order it happened
--     admin_daily_activity()      §23  one date across everybody
--     admin_leaderboard()         §16  the board, with city and zone
--     admin_activity_counts()     §19  the five columns the report was missing
--
-- ── Why nothing here reissues admin_progress_report() ───────────────────────
--
-- §19 asks the report to be able to show Darshan sessions, revision sessions, ticks, total
-- attempts and rank. The obvious move is to widen 0030's report, and it is the wrong one:
-- that function is four hundred lines of argued reasoning about live scene ids and date
-- windows, its signature was already dropped and recreated once in 0030, and widening a
-- returns-table means dropping and rewriting all of it to add five sums.
--
-- `admin_activity_counts()` takes the page of યુવક ids the report just returned and answers
-- the five extra questions about exactly those. One more round trip for a page of twenty,
-- against a rewrite of the report every future column would have to repeat. The columns the
-- panel *filters* and *sorts* by all still live in the report, where a filter has to live;
-- these five are display and export columns, which is the difference.
--
-- ── Why the aggregation is here and not in the browser ──────────────────────
--
-- §32: five hundred યુવકો today, fifty thousand later. `select *` and count in JavaScript
-- is a screen that works until it silently does not, and the failure mode is a phone holding
-- a hundred thousand rows to print twenty. Every function below returns the answer, not the
-- rows it was computed from, and every one of them is paged or capped.
--
-- ── Authorisation ──────────────────────────────────────────────────────────
--
-- `admin_assert_progress_reader()` (0029) — `progress.read` AND `users.read` — raises 42501.
-- §31 asks for an authorisation *error* rather than an empty result, and that is what it
-- does: an unauthorised caller is told no, instead of being shown a report that looks like a
-- project with no યુવકો in it.

-- ================================================================ §24 the ledger

-- Every award, filtered, newest first, paged.
--
-- `total_rows` repeats the filtered count on every row via `count(*) over ()`, which is
-- 0029's idiom and is here for its reason: the pager has to say "of ૪૭૩" and a
-- fetch-one-extra-row probe cannot answer that.
--
-- `is_legacy` is the one column that is not data but interpretation, and it earns its place.
-- `award_kind is null` means the row was written before 0031 and no kind, rule version or
-- reason was recorded. The panel must not print an empty cell there as though the field were
-- blank; it is not blank, it was never asked. §0 asks for legacy and new to be told apart,
-- and this is where the telling happens — once, in SQL, rather than in each of the four
-- screens that read this.
create or replace function public.admin_point_transactions(
  p_user      uuid    default null,
  p_level     integer default null,
  p_activity  text    default null,
  p_from      date    default null,
  p_to        date    default null,
  p_min       integer default null,
  p_max       integer default null,
  p_kind      text    default null,
  p_source    text    default null,
  p_page      integer default 0,
  p_page_size integer default 50
)
returns table (
  total_rows     bigint,
  id             bigint,
  user_id        uuid,
  name           text,
  smk            text,
  city_id        text,
  zone_id        text,
  activity_date  date,
  level_id       integer,
  activity_key   text,
  title          text,
  points         integer,
  source         text,
  source_id      bigint,
  attempt_number integer,
  award_kind     text,
  rule_version   integer,
  reason         text,
  admin_name     text,
  is_legacy      boolean,
  created_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- ── the guard is a STATEMENT, not a CTE ────────────────────────────────────
  --
  -- `perform public.admin_assert_progress_reader();`, which is 0029's and 0030's idiom for
  -- every one of their reporting functions, and it is the only form that works.
  --
  -- Written as `with guard as (select public.admin_assert_progress_reader())` and joined into
  -- the FROM list — which is what this file did first — the check never runs. The CTE is
  -- referenced once, so the planner inlines it; no column of it is used, so the unused target
  -- entry is pruned; and a subquery with an empty target list still produces its one row
  -- without ever calling the function. The function then returned the whole ledger to any
  -- signed-in યુવક. There is no version of the CTE form that is safe, either: even a guard
  -- used in a WHERE clause is not evaluated when the scan beneath it yields no rows, so a
  -- report about a યુવક with no activity would answer an unauthorised caller with silence
  -- instead of a refusal. A statement before the query runs whatever the query returns.
  perform public.admin_assert_progress_reader();

  return query
  with size as (
    select greatest(1, least(200, coalesce(p_page_size, 50))) as n,
           greatest(0, coalesce(p_page, 0))                   as pg
  ),
  filtered as (
    select t.*
    from public.point_transactions t
    where (p_user     is null or t.user_id = p_user)
      and (p_level    is null or t.level_id = p_level)
      and (p_activity is null or t.activity_key = p_activity)
      and (p_from     is null or t.activity_date >= p_from)
      and (p_to       is null or t.activity_date <= p_to)
      and (p_min      is null or t.points >= p_min)
      and (p_max      is null or t.points <= p_max)
      and (p_source   is null or t.source = p_source)
      -- 'LEGACY' is a kind in the filter even though it is not a kind in the column, because
      -- "show me everything from before the new system" is the question §0 makes worth asking.
      and (p_kind     is null
           or (p_kind = 'LEGACY' and t.award_kind is null)
           or t.award_kind = p_kind)
  )
  select
    count(*) over ()::bigint,
    f.id,
    f.user_id,
    p.name,
    p.smk,
    p.zone_id      as city_id,
    p.sub_zone_id  as zone_id,
    f.activity_date,
    f.level_id,
    f.activity_key,
    -- The કસોટી's current title, from the PUBLISHED configuration. LEFT JOIN LATERAL because
    -- a code paid under version 3 may not exist in version 7, and a payment that happened
    -- must still print. Same shape as the point_ledger view (0021).
    coalesce(l4.title, '') as title,
    f.points,
    f.source,
    f.source_id,
    f.attempt_number,
    f.award_kind,
    f.rule_version,
    f.reason,
    coalesce(ap.name, '') as admin_name,
    (f.award_kind is null) as is_legacy,
    f.created_at
  from filtered f
  join public.profiles p on p.id = f.user_id
  left join public.profiles ap on ap.id = f.admin_id
  left join lateral (
    select a.title
    from public.level4_activities a
    join public.level4_configs c on c.id = a.config_id and c.status = 'PUBLISHED'
    where a.code = f.activity_key and f.level_id = 4
    limit 1
  ) l4 on true
  order by f.created_at desc, f.id desc
  -- Scalar subqueries, not `size.pg`: OFFSET and LIMIT are evaluated once for the whole
  -- statement and may not read a column of the FROM list.
  offset (select pg * n from size)
  limit  (select n from size);
end;
$$;

revoke all on function public.admin_point_transactions(uuid, integer, text, date, date,
  integer, integer, text, text, integer, integer) from public;
grant execute on function public.admin_point_transactions(uuid, integer, text, date, date,
  integer, integer, text, text, integer, integer) to authenticated;

comment on function public.admin_point_transactions(uuid, integer, text, date, date,
  integer, integer, text, text, integer, integer) is
  'The ledger, filtered and paged for the સંચાલક (§24, 0032). Read only — nothing in this '
  'file writes. is_legacy marks a row written before 0031, whose kind, rule version and '
  'reason were never recorded and must not be printed as though they were blank.';

-- ================================================================ §22 the timeline

-- One યુવક's journey, in the order it happened.
--
-- Three streams, one ordering. `activity_attempts` and `level4_attempts` are the events;
-- `point_transactions` is what each event was paid, joined on rather than unioned in, so a
-- payment appears **on** the act that earned it instead of beside it. A timeline that listed
-- "passed ૪.૧" and "+૧૦૦ ગુણ" as two entries would be asking the સંચાલક to pair them up by
-- eye, which is the job this screen exists to do for him.
--
-- A manual adjustment has no event to attach to and is therefore its own row — which is
-- exactly right, because it is its own act, performed by a person with a name and a reason.
--
-- Timestamps, not dates: §22's example is a morning. `submitted_at` and `at` are the
-- attempts' own instants; the IST day is derived from them the way every other function in
-- this project derives it.
create or replace function public.admin_user_timeline(
  p_user      uuid,
  p_from      date    default null,
  p_to        date    default null,
  p_page      integer default 0,
  p_page_size integer default 50
)
returns table (
  total_rows    bigint,
  at            timestamptz,
  activity_date date,
  level_id      integer,
  activity_key  text,
  title         text,
  kind          text,
  attempt_number integer,
  completed_items integer,
  total_items   integer,
  status        text,
  passed        boolean,
  points        integer,
  award_kind    text,
  reason        text,
  actor_name    text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- A statement, not a CTE — see admin_point_transactions() above for why the CTE form never
  -- runs. It matters most here: this function is asked about one યુવક at a time, and the
  -- three streams below are empty for a યુવક who has done nothing, so a guard living in the
  -- query would have had nothing to be evaluated against.
  perform public.admin_assert_progress_reader();

  return query
  with size as (
    select greatest(1, least(200, coalesce(p_page_size, 50))) as n,
           greatest(0, coalesce(p_page, 0))                   as pg
  ),

  -- લેવલ ૧-૩. One row per submission; `activity_attempts` has always kept them all.
  lvl123 as (
    select
      a.submitted_at                       as at,
      a.activity_date,
      a.level_id,
      a.activity_key,
      ''::text                             as title,
      'ATTEMPT'::text                      as kind,
      a.attempt_number,
      a.completed_items,
      a.total_items,
      a.status,
      (a.status = 'COMPLETED')             as passed,
      coalesce(t.points, 0)                as points,
      t.award_kind,
      null::text                           as reason,
      ''::text                             as actor_name
    from public.activity_attempts a
    left join public.point_transactions t
      on t.attempt_id = a.id and t.source = 'ACTIVITY_ATTEMPT'
    where a.user_id = p_user
      and (p_from is null or a.activity_date >= p_from)
      and (p_to   is null or a.activity_date <= p_to)
  ),

  -- લેવલ ૪. Every attempt, passed or failed — §7's whole point. The attempt number is
  -- counted rather than stored, because 0017 keeps no such column; the same window
  -- `attempt_history` (0021) uses, so the two screens number a given attempt identically.
  lvl4 as (
    select
      la.at,
      timezone('Asia/Kolkata', la.at)::date as activity_date,
      4                                     as level_id,
      coalesce(act.code, '')                as activity_key,
      coalesce(act.title, '')               as title,
      'EXAM'::text                          as kind,
      row_number() over (partition by la.user_id, la.activity_id
                         order by la.at, la.id)::integer as attempt_number,
      la.selected_count                     as completed_items,
      la.required_count                     as total_items,
      case when la.passed then 'COMPLETED' else 'REVISION_REQUIRED' end as status,
      la.passed,
      coalesce(t.points, 0)                 as points,
      t.award_kind,
      null::text                            as reason,
      ''::text                              as actor_name
    from public.level4_attempts la
    left join public.level4_activities act on act.id = la.activity_id
    left join public.point_transactions t
      on t.attempt_id = la.id and t.source = 'LEVEL4_ATTEMPT'
    where la.user_id = p_user
      and (p_from is null or timezone('Asia/Kolkata', la.at)::date >= p_from)
      and (p_to   is null or timezone('Asia/Kolkata', la.at)::date <= p_to)
  ),

  -- A સંચાલક's correction. Its own act.
  manual as (
    select
      t.created_at        as at,
      t.activity_date,
      t.level_id,
      t.activity_key,
      ''::text            as title,
      'MANUAL'::text      as kind,
      0                   as attempt_number,
      0                   as completed_items,
      0                   as total_items,
      ''::text            as status,
      null::boolean       as passed,
      t.points,
      t.award_kind,
      t.reason,
      coalesce(ap.name, '') as actor_name
    from public.point_transactions t
    left join public.profiles ap on ap.id = t.admin_id
    where t.user_id = p_user
      and t.award_kind = 'MANUAL'
      and (p_from is null or t.activity_date >= p_from)
      and (p_to   is null or t.activity_date <= p_to)
  ),

  all_rows as (
    select * from lvl123
    union all select * from lvl4
    union all select * from manual
  )
  select count(*) over ()::bigint, r.*
  from all_rows r
  -- The tiebreak is not decoration. `at desc` alone is not a total order, and two acts recorded
  -- in the same instant — a દર્શન session and the કસોટી submitted straight after it, both
  -- stamped by one clock — may come back in either order on either request. Under OFFSET/LIMIT
  -- that is not a cosmetic wobble: rows that swap across a page boundary are shown twice or not
  -- at all, and a timeline that quietly drops an act is worse than one that is slow. The extra
  -- keys are the columns that actually distinguish two rows of the same instant, ending on the
  -- attempt number, which is unique per (યુવક, day, level, activity) by 0021's own constraint.
  order by r.at desc, r.level_id desc, r.activity_key desc, r.attempt_number desc
  offset (select pg * n from size)
  limit  (select n from size);
end;
$$;

revoke all on function public.admin_user_timeline(uuid, date, date, integer, integer) from public;
grant execute on function public.admin_user_timeline(uuid, date, date, integer, integer) to authenticated;

comment on function public.admin_user_timeline(uuid, date, date, integer, integer) is
  'One યુવક''s activity in the order it happened (§22, 0032). Attempts from '
  'activity_attempts and level4_attempts with what each was paid joined on, plus manual '
  'adjustments as their own rows. Every લેવલ ૪ attempt appears, passed or failed.';

-- ================================================================ §23 one day, everybody

-- What happened on a date.
--
-- Returned as one jsonb object with a totals block and a capped list of યુવકો, because the
-- two are one question — "૪૭ active, and here they are" — and two round trips would let a
-- screen show a total that disagrees with the list beneath it.
--
-- The per-યુવક list is capped at 500 and says so in `truncated`. A silent cap is a report
-- that claims completeness it does not have (§32); a stated one is a page with a next step.
create or replace function public.admin_daily_activity(
  p_date  date,
  p_city  text default null,
  p_zone  text default null,
  p_limit integer default 500
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  out_doc jsonb;
begin
  -- A statement, not a CTE — see admin_point_transactions() above.
  perform public.admin_assert_progress_reader();

  -- The whole document is one parenthesised subquery assigned to a variable, so that the CTEs
  -- below are unchanged from the `language sql` version this replaced. Only the guard moved.
  out_doc := (
  with day as (select coalesce(p_date, timezone('Asia/Kolkata', now())::date) as d),
  cap as (select greatest(1, least(2000, coalesce(p_limit, 500))) as n),

  people as (
    select p.id, p.name, p.smk, p.zone_id as city_id, p.sub_zone_id as zone_id
    from public.profiles p
    where (p_city is null or p.zone_id = p_city)
      and (p_zone is null or p.sub_zone_id = p_zone)
  ),

  -- લેવલ ૧-૩, counted per યુવક. `filter (where ...)` rather than three scans: one pass over
  -- the day's attempts answers all of it, and the index on (level_id, activity_date desc)
  -- from 0029 is what makes the pass cheap.
  a123 as (
    select
      a.user_id,
      count(*) filter (where a.activity_key = 'darshan')::integer  as darshan_sessions,
      count(*) filter (where a.activity_key = 'revision')::integer as revision_sessions,
      count(*) filter (where a.activity_key = 'video')::integer    as video_sessions,
      -- Ticks for the day: the size of the distinct union across the day's revision
      -- attempts, not the sum of their counts. A યુવક who ticks the same ૪૦ દ્રશ્યો twice
      -- has brought ૪૦ to mind, not ૮૦ — the same reading activity_submit() step 8 takes.
      --
      -- Withheld દ્રશ્યો are subtracted, exactly as admin_activity_counts() subtracts them
      -- (0032, the `tk` CTE) and exactly as award_points()'s TICK branch subtracts them
      -- (0031:520-538). That last one settles which reading is correct: the engine pays on the
      -- withheld-subtracted count, and a report that disagreed with the ledger would be the
      -- wrong half of the disagreement. Without it this figure can exceed the size of the live
      -- collection, and the daily page and the progress report answer one question two ways
      -- for the same યુવક on the same day.
      coalesce((
        select count(distinct s.scene_id)
        from public.activity_attempts r
        cross join lateral unnest(r.selected_scene_ids) as s(scene_id)
        where r.user_id = a.user_id and r.activity_date = (select d from day)
          and r.level_id = 3
          and not (s.scene_id = any (public.admin_withheld_scene_ids()))
      ), 0)::integer as ticks
    from public.activity_attempts a
    where a.activity_date = (select d from day)
    group by a.user_id
  ),

  a4 as (
    select
      la.user_id,
      count(*)::integer                                  as exam_attempts,
      count(*) filter (where la.passed)::integer         as exam_passed,
      count(*) filter (where not la.passed)::integer     as exam_failed
    from public.level4_attempts la
    where timezone('Asia/Kolkata', la.at)::date = (select d from day)
    group by la.user_id
  ),

  pts as (
    select t.user_id, coalesce(sum(t.points), 0)::bigint as points
    from public.point_transactions t
    where t.activity_date = (select d from day)
    group by t.user_id
  ),

  rows as (
    select
      pe.id, pe.name, pe.smk, pe.city_id, pe.zone_id,
      coalesce(a123.darshan_sessions, 0)  as darshan_sessions,
      coalesce(a123.revision_sessions, 0) as revision_sessions,
      coalesce(a123.video_sessions, 0)    as video_sessions,
      coalesce(a123.ticks, 0)             as ticks,
      coalesce(a4.exam_attempts, 0)       as exam_attempts,
      coalesce(a4.exam_passed, 0)         as exam_passed,
      coalesce(a4.exam_failed, 0)         as exam_failed,
      coalesce(pts.points, 0)             as points
    from people pe
    left join a123 on a123.user_id = pe.id
    left join a4   on a4.user_id   = pe.id
    left join pts  on pts.user_id  = pe.id
    -- Active means "did something", and a યુવક who only earned a manual adjustment today did
    -- not do anything — he appears in the ledger, not in the day's activity.
    where coalesce(a123.darshan_sessions, 0) + coalesce(a123.revision_sessions, 0)
        + coalesce(a123.video_sessions, 0)   + coalesce(a4.exam_attempts, 0) > 0
  )
  select jsonb_build_object(
    'date', (select d from day),
    'totals', jsonb_build_object(
      'activeUsers',       (select count(*) from rows),
      'darshanSessions',   (select coalesce(sum(darshan_sessions), 0) from rows),
      'revisionSessions',  (select coalesce(sum(revision_sessions), 0) from rows),
      'videoSessions',     (select coalesce(sum(video_sessions), 0) from rows),
      'ticks',             (select coalesce(sum(ticks), 0) from rows),
      'examAttempts',      (select coalesce(sum(exam_attempts), 0) from rows),
      'examPassed',        (select coalesce(sum(exam_passed), 0) from rows),
      'examFailed',        (select coalesce(sum(exam_failed), 0) from rows),
      'points',            (select coalesce(sum(points), 0) from rows)
    ),
    'truncated', (select count(*) from rows) > (select n from cap),
    'cap',       (select n from cap),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'userId', r.id, 'name', r.name, 'smk', r.smk,
               'cityId', r.city_id, 'zoneId', r.zone_id,
               'darshanSessions', r.darshan_sessions,
               'revisionSessions', r.revision_sessions,
               'videoSessions', r.video_sessions,
               'ticks', r.ticks,
               'examAttempts', r.exam_attempts,
               'examPassed', r.exam_passed,
               'examFailed', r.exam_failed,
               'points', r.points
             ) order by r.points desc, r.name asc)
      from (
        select * from rows order by points desc, name asc limit (select n from cap)
      ) r
    ), '[]'::jsonb)
  ));

  return out_doc;
end;
$$;

revoke all on function public.admin_daily_activity(date, text, text, integer) from public;
grant execute on function public.admin_daily_activity(date, text, text, integer) to authenticated;

comment on function public.admin_daily_activity(date, text, text, integer) is
  'One date across every યુવક — totals and a capped per-person list in one object (§23, '
  '0032). Ticks are the distinct union across the day''s revision attempts, matching '
  'activity_submit() step 8, not the sum of their counts.';

-- ================================================================ §16 the board

-- The leaderboard, as the સંચાલક needs to see it.
--
-- Deliberately **not** a second scoring system. It is the same `sum(point_transactions.
-- points)` that `leaderboard()` (0023) computes, and §16 is explicit that there must not be
-- two. What it adds is what a યુવક must never have: the user id, the city and the zone, and
-- an arbitrary date window instead of the four fixed periods.
--
-- Ranking is 0023's, verbatim in shape and for its reasons:
--   `rank()`       ties share a place — two યુવકો on ૮૦૦ are both ૩rd
--   `row_number()` a deterministic print order, so the cut takes exactly N rows and takes
--                  the same N every time
--
-- The rank is computed **before** the city/zone filter is applied to the output, so a
-- સંચાલક filtering to સુરત sees each યુવક's place in the whole project. A rank that
-- silently renumbered inside a filter would answer a question nobody asked and would
-- disagree with the board the યુવક himself sees.
create or replace function public.admin_leaderboard(
  p_from  date    default null,
  p_to    date    default null,
  p_city  text    default null,
  p_zone  text    default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  out_doc jsonb;
begin
  -- A statement, not a CTE — see admin_point_transactions() above.
  perform public.admin_assert_progress_reader();

  out_doc := (
  with cap as (select greatest(1, least(500, coalesce(p_limit, 20))) as n),
  earned as (
    select t.user_id, sum(t.points)::bigint as total
    from public.point_transactions t
    where (p_from is null or t.activity_date >= p_from)
      and (p_to   is null or t.activity_date <= p_to)
    group by t.user_id
    having sum(t.points) > 0
  ),
  ranked as (
    select
      e.user_id, e.total, p.name, p.smk,
      p.zone_id as city_id, p.sub_zone_id as zone_id,
      rank()       over (order by e.total desc)                          as place,
      row_number() over (order by e.total desc, p.name asc, e.user_id asc) as ord
    from earned e
    join public.profiles p on p.id = e.user_id and p.status = 'ACTIVE'
  ),
  shown as (
    select * from ranked r
    where (p_city is null or r.city_id = p_city)
      and (p_zone is null or r.zone_id = p_zone)
    order by r.ord
    limit (select n from cap)
  )
  select jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'participants', (select count(*) from ranked),
    'shown',        (select count(*) from shown),
    'totalPoints',  (select coalesce(sum(total), 0) from ranked),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank',   s.place,
               'userId', s.user_id,
               'name',   s.name,
               'smk',    s.smk,
               'cityId', s.city_id,
               'zoneId', s.zone_id,
               'points', s.total
             ) order by s.ord)
      from shown s
    ), '[]'::jsonb)
  ));

  return out_doc;
end;
$$;

revoke all on function public.admin_leaderboard(date, date, text, text, integer) from public;
grant execute on function public.admin_leaderboard(date, date, text, text, integer) to authenticated;

comment on function public.admin_leaderboard(date, date, text, text, integer) is
  'The board for the સંચાલક (§16, 0032) — the same sum(point_transactions.points) that '
  'leaderboard() (0023) computes, never a second scoring system. Adds user id, city, zone '
  'and a free date window. Rank is the whole project''s, computed before the city/zone '
  'filter, so it agrees with the board a યુવક sees.';

-- ================================================================ §19 the five columns

-- Darshan sessions, revision sessions, ticks, all-level attempts and rank — for the page of
-- યુવકો the report just returned, and for nobody else.
--
-- `p_users` is that page: twenty ids, not a filter. The report has already decided who is on
-- the screen, and re-deciding it here would be two implementations of one filter drifting
-- apart on the day somebody fixes only the first (§39).
--
-- `rank` is the exception and is computed over **everybody**, because a rank inside a page
-- of twenty is not a rank. That is a grouped aggregate over the whole ledger; the index
-- point_transactions_user_date_idx serves the date predicate, and the ledger holds one row
-- per (યુવક, day, activity) rather than one per event, which is what keeps it small.
create or replace function public.admin_activity_counts(
  p_users uuid[],
  p_from  date default null,
  p_to    date default null
)
returns table (
  user_id           uuid,
  darshan_sessions  integer,
  revision_sessions integer,
  video_sessions    integer,
  ticks             integer,
  attempts_all      integer,
  exam_attempts     integer,
  exam_passed       integer,
  points_total      bigint,
  rank              integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- A statement, not a CTE — see admin_point_transactions() above. It matters here too: an
  -- empty p_users produces no rows at all, and a guard inside the query would never run.
  perform public.admin_assert_progress_reader();

  return query
  with want as (
    select distinct u.id
    from unnest(coalesce(p_users, '{}'::uuid[])) as u(id)
    where u.id is not null
  ),
  a123 as (
    select
      a.user_id,
      count(*) filter (where a.activity_key = 'darshan')::integer  as darshan_sessions,
      count(*) filter (where a.activity_key = 'revision')::integer as revision_sessions,
      count(*) filter (where a.activity_key = 'video')::integer    as video_sessions,
      count(*)::integer                                            as attempts_123
    from public.activity_attempts a
    join want w on w.id = a.user_id
    where (p_from is null or a.activity_date >= p_from)
      and (p_to   is null or a.activity_date <= p_to)
    group by a.user_id
  ),
  -- Ticks: the distinct union of દ્રશ્યો named across every લેવલ ૩ attempt in the window,
  -- minus anything the સંચાલક has withheld. The same subtraction 0029 makes everywhere, so
  -- a યુવક cannot read above the live collection because he once submitted a દ્રશ્ય that has
  -- since been taken out.
  tk as (
    select a.user_id, count(distinct s.scene_id)::integer as ticks
    from public.activity_attempts a
    join want w on w.id = a.user_id
    cross join lateral unnest(a.selected_scene_ids) as s(scene_id)
    where a.level_id = 3
      and (p_from is null or a.activity_date >= p_from)
      and (p_to   is null or a.activity_date <= p_to)
      and not (s.scene_id = any (public.admin_withheld_scene_ids()))
    group by a.user_id
  ),
  a4 as (
    select
      la.user_id,
      count(*)::integer                          as exam_attempts,
      count(*) filter (where la.passed)::integer as exam_passed
    from public.level4_attempts la
    join want w on w.id = la.user_id
    where (p_from is null or timezone('Asia/Kolkata', la.at)::date >= p_from)
      and (p_to   is null or timezone('Asia/Kolkata', la.at)::date <= p_to)
    group by la.user_id
  ),
  board as (
    select
      t.user_id,
      sum(t.points)::bigint as total,
      rank() over (order by sum(t.points) desc)::integer as place
    from public.point_transactions t
    group by t.user_id
    having sum(t.points) > 0
  )
  select
    w.id,
    coalesce(a123.darshan_sessions, 0),
    coalesce(a123.revision_sessions, 0),
    coalesce(a123.video_sessions, 0),
    coalesce(tk.ticks, 0),
    coalesce(a123.attempts_123, 0) + coalesce(a4.exam_attempts, 0),
    coalesce(a4.exam_attempts, 0),
    coalesce(a4.exam_passed, 0),
    coalesce(board.total, 0),
    -- No rank at all rather than a last place: a યુવક who has earned nothing is not ranked,
    -- and printing him as ૪૭th of ૪૭ would be inventing a standing he does not hold. The
    -- panel prints '-'.
    board.place
  from want w
  left join a123  on a123.user_id  = w.id
  left join tk    on tk.user_id    = w.id
  left join a4    on a4.user_id    = w.id
  left join board on board.user_id = w.id;
end;
$$;

revoke all on function public.admin_activity_counts(uuid[], date, date) from public;
grant execute on function public.admin_activity_counts(uuid[], date, date) to authenticated;

comment on function public.admin_activity_counts(uuid[], date, date) is
  'The five report columns admin_progress_report() does not carry — Darshan sessions, '
  'revision sessions, ticks, total attempts and rank — for one page of યુવકો (§19, 0032). '
  'Rank is over the whole project, never within the page. Null rank means "has earned '
  'nothing", which is not last place.';

-- ================================================================ the points overview

-- What the panel's Overview tab shows, in one call: the rules in force, and what they have
-- paid. §36's first section.
create or replace function public.admin_points_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  out_doc jsonb;
begin
  -- A statement, not a CTE — see admin_point_transactions() above.
  perform public.admin_assert_progress_reader();

  out_doc := (
  with today as (select timezone('Asia/Kolkata', now())::date as d),
  led as (select t.* from public.point_transactions t)
  select jsonb_build_object(
    'rules',    public.point_rules(),
    'settings', (select jsonb_build_object(
                          'enabled', s.enabled, 'level1', s.level1,
                          'level2', s.level2, 'level3', s.level3, 'level4', s.level4)
                 from public.point_settings() s),
    'leaderboard', (select jsonb_build_object(
                             'enabled', l.enabled, 'periods', to_jsonb(l.periods),
                             'defaultPeriod', l.default_period, 'topN', l.top_n)
                    from public.leaderboard_settings() l),
    'totals', jsonb_build_object(
      'transactions', (select count(*) from led),
      'points',       (select coalesce(sum(points), 0) from led),
      'earners',      (select count(distinct user_id) from led),
      'today',        (select coalesce(sum(points), 0) from led
                       where activity_date = (select d from today)),
      'todayRows',    (select count(*) from led where activity_date = (select d from today)),
      -- The line §0 asks every screen to be able to draw. Legacy rows are the ones written
      -- before 0031; their count and their sum are the reconciliation figure that must never
      -- move again, and the panel prints it so that a change would be visible.
      'legacyRows',   (select count(*) from led where award_kind is null),
      'legacyPoints', (select coalesce(sum(points), 0) from led where award_kind is null),
      'newRows',      (select count(*) from led where award_kind is not null),
      'newPoints',    (select coalesce(sum(points), 0) from led where award_kind is not null)
    ),
    'byKind', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind',  coalesce(k.award_kind, 'LEGACY'),
               'rows',  k.n,
               'points', k.p) order by k.p desc)
      from (select award_kind, count(*) as n, coalesce(sum(points), 0) as p
            from led group by award_kind) k
    ), '[]'::jsonb),
    'byLevel', coalesce((
      select jsonb_agg(jsonb_build_object(
               'level', l.level_id, 'rows', l.n, 'points', l.p) order by l.level_id)
      from (select level_id, count(*) as n, coalesce(sum(points), 0) as p
            from led group by level_id) l
    ), '[]'::jsonb)
  ));

  return out_doc;
end;
$$;

revoke all on function public.admin_points_overview() from public;
grant execute on function public.admin_points_overview() to authenticated;

comment on function public.admin_points_overview() is
  'The rules in force and what they have paid, in one call (§36, 0032). Reports legacy rows '
  '(award_kind null, written before 0031) separately from new ones, so the historical count '
  'and sum §41 asks to be preserved are visible on the screen rather than only in a script.';

-- ================================================================ the codes to price

-- Every લેવલ ૪ કસોટી the panel should offer a value for, from the PUBLISHED configuration.
--
-- §11: do not hardcode 4.1 … 4.4. A ૪.૫ created next month appears here the moment it is
-- published, and a code that has been retired keeps its stored value without being offered
-- again — the ledger is keyed by code, and a value for a code nobody can sit is harmless.
create or replace function public.admin_point_activities()
-- `"position"` is quoted because bare `position` is a col_name_keyword — Postgres reserves it
-- for `position(substring in string)` and refuses it as an OUT-parameter name, which is what a
-- RETURNS TABLE column is. Unquoted it is a syntax error at CREATE FUNCTION time.
returns table (code text, title text, "position" integer, active boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- A statement, not a CTE — see admin_point_transactions() above. A configuration that has
  -- not been published yet returns no rows, and a guard in the FROM list would not have run
  -- for that call either.
  perform public.admin_assert_progress_reader();

  return query
  select a.code, a.title, a.position, a.active
  from public.level4_activities a
  join public.level4_configs c on c.id = a.config_id and c.status = 'PUBLISHED'
  order by a.position;
end;
$$;

revoke all on function public.admin_point_activities() from public;
grant execute on function public.admin_point_activities() to authenticated;

comment on function public.admin_point_activities() is
  'The લેવલ ૪ કસોટીઓ in the published configuration, so the points panel can offer a value '
  'for each without hardcoding 4.1-4.4 (§11, 0032). A new 4.5 appears as soon as it is '
  'published.';
