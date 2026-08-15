-- વર્ણી ધ્યાન — a test account earns points and appears in nobody's totals.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE DEFECT
-- ════════════════════════════════════════════════════════════════════════════
--
-- People are registered to try the app - to check that a દ્રશ્ય unlocks, that લેવલ ૪ scores,
-- that the point engine pays what the configuration says. That is the only honest way to test
-- this application, because the alternative is asserting against a mock of it.
--
-- And every one of those accounts is, to the database, a યુવક. It is counted in "Total
-- registered". It moves the "Average remembered" figure. It occupies a place on the
-- leaderboard, above people who have actually been doing this for months. It is a row in the
-- progress report, the point ledger, the daily records and every Excel export a સંચાલક hands
-- to somebody who will make a decision with it.
--
-- So the numbers this panel exists to produce are wrong by however many people happened to be
-- testing that week, and nothing on any screen says so.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE FIX, AND WHY IT IS NOT A FILTER
-- ════════════════════════════════════════════════════════════════════════════
--
-- A test account must behave *exactly* like a real one - earn its points, pass its gates,
-- write its rows - or it tests nothing. What changes is not the account's behaviour but which
-- population the reports are allowed to count.
--
-- The obvious implementation is `and not is_test` added to each report. There are twenty-four
-- reporting functions in this schema across nine thousand lines, so that is twenty-four
-- chances to forget, and the twenty-fifth report written next year starts wrong. The failure
-- is silent in both directions: nobody notices a total that is four too high.
--
-- So the population gets a name:
--
--     public.counted_profiles   = profiles that count toward anything reported
--     public.yuvaks             = counted_profiles minus administrators, with the લેવલ ૪ gate
--     public.test_yuvaks        = the test accounts themselves, for the one screen that
--                                 exists to look at them
--
-- and the nine functions that enumerate a population read `counted_profiles` instead of
-- `profiles`. Those nine were not chosen by eye: `pg_get_functiondef` was searched for every
-- read of `public.profiles`, which found eighteen functions, and each was classified by
-- whether it enumerates a population or resolves one person. The nine that enumerate are
-- re-issued at the bottom of this file, generated from their live definitions with one token
-- changed each, so nothing else in eleven hundred lines could drift while being copied.
--
-- The other nine keep reading `public.profiles` deliberately, and that is the second half of
-- the design: `admin_user_progress_detail`, `admin_daily_record_detail`,
-- `admin_award_manual_points`, `actor_names` and the rest resolve a named individual. A test
-- account has to stay visible there, or a સંચાલક cannot open the account he is testing with
-- and confirm the points arrived - which is the entire reason it exists.
--
--     Hidden from:  every total, count, average, ranking, list and export.
--     Visible in:   its own detail page, its own app, and the Test accounts screen.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Marking is a privileged act
-- ════════════════════════════════════════════════════════════════════════════
--
-- Marking an account removes a person from every figure this panel reports. That is closer to
-- granting a role than to editing a field, so it is not covered by `users.update`: it needs
-- `users.test`, which only SUPER_ADMIN holds. An ADMIN who could quietly mark a real યુવક
-- could quietly delete him from every report while leaving him able to sign in - a
-- disappearance nobody would look for.
--
-- Re-applied as a set with 0031 onwards, so everything here is written to run twice.

-- ================================================================ the flag

alter table public.profiles
  add column if not exists is_test        boolean     not null default false,
  add column if not exists test_marked_at timestamptz,
  add column if not exists test_marked_by uuid references auth.users (id);

comment on column public.profiles.is_test is
  'This account exists to try the app. It behaves exactly like any other - it earns points and '
  'writes progress - but public.counted_profiles excludes it, so it appears in no total, '
  'ranking, list or export. Set only through a caller holding users.test (0040).';

-- Partial: the Test accounts screen asks "which are they", never "which are not". At a handful
-- of rows out of hundreds this is the difference between an index scan and reading the table.
create index if not exists profiles_is_test_idx on public.profiles (id) where is_test;

-- ================================================================ who may mark one

-- Two new permissions, and SUPER_ADMIN alone. Identical to the live matrix in every other
-- respect - shared/domain/permissions.js carries the same two, and scripts/test-admins.mjs
-- asserts the two agree.
create or replace function public.permissions_for(r public.admin_role)
returns text[]
language sql
immutable
as $$
  select case r
    when 'SUPER_ADMIN' then array[
      'users.read', 'users.update', 'users.disable',
      -- users.test  : mark an account as a test account, or return it to being a real one.
      -- users.purge : delete a test account and everything it produced. Only ever a test one.
      'users.test', 'users.purge',
      'progress.read', 'sessions.read',
      'darshan.read', 'darshan.create', 'darshan.update', 'darshan.disable',
      'settings.read', 'settings.update',
      'admins.read', 'admins.create', 'admins.update', 'admins.disable', 'roles.assign',
      'audit.read'
    ]
    when 'ADMIN' then array[
      'users.read', 'users.update', 'users.disable',
      'progress.read', 'sessions.read',
      'darshan.read', 'darshan.create', 'darshan.update', 'darshan.disable',
      'settings.read', 'settings.update',
      'admins.read',
      'audit.read'
    ]
    when 'CONTENT_MANAGER' then array[
      'darshan.read', 'darshan.create', 'darshan.update', 'darshan.disable',
      'settings.read'
    ]
    when 'COORDINATOR' then array[
      'users.read', 'progress.read', 'sessions.read', 'darshan.read'
    ]
    when 'VIEWER' then array[
      'users.read', 'progress.read', 'sessions.read', 'darshan.read', 'settings.read'
    ]
    else array[]::text[]
  end;
$$;

/*
  `profiles` already has an "own profile updatable" policy (`id = auth.uid()`), so without this
  every યુવક could mark himself as a test account and walk off the leaderboard with his points
  intact. `users.update` is not enough either - see the header.

  Written as a BEFORE trigger rather than a policy because a policy cannot see the *old* value:
  the rule is about the column changing, not about the row being writable, and every other
  write to the row has to keep working while this one column does not move.

  auth.uid() null - a migration, the seed script, service_role - passes through, exactly as
  profiles_guard_status() and admins_guard() do.
*/
create or replace function public.profiles_guard_test_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_test is distinct from old.is_test then
    if auth.uid() is not null and not public.has_permission('users.test') then
      -- Held rather than raised, matching profiles_guard_status(): the panel sends whole rows,
      -- and refusing the entire save because one field the person did not touch came back
      -- unchanged-but-present would block edits that are perfectly legitimate.
      new.is_test        := old.is_test;
      new.test_marked_at := old.test_marked_at;
      new.test_marked_by := old.test_marked_by;
      return new;
    end if;

    -- Stamped here and not by the caller, so the trail says who did it rather than who said
    -- they did. NULL on the way back to being a real account: the fields describe a mark that
    -- is currently set, not a history, and audit_logs already holds the history.
    if new.is_test then
      new.test_marked_at := now();
      new.test_marked_by := auth.uid();
    else
      new.test_marked_at := null;
      new.test_marked_by := null;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.profiles_guard_test_flag() is
  'Holds profiles.is_test unless the caller holds users.test, and stamps who marked it. '
  'Without it the "own profile updatable" policy would let any યુવક remove himself from every '
  'report and every ranking while keeping his points (0040).';

drop trigger if exists profiles_guard_test_flag on public.profiles;

create trigger profiles_guard_test_flag
  before update on public.profiles
  for each row execute function public.profiles_guard_test_flag();

-- ================================================================ the populations

/*
  The one definition of "counts toward anything reported".

  Every column of `profiles`, so it can be substituted for the table without a single other
  line of a report changing - which is exactly how the nine functions at the bottom were
  patched, and why the patch could be verified token by token.

  security_invoker so a client reading it gets the same RLS it would get from the table.
  Inside the SECURITY DEFINER reports it is read as the owner, where RLS does not apply - the
  same as reading `profiles` did before, so no report gained or lost a row for any reason
  other than the test flag.
*/
create or replace view public.counted_profiles
  with (security_invoker = on)
as
  select * from public.profiles where not is_test;

comment on view public.counted_profiles is
  'Profiles that count toward a reported figure: everyone except test accounts (0040). Every '
  'function that enumerates a population reads this. A report that reads public.profiles '
  'directly is a bug - scripts/test-test-accounts.mjs fails the build for it.';

grant select on public.counted_profiles to authenticated;

-- 0038''s view, narrowed by one more term. It was profiles_level4 minus administrators; it is
-- now that minus test accounts as well, which is what makes the Users list, the dashboard
-- counts and every Excel export correct without one line of admin/src changing.
--
-- Filtered by id against counted_profiles rather than by a `v.is_test` column, and that is a
-- constraint rather than a preference: `profiles_level4` (0011) is `select p.*, …`, and a view
-- freezes the column list that `*` expanded to on the day it was created. It has no `is_test`
-- and will not grow one. Re-creating it to pick the column up would reorder `level4_gate_open`
-- behind the three columns added above, which `create or replace view` refuses outright, so the
-- fix would be a `drop … cascade` taking every dependent view with it - a great deal of blast
-- radius for a column this only needs to *test*, not to return.
create or replace view public.yuvaks
  with (security_invoker = on)
as
  select v.*
  from public.profiles_level4 v
  where v.id not in (select public.admin_account_ids())
    and v.id in (select c.id from public.counted_profiles c);

comment on view public.yuvaks is
  'The people learning: profiles_level4, minus anyone holding a public.admins row (0038), '
  'minus test accounts (0040). What the Users list, the counts, the exports and the reports '
  'mean by "યુવક". Read profiles only when you mean every account that exists.';

-- The other side of the same coin, and the only place a test account is listed rather than
-- hidden. Same columns as `yuvaks` so the panel can render both through one table component.
create or replace view public.test_yuvaks
  with (security_invoker = on)
as
  select v.*
  from public.profiles_level4 v
  where v.id in (select p.id from public.profiles p where p.is_test);

comment on view public.test_yuvaks is
  'Test accounts, for the one screen that exists to look at them. Reading it still requires '
  'users.read through the underlying profiles policy; it is not a way around anything.';

grant select on public.test_yuvaks to authenticated;

-- ================================================================ purging one

/*
  Deleting a person is not something this schema does. §7 is "suspend, never delete", and
  `admins_no_delete()` enforces the same for administrators - the history has to stay attached
  to somebody.

  A test account is the one case where that reasoning does not apply, because there is no
  person and the history is noise that was manufactured on purpose. So it may be deleted, and
  the guards are on *what* may be deleted rather than on whether deletion happens:

    · the caller must hold `users.purge`, which is SUPER_ADMIN only;
    · the row must already be marked `is_test`. A real યુવક cannot be purged by this function
      at all, not by a SUPER_ADMIN, not by anybody - the only route is to mark him as a test
      account first, which is itself audited and requires the same person to state that a real
      person is a test account.

  What goes: the profile, and by cascade every progress row, point transaction, daily record,
  attempt and revision behind it. What stays: the audit trail, which is written here before the
  delete and whose actor_id points at auth.users rather than at the profile (0038).

  The auth.users row is NOT deleted here. It belongs to GoTrue, which owns its own schema, and
  reaching across to delete from it inside an application function is the kind of thing that
  works on one project and raises `permission denied` on the next. netlify/functions/
  purge-test-account.js finishes the job with the admin API, exactly as create-admin.js creates
  it - see its note.
*/
create or replace function public.admin_purge_test_account(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  victim   public.profiles%rowtype;
  n_points integer;
  n_days   integer;
begin
  if not public.has_permission('users.purge') then
    raise exception 'not permitted to purge accounts' using errcode = '42501';
  end if;

  select * into victim from public.profiles where id = p_user;
  if not found then
    raise exception 'no such account' using errcode = 'P0002';
  end if;

  -- The whole safety property of this function is this one branch.
  if not victim.is_test then
    raise exception 'only a test account may be purged - mark it as one first'
      using errcode = 'P0001';
  end if;

  select count(*) into n_points from public.point_transactions where user_id = p_user;
  select count(*) into n_days   from public.daily_activity_records where user_id = p_user;

  -- Written before the delete, because after it there is nothing left to describe. Skipped
  -- when there is no caller (a migration or the secret key), like every audit trigger here:
  -- audit_logs.actor_id is NOT NULL.
  if auth.uid() is not null then
    insert into public.audit_logs (actor_id, actor_role, action, resource_type, target_id, "before")
    values (
      auth.uid(), public.effective_role()::text, 'TEST_ACCOUNT_PURGED', 'profiles',
      p_user::text,
      to_jsonb(victim) || jsonb_build_object('purged_points', n_points, 'purged_days', n_days)
    );
  end if;

  delete from public.profiles where id = p_user;

  return jsonb_build_object(
    'id', p_user,
    'name', victim.name,
    'email', victim.email,
    'points_removed', n_points,
    'days_removed', n_days
  );
end;
$$;

revoke all on function public.admin_purge_test_account(uuid) from public;
grant execute on function public.admin_purge_test_account(uuid) to authenticated;

comment on function public.admin_purge_test_account(uuid) is
  'Delete a test account and everything it produced. Requires users.purge AND profiles.is_test '
  '- a real યુવક can never be reached by it. Audits before deleting. The auth.users row is '
  'left to netlify/functions/purge-test-account.js (0040).';

-- ================================================================ the nine reports
--
-- Everything below is generated, and deliberately so. Each function is its live definition
-- with `public.profiles p` - the alias every one of them uses for the population it walks -
-- replaced by `public.counted_profiles p`, and nothing else. The generator asserted the exact
-- number of matches per function before writing a line (1 each, except
-- admin_progress_filter_options with 3 and admin_progress_summary with 2), so a body that had
-- changed shape would have aborted rather than been half-patched.
--
-- The `ap` alias - the administrator's name on a ledger row or an audit entry - is left
-- pointing at `public.profiles` on purpose, in the two functions that resolve it. It answers
-- "who did this", not "who counts".
-- admin_daily_activity: population read swapped, 135 lines, nothing else touched.
CREATE OR REPLACE FUNCTION public.admin_daily_activity(p_date date, p_city text DEFAULT NULL::text, p_zone text DEFAULT NULL::text, p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    from public.counted_profiles p
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
$function$
;

-- admin_daily_records: population read swapped, 94 lines, nothing else touched.
CREATE OR REPLACE FUNCTION public.admin_daily_records(p_search text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_zone text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_min_points integer DEFAULT NULL::integer, p_min_level1 integer DEFAULT NULL::integer, p_min_level2 integer DEFAULT NULL::integer, p_min_level3 integer DEFAULT NULL::integer, p_min_level4 integer DEFAULT NULL::integer, p_page integer DEFAULT 0, p_page_size integer DEFAULT 50)
 RETURNS TABLE(total_rows bigint, user_id uuid, name text, smk text, city_id text, zone_id text, record_date date, level1_reported integer, level1_recorded integer, level2_reported integer, level2_recorded integer, level3_reported integer, level3_recorded integer, level4_reported integer, level4_recorded integer, reported_total integer, recorded_total integer, base_points integer, bonus_points integer, total_points integer, first_submitted_at timestamp with time zone, last_updated_at timestamp with time zone, edit_until timestamp with time zone, locked_at timestamp with time zone, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    join public.counted_profiles p on p.id = r.user_id
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
$function$
;

-- admin_leaderboard: population read swapped, 63 lines, nothing else touched.
CREATE OR REPLACE FUNCTION public.admin_leaderboard(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_city text DEFAULT NULL::text, p_zone text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    join public.counted_profiles p on p.id = e.user_id and p.status = 'ACTIVE'
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
$function$
;

-- leaderboard: population read swapped, 171 lines, nothing else touched.
CREATE OR REPLACE FUNCTION public.leaderboard(p_period text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid    uuid := auth.uid();
  cfg    record;
  want   text;
  bound  date;
  list   jsonb;
  mine   jsonb;
  people integer;
begin
  -- 0. Who is asking, and whether he is entitled to ask anything at all.
  --
  --    `is_active_user()` is asked here rather than left to a policy because this function is
  --    SECURITY DEFINER and therefore not subject to RLS — the same sentence
  --    `activity_submit()` (0021) writes about writes, applied to a read. A SUSPENDED account
  --    can still sign in and read its own history (0004); this is what stops it reading the
  --    સંઘ. Bare identifiers, in the shape `level4_submit()` established, so the client maps
  --    them to Gujarati wording in one place instead of parsing prose out of a Postgres error.
  if uid is null then
    raise exception 'leaderboard_not_signed_in';
  end if;

  if not public.is_active_user() then
    raise exception 'leaderboard_not_active';
  end if;

  select * into cfg from public.leaderboard_settings();

  -- 1. A board that is off discloses nothing, and says so in the shape of a board.
  --
  --    Empty rather than an exception: a switched-off feature is not a failure, and a raise
  --    here would put an error toast in front of a યુવક over a decision his સંચાલક made on
  --    purpose. `period` is the resolved default (which is 'ALL' when nothing is configured at
  --    all), so `normaliseLeaderboard()` still receives a valid period and the page still has
  --    a tab to draw itself around.
  if not cfg.enabled then
    return jsonb_build_object(
      'period', cfg.default_period,
      'rows', '[]'::jsonb,
      -- Cast, so the argument has a type before it reaches a variadic "any": an untyped NULL
      -- literal is resolved as text and this must be a JSON null, which is what
      -- `normaliseLeaderboard()` reads as "he has no ક્રમાંક here".
      'me', null::jsonb,
      'participants', 0
    );
  end if;

  -- 2. Which window, and it is the સંચાલક's list that decides.
  --
  --    A caller asking for a window that is not offered — a stale tab, an older build, a curl
  --    trying `ALL` on a project that only publishes `DAY` — gets the **default**, never an
  --    error and never the window he asked for. Erroring would make an ordinary version skew
  --    look like a broken page; honouring it would make the સંચાલક's choice of windows
  --    advisory, which is the one thing it is not. `p_period` null (an argument-less call)
  --    lands in the same branch: `null = any(...)` is null, which is not true.
  want := case when p_period = any (cfg.periods) then p_period else cfg.default_period end;

  -- 3. The lower bound, computed **in SQL, in IST, from the server's clock**, and never from
  --    the caller. There is no date parameter and there must not be one: a phone with its
  --    clock set to last month would otherwise be ranked against a different month than
  --    everybody else, and would be doing it through the one function in the schema that
  --    reads other people's rows. The same expression `activity_submit()` step 2,
  --    `level4_attempts_award()` and the 0021 views use — if the project ever leaves
  --    Asia/Kolkata, this is one of those places.
  --
  --    `WEEK` is the **calendar week**, Monday-start, which is what `date_trunc('week')`
  --    gives. A rolling "last seven days" was rejected: it moves the board's contents every
  --    midnight, so yesterday's ક્રમાંક cannot be reproduced today and two યુવકો comparing
  --    phones an hour apart are comparing different questions. આ અઠવાડિયે means the week, and
  --    a week that begins whenever you happen to look is not one.
  --
  --    `ALL` has no bound at all, which is a null here and a dropped predicate below.
  bound := case want
             when 'DAY'   then timezone('Asia/Kolkata', now())::date
             when 'WEEK'  then date_trunc('week',  timezone('Asia/Kolkata', now()))::date
             when 'MONTH' then date_trunc('month', timezone('Asia/Kolkata', now()))::date
             else null
           end;

  -- 4, 5 and 6 in one statement, because all three answers are properties of one ranking and
  --    computing the ranking twice is how `participants` and `me` begin to disagree.
  with earned as (
    -- The ledger is the source, summed over the window. `activity_date` is the IST business
    -- day the award belongs to and not `created_at`, so a submission at ૨૩:૫૯ that committed
    -- after midnight is counted in the day it was earned — the ledger already decided that
    -- question in 0021 and this must not answer it a second way.
    --
    -- `having sum(points) > 0` is narrowing rule 2 and is not an optimisation: it is what
    -- keeps this a ranking rather than a directory. A યુવક with no rows in the window is
    -- already absent — `group by` produces nothing for him — and one whose window sums to
    -- zero is removed here, so the two ways of having earned nothing are treated alike.
    select t.user_id, sum(t.points)::bigint as total
    from public.point_transactions t
    where bound is null or t.activity_date >= bound
    group by t.user_id
    having sum(t.points) > 0
  ),
  ranked as (
    select
      e.user_id,
      p.name,
      e.total,
      -- Ties share a ક્રમાંક. `rank()` and never `row_number()`: two યુવકો on ૯૦૦ are both
      -- second, because telling one of them he is third for a reason no screen can explain is
      -- a statement about them that the data does not support.
      rank() over (order by e.total desc) as place,
      -- …and a separate, total order for PRINTING, so the same board renders the same way
      -- twice. `rank()` leaves tied rows in whatever order the plan produced them, which can
      -- change between two calls a second apart and would shuffle the middle of the list under
      -- a યુવક's thumb. Name breaks the tie; `user_id` breaks a tie between two identical
      -- names on identical totals and is used **only** as a sort key — it is never selected,
      -- never aggregated into the document, and never leaves this function.
      row_number() over (order by e.total desc, p.name asc, e.user_id asc) as ord
    from earned e
    -- INNER, and the `status` filter is narrowing rule 4. Because the join happens BEFORE the
    -- window functions, a SUSPENDED યુવક does not occupy a ક્રમાંક either — the board reads
    -- ૧, ૨, ૩ with no gap where he was, rather than announcing by omission that somebody was
    -- removed.
    join public.counted_profiles p on p.id = e.user_id and p.status = 'ACTIVE'
  )
  select
    -- Narrowing rule 1, and this is the object that must never grow a fifth key. `top_n` cuts
    -- on `ord` rather than on `place`, so exactly N rows come back even when the Nth and the
    -- (N+1)th are tied; the alternative — cutting on rank — makes the length of the board a
    -- function of the data, and a page that sometimes returns 137 rows on a limit of 100 is
    -- not bounded at all.
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'rank',   r.place,
          'name',   r.name,
          'points', r.total,
          'isMe',   r.user_id = uid
        )
        order by r.ord
      ) filter (where r.ord <= cfg.top_n),
      '[]'::jsonb
    ),

    -- `me`, over the **whole** ranking rather than the slice above, so a યુવક standing 37th
    -- still learns where he stands. Null — a real JSON null — when he has no row in this
    -- ranking, which means he has earned nothing in this window. That is a different thing
    -- from being last and the page words it differently: there is no ક્રમાંક to report, and
    -- `normaliseLeaderboard()` passes the null through untouched so it can say so.
    (
      select jsonb_build_object('rank', m.place, 'points', m.total)
      from ranked m
      where m.user_id = uid
    ),

    -- How many are on the board at all, which is what makes "૩૭મો" mean something. A count,
    -- never a list: it is the one aggregate that says something about everybody while saying
    -- nothing about anybody.
    count(*)::integer
  into list, mine, people
  from ranked r;

  return jsonb_build_object(
    'period',       want,
    'rows',         list,
    'me',           mine,
    'participants', people
  );
end;
$function$
;

-- admin_level3_users: population read swapped, 127 lines, nothing else touched.
CREATE OR REPLACE FUNCTION public.admin_level3_users(p_search text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_zone text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_day date DEFAULT NULL::date, p_active boolean DEFAULT NULL::boolean, p_min_points integer DEFAULT NULL::integer, p_min_ticks integer DEFAULT NULL::integer, p_min_revs integer DEFAULT NULL::integer, p_sort text DEFAULT 'points'::text, p_dir text DEFAULT 'desc'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 20)
 RETURNS TABLE(total_rows bigint, user_id uuid, name text, smk text, city_id text, zone_id text, account_status text, revisions bigint, ticks bigint, scenes_distinct bigint, points bigint, days bigint, last_at timestamp with time zone, today_revisions bigint, today_ticks bigint, today_points bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  day_   date    := coalesce(p_day, timezone('Asia/Kolkata', now())::date);
  size_  integer := least(greatest(coalesce(p_page_size, 20), 1), 200);
  page_  integer := greatest(coalesce(p_page, 0), 0);
  sort_  text;
  dir_   text;
  needle text;
begin
  -- 0032's rule: guarded by a `perform`, never by a CTE. A permission test folded into a query
  -- can be optimised away or short-circuited; a statement of its own cannot.
  if not public.has_permission('progress.read') then
    raise exception 'level3_report_forbidden' using errcode = '42501';
  end if;

  -- Whitelisted, because `p_sort` reaches an ORDER BY. Anything unrecognised falls to the
  -- default rather than raising: a panel sending a column this function has not heard of should
  -- show a sensible page, not an error a સંચાલક cannot act on.
  sort_ := case lower(coalesce(p_sort, ''))
             when 'ticks'        then 'ticks'
             when 'revisions'    then 'revisions'
             when 'scenes'       then 'scenes_distinct'
             when 'days'         then 'days'
             when 'last'         then 'last_at'
             when 'today_points' then 'today_points'
             when 'today_ticks'  then 'today_ticks'
             when 'name'         then 'name'
             when 'smk'          then 'smk'
             else 'points'
           end;
  dir_   := case when lower(coalesce(p_dir, '')) = 'asc' then 'asc' else 'desc' end;
  needle := nullif(btrim(coalesce(p_search, '')), '');

  return query execute format($q$
    with att as (
      select a.*
      from public.activity_attempts a
      where a.level_id = 3
        and a.activity_key = 'revision'
        and ($4::date is null or a.activity_date >= $4)
        and ($5::date is null or a.activity_date <= $5)
    ),
    agg as (
      select
        att.user_id,
        count(*)                                              as revisions,
        sum(coalesce(cardinality(att.selected_scene_ids), 0)) as ticks,
        count(distinct att.activity_date)                     as days,
        max(att.submitted_at)                                 as last_at,
        count(*) filter (where att.activity_date = $6)        as today_revisions,
        coalesce(sum(coalesce(cardinality(att.selected_scene_ids), 0))
                 filter (where att.activity_date = $6), 0)    as today_ticks
      from att group by att.user_id
    ),
    sc as (
      select att.user_id, count(distinct s.scene_id) as scenes_distinct
      from att
      cross join lateral unnest(att.selected_scene_ids) as s(scene_id)
      where not (s.scene_id = any (public.admin_withheld_scene_ids()))
      group by att.user_id
    ),
    tx as (
      select t.user_id,
             sum(t.points)                                          as points,
             coalesce(sum(t.points) filter (where t.activity_date = $6), 0) as today_points
      from public.point_transactions t
      where t.level_id = 3
        and ($4::date is null or t.activity_date >= $4)
        and ($5::date is null or t.activity_date <= $5)
      group by t.user_id
    ),
    rows_ as (
      -- **LEFT JOIN from profiles**, which is what makes "did not do લેવલ ૩ today" answerable.
      select
        p.id                              as user_id,
        p.name, p.smk,
        p.zone_id                         as city_id,
        p.sub_zone_id                     as zone_id,
        p.status                          as account_status,
        coalesce(agg.revisions, 0)        as revisions,
        coalesce(agg.ticks, 0)            as ticks,
        coalesce(sc.scenes_distinct, 0)   as scenes_distinct,
        coalesce(tx.points, 0)            as points,
        coalesce(agg.days, 0)             as days,
        agg.last_at                       as last_at,
        coalesce(agg.today_revisions, 0)  as today_revisions,
        coalesce(agg.today_ticks, 0)      as today_ticks,
        coalesce(tx.today_points, 0)      as today_points
      from public.counted_profiles p
      left join agg on agg.user_id = p.id
      left join sc  on sc.user_id  = p.id
      left join tx  on tx.user_id  = p.id
      where ($1::text is null
             or p.name ilike '%%' || $1 || '%%'
             or p.smk  ilike '%%' || $1 || '%%'
             or coalesce(p.mobile, '') ilike '%%' || $1 || '%%')
        and ($2::text is null or p.zone_id = $2)
        and ($3::text is null or p.sub_zone_id = $3)
        and ($7::text is null or p.status = $7)
    ),
    kept as (
      select * from rows_ r
      where ($8::boolean is null
             or ($8 and r.today_revisions > 0)
             or (not $8 and r.today_revisions = 0))
        and ($9::integer  is null or r.points    >= $9)
        and ($10::integer is null or r.ticks     >= $10)
        and ($11::integer is null or r.revisions >= $11)
    )
    -- Parenthesised, so the cast applies to the window function's result and not to its empty
    -- OVER clause. `count(*)` is already bigint, so this is belt and braces against the day the
    -- expression is edited into something that is not.
    select (count(*) over ())::bigint, k.*
    from kept k
    order by %I %s nulls last, k.name asc
    limit $12 offset $13
  $q$, sort_, dir_)
  using needle, p_city, p_zone, p_from, p_to, day_, p_status,
        p_active, p_min_points, p_min_ticks, p_min_revs, size_, page_ * size_;
end;
$function$
;

-- admin_point_transactions: population read swapped, 89 lines, nothing else touched.
CREATE OR REPLACE FUNCTION public.admin_point_transactions(p_user uuid DEFAULT NULL::uuid, p_level integer DEFAULT NULL::integer, p_activity text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_min integer DEFAULT NULL::integer, p_max integer DEFAULT NULL::integer, p_kind text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 50)
 RETURNS TABLE(total_rows bigint, id bigint, user_id uuid, name text, smk text, city_id text, zone_id text, activity_date date, level_id integer, activity_key text, title text, points integer, source text, source_id bigint, attempt_number integer, award_kind text, rule_version integer, reason text, admin_name text, is_legacy boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  join public.counted_profiles p on p.id = f.user_id
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
$function$
;

-- admin_progress_filter_options: population reads swapped, 46 lines, nothing else touched.
CREATE OR REPLACE FUNCTION public.admin_progress_filter_options()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.admin_assert_progress_reader();

  return jsonb_build_object(
    'cities', coalesce((
      select jsonb_agg(jsonb_build_object('id', z.zone_id, 'count', z.n) order by z.n desc)
      from (
        select p.zone_id, count(*)::integer as n
        from public.counted_profiles p
        where coalesce(btrim(p.zone_id), '') <> ''
        group by p.zone_id
      ) z
    ), '[]'::jsonb),
    'zones', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', s.sub_zone_id, 'cityId', s.zone_id, 'count', s.n)
               order by s.n desc
             )
      from (
        select p.sub_zone_id, p.zone_id, count(*)::integer as n
        from public.counted_profiles p
        where coalesce(btrim(p.sub_zone_id), '') <> ''
        group by p.sub_zone_id, p.zone_id
      ) s
    ), '[]'::jsonb),
    'statuses', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.status, 'count', t.n) order by t.n desc)
      from (select p.status, count(*)::integer as n from public.counted_profiles p group by p.status) t
    ), '[]'::jsonb),
    'level4Total', coalesce((
      select count(*)::integer
      from public.level4_activities a
      join public.level4_configs c on c.id = a.config_id and c.status = 'PUBLISHED'
      where a.active
    ), 0),
    'contentTotal', public.admin_content_total()
  );
end;
$function$
;

-- admin_progress_report: population read swapped, 221 lines, nothing else touched.
CREATE OR REPLACE FUNCTION public.admin_progress_report(p_search text DEFAULT NULL::text, p_min_remembered integer DEFAULT NULL::integer, p_min_l4_passed integer DEFAULT NULL::integer, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_level integer DEFAULT NULL::integer, p_status text DEFAULT NULL::text, p_sort text DEFAULT 'remembered'::text, p_dir text DEFAULT 'desc'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 20, p_city text DEFAULT NULL::text, p_zone text DEFAULT NULL::text, p_min_l4_attempts integer DEFAULT NULL::integer, p_min_percentage numeric DEFAULT NULL::numeric, p_active_since date DEFAULT NULL::date, p_live_scene_ids text[] DEFAULT NULL::text[])
 RETURNS TABLE(total_rows bigint, user_id uuid, name text, mobile text, smk text, city_id text, zone_id text, account_status text, registered_at timestamp with time zone, level1_status text, level1_attempts integer, level2_status text, level2_attempts integer, level3_status text, level3_attempts integer, level3_last_at timestamp with time zone, remembered_count integer, remembered_l3 integer, remembered_l4 integer, content_total integer, remembered_pct numeric, gate_open boolean, level4_total integer, level4_unlocked integer, level4_completed integer, level4_passed integer, level4_revision integer, level4_attempts integer, level4_last_at timestamp with time zone, last_active_at timestamp with time zone, points_total bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  size  integer := least(greatest(coalesce(p_page_size, 20), 1), 200);
  skip  integer := greatest(coalesce(p_page, 0), 0) * size;
  term  text    := nullif(btrim(coalesce(p_search, '')), '');
  sort  text    := lower(coalesce(p_sort, 'remembered'));
  asc_  boolean := lower(coalesce(p_dir, 'desc')) = 'asc';
  -- The live collection, or nothing. Empty is treated as absent: a panel that failed to
  -- load the manifest must fall back, not report every યુવક at zero.
  live  text[]  := case
                     when p_live_scene_ids is null then null
                     when cardinality(p_live_scene_ids) = 0 then null
                     else p_live_scene_ids
                   end;
  content_n integer := coalesce(cardinality(live), public.admin_content_total());
begin
  perform public.admin_assert_progress_reader();

  return query
  with
    cfg as (select c.id from public.level4_configs c where c.status = 'PUBLISHED' limit 1),
    l4_total as (
      select count(*)::integer as n
      from public.level4_activities a join cfg on cfg.id = a.config_id
      where a.active
    ),
    -- Membership test. With a live list the intersection is exact; without one we fall back
    -- to 0029's rule, which can only remove દ્રશ્યો Postgres knows were withheld.
    gone as (select public.admin_withheld_scene_ids() as ids),
    base as (
      select p.id, p.name, p.mobile, p.smk, p.zone_id, p.sub_zone_id, p.status,
             p.created_at, p.gate_passed_at
      from public.counted_profiles p
      where (p_status is null or p.status = p_status)
        and (p_city   is null or p.zone_id = p_city)
        and (p_zone   is null or p.sub_zone_id = p_zone)
        and (
          term is null
          or p.name   ilike '%' || term || '%'
          or p.mobile ilike '%' || term || '%'
          or p.email  ilike '%' || term || '%'
          or coalesce(p.smk, '') ilike '%' || term || '%'
        )
    ),
    l123 as (
      select a.user_id,
             count(*) filter (where a.level_id = 1)::integer as l1_attempts,
             count(*) filter (where a.level_id = 2)::integer as l2_attempts,
             count(*) filter (where a.level_id = 3)::integer as l3_attempts,
             bool_or(a.level_id = 1 and a.status = 'COMPLETED') as l1_done,
             bool_or(a.level_id = 2 and a.status = 'COMPLETED') as l2_done,
             bool_or(a.level_id = 3 and a.status = 'COMPLETED') as l3_done,
             max(a.submitted_at) filter (where a.level_id = 3) as l3_last,
             max(a.submitted_at)                               as any_last
      from public.activity_attempts a
      where (p_from is null or a.activity_date >= p_from)
        and (p_to   is null or a.activity_date <= p_to)
      group by a.user_id
    ),
    l3_ids as (
      select a.user_id, s.scene_id
      from public.activity_attempts a
      cross join lateral unnest(a.selected_scene_ids) as s(scene_id)
      cross join gone
      where a.level_id = 3
        and (case when live is null then not (s.scene_id = any(gone.ids))
                  else s.scene_id = any(live) end)
        and (p_from is null or a.activity_date >= p_from)
        and (p_to   is null or a.activity_date <= p_to)
      group by a.user_id, s.scene_id
    ),
    l4_ids as (
      select la.user_id, s.scene_id
      from public.level4_attempts la
      cross join lateral unnest(la.selected_scene_ids) as s(scene_id)
      cross join gone
      where (case when live is null then not (s.scene_id = any(gone.ids))
                  else s.scene_id = any(live) end)
        and (p_from is null or timezone('Asia/Kolkata', la.at)::date >= p_from)
        and (p_to   is null or timezone('Asia/Kolkata', la.at)::date <= p_to)
      group by la.user_id, s.scene_id
    ),
    remembered as (
      select coalesce(a.user_id, b.user_id) as user_id,
             count(*)::integer                                      as total,
             count(*) filter (where a.user_id is not null)::integer as from_l3,
             count(*) filter (where b.user_id is not null)::integer as from_l4
      from l3_ids a
      full outer join l4_ids b on b.user_id = a.user_id and b.scene_id = a.scene_id
      group by coalesce(a.user_id, b.user_id)
    ),
    l4_att as (
      select la.user_id,
             count(*)::integer                                                as attempts,
             count(distinct la.activity_id) filter (where la.passed)::integer as passed,
             max(la.at)                                                       as last_at
      from public.level4_attempts la
      where (p_from is null or timezone('Asia/Kolkata', la.at)::date >= p_from)
        and (p_to   is null or timezone('Asia/Kolkata', la.at)::date <= p_to)
      group by la.user_id
    ),
    points as (
      select t.user_id, sum(t.points)::bigint as total
      from public.point_transactions t
      where (p_from is null or t.activity_date >= p_from)
        and (p_to   is null or t.activity_date <= p_to)
      group by t.user_id
    ),
    joined as (
      select
        b.id, b.name, b.mobile, b.smk, b.zone_id, b.sub_zone_id, b.status, b.created_at,
        case when b.gate_passed_at is not null or coalesce(l.l1_done, false)
             then 'COMPLETED' else 'NOT_STARTED' end                  as l1_status,
        coalesce(l.l1_attempts, 0)                                    as l1_attempts,
        case when coalesce(l.l2_done, false) then 'COMPLETED' else 'NOT_STARTED' end as l2_status,
        coalesce(l.l2_attempts, 0)                                    as l2_attempts,
        case when coalesce(l.l3_done, false) then 'COMPLETED' else 'NOT_STARTED' end as l3_status,
        coalesce(l.l3_attempts, 0)                                    as l3_attempts,
        l.l3_last,
        coalesce(r.total, 0)                                          as remembered,
        coalesce(r.from_l3, 0)                                        as remembered_l3,
        coalesce(r.from_l4, 0)                                        as remembered_l4,
        content_n                                                         as content_total,
        case when content_n > 0
             then round((coalesce(r.total, 0)::numeric * 100) / content_n, 2)
             else 0::numeric end                                      as pct,
        coalesce(t4.n, 0)                                             as l4_total,
        coalesce(la.passed, 0)                                        as l4_passed,
        coalesce(la.attempts, 0)                                      as l4_attempts,
        la.last_at                                                    as l4_last,
        greatest(l.any_last, la.last_at)                              as last_active,
        coalesce(pt.total, 0)                                         as points
      from base b
      cross join l4_total t4
      left join l123       l  on l.user_id  = b.id
      left join remembered r  on r.user_id  = b.id
      left join l4_att     la on la.user_id = b.id
      left join points     pt on pt.user_id = b.id
      where
        ((p_from is null and p_to is null) or l.user_id is not null or la.user_id is not null)
        and (p_min_remembered  is null or coalesce(r.total, 0)     >= p_min_remembered)
        and (p_min_l4_passed   is null or coalesce(la.passed, 0)   >= p_min_l4_passed)
        and (p_min_l4_attempts is null or coalesce(la.attempts, 0) >= p_min_l4_attempts)
        and (
          p_min_percentage is null
          or (content_n > 0 and (coalesce(r.total, 0)::numeric * 100) / content_n >= p_min_percentage)
        )
        and (
          p_active_since is null
          or greatest(l.any_last, la.last_at) >= p_active_since::timestamptz
        )
        and (
          p_level is null
          or (p_level = 1 and coalesce(l.l1_attempts, 0) > 0)
          or (p_level = 2 and coalesce(l.l2_attempts, 0) > 0)
          or (p_level = 3 and coalesce(l.l3_attempts, 0) > 0)
          or (p_level = 4 and coalesce(la.attempts, 0) > 0)
        )
    ),
    paged as (
      select j.*, count(*) over () as n
      from joined j
      order by
        case when asc_ then
          case sort
            when 'name'         then null
            when 'l4_passed'    then j.l4_passed::numeric
            when 'l4_attempts'  then j.l4_attempts::numeric
            when 'points'       then j.points::numeric
            when 'percentage'   then j.pct
            when 'registered'   then extract(epoch from j.created_at)
            when 'last_active'  then extract(epoch from j.last_active)
            else j.remembered::numeric
          end
        end asc nulls last,
        case when not asc_ then
          case sort
            when 'name'         then null
            when 'l4_passed'    then j.l4_passed::numeric
            when 'l4_attempts'  then j.l4_attempts::numeric
            when 'points'       then j.points::numeric
            when 'percentage'   then j.pct
            when 'registered'   then extract(epoch from j.created_at)
            when 'last_active'  then extract(epoch from j.last_active)
            else j.remembered::numeric
          end
        end desc nulls last,
        case when sort = 'name' and asc_ then j.name end asc nulls last,
        case when sort = 'name' and not asc_ then j.name end desc nulls last,
        j.id
      offset skip
      limit size
    )
  select
    p.n,
    p.id, p.name, p.mobile, p.smk, p.zone_id, p.sub_zone_id, p.status, p.created_at,
    p.l1_status, p.l1_attempts,
    p.l2_status, p.l2_attempts,
    p.l3_status, p.l3_attempts, p.l3_last,
    p.remembered, p.remembered_l3, p.remembered_l4, p.content_total, p.pct,
    public.level4_gate_open(p.id),
    p.l4_total,
    st.unlocked, st.completed, p.l4_passed, st.revision,
    p.l4_attempts, p.l4_last,
    p.last_active, p.points
  from paged p
  left join lateral (
    select
      count(*) filter (where s.status <> 'LOCKED')::integer           as unlocked,
      count(*) filter (where s.status = 'COMPLETED')::integer         as completed,
      count(*) filter (where s.status = 'REVISION_REQUIRED')::integer as revision
    from public.level4_activity_states(p.id, (select id from cfg)) s
  ) st on true;
end;
$function$
;

-- admin_progress_summary: population reads swapped, 138 lines, nothing else touched.
CREATE OR REPLACE FUNCTION public.admin_progress_summary(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_city text DEFAULT NULL::text, p_zone text DEFAULT NULL::text, p_live_scene_ids text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  live      text[]  := case
                         when p_live_scene_ids is null then null
                         when cardinality(p_live_scene_ids) = 0 then null
                         else p_live_scene_ids
                       end;
  content_n     integer := coalesce(cardinality(live), public.admin_content_total());
  today_ist date    := timezone('Asia/Kolkata', now())::date;
  result    jsonb;
begin
  perform public.admin_assert_progress_reader();

  with
    cfg as (select c.id from public.level4_configs c where c.status = 'PUBLISHED' limit 1),
    l4_total as (
      select count(*)::integer as n
      from public.level4_activities a join cfg on cfg.id = a.config_id where a.active
    ),
    gone as (select public.admin_withheld_scene_ids() as ids),
    pool as (
      select p.id
      from public.counted_profiles p
      where (p_city is null or p.zone_id = p_city)
        and (p_zone is null or p.sub_zone_id = p_zone)
    ),
    l123 as (
      select a.user_id,
             bool_or(a.level_id = 1 and a.status = 'COMPLETED') as l1,
             bool_or(a.level_id = 2 and a.status = 'COMPLETED') as l2,
             bool_or(a.level_id = 3 and a.status = 'COMPLETED') as l3
      from public.activity_attempts a
      where (p_from is null or a.activity_date >= p_from)
        and (p_to   is null or a.activity_date <= p_to)
      group by a.user_id
    ),
    ids as (
      select a.user_id, s.scene_id
      from public.activity_attempts a
      cross join lateral unnest(a.selected_scene_ids) as s(scene_id)
      cross join gone
      where a.level_id = 3
        and (case when live is null then not (s.scene_id = any(gone.ids))
                  else s.scene_id = any(live) end)
        and (p_from is null or a.activity_date >= p_from)
        and (p_to   is null or a.activity_date <= p_to)
      union
      select la.user_id, s.scene_id
      from public.level4_attempts la
      cross join lateral unnest(la.selected_scene_ids) as s(scene_id)
      cross join gone
      where (case when live is null then not (s.scene_id = any(gone.ids))
                  else s.scene_id = any(live) end)
        and (p_from is null or timezone('Asia/Kolkata', la.at)::date >= p_from)
        and (p_to   is null or timezone('Asia/Kolkata', la.at)::date <= p_to)
    ),
    remembered as (select user_id, count(*)::integer as n from ids group by user_id),
    l4 as (
      select la.user_id,
             count(distinct la.activity_id) filter (where la.passed)::integer as passed
      from public.level4_attempts la
      where (p_from is null or timezone('Asia/Kolkata', la.at)::date >= p_from)
        and (p_to   is null or timezone('Asia/Kolkata', la.at)::date <= p_to)
      group by la.user_id
    ),
    people as (
      select pool.id,
             coalesce(l.l1, false)  as l1,
             coalesce(l.l2, false)  as l2,
             coalesce(l.l3, false)  as l3,
             coalesce(r.n, 0)       as remembered,
             coalesce(l4.passed, 0) as passed
      from pool
      left join l123       l  on l.user_id  = pool.id
      left join remembered r  on r.user_id  = pool.id
      left join l4            on l4.user_id = pool.id
    )
  select jsonb_build_object(
    'contentTotal',    content_n,
    'contentSource',   case when live is null then 'server-estimate' else 'app-manifest' end,
    'level4Total',     (select n from l4_total),
    'totalUsers',      (select count(*) from pool),
    'activeUsers',     (select count(*) from public.counted_profiles p
                         join pool on pool.id = p.id where p.status = 'ACTIVE'),
    'activeToday',     (
                         select count(distinct u) from (
                           select a.user_id as u from public.activity_attempts a
                             join pool on pool.id = a.user_id
                            where a.activity_date = today_ist
                           union
                           select la.user_id from public.level4_attempts la
                             join pool on pool.id = la.user_id
                            where timezone('Asia/Kolkata', la.at)::date = today_ist
                         ) t
                       ),
    'level1Completed', (select count(*) from people where l1),
    'level2Completed', (select count(*) from people where l2),
    'level3Completed', (select count(*) from people where l3),
    'level4GateOpen',  (select count(*) from pool where public.level4_gate_open(pool.id)),
    'level4AnyPassed', (select count(*) from people where passed > 0),
    'level4AllPassed', (select count(*) from people
                         where (select n from l4_total) > 0
                           and passed >= (select n from l4_total)),
    -- The figure the whole brief turns on: how many have the entire collection.
    'fullyRemembered', (select count(*) from people where content_n > 0 and remembered >= content_n),
    'avgRemembered',   (select round(avg(remembered), 1) from people where remembered > 0),
    'participants',    (select count(*) from people where remembered > 0 or passed > 0),
    'buckets', (
      select jsonb_agg(b order by lo desc)
      from (
        select k.lo,
               jsonb_build_object(
                 'key', k.key, 'lo', k.lo, 'hi', k.hi,
                 'count', (select count(*) from people where remembered between k.lo and k.hi)
               ) as b
        from (
          values
            ('100%',  content_n,                            content_n),
            ('90+',   ceil(content_n * 0.90)::integer,      content_n - 1),
            ('75-89', ceil(content_n * 0.75)::integer,      ceil(content_n * 0.90)::integer - 1),
            ('50-74', ceil(content_n * 0.50)::integer,      ceil(content_n * 0.75)::integer - 1),
            ('25-49', ceil(content_n * 0.25)::integer,      ceil(content_n * 0.50)::integer - 1),
            ('1-24',  1,                                ceil(content_n * 0.25)::integer - 1)
        ) as k(key, lo, hi)
      ) bins
    )
  )
  into result;

  return result;
end;
$function$
;

-- ================================================================ say what happened

do $$
declare n_test integer; n_counted integer;
begin
  select count(*) into n_test from public.profiles where is_test;
  select count(*) into n_counted from public.counted_profiles;
  raise notice '[0040] % test account(s); % profiles now count toward reports.', n_test, n_counted;
  raise notice '[0040] Nine population functions re-issued against public.counted_profiles.';
end
$$;
