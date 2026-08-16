-- વર્ણી ધ્યાન — the ક્રમાંક a યુવક reads lists યુવકો, and only યુવકો.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE DEFECT
-- ════════════════════════════════════════════════════════════════════════════
--
-- `public.leaderboard()` is the one function in this schema by which one યુવક learns anything
-- about another. 0040 narrowed the population it ranks from `public.profiles` to
-- `public.counted_profiles`, which is "everyone except test accounts", and that fixed the half
-- of the problem 0040 was written about.
--
-- It is not the whole population question. `public.yuvaks` — the view every count, list and
-- export in the સંચાલક panel means by "યુવક" — is `counted_profiles` **minus anyone holding a
-- `public.admins` row** (0038). The board was never given that second term, so an
-- administrator who also happens to have a profile was ranked among the યુવકો, by name, on a
-- screen the whole સંઘ opens. In this project that is literally what happened: `admin@varni.com`
-- ("Varni Admin", a VIEWER) stood third on આજનું ટોપ ૧૦ beside four real યુવકો.
--
-- Three separate things were wrong with that, and only the first is obvious:
--
--   * an administrator's own activity was published to two thousand people who did not ask
--     for it and cannot be shown anything else about him;
--   * he **displaced a યુવક**. The board is `top_n` long, so the person who should have been
--     tenth was not on it at all;
--   * `participants` counted him, so "૩૭ યુવકોમાં" was one too many — the count under the
--     board disagreed with the population the board claims to describe.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE FIX
-- ════════════════════════════════════════════════════════════════════════════
--
-- One `and` in the `ranked` CTE, written as the same term `public.yuvaks` carries, so that
-- "not a યુવક" has one definition in this schema instead of two.
--
-- **What deliberately does NOT change: the સંચાલક panel.** `admin_leaderboard()` is a separate
-- function behind `progress.read`, and an administrator opening an account must still be able
-- to see exactly what it earned — that is how a person testing the app confirms the points
-- arrived. Hidden from the board every યુવક reads; visible to the person who is allowed to
-- look. The same division 0040 drew between "every total, count, ranking and export" and "its
-- own detail page", applied to the one ranking 0040 did not finish narrowing.
--
-- Test accounts need nothing here: `counted_profiles` already removes them and this migration
-- leaves that term exactly as it found it. The suite asserts both halves regardless, because
-- the two exclusions are one requirement and a future edit is as likely to drop one as the
-- other.
--
-- `create or replace`, so the function keeps its oid, its `revoke all` and its grant to
-- `authenticated` (0023). The body below is 0040's own definition, copied token for token with
-- the single join predicate added — the same discipline 0040 used when it copied nine
-- functions out of the live catalogue.

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
    -- Narrowing rule 5, and the whole of 0048. `counted_profiles` removes test accounts and
    -- nothing else (0040), so an administrator who also happens to hold a profile stood on
    -- this board among the યુવકો it exists to rank — which is what put "Varni Admin" on a
    -- screen two thousand of them read every evening.
    --
    -- Spelled as the same `not in (select public.admin_account_ids())` term that
    -- public.yuvaks carries (0038, narrowed again by 0040), so "not a યુવક" has ONE
    -- definition in this schema rather than two that can drift apart. It follows that
    -- definition in every particular, including the one worth naming: `admin_account_ids()`
    -- returns every row of `admins` whatever its status, so a REVOKED administrator does not
    -- reappear on the board. He is not a યુવક; losing a role did not make him one.
    --
    -- It is a term in the SAME join rather than a filter further down, for the reason the
    -- SUSPENDED note above gives: excluded before the window functions run, so he occupies no
    -- ક્રમાંક, leaves no gap in ૧, ૨, ૩, and is not counted in `participants`.
    and p.id not in (select public.admin_account_ids())
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
    --
    -- An administrator reading his own app now lands in that branch, and it is the right one:
    -- he has no ક્રમાંક because he is not in the ranking, and the page already has a sentence
    -- for exactly that. Nothing needed changing on the client.
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

comment on function public.leaderboard(text) is
  'ક્રમાંક — the ONLY path in this schema by which one યુવક learns anything about another '
  '(0023, narrowed by 0040 and 0048). SECURITY DEFINER, and deliberately not a view: a view '
  'exposes its columns to PostgREST filters, so ?user_id=eq.<uuid> would be a question about '
  'one named person, while this takes a period and returns one assembled document. Returns '
  'rank, name, points and isMe — no user_id, not even an opaque one, and no SMK, mobile, '
  'email, સબઝોન, date or per-activity detail. The population is public.yuvaks'' population: '
  'ACTIVE profiles, minus test accounts (0040), minus anyone holding a public.admins row '
  '(0048), and only those whose window sums above zero. Excluded before the window functions '
  'run, so an excluded account occupies no ક્રમાંક and is not counted in participants. Only '
  'the configured top N, and only while the સંચાલક has switched the board on; off returns an '
  'empty board rather than an error. The window''s lower bound is computed in IST from the '
  'server clock and never from the caller, and me is computed over the full ranking so a યુવક '
  'outside the top N still learns his place. The સંચાલક panel is unaffected: '
  'admin_leaderboard() is a separate function behind progress.read, and an administrator must '
  'still be able to open an account and see what it earned. Not one RLS policy is widened by '
  'this function and point_transactions is untouched.';

do $$
declare
  admin_n   integer;
  both_n    integer;
begin
  select count(*) into admin_n from public.admins;
  select count(*) into both_n
    from public.admins a join public.profiles p on p.id = a.id;

  raise notice '[0048] % સંચાલક record(s); % of them also hold a યુવક profile.', admin_n, both_n;
  raise notice '[0048] Those % no longer appear on the ક્રમાંક યુવકો read, and no longer', both_n;
  raise notice '[0048] occupy a place or count toward participants. The સંચાલક panel is';
  raise notice '[0048] unchanged — admin_leaderboard() and the per-account pages still show them.';
end
$$;
