-- વર્ણી ધ્યાન — ક્રમાંક, the one place in this project where a યુવક reads another યુવક's
-- number, opened once and as narrowly as it can be opened.
--
-- What this adds
-- --------------
-- Three functions and one reissue, and not one row of anybody's data:
--
--   `leaderboard_settings()`       settings['levels'].value.leaderboard as it stands right
--                                  now — is the board on, which windows are offered, which
--                                  one opens first, how many names may stand on it.
--   `settings_check_leaderboard()` a BEFORE INSERT OR UPDATE trigger on `settings` that
--                                  refuses what that resolver would silently narrow.
--   `leaderboard(p_period text)`   **the aperture.** The only path in this schema by which
--                                  one યુવક learns anything at all about another.
--   `nav_registry()`               reissued with `leaderboard` flipped to `ready = true`,
--                                  because `/leaderboard` is now a route src/App.jsx serves.
--
-- Why this shape and not the obvious one
-- --------------------------------------
-- The obvious shape is a view — `create view leaderboard as select name, sum(points) ...` —
-- granted to `authenticated`, and it is wrong in two different ways at once.
--
-- **A `security_invoker` view cannot do this at all.** RLS on `point_transactions` (0021) is
-- `user_id = auth.uid() or has_permission('progress.read')`, so a view running as the caller
-- would show a યુવક a leaderboard of exactly one person: himself, in first place, alone. It
-- would look like a working feature and be a mirror.
--
-- **A view WITHOUT `security_invoker` is a hole.** It would run as its owner, and a client
-- may add its own `select`, `order`, `limit` and — this is the part that matters — its own
-- `where` to any view through PostgREST. A column list is not an access control; whatever a
-- view exposes can be filtered on, and filtering is asking questions. `?user_id=eq.<uuid>`
-- against such a view is a question about one named person.
--
-- So the crossing is a **function**, and a function is the right instrument precisely because
-- it takes one parameter and returns one already-assembled document. There is no `where` to
-- attach to it, no column to select that it did not decide to build, and no row that can be
-- asked for by name. What comes back is what §13 permits and nothing beside it:
--
--   1. **No identifier. Not even an opaque one.** `rows` carries `rank`, `name`, `points`,
--      `isMe`, and that is the complete list. An id is what turns a list of names into a set
--      of keys another request can be built around; without one, a row of this board cannot
--      be joined to anything, anywhere, by anybody. No SMK, no મોબાઈલ, no email, no સબઝોન,
--      no dates, no per-activity detail.
--   2. **Only યુવકો who have actually earned something.** A total of zero, or no rows at
--      all in the window, is not on the board. A list of everybody at ૦ is not a ranking, it
--      is a directory of the સંઘ — which is the §13 problem arriving by another door.
--   3. **Only while the સંચાલક has switched it on**, and `enabled: false` is the default. A
--      project that applies this migration and never opens the panel discloses nothing at
--      all: the function returns an empty board, and there is no other reader.
--   4. **Only the top N**, bounded at 100 by `leaderboard_settings()`, because a board naming
--      all ~500 યુવકો is rule 2's directory again wearing a large number.
--
-- shared/domain/leaderboard.js is the frozen contract for all of this; `leaderboard_settings()`
-- mirrors `resolveLeaderboard()` branch for branch and `settings_check_leaderboard()` mirrors
-- `validateLeaderboard()` message for message, the same resolver/validator pairing 0014
-- established for the લેવલ ૪ gate, 0018 for the slideshow and 0021 for points: a resolver that
-- forgives, so a યુવક's page never fails over a field he cannot see, and a validator that
-- refuses, so the સંચાલક is told at the moment he mistypes.
--
-- What this does NOT change
-- -------------------------
-- * **Not one RLS policy, anywhere.** None is added, none is widened, and `point_transactions`
--   in particular keeps exactly the policy 0021 gave it and keeps its revoked insert, update
--   and delete privileges. The aperture is the SECURITY DEFINER function below and nothing
--   else; if `leaderboard()` were dropped tomorrow, no યુવક could read another's row by any
--   path in this schema. That property is the whole design and it is worth stating as a test:
--   a future change that "just adds a policy so the view works" has undone this migration.
-- * **No table is altered and none is created.** `point_transactions`, `profiles`,
--   `activity_attempts`, `daily_activity_progress`, `progress` — all untouched, no new column,
--   no new index, no new constraint.
-- * **No new permission and no new role.** `permissions_for()` is not reissued. Reading the
--   board is not a permission — it is being a signed-in, ACTIVE યુવક — and configuring it is
--   `settings.update`, which already exists and already covers this key.
-- * **Nothing is seeded.** No `settings` row is written or defaulted here. The board is off
--   until a સંચાલક turns it on, and turning it on is a decision about somebody's સંઘ that a
--   migration must not make on their behalf.
-- * **`settings_check_slideshow` (0018), `settings_check_mobile_nav` (0019) and
--   `settings_check_points` (0021).** The trigger added here is the **fourth** BEFORE trigger
--   on `public.settings` and replaces none of them: the four examine different keys —
--   `app.slideshow`, `nav.mobileBottom`, `levels.points` and `levels.leaderboard` — and all
--   four run on every settings write. Two of them now watch the same row (`key = 'levels'`)
--   and are still independent, because each early-returns on the key it does not own.
-- * **The bottom bar of anybody already running.** `nav_registry()` gains a `ready = true`,
--   which means "this build has the screen" and has never meant "show it". Whether ક્રમાંક
--   stands in a યુવક's bar stays the સંચાલક's, decided by the `settings['nav']` row he
--   already has, exactly as 0020 and 0022 left it.

-- ================================================================ the resolver

-- `settings['levels'].value.leaderboard` as the row holds it right now.
--
-- Mirrors `resolveLeaderboard()` in shared/domain/leaderboard.js branch for branch, including
-- which way each malformed value falls — and the direction every branch falls is **closed**,
-- for the reason that file states and that is sharper here than anywhere else in the schema:
-- this function decides whether one યુવક may see another's name. A raise would be an error on
-- a page; a wrong `true` would be a disclosure.
--
--   absent / not an object      → off, no windows. Nothing configured shows nothing.
--   `enabled` not exactly true  → off. `= 'true'::jsonb`, never truthiness: the stored value
--                                 is jsonb and the *string* 'false' is truthy in the language
--                                 the panel is written in.
--   `periods` not an array      → empty, and therefore off. Deliberately **not** "fall back to
--                                 ALL": a malformed field must not widen the window it failed
--                                 to describe, and ALL is the widest one there is.
--   an unknown period string    → dropped, the rest survive. A row written by a later build
--                                 naming a fifth window costs one tab, not the board.
--   duplicates / wrong order    → both fixed by the same pass. See below.
--   `defaultPeriod` not offered → the first surviving period. A default naming a tab that is
--                                 not on screen would open the board on nothing.
--   `topN` absent/out of range  → 20. Not clamped to the nearer bound: `whole()` in the shared
--                                 module returns null outside 3..100 and the `?? 20` supplies
--                                 the default, so this does the same. The prose there says
--                                 "clamped" and the code is what is mirrored — they differ
--                                 only over a row the trigger below refuses anyway, and 20 is
--                                 inside the range either way.
--
-- **`enabled` is true only when a window survived**, which is the resolver's own
-- `s.enabled === true && periods.length > 0`. A board that is on with nothing to show is off.
--
-- The periods are filtered **from the canonical list rather than from the stored one**, which
-- is not a stylistic choice: it de-duplicates and imposes the tab order in a single pass, so
-- `["ALL","WEEK","ALL"]` becomes `{WEEK,ALL}` — narrowest window first — whatever order it was
-- written in. `jsonb ? text` tests array membership as well as object keys, so a non-string
-- element cannot match a period name and simply contributes nothing.
--
-- The nested CASE for `topN`, never `jsonb_typeof(x) = 'number' and (x)::numeric > ...`:
-- Postgres does not promise left-to-right evaluation of AND, so the cast in a second arm may
-- run even when the first arm is false, and `('"twenty"'::jsonb ->> 'topN')::numeric` raises.
-- An ordered CASE is the documented way to make a guard actually guard (0018:70-72, 0021).
--
-- Rounding before the range test, not after, because `whole()` does exactly that:
-- `Math.round(n)` and then the bound. (`round()` here breaks halves away from zero where JS
-- breaks them upward; the trigger below refuses fractions outright, so the two can only
-- disagree about a row no panel wrote.)
--
-- SECURITY DEFINER and revoked from `public` with **no grant at all**, for the reason 0014
-- gives about `level4_gate_setting()`: it must answer identically for every caller, and it
-- returns configuration and nothing about any person. Its only caller is `leaderboard()`
-- below, which runs as the owner and needs no grant. The panel gets the same four values by
-- resolving the `settings` row it already fetches.
create or replace function public.leaderboard_settings()
returns table (enabled boolean, periods text[], default_period text, top_n integer)
language sql
stable
security definer
set search_path = public
as $$
  with raw as (
    select s.value -> 'leaderboard' as b
    from public.settings s
    where s.key = 'levels'
  ),
  asked as (
    -- Not an array → the empty array, which is the resolver's `Array.isArray(...) ? ... : []`.
    select case when jsonb_typeof(b -> 'periods') = 'array' then b -> 'periods' else '[]'::jsonb end as p
    from raw
  ),
  kept as (
    -- The canonical order, narrowest first, and the same list LEADERBOARD_PERIODS holds. A
    -- window named here and nowhere else in this file would be a tab with no lower bound in
    -- `leaderboard()` — keep the two in step.
    select coalesce(array_agg(c.period order by c.ord), '{}'::text[]) as periods
    from (values ('DAY'::text, 1), ('WEEK', 2), ('MONTH', 3), ('ALL', 4)) as c(period, ord)
    -- No settings row at all → the scalar subquery is null, `null ? 'DAY'` is null, and
    -- nothing survives. Which is the closed direction, and is meant to be.
    where (select a.p from asked a) ? c.period
  )
  select
    coalesce((select (r.b -> 'enabled') = 'true'::jsonb from raw r), false)
      and coalesce(array_length(k.periods, 1), 0) > 0,

    k.periods,

    coalesce(
      -- `->>` on a number, an object or a jsonb null gives text that is not one of the four
      -- period names, so this single test covers both halves of the resolver's
      -- `isPeriod(...) && periods.includes(...)`.
      (select r.b ->> 'defaultPeriod' from raw r where (r.b ->> 'defaultPeriod') = any (k.periods)),
      k.periods[1],
      'ALL'
    ),

    coalesce(
      (select case when jsonb_typeof(r.b -> 'topN') = 'number' then
                case when round((r.b ->> 'topN')::numeric) between 3 and 100
                     then round((r.b ->> 'topN')::numeric)::integer end
              end
       from raw r),
      20
    )
  from kept k;
$$;

revoke all on function public.leaderboard_settings() from public;

comment on function public.leaderboard_settings() is
  'The ક્રમાંક configuration in force, from settings[''levels''].value.leaderboard (0023). '
  'Mirrors resolveLeaderboard() in shared/domain/leaderboard.js branch for branch: enabled is '
  'true only when the jsonb is exactly true AND a valid period survived, periods are filtered '
  'from the canonical order so they are de-duplicated and narrowest-first, defaultPeriod falls '
  'to the first offered one, topN out of 3..100 falls to 20. Defaults to off, so a project '
  'that never opens the panel discloses nothing. Revoked with no grant: its only caller is '
  'leaderboard(), which runs as the owner.';

-- ================================================================ the bound

-- Refuses what `leaderboard_settings()` above would silently narrow.
--
-- Mirrors `validateLeaderboard()` in shared/domain/leaderboard.js message for message, in the
-- same order, so the wording a સંચાલક reads is the same whether the save was stopped by the
-- panel or by the database.
--
-- **The deliberate asymmetry, and why it is not a bug.** Switching the board on with no window
-- chosen *resolves* to off — `enabled and at least one period` — but is **refused** here. The
-- two differ on purpose. A resolver reading a stored row has no one to tell, so it must fall
-- closed and carry on; a સંચાલક who ticks the box, saves, and is told "Saved" would then go
-- looking at a board that is dark, with nothing on any screen to say that he had not finished.
-- Refusing the write is the only moment at which that can be explained to the person who can
-- fix it. The same reasoning runs the other way for `topN`: out of range falls to 20 in the
-- resolver and is refused here, because 20 is a page length nobody chose.
--
-- And it is a trigger rather than only a panel check because `settings` is writable through
-- PostgREST by anyone `has_permission('settings.update')` admits, with no obligation to go
-- anywhere near admin/src. A disabled control is not a rule (0018). A curl could otherwise put
-- `{"enabled": true, "periods": ["YEAR"], "topN": 5000}` in this row, and every યુવક would
-- open ક્રમાંક on a board that is off — the resolver dropping the unknown window exactly as
-- designed, with nothing anywhere to say why.
--
-- Only `key = 'levels'`, and only when `leaderboard` is actually present in the incoming value.
-- `?` tests for the key rather than for a non-null value, so `{"leaderboard": null}` is caught
-- as the malformed write it is instead of slipping through as "absent". A write that does not
-- mention the key is not examined at all, which is what lets this sit beside
-- `settings_check_points()` on the same row without either seeing the other's writes.
create or replace function public.settings_check_leaderboard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v      jsonb;
  e      jsonb;
  kept   text[];
  want   text;
  n      numeric;
begin
  if new.key <> 'levels' or not (new.value ? 'leaderboard') then
    return new;
  end if;

  v := new.value -> 'leaderboard';

  if jsonb_typeof(v) <> 'object' then
    raise exception 'The leaderboard setting is missing.' using errcode = 'check_violation';
  end if;

  -- A real boolean, not truthiness. An absent switch is not "off" here: the સંચાલક is saving
  -- a leaderboard configuration and has to have said which way it goes.
  if jsonb_typeof(v -> 'enabled') <> 'boolean' then
    raise exception 'Leaderboard: turn it on or off before saving.'
      using errcode = 'check_violation';
  end if;

  if jsonb_typeof(v -> 'periods') <> 'array' then
    raise exception 'Leaderboard: choose which periods to show.'
      using errcode = 'check_violation';
  end if;

  -- Every element is examined, not only the ones a panel would write. The resolver would drop
  -- an unknown window and carry on; refusing it here is the same trade the message above
  -- makes — a tab the સંચાલક chose and cannot see appearing is worse than a save that
  -- explains itself. `#>> '{}'` rather than `->>` so a non-string element is named in the
  -- error as whatever it actually is instead of arriving as a null.
  for e in select el.value from jsonb_array_elements(v -> 'periods') el loop
    if (e #>> '{}') is null or (e #>> '{}') not in ('DAY', 'WEEK', 'MONTH', 'ALL') then
      raise exception 'Leaderboard: "%" is not a period.', coalesce(e #>> '{}', 'null')
        using errcode = 'check_violation';
    end if;
  end loop;

  -- The surviving windows, in canonical order — the same single pass the resolver makes, so
  -- the two checks below are asked about exactly the list that would be in force.
  select coalesce(array_agg(c.period order by c.ord), '{}'::text[])
    into kept
  from (values ('DAY'::text, 1), ('WEEK', 2), ('MONTH', 3), ('ALL', 4)) as c(period, ord)
  where (v -> 'periods') ? c.period;

  -- The asymmetry, in one line. See the essay above this function.
  if (v -> 'enabled') = 'true'::jsonb and coalesce(array_length(kept, 1), 0) = 0 then
    raise exception 'Leaderboard: choose at least one period to show.'
      using errcode = 'check_violation';
  end if;

  want := v ->> 'defaultPeriod';

  if want is null or want not in ('DAY', 'WEEK', 'MONTH', 'ALL') then
    raise exception 'Leaderboard: choose which period opens first.'
      using errcode = 'check_violation';
  end if;

  -- Only when there is a list to be part of: an `enabled: false` row with no periods at all is
  -- legal — it is what the panel writes when the board is switched off — and a default that
  -- names a window nobody offered is only a contradiction once windows exist.
  if coalesce(array_length(kept, 1), 0) > 0 and not (want = any (kept)) then
    raise exception 'Leaderboard: "%" opens first but is not one of the periods shown.',
      case want
        when 'DAY'   then 'Today'
        when 'WEEK'  then 'This week'
        when 'MONTH' then 'This month'
        else 'All time'
      end
      using errcode = 'check_violation';
  end if;

  if jsonb_typeof(v -> 'topN') <> 'number' then
    raise exception 'Leaderboard: enter how many names to list.'
      using errcode = 'check_violation';
  end if;

  n := (v ->> 'topN')::numeric;

  -- Whole names only. Accepting 20.5 here while the resolver rounds it to 21 would put a
  -- number in the panel's field that is not the number any board is being cut at.
  if n <> trunc(n) then
    raise exception 'Leaderboard: the number of names must be a whole number.'
      using errcode = 'check_violation';
  end if;

  -- The floor is 3 because a board of one or two is not a ranking, it is a notice about the
  -- person at the top. The ceiling is 100 because this list is read on a phone on Surat mobile
  -- data, and because a board naming all ~500 યુવકો is a directory again.
  if n < 3 or n > 100 then
    raise exception 'Leaderboard: list between 3 and 100 names.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.settings_check_leaderboard() from public;

drop trigger if exists settings_check_leaderboard on public.settings;

-- BEFORE, so a refused write never reaches the row — and never reaches `audit_setting`
-- either, which would otherwise file an entry for a change that did not happen. Ordering
-- against the audit trigger does not arise: this one is BEFORE and that one is AFTER.
--
-- This is the **fourth** BEFORE trigger on `public.settings`. It sits alongside
-- `settings_check_slideshow` (0018), `settings_check_mobile_nav` (0019) and
-- `settings_check_points` (0021) rather than replacing any of them: the four examine different
-- keys and **all four run on every settings write**. Two of them now watch the same row —
-- `settings_check_points` and this one both fire on `key = 'levels'` — and they stay
-- independent because each early-returns on the sub-key it does not own, so a save that
-- rewrites `points` alone is never judged against the leaderboard's rules and the reverse.
create trigger settings_check_leaderboard
  before insert or update on public.settings
  for each row execute function public.settings_check_leaderboard();

comment on function public.settings_check_leaderboard() is
  'Refuses a settings[''levels''].value.leaderboard write that leaderboard_settings() would '
  'silently narrow (0023). Mirrors validateLeaderboard() in shared/domain/leaderboard.js '
  'message for message. Deliberately asymmetric with the resolver: enabled with no period '
  'RESOLVES to off but is REFUSED here, because a સંચાલક told "Saved" would find the board '
  'dark with nothing on screen to say he had not finished. The fourth BEFORE trigger on '
  'public.settings, alongside 0018, 0019 and 0021; all four run.';

-- ================================================================ the aperture

-- ────────────────────────────────────────────────────────────────────────────
-- THE one place a યુવક reads another યુવક. Read all of this before changing any of it.
-- ────────────────────────────────────────────────────────────────────────────
--
-- Every table in this project is built on one sentence from §13, which 0001's own header
-- states as a fact about the schema rather than as an intention:
--
--     There is no path that reads another યુવક's row without being a સંચાલક.
--
-- `profiles`, `progress`, `learning_state`, `level4_attempts`, `activity_attempts` and
-- `point_transactions` all carry the same policy — `user_id = auth.uid() or
-- has_permission('progress.read')` — and 0010 and 0021 go further, revoking the write
-- privileges as well so that a future mistake in a policy still does not open a door.
--
-- A leaderboard is, by definition, a યુવક reading other યુવકો. There is no way to build one
-- that does not cross that line. So it is crossed **once, here, and nowhere else**, and this
-- function is the entire crossing: not a policy, not a view, not a grant on a table. Four
-- rules narrow it, and they are the four in shared/domain/leaderboard.js:
--
--   1. **A name and a number, and nothing else.** `rows` carries `rank`, `name`, `points`,
--      `isMe`. There is **no user_id — not even an opaque one** — and there must never be,
--      because an id is what turns a list of names into a key another request can be built
--      around: with one, a caller has 100 handles to ask `profiles`, `progress`,
--      `point_transactions` or a future endpoint a second question with. Without one, a row of
--      this board joins to nothing that exists. No SMK, no મોબાઈલ, no email, no સબઝોન id, no
--      dates, no per-activity detail. `normaliseLeaderboard()` on the client rebuilds each row
--      from those four fields alone, so even a future widening of this SELECT would have to be
--      accepted there deliberately before it could reach a screen.
--   2. **Only યુવકો who have actually earned something.** `having sum(points) > 0`, and a
--      યુવક with no rows in the window is absent rather than present at zero. A list of
--      everybody at ૦ is not a ranking, it is a roll of the સંઘ — the §13 problem arriving
--      through the door marked "but they are all zero, so it discloses nothing". It discloses
--      the membership, which is the thing.
--   3. **Only while the board is on**, and off is the default. A disabled board returns an
--      empty document — and returns it rather than raising, because a feature the સંચાલક has
--      switched off is not an error and a યુવક who opens the page must be shown a page.
--   4. **Only the top N, and only ACTIVE profiles.** The cut is `leaderboard_settings().top_n`,
--      bounded at 100. SUSPENDED and DISABLED accounts are not on the board at all: §7 says
--      suspend rather than delete, and a suspended account still appearing in front of two
--      thousand phones would make that lifecycle a label.
--
-- Two more properties are worth stating because they are what a reviewer will check for:
--
--   * **There is no `where` a caller can attach.** A view exposes its columns to PostgREST's
--     filter syntax, so `?user_id=eq.<uuid>` is a question about one named person; a function
--     takes `p_period` and returns one assembled jsonb document, and `p_period` can only ever
--     be one of four strings the સંચાલક offered — anything else is answered with the default.
--   * **`me` is computed over the FULL ranking, not the returned slice**, so a યુવક in 37th
--     place learns he is 37th out of 123 without the 36 names above him being sent to his
--     phone. That is the one figure this feature exists to give him, and it costs no
--     disclosure at all.
--
-- SECURITY DEFINER, `set search_path = public`, revoked from `public` and granted only to
-- `authenticated`. `anon` gets nothing: a signed-out request is refused before the settings
-- are even read.
create or replace function public.leaderboard(p_period text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
    join public.profiles p on p.id = e.user_id and p.status = 'ACTIVE'
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
$$;

revoke all on function public.leaderboard(text) from public;
grant execute on function public.leaderboard(text) to authenticated;

comment on function public.leaderboard(text) is
  'ક્રમાંક — the ONLY path in this schema by which one યુવક learns anything about another '
  '(0023). SECURITY DEFINER, and deliberately not a view: a view exposes its columns to '
  'PostgREST filters, so ?user_id=eq.<uuid> would be a question about one named person, while '
  'this takes a period and returns one assembled document. Returns rank, name, points and '
  'isMe — no user_id, not even an opaque one, and no SMK, mobile, email, સબઝોન, date or '
  'per-activity detail. Only ACTIVE profiles, only યુવકો whose window sums above zero, only '
  'the configured top N, and only while the સંચાલક has switched the board on; off returns an '
  'empty board rather than an error. The window''s lower bound is computed in IST from the '
  'server clock and never from the caller, and me is computed over the full ranking so a યુવક '
  'outside the top N still learns his place. Not one RLS policy is widened by this function '
  'and point_transactions is untouched.';

-- ================================================================ the registry

-- `leaderboard` becomes a destination the bottom bar may hold.
--
-- The whole of the change is one boolean: the ક્રમાંક row's `ready`, false since 0019, is now
-- true, because `/leaderboard` is a route src/App.jsx serves. `ready` is a fact about this
-- build and never an opinion a stored row may hold — no `settings['nav']` value can set it,
-- which is what has kept the panel able to SHOW the line ("not built yet") without any save or
-- any curl being able to turn it into a button that navigates nowhere. That guarantee is
-- unchanged; the fact underneath it is what moved.
--
-- The `values` list is otherwise copied verbatim from 0022, including 0022's own `history`
-- row. This is the same reissue 0020 made for `settings` and 0022 made for `history`, and it
-- is a whole migration for one word for the reason 0022's header gives: `nav_registry()` is
-- the second copy of `NAV_REGISTRY` in shared/domain/navigation.js, and a `ready` flag that
-- differs between the two is not cosmetic drift — it is the panel offering a checkbox that the
-- database then refuses to save, with the refusal arriving as a `check_violation` about a
-- button the સંચાલક can see on screen. scripts/test-navigation.mjs reads the highest-numbered
-- migration that defines this function and asserts the flags agree, which is what makes the
-- pair a checked fact rather than a remembered one.
--
-- `create or replace`, so the function keeps its oid, its grants and 0019's revoke. Dropping
-- and recreating would silently restore the default `execute to public`.
create or replace function public.nav_registry()
returns table (key text, route text, label text, icon text, ready boolean, required boolean)
language sql
immutable
as $$
  -- The first row carries the casts, exactly as in 0019: a bare `values` list types every
  -- literal `unknown`, and `returns table` resolves that positionally.
  values
    ('home'::text,  '/'::text,      'મુખપૃષ્ઠ'::text, 'home'::text, true, true),
    ('start',       '/welcome',     'ધ્યાન',        'play',    true,  false),
    ('darshan',     '/darshan',     'દર્શન',        'darshan', true,  false),
    ('revision',    '/level/3',     'પુનરાવર્તન',    'list',    true,  false),
    ('level4',      '/level/4',     'લેવલ ૪',       'grid',    true,  false),
    ('profile',     '/profile',     'મારું',        'person',  true,  false),
    ('settings',    '/settings',    'સેટિંગ',       'gear',    true,  false),
    ('history',     '/history',     'પ્રગતિ',       'star',    true,  false),
    -- The line this reissue exists for. `/leaderboard` is routed in src/App.jsx, and the
    -- board itself is `public.leaderboard()` above.
    ('leaderboard', '/leaderboard', 'ક્રમાંક',      'trophy',  true,  false);
$$;

comment on function public.nav_registry() is
  'Every destination a mobile bottom-bar button may have (0019; settings marked ready in '
  '0020, history added in 0022, leaderboard marked ready in 0023). The second copy of '
  'NAV_REGISTRY in shared/domain/navigation.js; scripts/test-navigation.mjs asserts the two '
  'agree, ready flags included. `ready` is whether src/App.jsx routes the path — no settings '
  'value may set it.';
