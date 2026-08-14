-- વર્ણી ધ્યાન — the સંચાલક reads the progress the યુવકો are actually making.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE DEFECT
-- ════════════════════════════════════════════════════════════════════════════
--
-- There are two progress systems in this project and the panel reads the wrong one.
--
-- The first shipped in 0001: `learning_state` and `learning_sessions`, written from the
-- browser by src/lib/learning.jsx and reached through the `/learn` route. Nothing links to
-- that route any more. In production both tables hold **zero rows**, and they have held zero
-- rows for as long as the current levels have existed.
--
-- The second is what levels ૧–૪ actually write: `activity_attempts` and
-- `daily_activity_progress` (0021), `level4_attempts` and `level4_activity_progress` (0010,
-- 0025), `progress`, and `point_transactions`. Those tables are full.
--
-- Every progress screen in the panel — the `/progress` table, the "remembered" stat on a
-- યુવક's detail page, both reports — queries the first pair. So a project with ૮૯ યુવકો,
-- ૫૩ લેવલ ૧–૩ submissions and ૧૯ લેવલ ૪ કસોટીઓ renders as an empty table, and
-- ProgressPage.jsx tells the સંચાલક in prose that no score is being saved yet. The data was
-- never lost and no write path is broken. The panel simply never asks.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION ADDS
-- ════════════════════════════════════════════════════════════════════════════
--
-- Three read-only, admin-gated functions over the tables that already hold the answers. No
-- table is created, no row is written, no existing function is altered, and no business rule
-- is restated — `level4_activity_states()` (0012) stays the single authority on what is
-- LOCKED, and this file calls it rather than re-deriving it.
--
--   admin_progress_report()         one row per યુવક, filtered, sorted and paginated
--   admin_progress_summary()        the dashboard cards and the "how much is remembered" bins
--   admin_user_progress_detail()    one યુવક, in full, including per-કસોટી status
--
-- ── Why SECURITY DEFINER, when the RLS policies already allow this ──────────
--
-- A સંચાલક holding `progress.read` can already select every row of every table below: the
-- policies carry `or public.has_permission('progress.read')` (0004:602, 0010:1376, 0021:1411).
-- So this is not about reach. It is about **where the aggregation happens**.
--
-- "Show me the યુવકો who have passed at least ૨૦ કસોટીઓ" answered through PostgREST means
-- downloading every attempt of every યુવક into the browser and counting there. At ૫૦૦ યુવકો
-- that is the whole history on every page load, and the filter cannot reach the LIMIT — the
-- panel would have to fetch all of it to know which twenty rows to show. Counted here, the
-- server returns twenty rows.
--
-- These functions therefore check the permission themselves, on the first line, and raise
-- rather than return an empty set. That is the `level4_publish()` / `darshan_reorder()`
-- pattern (0010:915, 0012_darshan_reorder:109): a SECURITY DEFINER function that takes an
-- argument naming other people must state the check in its own body, because the policies
-- that would otherwise carry it do not apply to the owner it runs as.
--
-- They raise instead of returning nothing on purpose. An RLS refusal is an empty result
-- (errors.js:24), which a report is entitled to read as "nobody matched your filter". A
-- report that cannot tell "no yuvak has passed twenty" from "you may not ask" is a report
-- that will eventually be believed about the wrong one.
--
-- ── What "remembered" means here, and why not level3_score ──────────────────
--
-- `progress.level3_score` is the obvious column and it is the wrong one. It is upserted
-- straight from the browser (src/lib/progress.js:366) with no trigger and no guard — 0026
-- pinned `level4_score` against exactly this and deliberately left `level3_score` writable,
-- because un-ticking a mis-tick has to work. In production one profile carries
-- `level3_score = 110` against a collection of ૧૦૮. It is a number the phone chose.
--
-- The authoritative record is the scene ids on the attempts themselves —
-- `activity_attempts.selected_scene_ids` for લેવલ ૩ and `level4_attempts.selected_scene_ids`
-- for લેવલ ૪. Both tables revoke insert, update and delete from `authenticated` (0021:1424,
-- 0010:1387); the only writers are `activity_submit()` and `level4_submit()`. So a count of
-- the **distinct union** of those ids is a fact about what the યુવક submitted, not about
-- what his phone reported, and it is the definition used throughout this file.
--
-- The two halves are also returned separately, because they answer different questions: a
-- લેવલ ૩ id was recalled from the વર્ણન, a લેવલ ૪ id from the number alone.
--
-- ── The denominator is not in this database ────────────────────────────────
--
-- "૮૭ of ૧૦૮" needs the ૧૦૮, and Postgres cannot compute it. The collection is
-- `content/darshan.json` — a file, ૧૦૯ entries — with `public.scenes` as a *sparse* overlay
-- withholding some and adding others (0010:167). Today that resolves to ૧૦૮: ૧૦૯ manifest
-- entries, less darshan-083 and darshan-106 withheld, plus darshan-112 created in the panel.
-- Only the browser can evaluate it, through useScenes() (src/lib/useScenes.js:258).
--
-- `admin_content_total()` below is the server's best answer and is offered as a
-- cross-check, not as the truth: it reports the largest `total_items` any યુવક's recent
-- લેવલ ૩ attempt carried, which is the denominator the app itself used at submit time. It
-- reads ૧૦૮ today. The panel computes the live figure the same way the યુવક app does and
-- displays that; when the two disagree the panel says so rather than picking one.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT IS DELIBERATELY NOT HERE
-- ════════════════════════════════════════════════════════════════════════════
--
-- No per-image figure for લેવલ ૧ or લેવલ ૨. Neither records scene ids — every લેવલ ૧ and
-- લેવલ ૨ attempt in production carries an empty `selected_scene_ids` and `total_items = 0`,
-- because watching the વિડિયો and doing દર્શન are not per-દ્રશ્ય acts. The panel reports
-- those two levels as status and attempt counts, which is all that was ever recorded. A
-- "૮૭ / ૧૦૮ remembered at લેવલ ૨" would be an invention.
--
-- No new permission. `progress.read` and `users.read` already exist and already mean this;
-- LEVEL4.md §1 freezes the matrix.
--
-- No write path, no backfill, no migration of the dead tables. `learning_state` and
-- `learning_sessions` keep their rows, their policies and their emptiness.

-- ================================================================ the guard

-- The check every function below opens with.
--
-- Both permissions, because these functions return names and mobile numbers as well as
-- progress: `users.read` is what governs `public.profiles` (0004:591) and `progress.read` is
-- what governs everything else. A COORDINATOR and a VIEWER hold both. A CONTENT_MANAGER
-- holds neither and is refused here rather than shown an empty report.
create or replace function public.admin_assert_progress_reader()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_permission('progress.read') and public.has_permission('users.read')) then
    raise exception 'progress reporting requires progress.read and users.read'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.admin_assert_progress_reader() from public;

comment on function public.admin_assert_progress_reader() is
  'Raises 42501 unless the caller holds both progress.read and users.read. Opens every '
  'admin_* reporting function in 0028, which run as owner and so must state the check '
  'themselves rather than inherit it from a policy.';

-- ================================================================ the denominator

-- The server's cross-check on "of how many?".
--
-- Not the truth — the truth is a file the database cannot read (see the header). This is the
-- largest denominator a યુવક's own લેવલ ૩ attempt reported recently, which is what the app
-- computed from the manifest and the overlay at the moment he submitted.
--
-- Bounded to the last ૧૮૦ days so that a withheld દ્રશ્ય eventually stops being counted; a
-- lifetime max would remember ૧૦૯ forever. Falls back to the count of live overlay rows, and
-- then to zero, so a project with no submissions yet returns something honest rather than
-- null.
create or replace function public.admin_content_total()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select max(a.total_items)
      from public.activity_attempts a
      where a.level_id = 3
        and a.total_items > 0
        and a.activity_date >= (timezone('Asia/Kolkata', now())::date - 180)
    ),
    (
      select count(*)::integer
      from public.scenes s
      where s.active
        and coalesce(s.status, 'ACTIVE') in ('PUBLISHED', 'ACTIVE')
    ),
    0
  );
$$;

revoke all on function public.admin_content_total() from public;

comment on function public.admin_content_total() is
  'The server''s best estimate of the live દર્શન count — the largest total_items a લેવલ ૩ '
  'attempt reported in the last 180 days. A cross-check on the browser''s useScenes().total, '
  'which is authoritative because the manifest is a file Postgres cannot see.';

-- દ્રશ્યો the સંચાલક has taken out of the collection.
--
-- Needed because an attempt is a permanent record of what was ticked *that day*, and the
-- collection moves underneath it. In production one યુવક has ૧૧૦ distinct scene ids across
-- his attempts against a live collection of ૧૦૮ — three of them name દ્રશ્યો that have since
-- been withheld (darshan-083, darshan-106 and two panel-created rows). Counted naively he
-- reads ૧૧૦ / ૧૦૮, which is not a number a report is allowed to print.
--
-- The withholding test is `level4_effective_items()`'s (0010:277), and it is the whole of
-- what Postgres can check: a scene the સંચાલક withheld has a row saying so. A manifest id
-- that has vanished entirely cannot happen — ids are never removed from the manifest
-- (ORDERING.md §1) — so this closes the only gap that exists.
--
-- An array rather than a subquery in six places: `stable`, so it is evaluated once per
-- statement rather than once per row, and there is one definition to change.
create or replace function public.admin_withheld_scene_ids()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(s.id), '{}'::text[])
  from public.scenes s
  where not (s.active and coalesce(s.status, 'ACTIVE') in ('PUBLISHED', 'ACTIVE'));
$$;

revoke all on function public.admin_withheld_scene_ids() from public;

comment on function public.admin_withheld_scene_ids() is
  'દ્રશ્યો withheld by the સંચાલક, excluded from every remembered count so that an attempt '
  'naming a scene since removed cannot push a યુવક above the live total.';

-- ================================================================ the report

-- One row per યુવક, filtered and paginated by the server.
--
-- ── Shape ──────────────────────────────────────────────────────────────────
--
-- `total_rows` repeats the full filtered count on every row (`count(*) over ()`). One round
-- trip instead of two, and the pager needs the total to say "of ૪૭" — the panel's existing
-- fetch-one-extra-row idiom (activityService.js:157) answers "is there a next page?" and
-- cannot answer "how many in all", which a filtered report has to.
--
-- ── The date window ────────────────────────────────────────────────────────
--
-- `p_from` / `p_to` are IST dates, inclusive. When either is given every activity figure
-- below is restricted to that window and a યુવક with no activity inside it is dropped
-- entirely — "who remembered ૫૦+ દ્રશ્યો last week" is a question about last week. When both
-- are null every figure is lifetime. There is no third mode; a report whose columns silently
-- mixed windowed and lifetime numbers would be unreadable.
--
-- The three લેવલ ૪ *status* columns are the stated exception: unlocked, completed and
-- revision-required are read from `level4_activity_states()`, which has no notion of a date
-- and should not be given one. "Was this કસોટી complete during March" is not a question the
-- status of a કસોટી can answer — it is a fact about now, and 0012 made COMPLETED permanent
-- precisely so that it stops depending on when you ask. The windowed counterpart already
-- exists next to them: `level4_attempts` and `level4_passed` are attempt counts and do
-- honour the window.
--
-- ── Why the unlocked count is computed after the LIMIT ─────────────────────
--
-- `level4_activity_states()` is the only correct answer to "what is unlocked" — it carries
-- the ક્રમ rule, the gate, and the coverage credit, and 0012 fixed the branch order in it.
-- It is also a per-યુવક function with subqueries inside, so calling it for every profile in
-- order to sort or filter would be the N+1 this migration exists to avoid.
--
-- It is therefore joined **after** the page has been chosen: filtering and ordering use the
-- cheap aggregates, and only the twenty rows being returned pay for the exact status. The
-- filters do not offer "unlocked count" for exactly this reason.
create or replace function public.admin_progress_report(
  p_search         text    default null,
  p_min_remembered integer default null,
  p_min_l4_passed  integer default null,
  p_from           date    default null,
  p_to             date    default null,
  p_level          integer default null,
  p_status         text    default null,
  p_sort           text    default 'remembered',
  p_dir            text    default 'desc',
  p_page           integer default 0,
  p_page_size      integer default 20
)
returns table (
  total_rows        bigint,
  user_id           uuid,
  name              text,
  mobile            text,
  smk               text,
  sub_zone_id       text,
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
  reported_total    integer,
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
  size integer := least(greatest(coalesce(p_page_size, 20), 1), 200);
  skip integer := greatest(coalesce(p_page, 0), 0) * size;
  term text    := nullif(btrim(coalesce(p_search, '')), '');
  sort text    := lower(coalesce(p_sort, 'remembered'));
  asc_ boolean := lower(coalesce(p_dir, 'desc')) = 'asc';
begin
  perform public.admin_assert_progress_reader();

  return query
  with
    cfg as (
      select c.id
      from public.level4_configs c
      where c.status = 'PUBLISHED'
      limit 1
    ),
    l4_total as (
      select count(*)::integer as n
      from public.level4_activities a
      join cfg on cfg.id = a.config_id
      where a.active
    ),
    -- The population, before any activity is looked at. Search is matched here so that a
    -- yuvak who has done nothing yet is still findable by name.
    base as (
      select p.id, p.name, p.mobile, p.smk, p.sub_zone_id, p.status, p.created_at,
             p.gate_passed_at
      from public.profiles p
      where (p_status is null or p.status = p_status)
        and (
          term is null
          or p.name   ilike '%' || term || '%'
          or p.mobile ilike '%' || term || '%'
          or p.email  ilike '%' || term || '%'
          or coalesce(p.smk, '') ilike '%' || term || '%'
        )
    ),
    -- Levels ૧–૩, from the attempts table. `filter` rather than three scans.
    l123 as (
      select a.user_id,
             count(*) filter (where a.level_id = 1)::integer as l1_attempts,
             count(*) filter (where a.level_id = 2)::integer as l2_attempts,
             count(*) filter (where a.level_id = 3)::integer as l3_attempts,
             bool_or(a.level_id = 1 and a.status = 'COMPLETED')  as l1_done,
             bool_or(a.level_id = 2 and a.status = 'COMPLETED')  as l2_done,
             bool_or(a.level_id = 3 and a.status = 'COMPLETED')  as l3_done,
             max(a.submitted_at) filter (where a.level_id = 3)   as l3_last,
             max(a.submitted_at)                                 as any_last,
             max(a.total_items) filter (where a.level_id = 3)::integer as reported
      from public.activity_attempts a
      where (p_from is null or a.activity_date >= p_from)
        and (p_to   is null or a.activity_date <= p_to)
      group by a.user_id
    ),
    -- Withheld દ્રશ્યો, excluded from both halves below. See admin_withheld_scene_ids().
    gone as (select public.admin_withheld_scene_ids() as ids),
    -- The લેવલ ૩ half of "remembered": distinct scene ids ever submitted from the વર્ણન.
    l3_ids as (
      select a.user_id, s.scene_id
      from public.activity_attempts a
      cross join lateral unnest(a.selected_scene_ids) as s(scene_id)
      cross join gone
      where a.level_id = 3
        and not (s.scene_id = any(gone.ids))
        and (p_from is null or a.activity_date >= p_from)
        and (p_to   is null or a.activity_date <= p_to)
      group by a.user_id, s.scene_id
    ),
    -- The લેવલ ૪ half: distinct scene ids submitted from the number alone.
    l4_ids as (
      select la.user_id, s.scene_id
      from public.level4_attempts la
      cross join lateral unnest(la.selected_scene_ids) as s(scene_id)
      cross join gone
      where not (s.scene_id = any(gone.ids))
        and (p_from is null or timezone('Asia/Kolkata', la.at)::date >= p_from)
        and (p_to   is null or timezone('Asia/Kolkata', la.at)::date <= p_to)
      group by la.user_id, s.scene_id
    ),
    remembered as (
      select coalesce(a.user_id, b.user_id) as user_id,
             count(*)::integer                                  as total,
             count(*) filter (where a.user_id is not null)::integer as from_l3,
             count(*) filter (where b.user_id is not null)::integer as from_l4
      from l3_ids a
      full outer join l4_ids b
        on b.user_id = a.user_id and b.scene_id = a.scene_id
      group by coalesce(a.user_id, b.user_id)
    ),
    -- લેવલ ૪ attempts. `passed` is per attempt; the count that matters to a સંચાલક is how
    -- many distinct કસોટીઓ he has passed, so both are returned.
    l4_att as (
      select la.user_id,
             count(*)::integer                                          as attempts,
             count(distinct la.activity_id) filter (where la.passed)::integer as passed,
             max(la.at)                                                 as last_at
      from public.level4_attempts la
      where (p_from is null or timezone('Asia/Kolkata', la.at)::date >= p_from)
        and (p_to   is null or timezone('Asia/Kolkata', la.at)::date <= p_to)
      group by la.user_id
    ),
    -- NOTE: completed and revision-required are NOT computed here. See the select at the
    -- bottom — they come from level4_activity_states() with the unlocked count, because
    -- `level4_activity_progress.status` is only half the definition.
    --
    -- The other half is coverage credit: level4_completed_activity_ids() (0010:372) also
    -- treats a કસોટી as complete when its effective items are a subset of the દ્રશ્યો the
    -- યુવક has already covered, which is what stops a republished configuration restarting
    -- everybody. A count of explicit rows would therefore read lower here than the same
    -- યુવક's own screen and lower than this file's own detail function, and a report that
    -- disagrees with the app about who finished what is worse than no report.
    points as (
      select t.user_id, sum(t.points)::bigint as total
      from public.point_transactions t
      where (p_from is null or t.activity_date >= p_from)
        and (p_to   is null or t.activity_date <= p_to)
      group by t.user_id
    ),
    joined as (
      select
        b.id, b.name, b.mobile, b.smk, b.sub_zone_id, b.status, b.created_at,
        case when b.gate_passed_at is not null or coalesce(l.l1_done, false)
             then 'COMPLETED' else 'NOT_STARTED' end               as l1_status,
        coalesce(l.l1_attempts, 0)                                 as l1_attempts,
        case when coalesce(l.l2_done, false) then 'COMPLETED' else 'NOT_STARTED' end as l2_status,
        coalesce(l.l2_attempts, 0)                                 as l2_attempts,
        case when coalesce(l.l3_done, false) then 'COMPLETED' else 'NOT_STARTED' end as l3_status,
        coalesce(l.l3_attempts, 0)                                 as l3_attempts,
        l.l3_last,
        coalesce(r.total, 0)                                       as remembered,
        coalesce(r.from_l3, 0)                                     as remembered_l3,
        coalesce(r.from_l4, 0)                                     as remembered_l4,
        coalesce(l.reported, 0)                                    as reported,
        coalesce(t4.n, 0)                                          as l4_total,
        coalesce(la.passed, 0)                                     as l4_passed,
        coalesce(la.attempts, 0)                                   as l4_attempts,
        la.last_at                                                 as l4_last,
        greatest(l.any_last, la.last_at)                           as last_active,
        coalesce(pt.total, 0)                                      as points
      from base b
      cross join l4_total t4
      left join l123       l  on l.user_id  = b.id
      left join remembered r  on r.user_id  = b.id
      left join l4_att     la on la.user_id = b.id
      left join points     pt on pt.user_id = b.id
      where
        -- A date window is a question about that window: no activity in it, not in the report.
        ((p_from is null and p_to is null) or l.user_id is not null or la.user_id is not null)
        and (p_min_remembered is null or coalesce(r.total, 0)  >= p_min_remembered)
        and (p_min_l4_passed  is null or coalesce(la.passed, 0) >= p_min_l4_passed)
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
            when 'name'        then null
            when 'l4_passed'   then j.l4_passed::numeric
            when 'l4_attempts' then j.l4_attempts::numeric
            when 'points'      then j.points::numeric
            when 'last_active' then extract(epoch from j.last_active)
            else j.remembered::numeric
          end
        end asc nulls last,
        case when not asc_ then
          case sort
            when 'name'        then null
            when 'l4_passed'   then j.l4_passed::numeric
            when 'l4_attempts' then j.l4_attempts::numeric
            when 'points'      then j.points::numeric
            when 'last_active' then extract(epoch from j.last_active)
            else j.remembered::numeric
          end
        end desc nulls last,
        case when sort = 'name' and asc_ then j.name end asc nulls last,
        case when sort = 'name' and not asc_ then j.name end desc nulls last,
        -- A total order, so page 2 cannot repeat a row from page 1 (ORDERING.md §8).
        j.id
      offset skip
      limit size
    )
  select
    p.n,
    p.id, p.name, p.mobile, p.smk, p.sub_zone_id, p.status, p.created_at,
    p.l1_status, p.l1_attempts,
    p.l2_status, p.l2_attempts,
    p.l3_status, p.l3_attempts, p.l3_last,
    p.remembered, p.remembered_l3, p.remembered_l4, p.reported,
    -- Per-યુવક, and therefore evaluated only for the page being returned. See the header.
    -- One call answers all three: unlocked, completed and revision-required are three
    -- readings of the same status list, and level4_activity_states() is the authority on it.
    public.level4_gate_open(p.id),
    p.l4_total,
    st.unlocked, st.completed, p.l4_passed, st.revision,
    p.l4_attempts, p.l4_last,
    p.last_active, p.points
  from paged p
  left join lateral (
    select
      count(*) filter (where s.status <> 'LOCKED')::integer          as unlocked,
      count(*) filter (where s.status = 'COMPLETED')::integer        as completed,
      count(*) filter (where s.status = 'REVISION_REQUIRED')::integer as revision
    from public.level4_activity_states(p.id, (select id from cfg)) s
  ) st on true;
end;
$$;

revoke all on function public.admin_progress_report(
  text, integer, integer, date, date, integer, text, text, text, integer, integer
) from public;

comment on function public.admin_progress_report(
  text, integer, integer, date, date, integer, text, text, text, integer, integer
) is
  'One row per યુવક with લેવલ ૧–૪ progress, filtered, sorted and paginated by the server. '
  'Raises 42501 without progress.read and users.read. "remembered" is the distinct union of '
  'scene ids submitted at લેવલ ૩ and લેવલ ૪, never progress.level3_score, which the browser '
  'writes. The unlocked count comes from level4_activity_states() and is evaluated only for '
  'the page returned.';

-- ================================================================ the summary

-- The cards at the top of the report, and the bins behind "૧૦૮ માંથી કેટલું યાદ છે?".
--
-- One function and one scan rather than nine head-counts. The bins are returned as counts
-- with their bounds, so the panel can label them and turn a click into
-- `p_min_remembered` / a range without knowing how they were cut here.
--
-- Bin edges are percentages of the live total, not literals: at ૧૦૮ the top bin is ૯૭–૧૦૮,
-- and it stays the top bin when the collection changes. §62 forbids a hardcoded count and
-- this is why.
create or replace function public.admin_progress_summary(
  p_from date default null,
  p_to   date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  total_content integer;
  today_ist     date := timezone('Asia/Kolkata', now())::date;
  result        jsonb;
begin
  perform public.admin_assert_progress_reader();

  total_content := public.admin_content_total();

  with
    cfg as (select c.id from public.level4_configs c where c.status = 'PUBLISHED' limit 1),
    l4_total as (
      select count(*)::integer as n
      from public.level4_activities a join cfg on cfg.id = a.config_id
      where a.active
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
    gone as (select public.admin_withheld_scene_ids() as ids),
    ids as (
      select a.user_id, s.scene_id
      from public.activity_attempts a
      cross join lateral unnest(a.selected_scene_ids) as s(scene_id)
      cross join gone
      where a.level_id = 3
        and not (s.scene_id = any(gone.ids))
        and (p_from is null or a.activity_date >= p_from)
        and (p_to   is null or a.activity_date <= p_to)
      union
      select la.user_id, s.scene_id
      from public.level4_attempts la
      cross join lateral unnest(la.selected_scene_ids) as s(scene_id)
      cross join gone
      where not (s.scene_id = any(gone.ids))
        and (p_from is null or timezone('Asia/Kolkata', la.at)::date >= p_from)
        and (p_to   is null or timezone('Asia/Kolkata', la.at)::date <= p_to)
    ),
    remembered as (
      select user_id, count(*)::integer as n
      from ids
      group by user_id
    ),
    l4 as (
      select la.user_id, count(distinct la.activity_id) filter (where la.passed)::integer as passed
      from public.level4_attempts la
      where (p_from is null or timezone('Asia/Kolkata', la.at)::date >= p_from)
        and (p_to   is null or timezone('Asia/Kolkata', la.at)::date <= p_to)
      group by la.user_id
    ),
    people as (
      select p.id,
             coalesce(l.l1, false) as l1,
             coalesce(l.l2, false) as l2,
             coalesce(l.l3, false) as l3,
             coalesce(r.n, 0)      as remembered,
             coalesce(l4.passed, 0) as passed,
             p.level4_unlocked
      from public.profiles p
      left join l123       l  on l.user_id  = p.id
      left join remembered r  on r.user_id  = p.id
      left join l4            on l4.user_id = p.id
    )
  select jsonb_build_object(
    'totalContent',      total_content,
    'level4Total',       (select n from l4_total),
    'totalUsers',        (select count(*) from public.profiles),
    'activeUsers',       (select count(*) from public.profiles where status = 'ACTIVE'),
    'activeToday',       (
                           select count(distinct u) from (
                             select a.user_id as u from public.activity_attempts a
                              where a.activity_date = today_ist
                             union
                             select la.user_id from public.level4_attempts la
                              where timezone('Asia/Kolkata', la.at)::date = today_ist
                           ) t
                         ),
    'level1Completed',   (select count(*) from people where l1),
    'level2Completed',   (select count(*) from people where l2),
    'level3Completed',   (select count(*) from people where l3),
    'level4GateOpen',    (select count(*) from public.profiles p where public.level4_gate_open(p.id)),
    'level4AnyPassed',   (select count(*) from people where passed > 0),
    'level4AllPassed',   (select count(*) from people
                           where (select n from l4_total) > 0 and passed >= (select n from l4_total)),
    'avgRemembered',     (select round(avg(remembered), 1) from people where remembered > 0),
    'participants',      (select count(*) from people where remembered > 0 or passed > 0),
    -- Bins, widest first, each as a share of the live total. `hi` is inclusive.
    'buckets', (
      -- `order by k.lo`, the integer, and not `b->>'lo'`, which is that integer as text:
      -- '9' sorts after '81' and the bins would come back shuffled the moment the collection
      -- shrank far enough to put a one-digit bound next to a two-digit one.
      select jsonb_agg(b order by lo desc)
      from (
        select k.lo,
               jsonb_build_object(
                 'key',  k.key,
                 'lo',   k.lo,
                 'hi',   k.hi,
                 'count', (select count(*) from people where remembered between k.lo and k.hi)
               ) as b
        from (
          values
            ('90+',   ceil(total_content * 0.90)::integer, total_content),
            ('75-89', ceil(total_content * 0.75)::integer, ceil(total_content * 0.90)::integer - 1),
            ('50-74', ceil(total_content * 0.50)::integer, ceil(total_content * 0.75)::integer - 1),
            ('25-49', ceil(total_content * 0.25)::integer, ceil(total_content * 0.50)::integer - 1),
            ('1-24',  1,                                   ceil(total_content * 0.25)::integer - 1)
        ) as k(key, lo, hi)
      ) bins
    )
  )
  into result;

  return result;
end;
$$;

revoke all on function public.admin_progress_summary(date, date) from public;

comment on function public.admin_progress_summary(date, date) is
  'The સંચાલક dashboard cards and the remembered-count bins, in one scan. Bin edges are '
  'shares of admin_content_total(), never literals, so they follow the collection.';

-- ================================================================ one યુવક, in full

-- Everything the detail page shows about one person, as a single document.
--
-- jsonb rather than a rowset because the shape is genuinely nested — a યુવક has one લેવલ ૧
-- status and N કસોટીઓ — and returning it as columns would either flatten the કસોટીઓ into
-- the profile or make the panel issue a second call per section.
--
-- The per-કસોટી statuses come from `level4_activity_states()` unchanged. That function is
-- SECURITY DEFINER and revoked from everyone (0012:125) precisely because it names a યુવક;
-- calling it from inside a function that has already checked `progress.read` is how a
-- સંચાલક reaches it without it being granted to `authenticated`.
create or replace function public.admin_user_progress_detail(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cfg_id uuid;
  result jsonb;
begin
  perform public.admin_assert_progress_reader();

  select c.id into cfg_id
  from public.level4_configs c
  where c.status = 'PUBLISHED'
  limit 1;

  select jsonb_build_object(
    'user', (
      select jsonb_build_object(
               'userId', p.id, 'name', p.name, 'mobile', p.mobile, 'email', p.email,
               'smk', p.smk, 'zoneId', p.zone_id, 'subZoneId', p.sub_zone_id,
               'status', p.status, 'registeredAt', p.created_at,
               'gatePassedAt', p.gate_passed_at, 'level4Unlocked', p.level4_unlocked
             )
      from public.profiles p where p.id = p_user
    ),
    'totalContent', public.admin_content_total(),
    'gateOpen',     public.level4_gate_open(p_user),

    'level1', (
      select jsonb_build_object(
               'status', case when bool_or(a.status = 'COMPLETED') then 'COMPLETED' else 'NOT_STARTED' end,
               'attempts', count(*)::integer,
               'lastAt', max(a.submitted_at),
               'completedAt', min(a.submitted_at) filter (where a.status = 'COMPLETED')
             )
      from public.activity_attempts a where a.user_id = p_user and a.level_id = 1
    ),
    'level2', (
      select jsonb_build_object(
               'status', case when bool_or(a.status = 'COMPLETED') then 'COMPLETED' else 'NOT_STARTED' end,
               'attempts', count(*)::integer,
               'days', count(distinct a.activity_date)::integer,
               'lastAt', max(a.submitted_at),
               'completedAt', min(a.submitted_at) filter (where a.status = 'COMPLETED')
             )
      from public.activity_attempts a where a.user_id = p_user and a.level_id = 2
    ),
    'level3', (
      select jsonb_build_object(
               'status', case when bool_or(a.status = 'COMPLETED') then 'COMPLETED' else 'NOT_STARTED' end,
               'attempts', count(*)::integer,
               'days', count(distinct a.activity_date)::integer,
               'best', coalesce(max(a.completed_items), 0),
               'latest', (
                 select l.completed_items from public.activity_attempts l
                 where l.user_id = p_user and l.level_id = 3
                 order by l.submitted_at desc, l.id desc limit 1
               ),
               'reportedTotal', coalesce(max(a.total_items), 0),
               'lastAt', max(a.submitted_at)
             )
      from public.activity_attempts a where a.user_id = p_user and a.level_id = 3
    ),

    -- The distinct union that the report counts, returned as the ids themselves so the
    -- detail page can show which દ્રશ્યો they are.
    -- Withheld દ્રશ્યો excluded here exactly as in admin_progress_report, so the detail page
    -- and the row it was opened from cannot print different numbers.
    'rememberedSceneIds', (
      select coalesce(jsonb_agg(distinct t.scene_id order by t.scene_id), '[]'::jsonb)
      from (
        select s.scene_id
        from public.activity_attempts a
        cross join lateral unnest(a.selected_scene_ids) as s(scene_id)
        where a.user_id = p_user and a.level_id = 3
          and not (s.scene_id = any(public.admin_withheld_scene_ids()))
        union
        select s.scene_id
        from public.level4_attempts la
        cross join lateral unnest(la.selected_scene_ids) as s(scene_id)
        where la.user_id = p_user
          and not (s.scene_id = any(public.admin_withheld_scene_ids()))
      ) t
    ),
    'rememberedFromLevel3', (
      select count(distinct s.scene_id)::integer
      from public.activity_attempts a
      cross join lateral unnest(a.selected_scene_ids) as s(scene_id)
      where a.user_id = p_user and a.level_id = 3
        and not (s.scene_id = any(public.admin_withheld_scene_ids()))
    ),
    'rememberedFromLevel4', (
      select count(distinct s.scene_id)::integer
      from public.level4_attempts la
      cross join lateral unnest(la.selected_scene_ids) as s(scene_id)
      where la.user_id = p_user
        and not (s.scene_id = any(public.admin_withheld_scene_ids()))
    ),

    'level4', jsonb_build_object(
      'configId', cfg_id,
      'total', coalesce((
        select count(*)::integer from public.level4_activities a
        where a.config_id = cfg_id and a.active
      ), 0),
      'attempts', coalesce((
        select count(*)::integer from public.level4_attempts la where la.user_id = p_user
      ), 0),
      'passed', coalesce((
        select count(distinct la.activity_id)::integer
        from public.level4_attempts la where la.user_id = p_user and la.passed
      ), 0),
      'lastAt', (select max(la.at) from public.level4_attempts la where la.user_id = p_user),
      'activities', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'activityId', a.id,
                   'code', a.code,
                   'title', a.title,
                   'position', a.position,
                   'requiredCount', a.required_count,
                   'itemCount', (
                     select count(*)::integer from public.level4_activity_items i
                     where i.activity_id = a.id
                   ),
                   'status', st.status,
                   'attempts', st.attempt_count,
                   'revisionCount', st.revision_count,
                   'completedAt', st.completed_at,
                   'passedAttempts', (
                     select count(*)::integer from public.level4_attempts la
                     where la.user_id = p_user and la.activity_id = a.id and la.passed
                   ),
                   'bestSelected', (
                     select max(la.selected_count) from public.level4_attempts la
                     where la.user_id = p_user and la.activity_id = a.id
                   ),
                   'lastAttemptAt', (
                     select max(la.at) from public.level4_attempts la
                     where la.user_id = p_user and la.activity_id = a.id
                   )
                 )
                 order by a.position
               )
        from public.level4_activity_states(p_user, cfg_id) st
        join public.level4_activities a on a.id = st.activity_id
      ), '[]'::jsonb)
    ),

    'points', jsonb_build_object(
      'total', coalesce((
        select sum(t.points)::bigint from public.point_transactions t where t.user_id = p_user
      ), 0),
      'lastAt', (
        select max(t.created_at) from public.point_transactions t where t.user_id = p_user
      )
    )
  )
  into result;

  return result;
end;
$$;

revoke all on function public.admin_user_progress_detail(uuid) from public;

comment on function public.admin_user_progress_detail(uuid) is
  'One યુવક''s complete progress as a document, including per-કસોટી status taken from '
  'level4_activity_states() rather than re-derived. Raises 42501 without progress.read and '
  'users.read — which is what lets a સંચાલક reach a function that names a યુવક and is '
  'granted to nobody.';

-- ================================================================ grants

-- To `authenticated` only, and each function refuses in its own body unless the caller holds
-- both permissions. `anon` is not granted: an unauthenticated request has no role to check
-- and is refused before the body runs, which is where 0004 leaves every other helper.
grant execute on function public.admin_assert_progress_reader() to authenticated;
grant execute on function public.admin_content_total() to authenticated;
grant execute on function public.admin_withheld_scene_ids() to authenticated;
grant execute on function public.admin_progress_report(
  text, integer, integer, date, date, integer, text, text, text, integer, integer
) to authenticated;
grant execute on function public.admin_progress_summary(date, date) to authenticated;
grant execute on function public.admin_user_progress_detail(uuid) to authenticated;

-- ================================================================ indexes

-- Three, each justified by a scan above and by nothing else.
--
-- The report unnests `selected_scene_ids` for every લેવલ ૩ attempt of every યુવક in the
-- filtered set. The existing indexes on `activity_attempts` are both `(user_id, …)`
-- (0021:154), which do not help a query that starts by choosing a level. At ૫૩ rows today
-- Postgres will seq-scan regardless; at ૫૦૦ યુવકો submitting daily this is the difference
-- between reading the લેવલ ૩ rows and reading all of them.
create index if not exists activity_attempts_level_date_idx
  on public.activity_attempts (level_id, activity_date desc);

-- "Who has passed at least N કસોટીઓ" counts distinct activity_id among passing attempts.
-- Partial, because a failed attempt is never on either side of that question, and the
-- passing rows are the minority.
create index if not exists level4_attempts_passed_idx
  on public.level4_attempts (user_id, activity_id)
  where passed;

-- "Active today" and every date-windowed card scan `daily_activity_progress` by date across
-- all યુવકો. The only index there is `(user_id, activity_date desc)` (0021:219), whose
-- leading column is the one this query does not have.
create index if not exists daily_activity_progress_date_idx
  on public.daily_activity_progress (activity_date desc);

-- Deliberately NOT created:
--
--   * anything on `profiles.name` / `mobile` for the ILIKE search. A trigram index is the
--     right tool and it is not justified at ૮૯ rows, or at ૫,૦૦૦; `pg_trgm` is an extension
--     to install and an index to maintain for a scan Postgres does in under a millisecond
--     on a table this size. Revisit when profiles passes ~50,000.
--   * anything on `level4_activity_progress.status`. Its primary key is
--     `(user_id, activity_id)` (0010:198) and the report joins it by activity, which that
--     key already serves.
--   * anything on `point_transactions`. `(user_id, activity_date desc)` (0021:313) already
--     covers the only access this file makes.
