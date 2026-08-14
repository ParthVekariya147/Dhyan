-- વર્ણી ધ્યાન — the report counts what the યુવક can actually see today.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE DEFECT 0029 LEFT BEHIND
-- ════════════════════════════════════════════════════════════════════════════
--
-- 0029 counts "remembered" as the distinct union of submitted scene ids, minus anything
-- `public.scenes` says is withheld. That is right as far as Postgres can see, and it is
-- still not the same set the યુવક app calls the collection.
--
-- The collection is `content/darshan.json` — a file — overlaid by `public.scenes`, gated
-- twice (`isWithheld` then `isLearnable`) and sequenced by `withDisplayIndex()`. That whole
-- computation lives in shared/domain/darshan.js and runs in the browser, because the
-- database cannot read the manifest. 0029's `admin_content_total()` approximated the size
-- of that set from `max(activity_attempts.total_items)`; it approximated nothing about its
-- *membership*.
--
-- The gap is not theoretical and production shows it exactly. Four યુવકો each submitted 108
-- distinct દ્રશ્યો and each reads 107 of 108:
--
--     submitted 108  ·  darshan-111 among them, since withheld  ·  darshan-112 missing,
--                                                                  created after they
--                                                                  finished
--
-- They completed everything that existed when they did the work. The collection then moved:
-- one દ્રશ્ય was taken out, another was added. 107 / 108 is the true answer *against today's
-- collection*, and it is the same answer their own phone would give them — but 0029 arrived
-- at it by two independent approximations that happened to agree, and it could not say
-- which દ્રશ્ય was missing or why.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE FIX — the caller passes the collection in
-- ════════════════════════════════════════════════════════════════════════════
--
-- Every function below takes `p_live_scene_ids text[]`: the ids of the live collection, as
-- computed by the panel through **the same `shared/domain/darshan.js` functions the યુવક app
-- calls**. Not a second definition of the collection — the same one, evaluated where the
-- manifest is readable.
--
-- With it: remembered = |submitted ∩ live|, total = cardinality(live), and "which are
-- missing" becomes answerable. Without it (null), every function falls back to 0029's
-- behaviour, so an older panel build keeps working and simply keeps 0029's precision.
--
-- Trusting an argument from the client needs saying out loud. It is safe here for a reason
-- that does not generalise: the caller is already an authenticated સંચાલક holding
-- `progress.read` and `users.read`, the manifest is the same file for every build, and the
-- argument can only *narrow* what is counted — a forged list cannot invent a submission,
-- because the intersection is still taken against `activity_attempts` and `level4_attempts`,
-- which no client may write (0021:1424, 0010:1387). The worst a wrong list can do is make
-- the સંચાલક's own report disagree with his own app, which `admin_verify_user_progress()`
-- below exists to catch.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ALSO IN THIS MIGRATION
-- ════════════════════════════════════════════════════════════════════════════
--
--   * city and zone filters, from the fields registration already writes.
--     `profiles.zone_id` is the city ('surat') and `profiles.sub_zone_id` is the મંડળ
--     ('varachha', 'vedroad', 'navsari') — ZONES and SUBZONES in shared/domain/constants.js.
--     No new column, and no second copy of either.
--   * `admin_progress_filter_options()` so the filter lists are built from the values that
--     are really in the table rather than from a hardcoded list that drifts.
--   * percentage, last-active and લેવલ ૪ attempt filters, and the sorts to match.
--   * `admin_verify_user_progress()` — the reconciliation tool: for one યુવક, what he
--     submitted, what survived each gate, and exactly which દ્રશ્યો are missing and why.
--   * per-દ્રશ્ય detail on the user document, with the date each was first and last ticked.
--
-- Nothing about the યુવક flow, the unlock rules, the કસોટી rules or the points is touched.
-- This migration adds and replaces read-only reporting functions and nothing else.

-- The old signatures must go before the new ones land: `create or replace` with a different
-- argument list creates an *overload*, and two candidates that differ only by trailing
-- defaults are ambiguous to the resolver rather than replaced.
drop function if exists public.admin_progress_report(
  text, integer, integer, date, date, integer, text, text, text, integer, integer
);
drop function if exists public.admin_progress_summary(date, date);
drop function if exists public.admin_user_progress_detail(uuid);

-- ================================================================ filter options

-- The values the filters actually offer, read from the rows that exist.
--
-- Dynamic and not a constant list, because `shared/domain/constants.js` names three મંડળ and
-- production uses two; a filter offering an option that can never match is a filter that
-- teaches the સંચાલક to distrust it. Counts ride along so the panel can show "Varachha (88)"
-- and so an empty city is visibly empty rather than absent.
create or replace function public.admin_progress_filter_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_progress_reader();

  return jsonb_build_object(
    'cities', coalesce((
      select jsonb_agg(jsonb_build_object('id', z.zone_id, 'count', z.n) order by z.n desc)
      from (
        select p.zone_id, count(*)::integer as n
        from public.profiles p
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
        from public.profiles p
        where coalesce(btrim(p.sub_zone_id), '') <> ''
        group by p.sub_zone_id, p.zone_id
      ) s
    ), '[]'::jsonb),
    'statuses', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.status, 'count', t.n) order by t.n desc)
      from (select p.status, count(*)::integer as n from public.profiles p group by p.status) t
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
$$;

revoke all on function public.admin_progress_filter_options() from public;

comment on function public.admin_progress_filter_options() is
  'City (profiles.zone_id), મંડળ (profiles.sub_zone_id) and account-status values that are '
  'really present, with counts, so the filter lists cannot offer an option nothing matches.';

-- ================================================================ the report

create or replace function public.admin_progress_report(
  p_search          text    default null,
  p_min_remembered  integer default null,
  p_min_l4_passed   integer default null,
  p_from            date    default null,
  p_to              date    default null,
  p_level           integer default null,
  p_status          text    default null,
  p_sort            text    default 'remembered',
  p_dir             text    default 'desc',
  p_page            integer default 0,
  p_page_size       integer default 20,
  p_city            text    default null,
  p_zone            text    default null,
  p_min_l4_attempts integer default null,
  p_min_percentage  numeric default null,
  p_active_since    date    default null,
  p_live_scene_ids  text[]  default null
)
returns table (
  total_rows        bigint,
  user_id           uuid,
  name              text,
  mobile            text,
  smk               text,
  city_id           text,
  zone_id           text,
  account_status    text,
  registered_at     timestamptz,
  level1_status     text,
  level1_attempts   integer,
  level2_status     text,
  level2_attempts   integer,
  level3_status     text,
  level3_attempts   integer,
  level3_last_at    timestamptz,
  remembered_count  integer,
  remembered_l3     integer,
  remembered_l4     integer,
  content_total     integer,
  remembered_pct    numeric,
  gate_open         boolean,
  level4_total      integer,
  level4_unlocked   integer,
  level4_completed  integer,
  level4_passed     integer,
  level4_revision   integer,
  level4_attempts   integer,
  level4_last_at    timestamptz,
  last_active_at    timestamptz,
  points_total      bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
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
      from public.profiles p
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
$$;

revoke all on function public.admin_progress_report(
  text, integer, integer, date, date, integer, text, text, text, integer, integer,
  text, text, integer, numeric, date, text[]
) from public;

comment on function public.admin_progress_report(
  text, integer, integer, date, date, integer, text, text, text, integer, integer,
  text, text, integer, numeric, date, text[]
) is
  'One row per યુવક with લેવલ ૧–૪ progress, filtered, sorted and paginated by the server. '
  'p_live_scene_ids carries the collection as the યુવક app computes it, so remembered is an '
  'intersection with what he can actually see today rather than an approximation; null '
  'falls back to 0029 behaviour. p_city is profiles.zone_id, p_zone is sub_zone_id.';

-- ================================================================ the summary

create or replace function public.admin_progress_summary(
  p_from           date   default null,
  p_to             date   default null,
  p_city           text   default null,
  p_zone           text   default null,
  p_live_scene_ids text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
      from public.profiles p
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
    'activeUsers',     (select count(*) from public.profiles p
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
$$;

revoke all on function public.admin_progress_summary(date, date, text, text, text[]) from public;

comment on function public.admin_progress_summary(date, date, text, text, text[]) is
  'સંચાલક dashboard cards and the remembered-count bins, in one scan, optionally narrowed to '
  'a city or મંડળ. fullyRemembered counts યુવકો holding the entire live collection.';

-- ================================================================ one યુવક, in full

create or replace function public.admin_user_progress_detail(
  p_user           uuid,
  p_live_scene_ids text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  live   text[] := case
                     when p_live_scene_ids is null then null
                     when cardinality(p_live_scene_ids) = 0 then null
                     else p_live_scene_ids
                   end;
  content_n  integer := coalesce(cardinality(live), public.admin_content_total());
  cfg_id uuid;
  result jsonb;
begin
  perform public.admin_assert_progress_reader();

  select c.id into cfg_id
  from public.level4_configs c where c.status = 'PUBLISHED' limit 1;

  with
    gone as (select public.admin_withheld_scene_ids() as ids),
    -- Every tick this યુવક has ever made, with when he made it. `first_at` / `last_at` are
    -- what turn a list of ids into "remembered on 3 Aug, last revised on 12 Aug".
    ticks as (
      select s.scene_id, min(a.submitted_at) as first_at, max(a.submitted_at) as last_at,
             count(*)::integer as times, 3 as level
      from public.activity_attempts a
      cross join lateral unnest(a.selected_scene_ids) as s(scene_id)
      where a.user_id = p_user and a.level_id = 3
      group by s.scene_id
      union all
      select s.scene_id, min(la.at), max(la.at), count(*)::integer, 4
      from public.level4_attempts la
      cross join lateral unnest(la.selected_scene_ids) as s(scene_id)
      where la.user_id = p_user
      group by s.scene_id
    ),
    merged as (
      select scene_id, min(first_at) as first_at, max(last_at) as last_at,
             sum(times)::integer as times,
             bool_or(level = 3) as from_l3, bool_or(level = 4) as from_l4
      from ticks group by scene_id
    ),
    kept as (
      select m.* from merged m cross join gone
      where case when live is null then not (m.scene_id = any(gone.ids))
                 else m.scene_id = any(live) end
    )
  select jsonb_build_object(
    'user', (
      select jsonb_build_object(
               'userId', p.id, 'name', p.name, 'mobile', p.mobile, 'email', p.email,
               'smk', p.smk, 'cityId', p.zone_id, 'zoneId', p.sub_zone_id,
               'status', p.status, 'registeredAt', p.created_at,
               'gatePassedAt', p.gate_passed_at, 'level4Unlocked', p.level4_unlocked
             )
      from public.profiles p where p.id = p_user
    ),
    'contentTotal',  content_n,
    'contentSource', case when live is null then 'server-estimate' else 'app-manifest' end,
    'gateOpen',      public.level4_gate_open(p_user),

    'level1', (
      select jsonb_build_object(
               'status', case when bool_or(a.status = 'COMPLETED') then 'COMPLETED' else 'NOT_STARTED' end,
               'attempts', count(*)::integer, 'lastAt', max(a.submitted_at),
               'completedAt', min(a.submitted_at) filter (where a.status = 'COMPLETED'))
      from public.activity_attempts a where a.user_id = p_user and a.level_id = 1
    ),
    'level2', (
      select jsonb_build_object(
               'status', case when bool_or(a.status = 'COMPLETED') then 'COMPLETED' else 'NOT_STARTED' end,
               'attempts', count(*)::integer, 'days', count(distinct a.activity_date)::integer,
               'lastAt', max(a.submitted_at),
               'completedAt', min(a.submitted_at) filter (where a.status = 'COMPLETED'))
      from public.activity_attempts a where a.user_id = p_user and a.level_id = 2
    ),
    'level3', (
      select jsonb_build_object(
               'status', case when bool_or(a.status = 'COMPLETED') then 'COMPLETED' else 'NOT_STARTED' end,
               'attempts', count(*)::integer, 'days', count(distinct a.activity_date)::integer,
               'best', coalesce(max(a.completed_items), 0),
               'latest', (select l.completed_items from public.activity_attempts l
                           where l.user_id = p_user and l.level_id = 3
                           order by l.submitted_at desc, l.id desc limit 1),
               'reportedTotal', coalesce(max(a.total_items), 0),
               'lastAt', max(a.submitted_at))
      from public.activity_attempts a where a.user_id = p_user and a.level_id = 3
    ),

    'remembered',          (select count(*)::integer from kept),
    'rememberedSceneIds',  (select coalesce(jsonb_agg(k.scene_id order by k.scene_id), '[]'::jsonb) from kept k),
    'rememberedFromLevel3',(select count(*)::integer from kept where from_l3),
    'rememberedFromLevel4',(select count(*)::integer from kept where from_l4),
    -- Per દ્રશ્ય, for the "view details" list the brief asks for. Ids only; the panel holds
    -- the number and the વર્ણન, because those live in the manifest.
    'sceneDetail', (
      select coalesce(jsonb_agg(
               jsonb_build_object('sceneId', k.scene_id, 'firstAt', k.first_at,
                                  'lastAt', k.last_at, 'times', k.times,
                                  'fromLevel3', k.from_l3, 'fromLevel4', k.from_l4)
               order by k.scene_id), '[]'::jsonb)
      from kept k
    ),

    'level4', jsonb_build_object(
      'configId', cfg_id,
      'total', coalesce((select count(*)::integer from public.level4_activities a
                          where a.config_id = cfg_id and a.active), 0),
      'attempts', coalesce((select count(*)::integer from public.level4_attempts la
                             where la.user_id = p_user), 0),
      'passed', coalesce((select count(distinct la.activity_id)::integer
                           from public.level4_attempts la
                           where la.user_id = p_user and la.passed), 0),
      'lastAt', (select max(la.at) from public.level4_attempts la where la.user_id = p_user),
      'activities', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'activityId', a.id, 'code', a.code, 'title', a.title,
                   'position', a.position, 'requiredCount', a.required_count,
                   'itemCount', (select count(*)::integer from public.level4_activity_items i
                                  where i.activity_id = a.id),
                   'status', st.status, 'attempts', st.attempt_count,
                   'revisionCount', st.revision_count, 'completedAt', st.completed_at,
                   'passedAttempts', (select count(*)::integer from public.level4_attempts la
                                       where la.user_id = p_user and la.activity_id = a.id and la.passed),
                   'bestSelected', (select max(la.selected_count) from public.level4_attempts la
                                     where la.user_id = p_user and la.activity_id = a.id),
                   'lastAttemptAt', (select max(la.at) from public.level4_attempts la
                                      where la.user_id = p_user and la.activity_id = a.id))
                 order by a.position)
        from public.level4_activity_states(p_user, cfg_id) st
        join public.level4_activities a on a.id = st.activity_id
      ), '[]'::jsonb)
    ),

    'points', jsonb_build_object(
      'total', coalesce((select sum(t.points)::bigint from public.point_transactions t
                          where t.user_id = p_user), 0),
      'lastAt', (select max(t.created_at) from public.point_transactions t where t.user_id = p_user))
  )
  into result;

  return result;
end;
$$;

revoke all on function public.admin_user_progress_detail(uuid, text[]) from public;

comment on function public.admin_user_progress_detail(uuid, text[]) is
  'One યુવક''s complete progress as a document, including per-દ્રશ્ય first and last tick and '
  'per-કસોટી status from level4_activity_states(). p_live_scene_ids narrows remembered to '
  'the collection the યુવક app currently shows.';

-- ================================================================ reconciliation

-- "Why does this યુવક read 107 of 108?"
--
-- The tool the brief asks for, and the answer to the question 0029 could not answer. It
-- takes the same live list the report takes and shows every step between what the યુવક
-- submitted and what the report prints:
--
--   submitted        distinct ids across લેવલ ૩ and લેવલ ૪, exactly as stored
--   counted          those that are in the live collection
--   withheld         submitted, but the સંચાલક has taken the દ્રશ્ય out
--   unknown          submitted, but not in the live collection and not withheld either —
--                    an id from a collection that no longer exists in this shape
--   missing          live દ્રશ્યો he has never ticked
--
-- `counted + withheld + unknown = submitted`, and `counted + missing = total`. Both
-- identities are returned so the panel can assert them rather than trust them.
create or replace function public.admin_verify_user_progress(
  p_user           uuid,
  p_live_scene_ids text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  live   text[] := case
                     when p_live_scene_ids is null then null
                     when cardinality(p_live_scene_ids) = 0 then null
                     else p_live_scene_ids
                   end;
  content_n  integer := coalesce(cardinality(live), public.admin_content_total());
  result jsonb;
begin
  perform public.admin_assert_progress_reader();

  with
    gone as (select public.admin_withheld_scene_ids() as ids),
    submitted as (
      select s.scene_id
      from public.activity_attempts a
      cross join lateral unnest(a.selected_scene_ids) as s(scene_id)
      where a.user_id = p_user and a.level_id = 3
      union
      select s.scene_id
      from public.level4_attempts la
      cross join lateral unnest(la.selected_scene_ids) as s(scene_id)
      where la.user_id = p_user
    ),
    classified as (
      -- `cross join gone` and not `= any((select ids from gone))`: that subquery yields one
      -- row holding a text[], so ANY compares a text against a set of *arrays* and Postgres
      -- refuses it outright. Joining the row in first gives ANY the array it wants.
      select sub.scene_id,
             case
               when live is not null and sub.scene_id = any(live)  then 'counted'
               when sub.scene_id = any(gone.ids)                   then 'withheld'
               when live is null                                   then 'counted'
               else 'unknown'
             end as kind
      from submitted sub
      cross join gone
    ),
    missing as (
      select l.scene_id
      from unnest(coalesce(live, '{}'::text[])) as l(scene_id)
      where not exists (select 1 from submitted s where s.scene_id = l.scene_id)
    )
  select jsonb_build_object(
    'userId',        p_user,
    'contentTotal',  content_n,
    'contentSource', case when live is null then 'server-estimate' else 'app-manifest' end,
    'submitted',     (select count(*)::integer from classified),
    'counted',       (select count(*)::integer from classified where kind = 'counted'),
    'withheldCount', (select count(*)::integer from classified where kind = 'withheld'),
    'unknownCount',  (select count(*)::integer from classified where kind = 'unknown'),
    'missingCount',  (select count(*)::integer from missing),
    'withheldIds',   (select coalesce(jsonb_agg(scene_id order by scene_id), '[]'::jsonb)
                       from classified where kind = 'withheld'),
    'unknownIds',    (select coalesce(jsonb_agg(scene_id order by scene_id), '[]'::jsonb)
                       from classified where kind = 'unknown'),
    'missingIds',    (select coalesce(jsonb_agg(scene_id order by scene_id), '[]'::jsonb)
                       from missing),
    -- The two identities the panel should assert rather than trust.
    'submittedBalances', (
      (select count(*) from classified where kind = 'counted')
      + (select count(*) from classified where kind = 'withheld')
      + (select count(*) from classified where kind = 'unknown')
    ) = (select count(*) from classified),
    'totalBalances', live is null or (
      (select count(*) from classified where kind = 'counted')
      + (select count(*) from missing)
    ) = content_n
  )
  into result;

  return result;
end;
$$;

revoke all on function public.admin_verify_user_progress(uuid, text[]) from public;

comment on function public.admin_verify_user_progress(uuid, text[]) is
  'Reconciliation: what one યુવક submitted, what survived each gate, and exactly which '
  'દ્રશ્યો are withheld, unknown or never ticked - so a disagreement between the app and the '
  'report can be explained rather than argued about.';

-- ================================================================ grants

grant execute on function public.admin_progress_filter_options() to authenticated;
grant execute on function public.admin_progress_report(
  text, integer, integer, date, date, integer, text, text, text, integer, integer,
  text, text, integer, numeric, date, text[]
) to authenticated;
grant execute on function public.admin_progress_summary(date, date, text, text, text[]) to authenticated;
grant execute on function public.admin_user_progress_detail(uuid, text[]) to authenticated;
grant execute on function public.admin_verify_user_progress(uuid, text[]) to authenticated;

-- ================================================================ indexes

-- City and મંડળ are now WHERE clauses on every report. `profiles` is small and this is a
-- composite covering both the common "one મંડળ" filter and the rarer "one city", with
-- `status` trailing because it is nearly always ACTIVE and so a poor leading column.
create index if not exists profiles_zone_idx
  on public.profiles (zone_id, sub_zone_id, status);
