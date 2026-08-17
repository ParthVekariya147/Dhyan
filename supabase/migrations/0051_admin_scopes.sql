-- વર્ણી ધ્યાન — a સંચાલક who looks after one zone sees one zone.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT IS MISSING TODAY
-- ════════════════════════════════════════════════════════════════════════════
--
-- 0043 made *what* a person may do editable from the panel: forty-eight permissions, roles
-- that are rows, and per-person exceptions. It said nothing at all about *whose data* he may
-- do it to. `users.read` is one bit, and it means every યુવક in every zone — so the સંઘ can
-- say "he may open the Users list" and cannot say "he may open the Users list for વરાછા".
--
-- The permission for this has existed since 0043 and has never meant anything:
--
--     ('scope.assign', 'scope', 'assign', 'Limit someone to a zone', …)
--
-- It is a tick box in the role editor that grants the ability to do something no table can
-- record and no policy can read. This migration is the other half of it.
--
-- ════════════════════════════════════════════════════════════════════════════
-- A SCOPE IS A LIST OF ZONES, AND NO ROWS MEANS EVERYWHERE
-- ════════════════════════════════════════════════════════════════════════════
--
-- **This is the single most important line in the file.** An administrator with no rows in
-- `admin_scopes` is unrestricted — not restricted to nothing. Read the other way round, this
-- migration would take every યુવક away from every સંચાલક in the સંઘ the moment it applied, and
-- the panel would come up empty for the person who deployed it with no error to explain why.
--
-- It is also the reason this ships alone safely: applying it changes nothing until somebody
-- writes the first row.
--
-- ── Why a zone and not a (city, zone) pair ──────────────────────────────────
--
-- 0050:248 says "an admin's scope is a (city, zone) pair", and this file stores only the zone.
-- The two agree, because 0050 also made the pair impossible to contradict: `zones.id` is unique
-- across every city, `profiles.sub_zone_id` is a foreign key to it, and
-- `profiles_guard_geography()` refuses a profile whose city and zone disagree. So a zone
-- determines its city, and storing the city beside it would be storing a value that can only
-- ever be derived or wrong — the second of which is exactly the failure 0050 spent a trigger
-- preventing on `profiles`.
--
-- A whole-city scope ("he looks after all of સુરત") is therefore expressed as its zones. That
-- is a real difference: a zone opened next year is not automatically his. It is the safer
-- direction to be wrong in — a new zone that nobody can see is noticed and fixed, and a new
-- zone silently added to somebody's remit is not — and the panel says so where the scope is
-- chosen.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHERE THE NARROWING ACTUALLY HAPPENS — three places, not twenty-four
-- ════════════════════════════════════════════════════════════════════════════
--
--   1. `public.scoped_profiles`, and the report functions re-issued to read it. This is the
--      panel's whole reporting surface: 0040 already funnelled every function that enumerates
--      a population through `public.counted_profiles`, and test-test-accounts.mjs fails the
--      build for a report that reads `public.profiles` directly. So there is exactly one view
--      to narrow, and the population that flows through it is provably complete.
--
--   2. Restrictive policies, for the twelve tables a browser could otherwise read directly.
--      RLS is not what the reports go through — they are SECURITY DEFINER — but PostgREST is
--      still in front of `point_transactions`, and a scoped coordinator who can read every
--      point transaction of every યુવક over the REST endpoint has not been scoped.
--
--   3. An explicit refusal in the four functions that resolve ONE named person. A scoped
--      સંચાલક who types another zone's user id into a URL must be told no, not shown a blank
--      page — the same argument RequirePermission.jsx makes: a refusal should be stated, not
--      mimed.
--
-- ── Why restrictive policies rather than re-writing the existing ones ───────
--
-- Twelve tables carry a policy of the shape `user_id = auth.uid() or has_permission
-- ('progress.read')`, written across 0004, 0010, 0021, 0034 and 0035 and hoisted by 0039.
-- Adding "and in scope" to each means dropping and re-creating twelve quals, by hand, in a
-- file that is not about any of them — and a qual copied with one word wrong is a policy that
-- still applies, still passes every test that only checks a refusal, and silently widens or
-- narrows a read.
--
-- A RESTRICTIVE policy is ANDed with whatever permissive policies already exist, so the
-- existing ones are not touched at all. Each new one says one thing — "and only if the row is
-- about somebody in your zones" — and for an unrestricted caller it is a constant true.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT THIS DOES NOT DO
-- ════════════════════════════════════════════════════════════════════════════
--
--   · **The SUPER_ADMIN cannot be scoped.** Enforced by the guard. Somebody has to be able to
--     see the whole સંઘ, or a zone can become invisible to everyone at once with no screen
--     anywhere saying so.
--   · **A bootstrap account is never scoped**, whatever `admin_scopes` says about him — the
--     same short-circuit `caller_permissions()` (0043 §2.4) makes for the same reason. 0024's
--     break-glass path is the recovery of last resort and a half-blind recovery is not one.
--   · **Nothing is scoped by city.** See above.
--   · **A યુવક's own reads are untouched.** Every restrictive policy below passes
--     `user_id = auth.uid()` first, and a યુવક has no `admin_scopes` rows anyway.
--   · **`public.leaderboard()` — the ranking the યુવક app shows — is deliberately NOT scoped.**
--     It is the same ranking for everybody by definition, and an administrator's remit must not
--     change what a યુવક is shown. Only `admin_leaderboard()`, the panel's, is narrowed.
--
-- Written to run twice: every create is `if not exists` or `create or replace`, every policy is
-- dropped before it is added, and the function re-issue below only rewrites a body that still
-- carries the old token.

-- ================================================================ 1. the table

create table if not exists public.admin_scopes (
  admin_id   uuid not null references public.admins (id) on delete cascade,

  /*
    `on update cascade` for the same reason 0050 put it on `profiles.sub_zone_id`: a zone id is
    immutable through the panel — geography_guard() refuses a change — so this is not there to
    follow a rename anybody can perform. It is there so a future migration that does rename one
    cannot leave a scope pointing at a zone that no longer exists, which would silently widen
    the person's access to nothing at all and look exactly like an unrestricted account.
  */
  zone_id    text not null references public.zones (id) on update cascade,

  granted_by uuid references auth.users (id),
  granted_at timestamptz not null default now(),

  primary key (admin_id, zone_id)
);

create index if not exists admin_scopes_admin_idx on public.admin_scopes (admin_id);

comment on table public.admin_scopes is
  'Which zones a સંચાલક may see (0051). NO ROWS MEANS EVERY ZONE - an empty scope is '
  'unrestricted, never "nothing", or applying this migration would have blanked the panel for '
  'every administrator in the સંઘ. Written only with scope.assign, and never onto a '
  'SUPER_ADMIN or onto yourself: admin_scopes_guard() refuses both, service_role included.';

-- ================================================================ 2. what the caller may see

/*
  The caller's zones, or NULL for "no limit".

  NULL and not an empty array, and the difference is the whole design. `array_agg` over no rows
  returns NULL already; `nullif(…, '{}')` is belt and braces for a future body that aggregates
  differently. Every reader below tests `is null` first and short-circuits, so an unrestricted
  administrator pays one index probe on a table with a handful of rows and nothing else.

  ── The bootstrap short-circuit ─────────────────────────────────────────────

  A founding account listed in `bootstrap_admins` (0024) is unrestricted whatever rows exist
  for him here. `caller_permissions()` makes exactly the same exception for exactly the same
  reason: that table is the sealed recovery path no panel action can reach, it exists so a
  project cannot be locked out of itself, and a recovery that can only see one zone is not a
  recovery. It is read first, so a stray `admin_scopes` row cannot narrow it.

  `stable`, so Postgres may evaluate it once per statement rather than once per row — which is
  what makes the per-row `in_caller_scope()` in the policies below affordable.
*/
create or replace function public.caller_scope()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.bootstrap_admins b where b.id = auth.uid()) then null
    else nullif(
      (select array_agg(s.zone_id order by s.zone_id)
       from public.admin_scopes s
       join public.admins a on a.id = s.admin_id and a.status = 'ACTIVE'
       where s.admin_id = auth.uid()),
      '{}'::text[]
    )
  end;
$$;

comment on function public.caller_scope() is
  'The zone ids this caller is limited to, or NULL for no limit (0051). NULL is the answer for '
  'an ordinary યુવક, for anon, for every administrator with no admin_scopes rows, and for a '
  'bootstrap account whatever rows he has - see 0024 and caller_permissions().';

/** Is this zone one of the caller's? True for everybody unrestricted. */
create or replace function public.in_caller_scope(p_zone text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.caller_scope() is null or p_zone = any(public.caller_scope());
$$;

/**
 * The same question asked about a person rather than a place.
 *
 * Its own function rather than `in_caller_scope((select sub_zone_id from profiles …))` written
 * out at each call site, because it is called from a dozen RLS policies and a policy that
 * reads `profiles` inline would re-enter `profiles`' own policies — which include this one.
 * SECURITY DEFINER breaks that loop, and the early return means an unrestricted caller never
 * reaches the lookup at all.
 */
create or replace function public.user_in_caller_scope(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.caller_scope() is null
      or exists (
           select 1 from public.profiles p
           where p.id = p_user and p.sub_zone_id = any(public.caller_scope())
         );
$$;

/**
 * Refuse a lookup of one named person outside the caller's zones.
 *
 * `raise`, not an empty result, and that is the point of it existing at all. The population
 * functions can honestly return nothing — a report over a zone he does not look after has no
 * rows in it for him. A detail lookup is a URL somebody typed or followed, and answering it
 * with a blank page says "this yuvak has no record", which is a false statement about a real
 * person rather than a refusal.
 *
 * Silent for a null id and for an id that matches nobody: those are the caller's own
 * "no such user" paths, and a scope error would misattribute a typo to a permission problem.
 */
create or replace function public.admin_assert_in_scope(p_user uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_user is null then return; end if;
  if public.caller_scope() is null then return; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user) then return; end if;

  if not public.user_in_caller_scope(p_user) then
    -- Verbatim, and asserted by scripts/test-scope.mjs. The same status the admins_guard()
    -- messages have (0038): the panel matches it to word the refusal for the person who hit it.
    raise exception 'this yuvak is not in a zone you look after'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.caller_scope() from public;
revoke all on function public.in_caller_scope(text) from public;
revoke all on function public.user_in_caller_scope(uuid) from public;
revoke all on function public.admin_assert_in_scope(uuid) from public;

-- anon as well as authenticated: the restrictive policies below are evaluated for every role
-- that can reach the table, and a policy whose function the role may not execute fails with
-- 42501 rather than with "no rows" — which would turn નોંધણી's own profile insert into an
-- error about permissions on a helper.
grant execute on function public.caller_scope() to anon, authenticated;
grant execute on function public.in_caller_scope(text) to anon, authenticated;
grant execute on function public.user_in_caller_scope(uuid) to anon, authenticated;
grant execute on function public.admin_assert_in_scope(uuid) to authenticated;

-- ================================================================ 3. the reported population

/*
  0040's population, narrowed by the caller's zones.

  Every column of `counted_profiles`, so it can be substituted for it without one other line of
  a report changing — which is exactly how the functions below were patched, and why the patch
  could be verified token by token. That is 0040's own sentence about `counted_profiles`, and
  this is the same move one layer further out:

      profiles            every account that exists
      counted_profiles    minus test accounts                        (0040)
      scoped_profiles     minus the zones this caller does not have  (0051)

  security_invoker, like the two views under it. Inside the SECURITY DEFINER reports it is read
  as the owner, where RLS does not apply — and the narrowing still happens, because
  `in_caller_scope()` is not RLS. It reads `auth.uid()`, which is the JWT claim on the session
  and is unchanged by SECURITY DEFINER. That distinction is what lets one view scope every
  report without any of them being re-written.
*/
create or replace view public.scoped_profiles
  with (security_invoker = on)
as
  select * from public.counted_profiles where public.in_caller_scope(sub_zone_id);

comment on view public.scoped_profiles is
  'counted_profiles narrowed to the caller''s zones (0051). Identical for anyone unrestricted, '
  'which is everybody until a scope row is written. Every function that enumerates a population '
  'for the panel reads this; public.leaderboard() - the યુવક app''s ranking - deliberately does '
  'not, because an administrator''s remit must not change what a યુવક is shown.';

grant select on public.scoped_profiles to authenticated;

/*
  The reports, re-issued against it.

  Generated from the live definitions with one token replaced, which is 0040's technique
  (`public.profiles p` -> `public.counted_profiles p`) and 0043 §8's (the progress assert ->
  the per-screen assert). The reason is the same each time and has not got weaker: these
  functions are between eighty and three hundred lines each, re-issuing them by hand means
  copying eleven hundred lines to change one token in each, and a transcription error still
  applies, still runs, and is wrong in a report nobody re-reads.

  Discovered rather than listed. 0040 named its nine; naming them again here would be a second
  copy of a list that has already grown once (0048 re-issued two of them, 0049 a third), and a
  report added next year would silently not be scoped. `pg_get_functiondef` is asked which
  functions read the population, so the answer is the schema's rather than this file's.

  `if out_src is distinct from src` — so a replay, where the token is already gone, re-issues
  nothing rather than executing an identical definition into the notice log.
*/
do $$
declare
  fn      record;
  src     text;
  out_src text;
  n       integer := 0;
  names   text[] := '{}';
begin
  /*
    `offset 0` is an optimisation fence, not a no-op, and it is load-bearing.

    SQL does not order the predicates in a WHERE clause, so a planner free to evaluate
    `pg_get_functiondef(p.oid)` before `p.prokind = 'f'` will reach an aggregate — `array_agg`
    is in this catalogue like any other — and raise `42809: "array_agg" is an aggregate
    function`, aborting the migration for a reason that has nothing to do with what it is
    doing. Postgres does not flatten a subquery carrying OFFSET, so the cheap filter is
    guaranteed to have run before the expensive one sees a row.

    The one exclusion is a decision rather than an omission. `public.leaderboard()` is what
    src/lib/leaderboard.js calls: the ranking every યુવક sees. It reads the same population and
    must not be narrowed — the board is the same board for everybody, and a caller's
    administrative remit is not a fact about the સંઘ's ranking. In practice no યુવક has a scope
    row, so this changes nothing today; it is excluded so that it cannot start mattering when
    somebody who is scoped opens the app.
  */
  for fn in
    select f.oid, f.proname
    from (
      select p.oid, p.proname
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.prokind = 'f' and p.proname <> 'leaderboard'
      offset 0
    ) f
    where pg_get_functiondef(f.oid) like '%public.counted_profiles%'
    order by f.proname
  loop
    src := pg_get_functiondef(fn.oid);
    out_src := replace(src, 'public.counted_profiles', 'public.scoped_profiles');
    if out_src is distinct from src then
      execute out_src;
      n := n + 1;
      names := names || fn.proname;
    end if;
  end loop;

  raise notice '[0051] % report function(s) re-issued against public.scoped_profiles: %',
    n, array_to_string(names, ', ');

  /*
    A count of zero on a first application would mean the discovery found nothing — a renamed
    view, a changed spelling — and the migration would then apply cleanly having scoped no
    report at all. That is the one failure mode of a generated patch that is invisible
    afterwards, so it is refused here rather than discovered in a report six months later.

    Zero is legitimate on a replay, where every body already reads the new view. Told apart by
    asking the schema, not by counting.
  */
  if n = 0 and not exists (
    select 1
    from (
      select p.oid from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.prokind = 'f'
      offset 0
    ) f
    where pg_get_functiondef(f.oid) like '%public.scoped_profiles%'
  ) then
    raise exception '[0051] no report function reads public.counted_profiles - the population '
                    'view has moved and this migration would have scoped nothing';
  end if;
end
$$;

-- ================================================================ 4. one named person

/*
  Four functions resolve a single યુવક by id, and none of them enumerates a population — so
  none is reached by the view swap above, and each would happily return a full document for
  somebody in a zone the caller does not look after.

  Each is re-issued with `perform public.admin_assert_in_scope(p_user)` injected at a token
  unique to it. That is more fragile than a single shared token would be, so it is done in two
  passes: the first tries every anchor, and the second raises if any of the four came out
  without the call in it. A failed injection is otherwise completely silent, and the thing it
  fails to add is the only thing standing between a scoped સંચાલક and another zone's records.

  The anchors put the check AFTER each function's own permission test and after its "no such
  user" test, so a refusal keeps naming the first rule that was actually broken.

  ── One anchor has to match two eras of the same body ───────────────────────

  A body's permission test is not a fixed string across this schema's history: 0029 wrote
  `admin_assert_progress_reader()`, and 0043 §8 re-issued ten functions to
  `admin_assert_report_reader('…')`. Which of the two is in a given body therefore depends on
  whether an EARLIER migration succeeded — and scripts/test-point-engine.mjs, which replays
  0031 onward, found exactly that: a replay in which 0043 aborted left `admin_daily_record_detail`
  carrying the 0029 form, and an injection that knew only one spelling failed on a file that had
  done nothing wrong. Both are matched, and the verification pass is what makes accepting both
  safe rather than hopeful.

  ── The anchors are regular expressions, and that is not decoration ─────────

  The first version of this block matched literal strings, and one of the four spanned a line
  break written as `chr(10)`. It applied cleanly in Docker and **failed on production** with
  "the anchor has moved" — because a stored function body carries whatever newline the file it
  was created from had, and the file was applied from a Windows checkout, where git leaves
  CRLF on disk. `db.mjs` reads the file byte for byte, so the body in production contains
  `\r\n` and the anchor containing `\n` matched nothing. Nothing was wrong with the function;
  the anchor was simply too literal to survive a checkout on another machine.

  So every pattern below joins its tokens with `\s+` and never with a newline of a particular
  kind. `regexp_replace` without the `g` flag rewrites the FIRST match only, which is what is
  wanted: these are the opening guards of each body.
*/
do $$
declare
  t       record;
  fn      record;
  src     text;
  out_src text;
  missing text[] := '{}';
  n       integer := 0;
begin
  -- ── pass one: inject ──────────────────────────────────────────────────────
  for t in
    select * from (values
      /*
        The progress detail page. It carries 0029's shared assert - 0043 §8 re-issued ten
        functions and this was not one of them, because it is not one of the six screens whose
        permission was split.

        Deliberately ONE anchor and not two. A second one naming `progress.detail.read` was
        written here first, against the day that permission is enforced on this function, and
        it was removed: scripts/test-permission-catalogue.mjs decides what is "enforced" by
        scanning the text of supabase/migrations, so a permission named in a string literal in
        this file reads to it as a permission some policy checks. It would have reported
        `progress.detail.read` as enforced while nothing enforces it - a false all-clear in the
        one test that exists to catch a tick box that hands out nothing. Speculating about a
        future body is not worth blinding that check, and the verification pass below is what
        makes the omission safe: if this anchor ever stops matching, the migration refuses to
        apply rather than quietly leaving the lookup unscoped.
      */
      ('admin_user_progress_detail',
       '(perform\s+public\.admin_assert_progress_reader\s*\(\s*\)\s*;)'),

      -- One day of one યુવક's own record. 0043 §8 pointed it at points.records.read; on a
      -- replay where that file has not run yet it is still 0034's shared assert. Both eras
      -- are matched by one pattern rather than two rows, because the only difference is which
      -- assert is called and the injection goes after either of them.
      ('admin_daily_record_detail',
       '(perform\s+public\.admin_assert_(progress_reader\s*\(\s*\)|report_reader\s*\([^)]*\))\s*;)'),

      /*
        લેવલ ૩ for one person. 0035 wrote its permission test inline rather than calling the
        shared assert, so the anchor is its "no such user" test - the next statement in the
        body, and the one whose refusal must keep coming first.

        `admin_assert_in_scope()` returns immediately for a null id, so putting the call in
        front of this `if` does not swallow `level3_detail_no_user`.
      */
      ('admin_user_level3_detail',
       '(if\s+p_user\s+is\s+null\s+then)'),

      /*
        The one WRITE in the four, and the one that matters most: awarding points by hand to a
        named person. Anchored on the statement AFTER 0031's own `points_unknown_user` test, so
        "there is no such user" is still answered before "he is not yours".
      */
      ('admin_award_manual_points',
       '(if\s+p_points\s+is\s+null\s+or\s+p_points\s*=\s*0\s+then)')
    ) as v(fn, anchor)
  loop
    for fn in
      -- By oid: admin_user_progress_detail has two overloads (0029 and 0030) and a rewrite
      -- that caught only one would leave the other unscoped.
      select p.oid
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname = t.fn and p.prokind = 'f'
    loop
      src := pg_get_functiondef(fn.oid);

      -- Already carries it: a replay, or an earlier anchor in this same list matched.
      if src like '%admin_assert_in_scope%' then
        continue;
      end if;

      /*
        `\1` puts the matched statement back, and the scope check goes on the side of it that
        each comment above argues for: after an assert, before an `if`. One expression covers
        both because the two rows that anchor on an `if` want the call first and the two that
        anchor on an assert want it second - so the ordering is carried by which token was
        chosen as the anchor, and not by a second column nobody would keep in step with it.
      */
      out_src := regexp_replace(
        src,
        t.anchor,
        case
          when t.anchor like '(if%'
            then 'perform public.admin_assert_in_scope(p_user);' || chr(10) || '  \1'
          else '\1' || chr(10) || '  perform public.admin_assert_in_scope(p_user);'
        end
      );

      if out_src is distinct from src then
        execute out_src;
        n := n + 1;
      end if;
    end loop;
  end loop;

  -- ── pass two: verify ──────────────────────────────────────────────────────
  for fn in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prokind = 'f'
      and p.proname in ('admin_user_progress_detail', 'admin_daily_record_detail',
                        'admin_user_level3_detail', 'admin_award_manual_points')
  loop
    if pg_get_functiondef(fn.oid) not like '%admin_assert_in_scope%' then
      missing := missing || (fn.proname || '(' || pg_get_function_identity_arguments(fn.oid) || ')');
    end if;
  end loop;

  /*
    Refused loudly, and the message says what to look at.

    A failed injection is otherwise completely silent, and the thing it fails to add is the only
    thing standing between a scoped સંચાલક and another zone's records. The hint names the one
    thing that has actually gone wrong here before - an anchor too literal to match a body
    stored from a differently-checked-out file - so the next person meets a diagnosis rather
    than a mystery.
  */
  if array_length(missing, 1) > 0 then
    raise exception
      '[0051] the scope check could not be injected into: %. These lookups would return '
      'another zone''s records without saying so, so nothing here has been applied.',
      array_to_string(missing, ', ')
      using hint = 'Read the live body with: select pg_get_functiondef(oid) from pg_proc '
                   'where proname = ''<the function named above>''; and compare it with the '
                   'anchor pattern in section 4 of this file. No data is involved either way - '
                   'this migration writes no yuvak row anywhere.';
  end if;

  raise notice '[0051] % single-person lookup(s) now refuse a yuvak outside the caller''s zones.', n;
end
$$;

-- ================================================================ 5. the tables themselves

/*
  Twelve tables a browser can read over PostgREST, each already carrying a permissive policy of
  the shape `user_id = auth.uid() or has_permission('progress.read')`.

  RESTRICTIVE, so each is ANDed with whatever is already there and not one existing qual is
  touched. Each says exactly one thing. For an unrestricted caller `user_in_caller_scope()` is
  a constant true, so this is a no-op for everybody until the first scope row is written.

  `for select` and not `for all`: §19 keeps this panel read-only over people, the writes on
  these tables are the યુવક's own and pass the first half of every policy above, and the panel's
  one write - admin_award_manual_points() - is SECURITY DEFINER and is guarded in §4 instead.
  A restrictive write policy here would add a second, differently-worded gate on the same act.

  `daily_activity_counts` is the odd one and is listed with its own expression: it hangs off
  `daily_activity_records` by `record_id` and has no `user_id` of its own, so scoping it by a
  column it does not have would have silently skipped it - which is the leak that is hardest to
  notice, because the parent row is correctly hidden and the line items are not.
*/
do $$
declare
  t     record;
  n     integer := 0;
  names text[] := '{}';
begin
  for t in
    select * from (values
      ('progress',                 'public.user_in_caller_scope(user_id)'),
      ('learning_state',           'public.user_in_caller_scope(user_id)'),
      ('learning_sessions',        'public.user_in_caller_scope(user_id)'),
      ('activity_attempts',        'public.user_in_caller_scope(user_id)'),
      ('daily_activity_progress',  'public.user_in_caller_scope(user_id)'),
      ('daily_activity_records',   'public.user_in_caller_scope(user_id)'),
      ('daily_activity_updates',   'public.user_in_caller_scope(user_id)'),
      ('level3_drafts',            'public.user_in_caller_scope(user_id)'),
      ('level4_activity_progress', 'public.user_in_caller_scope(user_id)'),
      ('level4_attempts',          'public.user_in_caller_scope(user_id)'),
      ('point_transactions',       'public.user_in_caller_scope(user_id)'),
      ('daily_activity_counts',
       'exists (select 1 from public.daily_activity_records r'
       ' where r.id = record_id and public.user_in_caller_scope(r.user_id))')
    ) as v(tbl, expr)
  loop
    -- Skipped rather than raised: a table that does not exist in this project is a schema this
    -- migration does not know, and refusing to apply would be worse than saying so.
    if not exists (
      select 1 from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relname = t.tbl and c.relkind = 'r'
    ) then
      raise notice '[0051] no public.% - skipped', t.tbl;
      continue;
    end if;

    execute format('drop policy if exists "zone scope limits this" on public.%I', t.tbl);
    execute format(
      'create policy "zone scope limits this" on public.%I as restrictive for select using (%s)',
      t.tbl, t.expr
    );
    n := n + 1;
    names := names || t.tbl;
  end loop;

  raise notice '[0051] % table(s) now filtered by zone for a scoped caller: %',
    n, array_to_string(names, ', ');
end
$$;

/*
  And `profiles`, which needs its own because the column is on the row rather than behind a
  `user_id`.

  `id = auth.uid()` first, so a યુવક reading his own profile is unaffected whatever anybody has
  scoped — and so is a સંચાલક reading his own, which is what adminAuth.jsx does on every page
  load to put a name in the corner.

  `for all` here and not `for select`: this table takes writes from the panel (`users.update`)
  as well as reads, and an administrator who may not SEE a યુવક must not be able to edit him
  either. The two halves are given the same expression so there is nothing to keep in step.
*/
drop policy if exists "zone scope limits this" on public.profiles;
create policy "zone scope limits this" on public.profiles
  as restrictive
  for all
  using (id = (select auth.uid()) or public.in_caller_scope(sub_zone_id))
  with check (id = (select auth.uid()) or public.in_caller_scope(sub_zone_id));

/*
  `in_caller_scope` is deliberately NOT hoisted into `(select …)` the way 0039 hoisted
  has_permission(). It takes a column, so it is per-row by nature and a scalar subquery would
  not compile. `caller_scope()` inside it is the `stable` call, and that is the one Postgres
  caches for the statement.
*/

-- ================================================================ 6. who may write a scope

/*
  Every rule that decides whether a scope may be written, in a BEFORE trigger rather than only
  in a policy — for the reason 0004 gives and 0043 repeats: a policy sees the new row and not
  the old one's role, cannot express "at or above your own", and does not bind service_role.

  The messages are verbatim and are asserted by scripts/test-scope.mjs, so they are identifiers
  that happen to read as English. adminService.js matches them to word each refusal for the
  person who hit it, exactly as it does for admins_guard()'s eight.
*/
create or replace function public.admin_scopes_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller     uuid := auth.uid();
  subject    uuid := case tg_op when 'DELETE' then old.admin_id else new.admin_id end;
  their_role text;
begin
  -- A migration, or the secret key. Both are server-side and already trusted, and this is the
  -- only way the first rows in this table could exist at all. Same opening as every guard 0043
  -- wrote.
  if caller is null then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if not public.has_permission('scope.assign') then
    raise exception 'not permitted to limit an administrator to a zone' using errcode = 'P0001';
  end if;

  /*
    Your own scope, never.

    The same rule `admins_guard()` applies to your own role and status, and here it prevents a
    smaller but sillier failure as well: an administrator who scopes himself out of the zone he
    is in cannot see the screen that would let him undo it.
  */
  if subject = caller then
    raise exception 'an administrator cannot change their own access' using errcode = 'P0001';
  end if;

  select a.role into their_role from public.admins a where a.id = subject;

  /*
    A SUPER_ADMIN is never scoped.

    0046 makes exactly one of them exist. If that one could be narrowed to વરાછા then no account
    in the સંઘ would see વેડરોડ, every report would quietly be a report about part of the સંઘ,
    and nothing on any screen would say so. This is the invariant that keeps "the numbers are
    the numbers" true for at least one person.
  */
  if their_role = 'SUPER_ADMIN' then
    raise exception 'a Super Admin sees every zone and cannot be limited to one'
      using errcode = 'P0001';
  end if;

  if tg_op <> 'DELETE' then
    new.granted_by := caller;
    new.granted_at := now();
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

revoke all on function public.admin_scopes_guard() from public;

drop trigger if exists admin_scopes_guard on public.admin_scopes;
create trigger admin_scopes_guard
  before insert or update or delete on public.admin_scopes
  for each row execute function public.admin_scopes_guard();

comment on function public.admin_scopes_guard() is
  'scope.assign is required; nobody may change their own scope; a SUPER_ADMIN may not be '
  'scoped at all (0051). A BEFORE trigger and not only a policy, so it binds service_role and '
  'can read the subject''s role rather than only the row being written.';

/*
  The trail.

  One row per zone added or removed, not one per save — the same choice audit_role_permission()
  made and for the same reason: the panel saves a scope as a set of tick boxes, and a single
  SCOPE_CHANGED carrying two JSON blobs leaves the reader to diff them. "વરાછા was added to
  Ramesh" is the sentence somebody needs a year later.
*/
create or replace function public.audit_admin_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, target_id, "before", "after")
  values (
    actor,
    public.effective_role(),
    'SCOPE_CHANGED',
    'admin_scopes',
    (case tg_op when 'DELETE' then old.admin_id else new.admin_id end)::text,
    case tg_op when 'DELETE' then to_jsonb(old) else null end,
    case tg_op when 'DELETE' then null else to_jsonb(new) end
  );

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

revoke all on function public.audit_admin_scope() from public;

drop trigger if exists audit_admin_scopes on public.admin_scopes;
create trigger audit_admin_scopes
  after insert or update or delete on public.admin_scopes
  for each row execute function public.audit_admin_scope();

-- ================================================================ 7. reading the table

alter table public.admin_scopes enable row level security;

/*
  Readable by anyone who may read administrators, and by the person himself.

  His own row matters: the panel tells a scoped સંચાલક which zones he is looking at, on every
  page, and it cannot do that from a table he may not read. It is also the honest half of the
  bargain — being limited is not something to be discovered by finding a report shorter than
  expected.
*/
drop policy if exists "scopes readable" on public.admin_scopes;
create policy "scopes readable" on public.admin_scopes
  for select using (
    admin_id = (select auth.uid()) or (select public.has_permission('admins.read'))
  );

drop policy if exists "scopes writable by permission" on public.admin_scopes;
create policy "scopes writable by permission" on public.admin_scopes
  for all
  using ((select public.has_permission('scope.assign')))
  with check ((select public.has_permission('scope.assign')));

grant select, insert, delete on public.admin_scopes to authenticated;
-- No UPDATE. A scope is a set of (admin, zone) rows; changing one means adding or removing a
-- row, and an UPDATE that moved a scope from one zone to another would be one audit entry
-- describing two changes.
revoke update on public.admin_scopes from authenticated;

-- ================================================================ 8. the panel's own session

/*
  `admin_session()` gains the scope, so the panel knows on the first render whether it is
  showing part of the સંઘ.

  Dropped and re-created rather than replaced: `create or replace function` cannot change a
  return type (42P13), and this adds a column to a `returns table`. Nothing depends on it in
  pg_depend — it is called over RPC by admin/src/lib/adminAuth.jsx and by nothing in SQL — so
  the drop cascades to nothing.

  It returns the zone ids and NOT the names. The names are `geography()`'s answer, the panel
  already loads it for its filters, and a label duplicated into a second call is a label that
  can disagree with the list beside it after somebody renames a zone.
*/
drop function if exists public.admin_session();

create or replace function public.admin_session()
returns table (
  role         text,
  role_label   text,
  rank         integer,
  permissions  text[],
  scope        text[],
  is_bootstrap boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    public.effective_role(),
    coalesce((select r.label from public.admin_roles r where r.key = public.effective_role()),
             public.effective_role()),
    public.caller_rank(),
    public.caller_permissions(),
    -- NULL, not an empty array, and the client must keep the difference: null is "every zone"
    -- and would be an empty array if it were flattened here.
    public.caller_scope(),
    exists (select 1 from public.bootstrap_admins b where b.id = auth.uid())
  where public.effective_role() is not null;
$$;

comment on function public.admin_session() is
  'Everything the panel needs to render itself, in one call: role, label, rank, the resolved '
  'permission list, the zones he is limited to (NULL for all of them, 0051), and whether the '
  'caller is holding a bootstrap fallback. Returns no row at all for an ordinary યુવક, which is '
  'the same answer effective_role() gave as NULL.';

revoke all on function public.admin_session() from public;
grant execute on function public.admin_session() to authenticated;

-- ================================================================ 9. the zone counts

/*
  `geography()` re-issued so its യുവક counts are the caller's own.

  0050 returns a count per city and per zone from `public.yuvaks`, and it is SECURITY DEFINER —
  so the view is read as the owner and RLS, including §5's restrictive policy, does not apply.
  Left alone, a વરાછા-scoped સંચાલક would open the scope editor and read how many યુવકો are in
  the two zones he cannot see. That is a small disclosure and it is exactly the kind that makes
  a person distrust the rest of the screen.

  Everything else about the function is 0050's, character for character, including the two
  reasons the counts are zero for a signed-out visitor.
*/
create or replace function public.geography()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'cities', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name, 'status', c.status, 'sort_order', c.sort_order,
               'yuvaks', case when auth.uid() is null then 0 else (
                 select count(*) from public.yuvaks y
                 where y.zone_id = c.id and public.in_caller_scope(y.sub_zone_id)
               ) end
             ) order by c.sort_order, c.name, c.id)
      from public.cities c
      where auth.uid() is not null or c.status = 'ACTIVE'
    ), '[]'::jsonb),

    'zones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', z.id, 'city_id', z.city_id, 'name', z.name, 'status', z.status,
               'sort_order', z.sort_order,
               'yuvaks', case when auth.uid() is null then 0 else (
                 select count(*) from public.yuvaks y
                 where y.sub_zone_id = z.id and public.in_caller_scope(y.sub_zone_id)
               ) end
             ) order by z.sort_order, z.name, z.id)
      from public.zones z
      where auth.uid() is not null or z.status = 'ACTIVE'
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.geography() from public;
grant execute on function public.geography() to anon, authenticated;

comment on function public.geography() is
  'Every city and zone in one document, in the સંચાલક''s order, for નોંધણી''s two dropdowns, '
  'the panel''s filters and the scope editor (0050). The counts come from public.yuvaks - '
  'administrators and test accounts excluded - and are narrowed to the caller''s own zones '
  '(0051), so a scoped સંચાલક is never told how many યુવકો are somewhere he cannot look. The '
  'place NAMES are not narrowed: a યુવક in a zone has to print with its name wherever he '
  'appears. A signed-out caller sees ACTIVE places only and no counts at all.';

-- ================================================================ say what happened

do $$
declare
  n_scoped integer;
  n_zones  integer;
begin
  select count(distinct admin_id) into n_scoped from public.admin_scopes;
  select count(*) into n_zones from public.zones;

  raise notice '[0051] admin_scopes exists. % administrator(s) are limited to a zone.', n_scoped;
  raise notice '[0051] % zone(s) available to scope to. NO ROWS FOR SOMEBODY MEANS EVERY ZONE,', n_zones;
  raise notice '[0051] so nothing any administrator can see has changed by applying this file.';
end
$$;
