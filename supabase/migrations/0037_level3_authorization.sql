-- વર્ણી ધ્યાન — લેવલ ૩'s reports, closed. The two functions 0035 shipped without a guard, and
-- the sentence that has now had to be written twice: **a grant is not a guard.**
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT WAS OPEN, MEASURED AGAINST THE LIVE DATABASE AND NOT AGAINST THIS FILE
-- ════════════════════════════════════════════════════════════════════════════
--
-- With the **publishable browser key only** — the one that ships inside the JS bundle, no login,
-- no session, no JWT — production answered:
--
--   * `admin_level3_report()`  → 200, and eight rows of real યુવક data: `user_id`, `revisions`,
--     `ticks`, `scenes_distinct`, `points`, `days`, `last_at`, `today_revisions`, `today_ticks`,
--     `today_points`, `engaged_ms`. Every યુવક the request named, and it may name anybody.
--   * `level3_snapshot(p_user := <a real uid>)` → 200, and that યુવક's document: his draft, his
--     day, his lifetime totals, his points. The function takes a યુવક's id and never once
--     compares it against the caller.
--   * `admin_user_level3_detail()` → refused, `level3_detail_forbidden`, SQLSTATE 42501.
--
-- The third one is the model. The pattern is already in 0035, four lines long, sitting at the
-- top of two of its five reporting functions; it was simply not applied to the other two.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE LESSON, WHICH IS THE WHOLE REASON THIS FILE EXISTS
-- ════════════════════════════════════════════════════════════════════════════
--
-- **A grant is not a guard.** Measured on this project, empirically and not by reading the
-- documentation: a request carrying only the publishable key **can execute a function granted to
-- `authenticated`**. So the grant line decides nothing about who may read a યુવક's data — it
-- decides only whether the refusal arrives from Postgres's privilege system or from the
-- function's own first statement. Every SECURITY DEFINER function that touches somebody's rows
-- must therefore state its own check, in its own body, and be readable as safe **without knowing
-- what any GRANT anywhere says**.
--
-- Two corollaries, both of which cost something here:
--
--   1. `revoke all on function … from public` is **not** the same as having no grant. It removes
--      the PUBLIC pseudo-role's default EXECUTE and nothing else; an explicit
--      `grant execute … to authenticated` (or to `anon`, however it got there — a drifted
--      production, a hand-run statement, a `grant … on all functions in schema public`) survives
--      it untouched. That is how `level3_snapshot(uuid)` — a function 0035 revoked from `public`
--      and never granted to anybody — came to answer an anonymous request in production. So the
--      revokes at the foot of this file name `anon` and `authenticated` explicitly rather than
--      trusting `public` to cover them.
--   2. The guard has to be a **statement**. 0032's header states it and the audit
--      (docs/POINT_SYSTEM_ARCHITECTURE.md, closing section) records it as a lesson already paid
--      for: a `with guard as (select …)` CTE inside a `language sql` function is referenced once,
--      so the planner inlines it; no column of it is used, so the target entry is pruned; and the
--      check never runs at all. There is no safe CTE form. **A WHERE-clause guard is no better**
--      — it is not evaluated when the scan beneath it yields no rows, so an unauthorised caller
--      asking about a યુવક who has done no પુનરાવર્તન would be answered with silence instead of a
--      refusal, and silence is an answer: it says "that યુવક exists and has done nothing".
--
--      `perform` / `raise`, as the first executable statement, before a row is looked at. That is
--      why `admin_level3_report()` stops being `language sql` below: a `language sql` function has
--      no place to put a statement that is not part of the query.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHY A NEW FILE AND NOT A CORRECTION TO 0035
-- ════════════════════════════════════════════════════════════════════════════
--
-- 0035 has been applied to production. A migration that has already run is corrected by the next
-- migration and never by rewriting it in place — the rewritten file would apply on a fresh
-- database and would never be applied to the one that is actually wrong, which is the failure
-- mode 0031 already produced once (see scripts/test-point-engine.mjs §A, which re-applies every
-- file from 0031 onward for exactly this reason). Everything here is
-- `create or replace` / `revoke` / `grant` and can be run any number of times.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT THIS FILE DOES **NOT** DO
-- ════════════════════════════════════════════════════════════════════════════
--
-- It does not change a single number. Not a column, not a signature, not a return shape, not one
-- row of arithmetic. `admin_level3_report()`'s body is 0035's body, moved inside a `return query`
-- with two column references qualified so plpgsql can tell a column from an OUT parameter;
-- `level3_snapshot()`'s body is 0035's body with `p_user` read through a variable that has been
-- checked first. Both still count what they counted. This is an authorisation fix and nothing
-- else, so that the diff a reviewer has to trust is four statements long.
--
-- It also does not touch `activity_submit()`, `award_points()`, the pace rule, the દ્રશ્ય
-- catalogue, the draft table, the RLS policies, or any row in `point_transactions`.

-- ================================================================ the સંચાલક's report, guarded

-- `admin_level3_report()`, reissued as plpgsql so it has somewhere to put its guard.
--
-- Everything below the `return query` is 0035:2077-2151 verbatim. Two references — the
-- `select user_id from att union select user_id from tx` that builds the roll of યુવકો — are
-- qualified as `att.user_id` and `tx.user_id`, because in a plpgsql function with a
-- `returns table` block `user_id` is also an OUT parameter and an unqualified reference is
-- ambiguous. `#variable_conflict use_column` says the same thing a second way, for the day
-- somebody adds a column reference and forgets. Neither changes what is computed.
--
-- The guard is `has_permission('progress.read')` raising `level3_detail_forbidden` — deliberately
-- **the same check and the same name** `admin_user_level3_detail()` already uses (0035:2177-2179),
-- so that the two functions a screen calls together cannot disagree about who may call them or
-- about what the refusal is called. (`admin_level3_users()` raises `level3_report_forbidden`; both
-- names carry SQLSTATE 42501, which is what admin/src/features/points/services/level3Service.js
-- actually branches on.)
create or replace function public.admin_level3_report(
  p_users uuid[]  default null,
  p_from  date    default null,
  p_to    date    default null,
  p_day   date    default null
)
returns table (
  user_id          uuid,
  revisions        bigint,
  ticks            bigint,
  scenes_distinct  bigint,
  points           bigint,
  days             bigint,
  last_at          timestamptz,
  today_revisions  bigint,
  today_ticks      bigint,
  today_points     bigint,
  engaged_ms       bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- 0032's rule, and the reason this function is no longer `language sql`: a permission test
  -- folded into the query is inlined and pruned and never runs, and a test in a WHERE clause is
  -- not evaluated when the scan beneath it is empty — so a યુવક with no પુનરાવર્તન would be
  -- answered with an empty set rather than refused, and an empty set is an answer. A statement of
  -- its own cannot be optimised away and cannot be skipped for want of rows.
  if not public.has_permission('progress.read') then
    raise exception 'level3_detail_forbidden' using errcode = '42501';
  end if;

  return query
  with day as (
    select coalesce(p_day, timezone('Asia/Kolkata', now())::date) as d
  ),
  att as (
    select a.*
    from public.activity_attempts a
    where a.level_id = 3
      and a.activity_key = 'revision'
      and (p_users is null or a.user_id = any (p_users))
      and (p_from is null or a.activity_date >= p_from)
      and (p_to   is null or a.activity_date <= p_to)
  ),
  tx as (
    select t.user_id, t.activity_date, t.points
    from public.point_transactions t
    where t.level_id = 3
      and (p_users is null or t.user_id = any (p_users))
      and (p_from is null or t.activity_date >= p_from)
      and (p_to   is null or t.activity_date <= p_to)
  )
  select
    u.user_id,
    coalesce(a.revisions, 0),
    coalesce(a.ticks, 0),
    coalesce(sc.scenes_distinct, 0),
    coalesce(x.points, 0),
    coalesce(a.days, 0),
    a.last_at,
    coalesce(a.today_revisions, 0),
    coalesce(a.today_ticks, 0),
    coalesce(x.today_points, 0),
    coalesce(a.engaged_ms, 0)
  from (
    -- Qualified — see the note above. 0035 wrote `select user_id from att`, which is the same
    -- column and the same rows, and is ambiguous only because this function now has a body.
    select att.user_id from att
    union
    select tx.user_id from tx
  ) u
  -- **Two aggregates and not one**, and the reason is worth stating because the single-query
  -- version is the obvious way to write this and is silently wrong. Unnesting the scene ids to
  -- count the distinct ones multiplies every attempt row by the number of દ્રશ્યો it names — so
  -- `count(*)` stops being "how many પુનરાવર્તન" and becomes "how many ticks", and
  -- `sum(cardinality(...))` becomes the sum of the squares. On the fixture that read ૧૨૦
  -- પુનરાવર્તન and ૫૦૦૦ ticks for a યુવક who had done three and ૧૨૦.
  --
  -- The row-level facts are counted over the attempts as they stand; the દ્રશ્ય-level fact is
  -- counted in its own subquery, where the multiplication is what is wanted.
  left join (
    select
      att.user_id,
      count(*)                                                          as revisions,
      sum(coalesce(cardinality(att.selected_scene_ids), 0))             as ticks,
      count(distinct att.activity_date)                                 as days,
      max(att.submitted_at)                                             as last_at,
      count(*) filter (where att.activity_date = (select d from day))   as today_revisions,
      coalesce(sum(coalesce(cardinality(att.selected_scene_ids), 0))
               filter (where att.activity_date = (select d from day)), 0) as today_ticks,
      -- `::bigint` is the one cast this file adds, and it adds nothing. `engaged_ms` is a bigint
      -- column, so `sum()` over it is **numeric**; `language sql` coerced that to the declared
      -- bigint on the way out through an ordinary assignment cast, and plpgsql's `return query`
      -- refuses to (42804, "structure of query does not match function result type"). Writing the
      -- coercion down is what keeps the returned value bit-for-bit the one 0035 returned — a sum
      -- of bigints is an exact integer, so nothing is rounded and nothing can be.
      coalesce(sum(att.engaged_ms), 0)::bigint                          as engaged_ms
    from att
    group by att.user_id
  ) a on a.user_id = u.user_id
  left join (
    select att.user_id, count(distinct s.scene_id) as scenes_distinct
    from att
    cross join lateral unnest(att.selected_scene_ids) as s(scene_id)
    where not (s.scene_id = any (public.admin_withheld_scene_ids()))
    group by att.user_id
  ) sc on sc.user_id = u.user_id
  left join (
    select
      tx.user_id,
      sum(tx.points)                                                    as points,
      coalesce(sum(tx.points) filter (where tx.activity_date = (select d from day)), 0) as today_points
    from tx
    group by tx.user_id
  ) x on x.user_id = u.user_id;
end;
$$;

comment on function public.admin_level3_report(uuid[], date, date, date) is
  'Per-યુવક લેવલ ૩ figures for the progress report (0035, guarded 0037): પુનરાવર્તન count, total '
  'ticks (the SUM across revisions, not the union), distinct દ્રશ્યો, points from the ledger, '
  'days, last activity, and the same three for one chosen day. Joined onto admin_progress_report() '
  'by uid in the browser, the way admin_activity_counts() already is. 0037 changes nothing it '
  'computes and only adds the check it shipped without: progress.read, asserted by a raise as the '
  'first statement of the body — never as a CTE and never in a WHERE clause, because neither runs '
  'when there is nothing to scan. Same errcode and same error name as admin_user_level3_detail().';

-- ================================================================ the યુવક's own document

-- `level3_snapshot()`, which may now only ever be handed a યુવક the caller is entitled to read.
--
-- ────────────────────────────────────────────────────────────────────────────
-- The comment that gave it away
-- ────────────────────────────────────────────────────────────────────────────
--
-- 0035:1176 says of this family that it "derives the યુવક from auth.uid() and takes no parameter
-- that could name another". That is true of `level3_draft_get()` and of `my_level3_summary()`. It
-- was never true of `level3_snapshot(p_user uuid)`, which is the function both of them call, is
-- where the whole document is actually built, and took a યુવક's id straight from its argument
-- list. The safe wrappers were real; the thing they wrapped was not.
--
-- The rule, and it is the ordinary one this schema already uses for `progress` (0004:602-610) and
-- for `level3_drafts`' own RLS policy (0035:2482-2483):
--
--   * no session at all              → refused, `level3_snapshot_not_signed_in`, 42501
--   * his own id, or no id at all    → allowed; NULL means "me", which is what deriving from
--                                      auth.uid() means and what every existing caller already
--                                      passes explicitly
--   * somebody else's id             → allowed only for a holder of `progress.read`, refused
--                                      otherwise with `level3_snapshot_forbidden`, 42501
--
-- The signature is kept — `level3_draft_get()`, `level3_draft_save()`, `level3_finalize()` and
-- `my_level3_summary()` all call it as `level3_snapshot(actor)` and must not be reissued for this.
-- Being SECURITY DEFINER does not change `auth.uid()`: it reads the request's JWT claims, which
-- are the caller's whoever the function runs as, so those four wrappers go on working unchanged
-- and each is asking about itself.
--
-- The declarations are moved into the body on purpose. `pace`, `live` and `ready` were
-- initialised in the DECLARE block, which runs **before** the first statement — so with a guard
-- above them the guard would no longer have been first. They are assigned to the same values, in
-- the same order, immediately after the check.
create or replace function public.level3_snapshot(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor    uuid := auth.uid();
  target   uuid;
  d        public.level3_drafts%rowtype;
  today    date;
  pace     jsonb;
  per_s    integer;
  live     text[];
  ready    boolean;
  valid    text[];
  eligible integer;
begin
  -- ── who is asking, before anything is read ────────────────────────────────
  --
  -- `actor is null` is tested first and separately, and not folded into the comparison below,
  -- because `target <> actor` is NULL rather than true when `actor` is NULL — an anonymous caller
  -- naming any યુવક would fall straight through a single combined test. That is the same
  -- three-valued-logic trap 0034's `coalesce(jsonb_typeof(...), 'absent')` note describes, and it
  -- is the exact shape this fix exists to close.
  if actor is null then
    raise exception 'level3_snapshot_not_signed_in' using errcode = '42501';
  end if;

  target := coalesce(p_user, actor);

  if target <> actor and not public.has_permission('progress.read') then
    raise exception 'level3_snapshot_forbidden' using errcode = '42501';
  end if;

  today := timezone('Asia/Kolkata', now())::date;
  pace  := public.point_pace();
  live  := public.live_scene_ids();
  ready := public.scene_catalog_ready();

  select * into d from public.level3_drafts where user_id = target;

  per_s := (pace ->> 'secondsPerTick')::integer;

  -- The draft's ticks, as the award engine would see them today. Shown rather than the raw
  -- array so the count on screen is the count that would be paid — a યુવક reading ૫૦ and being
  -- paid ૪૭ because three દ્રશ્યો were withdrawn at noon would be the page disagreeing with the
  -- ledger about what he just did.
  select coalesce(array_agg(distinct s.sid), '{}'::text[]) into valid
  from unnest(coalesce(d.scene_ids, '{}'::text[])) as s(sid)
  where not (s.sid = any (public.admin_withheld_scene_ids()))
    and (not ready or s.sid = any (live));

  -- How many of them the clock has earned so far. `null` when no pace rule is configured, which
  -- the screen reads as "there is nothing to say about time" rather than as a limit of zero.
  if per_s > 0 then
    eligible := greatest(
      least(
        coalesce(cardinality(valid), 0),
        ((coalesce(d.engaged_ms, 0) / 1000) + (pace ->> 'graceSeconds')::integer) / per_s
      ), 0);
  end if;

  return jsonb_build_object(
    'date', today,

    -- ── the પુનરાવર્તન he is in the middle of ────────────────────────────────
    'current', jsonb_build_object(
      'open',      (d.user_id is not null),
      'date',      d.activity_date,
      'sceneIds',  to_jsonb(coalesce(valid, '{}'::text[])),
      'ticks',     coalesce(cardinality(valid), 0),
      'engagedMs', coalesce(d.engaged_ms, 0),
      'startedAt', d.started_at,
      'savedAt',   d.updated_at,
      -- What finalising right now would be worth, at the pace rule. NULL when no rule is set.
      'eligibleTicks', eligible
    ),

    'pace', jsonb_build_object(
      'secondsPerTick', per_s,
      'graceSeconds',   (pace ->> 'graceSeconds')::integer,
      -- The whole session's requirement, so the page can say "આશરે N મિનિટ" without doing the
      -- multiplication itself (§17 — the client computes nothing the server can state).
      'requiredSeconds', case when per_s > 0
                              then coalesce(cardinality(valid), 0) * per_s
                              else 0 end
    ),

    -- ── today ────────────────────────────────────────────────────────────────
    'today', (
      select jsonb_build_object(
        'revisions', coalesce(count(*), 0),
        'ticks',     coalesce(sum(coalesce(cardinality(a.selected_scene_ids), 0)), 0),
        -- The day's **distinct** દ્રશ્યો, which is a different question from `ticks` and the one
        -- the લેવલ ૪ gate asks: "એક જ દિવસમાં N દ્રશ્યો યાદ કરો". Counted from finished
        -- પુનરાવર્તન only, so the page can offer the door the moment it is genuinely earned
        -- without waiting for `level4_state()` to be re-read — and without over-promising, which
        -- the additive total would do.
        'scenes',    coalesce((
          select count(distinct s.scene_id)
          from public.activity_attempts e
          cross join lateral unnest(e.selected_scene_ids) as s(scene_id)
          where e.user_id = target and e.activity_date = today
            and e.level_id = 3 and e.activity_key = 'revision'
            and not (s.scene_id = any (public.admin_withheld_scene_ids()))
        ), 0),
        'points',    coalesce((
          select sum(t.points) from public.point_transactions t
          where t.user_id = target and t.activity_date = today and t.level_id = 3
        ), 0)
      )
      from public.activity_attempts a
      where a.user_id = target and a.activity_date = today
        and a.level_id = 3 and a.activity_key = 'revision'
    ),

    -- ── every પુનરાવર્તન he has ever finished ────────────────────────────────
    --
    -- `ticks` is the **sum** of the per-પુનરાવર્તન counts and not the size of their union, which
    -- is the requirement's arithmetic said out loud (§2, §9): ૫૦ then ૪૦ is ૯૦ whether or not
    -- the second forty were the same દ્રશ્યો. A યુવક who brings the same fifty to mind twice has
    -- done the સાધના twice, and the union would report that he had done it once.
    'total', (
      select jsonb_build_object(
        'revisions', coalesce(count(*), 0),
        'ticks',     coalesce(sum(coalesce(cardinality(a.selected_scene_ids), 0)), 0),
        'days',      coalesce(count(distinct a.activity_date), 0),
        'lastAt',    max(a.submitted_at),
        'points',    coalesce((
          select sum(t.points) from public.point_transactions t
          where t.user_id = target and t.level_id = 3
        ), 0)
      )
      from public.activity_attempts a
      where a.user_id = target and a.level_id = 3 and a.activity_key = 'revision'
    ),

    -- ── today's finished પુનરાવર્તન, newest first ────────────────────────────
    --
    -- Today only. The whole history is `/history`'s to render and is already there; what this
    -- page needs is the list §27 asks it to print under the current session — "૫૦ ticks → +૫૦"
    -- — so a યુવક can see that resetting took nothing away from him.
    'revisions', coalesce((
      select jsonb_agg(r order by r ->> 'at' desc)
      from (
        select jsonb_build_object(
          'n',         a.attempt_number,
          'ticks',     coalesce(cardinality(a.selected_scene_ids), 0),
          'at',        a.submitted_at,
          'engagedMs', a.engaged_ms,
          'status',    a.status,
          'points',    coalesce((
            select sum(t.points) from public.point_transactions t
            where t.user_id = target and t.source = 'ACTIVITY_ATTEMPT' and t.source_id = a.id
          ), 0)
        ) as r
        from public.activity_attempts a
        where a.user_id = target and a.activity_date = today
          and a.level_id = 3 and a.activity_key = 'revision'
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.level3_snapshot(uuid) is
  'Everything લેવલ ૩ renders, as one document (0035, guarded 0037): the unfinished પુનરાવર્તન, '
  'the pace rule, today, the lifetime totals and today''s finished પુનરાવર્તન. Counted from '
  'level3_drafts, activity_attempts and point_transactions — nothing here is stored and nothing '
  'is a second scoring computation. total.ticks is the SUM of the per-પુનરાવર્તન counts, never '
  'the size of their union: ૫૦ then ૪૦ is ૯૦. 0037: p_user may only be the caller himself '
  '(NULL means himself) unless he holds progress.read; anyone else is refused with 42501, and an '
  'anonymous caller is refused before p_user is read at all. Signature and every figure unchanged.';

-- ================================================================ grants, audited and restated
--
-- Every function 0035 creates is named below with the verdict on it, because the audit is only
-- worth having if the next reader can see that each one was actually looked at. The grants are
-- restated rather than assumed: `revoke all … from public` does not remove an explicit grant to
-- `anon` or to `authenticated`, and production has already demonstrated that such a grant can
-- exist without any migration in this repository having written it.
--
-- Read every line below as belt and braces only. **Not one of these statements is what makes a
-- function safe** — the guard inside the function is. If a grant here were wrong tomorrow, every
-- function that touches a યુવક's rows would still refuse the wrong caller by itself.

-- ── may be called by any signed-in યુવક, and states its own check ──────────────
-- level3_draft_get / level3_draft_save / level3_finalize / level3_reset: auth.uid() then
-- is_active_user(), both raising 42501 (0035). Correct as shipped.
-- my_level3_summary: auth.uid(), raising 42501, and takes no parameter. Correct as shipped.
-- daily_record_save: auth.uid() then is_active_user() (0034/0035). Correct as shipped.
-- scene_catalog_sync: has_permission('darshan.update') as its first statement. Correct as shipped.
grant execute on function public.level3_draft_get()                     to authenticated;
grant execute on function public.level3_draft_save(text[])              to authenticated;
grant execute on function public.level3_finalize(uuid)                  to authenticated;
grant execute on function public.level3_reset(uuid)                     to authenticated;
grant execute on function public.my_level3_summary()                    to authenticated;
grant execute on function public.daily_record_save(date, jsonb, uuid)   to authenticated;
grant execute on function public.scene_catalog_sync(jsonb)              to authenticated;

-- ── a fact about the collection and about nobody ──────────────────────────────
--
-- `scene_catalog_ready()` is a boolean about a build step. `live_scene_ids()` is the list of
-- દ્રશ્ય ids the published collection contains — the same list `public.scene_catalog` already
-- shows every signed-in યુવક through its RLS policy (0035:2473), and the same list the browser
-- bundle ships in content/darshan.json. `point_pace()` is the સંચાલક's own configuration, which
-- the screen has to be told in order to say "આશરે N મિનિટ".
--
-- None of the three names a યુવક, holds a figure about one, or can be turned into one. They are
-- deliberately left ungated: adding a session check to `point_pace()` would buy nothing and would
-- put a raise inside `award_points()`'s path.
grant execute on function public.scene_catalog_ready() to authenticated;
grant execute on function public.live_scene_ids()      to authenticated;
grant execute on function public.point_pace()          to authenticated;

-- ── the સંચાલક's three, all now guarded by progress.read ──────────────────────
-- admin_user_level3_detail: guarded as shipped — the model this file copies.
-- admin_level3_users:       guarded as shipped, `level3_report_forbidden`.
-- admin_level3_report:      **was not guarded at all.** Fixed at the top of this file.
grant execute on function public.admin_level3_report(uuid[], date, date, date)  to authenticated;
grant execute on function public.admin_user_level3_detail(uuid, integer)        to authenticated;

-- `admin_level3_users()` is 0035's, and it is handled separately because it may not be there yet.
--
-- This is not hypothetical: it is exactly how this file first failed. Production holds a stale
-- copy of 0035 — the other functions of that file are deployed and this one is not — so a bare
-- GRANT aborted the whole migration with 42883 before a single guard had been installed.
--
-- Guarded on `to_regprocedure()` rather than fixed by ordering 0035 first, because **a migration
-- whose only purpose is to repair a drifted database must not itself require an undrifted one.**
-- This project has now been bitten three times by application order — 0032 failing behind 0031,
-- 0033 overwriting 0034's shared functions, and this. When 0035 is applied, whether before or
-- after, its own grant block runs and the function is granted then; this block simply declines to
-- speak about a function that is not there.
do $$
declare
  sig constant text :=
    'public.admin_level3_users(text, text, text, text, date, date, date, boolean, '
    'integer, integer, integer, text, text, integer, integer)';
begin
  if to_regprocedure(sig) is null then
    raise notice '0037: admin_level3_users() is absent - apply 0035, which grants it itself.';
    return;
  end if;

  execute format('grant execute on function %s to authenticated', sig);
  -- The same anon revoke the block below performs for its neighbours.
  execute format('revoke execute on function %s from anon', sig);
end;
$$;

-- None of the seventeen above is for `anon`, and saying so explicitly is the point of this block:
-- a drifted grant is invisible in a migration that only ever revokes `public`.
revoke execute on function public.level3_draft_get()                    from anon;
revoke execute on function public.level3_draft_save(text[])             from anon;
revoke execute on function public.level3_finalize(uuid)                 from anon;
revoke execute on function public.level3_reset(uuid)                    from anon;
revoke execute on function public.my_level3_summary()                   from anon;
revoke execute on function public.daily_record_save(date, jsonb, uuid)  from anon;
revoke execute on function public.scene_catalog_sync(jsonb)             from anon;
revoke execute on function public.scene_catalog_ready()                 from anon;
revoke execute on function public.live_scene_ids()                      from anon;
revoke execute on function public.point_pace()                          from anon;
revoke execute on function public.admin_level3_report(uuid[], date, date, date) from anon;
revoke execute on function public.admin_user_level3_detail(uuid, integer)       from anon;
-- admin_level3_users' anon revoke is in the guarded block above, beside its grant, because the
-- function may not exist on this database yet and a bare REVOKE fails with 42883 just as a GRANT
-- does. Keeping the pair together is also what stops one of them being dropped later.

-- ── reachable from no client at all ───────────────────────────────────────────
--
-- These take a યુવક's uuid and either write with it or price with it, and every one of them is
-- called only from another SECURITY DEFINER function that has already decided who the caller is.
-- 0035 revoked them from `public` and granted them to nobody, which was right; what it could not
-- do is remove a grant that had drifted onto `anon` or `authenticated` elsewhere. Named
-- explicitly here so that the absence of a grant is a fact and not an assumption.
--
--   award_points                     the single writer of point_transactions, through point_award
--   level3_commit                    writes an activity_attempts row for the uuid it is handed
--   level3_snapshot                  reads one — now guarded as well, at the top of this file
--   daily_activity_progress_recount  rewrites a day's derived row
--   daily_record_points              prices a day for a named યુવક
revoke execute on function
  public.award_points(uuid, date, integer, text, text, bigint, integer)
  from public, anon, authenticated;

revoke execute on function public.level3_commit(uuid, date, uuid)
  from public, anon, authenticated;

revoke execute on function public.level3_snapshot(uuid)
  from public, anon, authenticated;

revoke execute on function public.daily_activity_progress_recount(uuid, date, integer, text)
  from public, anon, authenticated;

revoke execute on function public.daily_record_points(uuid, integer, text, integer, date)
  from public, anon, authenticated;

-- ── the two trigger functions ─────────────────────────────────────────────────
--
-- `settings_check_pace()` and `activity_attempts_level3_award()` are the only functions 0035
-- creates that it never revokes, so both still carry PUBLIC's default EXECUTE. Neither is an
-- exposure — a function returning `trigger` raises 0A000 the moment it is called as an ordinary
-- function, whoever calls it — but "safe because Postgres happens to stop it" is not the property
-- this file is trying to leave behind, and the project's own idiom is to revoke them
-- (settings_check_slideshow 0018:149, settings_check_mobile_nav 0019:394, settings_check_points
-- 0021:615). A trigger's EXECUTE privilege is checked when the trigger is created, not each time
-- it fires, so the સંચાલક goes on writing settings and the panel goes on submitting attempts.
revoke all on function public.settings_check_pace()              from public, anon, authenticated;
revoke all on function public.activity_attempts_level3_award()   from public, anon, authenticated;

-- ================================================================ notes for the next reader
--
-- **The two tables 0035 adds were already right and are not touched.** `scene_catalog` has RLS on
-- with a read policy for any signed-in caller and no write policy at all; `level3_drafts` has RLS
-- on with a read policy of "his own row, or progress.read" and no write policy, with
-- INSERT/UPDATE/DELETE revoked from both client roles and SELECT additionally revoked from `anon`.
-- Every write goes through a SECURITY DEFINER function, which is what makes `engaged_ms` — and
-- therefore the pace rule, and therefore the points — unforgeable from a handset.
--
-- **`level3_commit()` still takes a `p_user` it does not check.** It is not granted to any client
-- role, and both of its callers (`level3_draft_get()`'s day-roll and `level3_finalize()`) have
-- already established the actor from `auth.uid()` — so it is unreachable and correct today. It is
-- deliberately left alone: it is a **writer**, its guard would have to be threaded through the
-- day-roll path that finalises yesterday on behalf of the યુવક, and this file's whole claim is
-- that it changes no behaviour. It is the next thing to look at if that grant ever changes, and
-- scripts/test-level3-auth.mjs asserts its unreachability so that the day it changes is a red
-- test rather than a discovery.
--
-- **The property that should be checked forever, not the two functions that were wrong.** This is
-- the second time this defect class has shipped — 0032 the first time, 0035 the second — so
-- scripts/test-level3-auth.mjs does not assert a list of names. It enumerates every SECURITY
-- DEFINER function 0035 and 0037 declare, straight out of `pg_proc`, and requires each one to
-- refuse a caller with no session, with the three collection-level helpers above as the only
-- allowlist. A function added to either file tomorrow is covered the moment it is created, and
-- has to be argued into the allowlist rather than silently defaulting into it.
