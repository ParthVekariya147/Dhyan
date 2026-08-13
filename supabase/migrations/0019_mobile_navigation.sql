-- વર્ણી ધ્યાન — the phone's bottom navigation bar becomes the સંચાલક's, with the rules
-- enforced where they cannot be walked around.
--
-- What this adds
-- --------------
-- `settings['nav'].value.mobileBottom` — an ordered list of which buttons stand at the
-- bottom of a યુવક's screen, under what word, with which icon. It was a literal nowhere:
-- until now the app had no bottom bar at all and every destination was reached from the
-- મુખપૃષ્ઠ. Which four things a યુવક can reach in one thumb-press is a judgement about what
-- he should be doing this month, not a fact about the code, so it belongs to the સંચાલક
-- (§34, §36) and changing it costs no deploy.
--
-- Why this row and not an `app_navigation_items` table
-- ----------------------------------------------------
-- A table per configuration was the obvious shape and is the wrong one here. `settings`
-- already has all four properties such a table would have been built to get: one RLS policy
-- naming `settings.update` (0004), one audit trigger filing every write, one validation
-- pattern (0018's BEFORE trigger), and one read the યુવક app is already making on every
-- visit. A second system would duplicate all four and add a round trip on a phone, to hold
-- at most nine rows that change a few times a year. So `nav` joins `app`, `levels` and
-- `journey` as a key in the same table, and what a real table would have given — a column
-- per field, a foreign key, a genuine `sort_order` — is bought with a resolver and this
-- trigger instead, exactly as the three keys beside it already do.
--
-- Why the rules are here and not only in the panel
-- ------------------------------------------------
-- The panel validates, and that validation is worth having — it is how a સંચાલક is told
-- that five is the ceiling rather than left to discover it. But **a disabled checkbox is not
-- a rule.** `settings` is writable through PostgREST by anyone `has_permission
-- ('settings.update')` admits, with no obligation to go anywhere near admin/src. A curl with
-- an ADMIN's token could otherwise:
--
--   * put six items in the bar, so every label is clipped on a 320px phone;
--   * hide મુખપૃષ્ઠ, leaving a યુવક deep in લેવલ ૪ with no way back and — in a PWA in
--     standalone mode, which draws no browser chrome — no way back at all;
--   * point a button at `https://…` or at `/admin`, under a label 2,000 people press
--     without reading;
--   * switch on ક્રમાંક, a route this build does not have, producing a button that
--     navigates to nothing.
--
-- The last two are the reason this migration exists at all. Everything else here is a bound;
-- those two are a boundary. Same reasoning as everywhere else in this schema: **the frontend
-- check is the explanation, the database check is the guarantee.**
--
-- What this does NOT change
-- -------------------------
-- * **Who may write.** Unchanged and deliberately not widened: `settings writable by
--   permission` (0004) is still the only way in, and `audit_setting` (0004) still records
--   the write — a `nav` change files a SETTINGS_UPDATED naming `nav` as its target, with the
--   whole before/after row, so who reordered the bar is answerable from the audit page with
--   no new action type and no new trigger.
-- * **Who may read.** Unchanged. The row is readable by `authenticated` because the યુવક app
--   already reads `settings` on every visit; the bar rides a request being made anyway. A
--   signed-out visitor reads nothing, which is what §5's "fetched after authentication"
--   asks for and what the existing policy already does.
-- * **Any other key in the row, or any other row.** The trigger looks at `key = 'nav'` and at
--   `mobileBottom` within it, and nothing else. A write that does not mention it is not
--   examined, so nothing that saves today can start failing — including the future
--   `desktopSidebar` key, which §9 asks to keep separate and which this deliberately does
--   not touch.
-- * **લેવલ ૧–૪, progress, scoring, unlocking, the ધૂન, or image delivery.** A navigation bar
--   is chrome. Nothing here reads or writes a single fact about any યુવક.
-- * **Points, gamification, ક્રમાંક.** Explicitly out of scope. `leaderboard` appears below
--   only in the registry, marked not-built, and the trigger REFUSES to let it be shown.

-- ================================================================ the registry

-- Every destination a bottom-bar button may have, and the whole of what a stored row may
-- choose between.
--
-- This is the second copy of `NAV_REGISTRY` in shared/domain/navigation.js, and the
-- duplication is deliberate in exactly the way `permissions_for()` (0004) is: the alternative
-- is the database fetching the list from the application that it is supposed to be checking,
-- which is not a check. `scripts/test-navigation.mjs` asserts that every key and every icon
-- name in the module appears in this file, so the two cannot drift silently — the same way
-- `seed-admin-supabase.mjs` already guards the permission matrix.
--
-- `ready` is the load-bearing column. It says whether src/App.jsx routes this path in the
-- build that is deployed, and it is what makes ક્રમાંક and સેટિંગ unshowable rather than
-- merely un-shown. A value in a settings row can never set it.
--
-- `required` marks the one destination that may not be taken away — see the check below.
--
-- A function rather than a table: a table would need its own RLS policy, its own write path,
-- and a decision about who may add a row to it — and "who may invent a new destination" has
-- exactly one right answer, which is "whoever deploys src/App.jsx". A function that returns
-- constants cannot be written to at all, which is the property wanted.
create or replace function public.nav_registry()
returns table (key text, route text, label text, icon text, ready boolean, required boolean)
language sql
immutable
as $$
  -- The first row carries the casts. A bare `values` list gives every string literal the
  -- `unknown` type, and `returns table` resolves that positionally against the declared
  -- columns — which works, right up until a column is added or reordered and `unknown`
  -- silently resolves to the wrong one. Pinning the first row makes the whole list's types
  -- explicit at the point they are decided.
  values
    ('home'::text,  '/'::text,      'મુખપૃષ્ઠ'::text, 'home'::text, true, true),
    ('start',       '/welcome',     'ધ્યાન',        'play',    true,  false),
    ('darshan',     '/darshan',     'દર્શન',        'darshan', true,  false),
    ('revision',    '/level/3',     'પુનરાવર્તન',    'list',    true,  false),
    ('level4',      '/level/4',     'લેવલ ૪',       'grid',    true,  false),
    ('profile',     '/profile',     'મારું',        'person',  true,  false),
    -- The two that exist so the panel can show them and nothing can switch them on.
    -- Points / gamification / ક્રમાંક is a separate piece of work; this row is the
    -- placeholder it was asked to be, and `ready = false` is what keeps it one.
    ('settings',    '/settings',    'સેટિંગ',       'gear',    false, false),
    ('leaderboard', '/leaderboard', 'ક્રમાંક',      'trophy',  false, false);
$$;

revoke all on function public.nav_registry() from public;

comment on function public.nav_registry() is
  'Every destination a mobile bottom-bar button may have (0019). The second copy of '
  'NAV_REGISTRY in shared/domain/navigation.js; scripts/test-navigation.mjs asserts the two '
  'agree. `ready` is whether src/App.jsx routes the path — no settings value may set it.';

-- The icons a bottom-bar item may carry. Closed, for the reason the shared module gives: the
-- alternative is a સંચાલક typing a name that becomes a component lookup or a URL, which is
-- markup injection with extra steps. Mirrors NAV_ICONS.
create or replace function public.nav_icons()
returns text[]
language sql
immutable
as $$
  select array['home', 'play', 'darshan', 'list', 'grid', 'person', 'gear', 'trophy', 'star', 'book']::text[];
$$;

revoke all on function public.nav_icons() from public;

-- ================================================================ the check

-- The numbers this enforces, and why they are these numbers.
--
-- Five is a measurement and not a preference: at 320px — the iPhone SE, every cheap Android
-- in portrait, and the width tokens.css is designed against — five cells are 64px each, which
-- is a tap target above the 44px floor with room for an icon and one short Gujarati word.
-- Six cells are 53px, under the floor with the label already clipped.
--
-- Two is the floor because one button is not navigation, it is a logo: with a single cell
-- there is nothing to move between, and the bar spends 64px of a phone's screen saying where
-- you already are.
--
-- Twelve characters is the point past which a label is certainly wrong. What actually *fits*
-- is CSS's problem, and .bnav-label truncates rather than wrapping — a bar whose height
-- depends on the સંચાલક's wording is a bar that moves the page under a thumb.

-- Refuses what `settings_mobile_nav()` below would silently correct.
--
-- The same division of labour the shared module draws between `resolveMobileNav()` and
-- `validateMobileNav()`, and for the same reason: a stored row must always yield a bar, but a
-- *write* that is out of range is a mistake and should be told so at the moment it is made
-- rather than quietly become something else.
--
-- Only `key = 'nav'`, and only when `mobileBottom` is actually present in the incoming value.
-- `?` tests for the key rather than for a non-null value, so `{"mobileBottom": null}` is
-- caught as the malformed write it is instead of slipping through as "absent".
--
-- Every message names the rule and the number. A constraint that says only "violates check
-- constraint" is a constraint the next person works around; `saveError()` in the panel
-- surfaces this text to the સંચાલક who caused it.
create or replace function public.nav_config_error(v jsonb)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  item     jsonb;
  reg      record;
  seen     text[] := array[]::text[];
  shown    integer := 0;
  n        numeric;
  lbl      text;
  home_ok  boolean := false;
begin
  if jsonb_typeof(v) <> 'array' then
    return 'settings.nav.mobileBottom must be an array of navigation items';
  end if;

  if jsonb_array_length(v) = 0 then
    return 'settings.nav.mobileBottom cannot be empty';
  end if;

  for item in select * from jsonb_array_elements(v) loop
    if jsonb_typeof(item) <> 'object' then
      return 'settings.nav.mobileBottom has an entry that is not an item';
    end if;

    -- The key is the identity, and an unknown one is refused rather than dropped. The
    -- *resolver* drops it, because a row written by a later build must still render on an
    -- older phone; a *write* naming a destination that does not exist is a mistake being
    -- made right now, and correcting it silently is how the panel and the row start
    -- disagreeing about what was saved.
    select * into reg from public.nav_registry() r where r.key = (item ->> 'key');
    if not found then
      return format('settings.nav: "%s" is not a navigation item this app has', item ->> 'key');
    end if;

    if reg.key = any (seen) then
      return format('settings.nav: "%s" appears twice in the list', reg.key);
    end if;
    seen := seen || reg.key;

    -- `jsonb_typeof`, never a cast. `(item ->> 'visible')::boolean` turns the string 'no'
    -- into an error and the *absence* of the key into NULL, and a NULL here would sail
    -- through every comparison below as neither true nor false — so a write that simply
    -- forgot `visible` would be accepted and then resolved as visible. Testing the JSON type
    -- is the only way to tell "false" from "not said".
    --
    -- `coalesce(..., 'absent')` is load-bearing and was learned the hard way. `item ->
    -- 'visible'` on a *missing* key is SQL NULL, `jsonb_typeof(NULL)` is NULL, and
    -- `NULL <> 'boolean'` is NULL rather than true — so without the coalesce this IF does not
    -- fire for the one case it most needs to catch. The consequence was not a bad message, it
    -- was a hole: further down, `(item ->> 'visible')::boolean` is also NULL, so the item was
    -- not counted toward the five-item ceiling, while resolveMobileNav() in JavaScript reads a
    -- missing `visible` as *shown*. A row with five items plus one that forgot the key passed
    -- this trigger and drew six buttons on the phone.
    if coalesce(jsonb_typeof(item -> 'visible'), 'absent') <> 'boolean'
       or coalesce(jsonb_typeof(item -> 'enabled'), 'absent') <> 'boolean' then
      return format('settings.nav: "%s" must say both visible and enabled, as true or false', reg.key);
    end if;

    -- `sortOrder` is what the panel writes; `sort_order` is the brief's own spelling and is
    -- read too, so a hand-run SQL patch cannot silently give an item no position. Same
    -- forgiveness the shared module's readOrder() extends, and for the same reason.
    if jsonb_typeof(item -> 'sortOrder') = 'number' then
      n := (item ->> 'sortOrder')::numeric;
    elsif jsonb_typeof(item -> 'sort_order') = 'number' then
      n := (item ->> 'sort_order')::numeric;
    else
      return format('settings.nav: "%s" has no position in the order', reg.key);
    end if;

    if n <> trunc(n) or n < 1 then
      return format('settings.nav: "%s" must have a whole position of 1 or more (got %s)', reg.key, n);
    end if;

    /*
      The boundary, not a bound.

      A route may be stored — the brief asks the item to carry one — but it may only be the
      one the registry already holds. The યુવક app ignores the stored value entirely and
      takes the route from its own registry, so this refusal is not what keeps him safe; what
      keeps him safe is that nothing reads this field. This is here so that a row which
      *claims* a different destination is refused at the moment it is written, rather than
      sitting in the table looking authoritative to whoever reads it next in psql.
    */
    if item ? 'route' and item ->> 'route' is distinct from reg.route then
      return format('settings.nav: "%s" cannot be pointed at a different page (%s is not %s)',
        reg.key, item ->> 'route', reg.route);
    end if;

    -- `coalesce` again, for the same NULL reason: `{"icon": null}` yields a NULL from `->>`,
    -- `NULL = any(...)` is NULL, and `not NULL` is NULL — so the guard would not fire. Empty
    -- string is never in the icon list, so coalescing to it refuses the write, which is what
    -- validateMobileNav() does with the same value.
    if item ? 'icon' and not (coalesce(item ->> 'icon', '') = any (public.nav_icons())) then
      return format('settings.nav: "%s" has an icon this app cannot draw (%s)', reg.key, item ->> 'icon');
    end if;

    if item ? 'label' then
      if jsonb_typeof(item -> 'label') <> 'string' then
        return format('settings.nav: "%s" must have a name written as text', reg.key);
      end if;
      -- Whitespace collapsed before measuring, matching the shared resolver exactly. A label
      -- that passes here and is then shortened there is a name in the panel that no યુવક sees.
      lbl := btrim(regexp_replace(item ->> 'label', '\s+', ' ', 'g'));
      if lbl = '' then
        return format('settings.nav: "%s" cannot have an empty name', reg.key);
      end if;
      -- `length()` counts characters, not bytes — which is the whole point on a Gujarati
      -- label, where `octet_length()` would be roughly three times the number of letters and
      -- would refuse every name the panel offers.
      if length(lbl) > 12 then
        return format('settings.nav: "%s" name must be 12 characters or fewer (got %s) - it has to fit under an icon on a phone',
          reg.key, length(lbl));
      end if;
    end if;

    if (item ->> 'visible')::boolean and (item ->> 'enabled')::boolean then
      -- §4 — a future item may sit in the list; it may not stand in the bar. Checked against
      -- the registry's `ready`, which is a fact about src/App.jsx that no row can claim. This
      -- is the line that keeps ક્રમાંક a placeholder: no save and no curl can turn it into a
      -- button that navigates to a route this build does not have.
      if not reg.ready then
        return format('settings.nav: "%s" is not built yet, so it cannot be shown', reg.key);
      end if;
      shown := shown + 1;
      if reg.required then
        home_ok := true;
      end if;
    end if;
  end loop;

  if shown < 2 then
    return format('settings.nav: show at least 2 items - one button is not a navigation bar (got %s)', shown);
  end if;

  if shown > 5 then
    return format('settings.nav: show at most 5 items - more than that and the labels stop fitting on a 320px phone (got %s)', shown);
  end if;

  /*
    §8 — the one item no configuration may take away.

    `home_ok` is only set inside the visible-AND-enabled branch above, which is deliberate:
    an item may be present, `visible: true` and `enabled: false`, and render nothing at all.
    All three have to hold, because all three are ways of removing the way back — and the
    bottom bar is the only chrome this app has on a phone. There is no sidebar behind it, no
    hamburger, and in a PWA in standalone mode no browser back button either. A યુવક in the
    middle of લેવલ ૪'s કસોટી with no મુખપૃષ્ઠ button is not badly configured, he is trapped.
  */
  if not home_ok then
    return 'settings.nav: "મુખપૃષ્ઠ" (home) cannot be switched off - it is the way back from every other page';
  end if;

  -- NULL means "nothing wrong with it". Every other path above returns the sentence a
  -- સંચાલક will read.
  return null;
end;
$$;

revoke all on function public.nav_config_error(jsonb) from public;

comment on function public.nav_config_error(jsonb) is
  'The whole of the mobile bottom navigation rules, in one place (0019): known keys only, no '
  'duplicates, 2..5 shown, home always shown, routes matching nav_registry(), icons from a '
  'closed list, labels of 12 characters or fewer, and nothing shown whose route this build '
  'does not have. Returns NULL when the list is sound, otherwise the sentence explaining why '
  'not. Mirrors validateMobileNav() in shared/domain/navigation.js. Both the write-time '
  'trigger and the read-time resolver call this, so a list that is refused on the way in is '
  'the same list the resolver falls back away from on the way out.';

-- The list with everything this build cannot draw removed — unknown keys, and keys whose
-- route src/App.jsx does not have.
--
-- This exists because the resolver and the trigger need to ask their question of *different*
-- lists, and getting that backwards is the subtle failure here. A **write** naming an unknown
-- destination is a mistake being made right now and is refused outright. A **read** of a row
-- containing one is a row written by a newer build being rendered on an older phone, which
-- must cost one button and not the whole bar. So the trigger validates the raw list and the
-- resolver validates the filtered one, exactly as resolveMobileNavConfig() filters before it
-- calls validateMobileNav().
create or replace function public.nav_config_known(v jsonb)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_agg(e.item order by e.ord)
      from jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end)
             with ordinality as e(item, ord)
      join public.nav_registry() r on r.key = (e.item ->> 'key')
      where r.ready
    ),
    '[]'::jsonb
  );
$$;

revoke all on function public.nav_config_known(jsonb) from public;

-- The trigger itself, which now decides nothing: it selects the rows it cares about, asks
-- `nav_config_error()`, and turns a sentence into a refusal. Every rule lives in that one
-- function so that the guarantee on the way in and the fallback on the way out cannot drift
-- apart — which they did, and it took a real 1-item bar to notice.
create or replace function public.settings_check_mobile_nav()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  msg text;
begin
  -- Only `key = 'nav'`, and only when `mobileBottom` is actually present in the incoming
  -- value. `?` tests for the key rather than for a non-null value, so `{"mobileBottom": null}`
  -- is caught as the malformed write it is instead of slipping through as "absent".
  if new.key <> 'nav' or not (new.value ? 'mobileBottom') then
    return new;
  end if;

  msg := public.nav_config_error(new.value -> 'mobileBottom');
  if msg is not null then
    raise exception '%', msg using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.settings_check_mobile_nav() from public;

drop trigger if exists settings_check_mobile_nav on public.settings;

-- BEFORE, so a refused write never reaches the row — and never reaches `audit_setting`
-- either, which would otherwise file an entry for a change that did not happen. Ordering
-- between the two does not arise: this one is BEFORE and the audit trigger is AFTER. It sits
-- alongside `settings_check_slideshow` (0018) rather than replacing it; the two examine
-- different keys and both run.
create trigger settings_check_mobile_nav
  before insert or update on public.settings
  for each row execute function public.settings_check_mobile_nav();

comment on function public.settings_check_mobile_nav() is
  'Refuses a settings[''nav''].value.mobileBottom write that nav_config_error() objects to '
  '(0019). The panel validates the same rules for the message; this is the guarantee, because '
  'settings is writable through PostgREST by anyone has_permission(''settings.update'') admits '
  'without going near admin/src.';

-- ================================================================ the resolver

-- The bar as the settings row holds it right now — every item that is visible, enabled and
-- routable, in order, carrying the registry's route rather than the row's.
--
-- Mirrors `resolveMobileNav()` in shared/domain/navigation.js branch for branch, including
-- which way each malformed value falls: absent, damaged or failing `nav_config_error()` →
-- the default four, whole; an unknown or not-yet-built key → dropped before anything else is
-- judged; an unusable label or icon → the registry's own.
--
-- That parity is asserted, not asserted-to: the same thirteen inputs are pushed through this
-- function and through `resolveMobileNav()` and the two outputs compared. Four of them
-- disagreed the first time, which is how the one-item bar described below was found.
--
-- The trigger above means a value this has to *correct* should not exist — but it is written
-- to correct anyway, because a row predating this migration can hold anything and a function
-- that raises inside a view is a broken page rather than one wrong button.
--
-- **Nothing in the application calls this.** The યુવક app resolves in JavaScript, from the
-- row it is already fetching, because a phone that has to make an RPC before it can draw its
-- own chrome is a phone that draws no chrome on a weak signal. This exists so that the rule
-- is answerable *in the database* — by a report, by a psql session debugging what a યુવક is
-- actually seeing, and by anything added later that must agree with the app about the bar
-- without reimplementing the resolver a third time. `settings_slideshow_seconds()` (0018) and
-- `level4_gate_setting()` (0014) exist for the same reason.
--
-- SECURITY DEFINER and revoked from public for the reason 0014 gives: it must answer
-- identically for every caller, and it returns configuration and nothing about any person.
create or replace function public.settings_mobile_nav()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  /*
    Filter, then validate, then resolve — and in that order, because it is the order
    resolveMobileNavConfig() uses and the three steps are not commutative.

    Unknown and not-yet-built keys go first, via nav_config_known(): they are the two ways a
    perfectly good configuration arrives at a build older or newer than the one that wrote it,
    and neither is damage. Validating before filtering would reject the whole bar because a
    newer panel had saved a ક્રમાંક row this build has never heard of.

    Then the whole filtered list stands or falls together. A list that fails is replaced
    entirely by the default four, never honoured in part — and this is the correction that
    mattered most here. Resolving leniently field-by-field, which is what this function did at
    first, produced a **one-item bar** from a row where two of three items were switched off:
    below the floor the trigger enforces, with no way to reach anything, and it passed every
    other check in this file. A configuration that is not valid is damage, and half of a
    damaged configuration is not a smaller problem than all of it.
  */
  with stored as (
    select case
             when public.nav_config_error(public.nav_config_known(s.value -> 'mobileBottom')) is null
               then public.nav_config_known(s.value -> 'mobileBottom')
             else '[]'::jsonb
           end as v
    from public.settings s
    where s.key = 'nav'
  ),
  items as (
    select
      r.key,
      r.route,
      coalesce(
        nullif(btrim(regexp_replace(
          case when jsonb_typeof(e.item -> 'label') = 'string' then e.item ->> 'label' else '' end,
          '\s+', ' ', 'g')), ''),
        r.label
      ) as label,
      case
        when e.item ->> 'icon' = any (public.nav_icons()) then e.item ->> 'icon'
        else r.icon
      end as icon,
      -- Absence is not "off"; `false` is how that is said. Matches the shared resolver's
      -- `s.visible !== false`, which is the branch that stops a list saved by an older panel
      -- from reading as a bar with everything switched off.
      --
      -- A CASE and not `jsonb_typeof(...) = 'boolean' and not (...)::boolean`, for the reason
      -- `settings_slideshow_seconds()` (0018) spells out: Postgres does not promise
      -- left-to-right evaluation of AND, so the cast in the second arm may run even when the
      -- first is false — and `'yes'::boolean` is true while `'maybe'::boolean` raises. An
      -- ordered CASE is the documented way to make a guard actually guard.
      case
        when jsonb_typeof(e.item -> 'visible') = 'boolean' then not (e.item ->> 'visible')::boolean
        else false
      end as hidden,
      case
        when jsonb_typeof(e.item -> 'enabled') = 'boolean' then not (e.item ->> 'enabled')::boolean
        else false
      end as disabled,
      coalesce(
        case when jsonb_typeof(e.item -> 'sortOrder') = 'number' then (e.item ->> 'sortOrder')::numeric end,
        case when jsonb_typeof(e.item -> 'sort_order') = 'number' then (e.item ->> 'sort_order')::numeric end,
        e.ord
      ) as sort_order
    from stored, lateral jsonb_array_elements(stored.v) with ordinality as e(item, ord)
    join public.nav_registry() r on r.key = (e.item ->> 'key')
    where r.ready
  ),
  bar as (
    select key, route, label, icon, sort_order
    from items
    where not hidden and not disabled
    -- Ties fall back to the key so the order is total and never depends on sort stability —
    -- two items sharing a position must come out in the same sequence every time, or one
    -- saved configuration produces two different bars.
    order by sort_order, key
  )
  select coalesce(
    (
      select jsonb_agg(jsonb_build_object('key', key, 'route', route, 'label', label, 'icon', icon))
      from bar
    ),
    -- The default four, and the same four the shared module falls back to. A fallback that
    -- differed from the default would be a bar that changes shape during an outage and
    -- teaches a યુવક that buttons move.
    (
      select jsonb_agg(jsonb_build_object('key', r.key, 'route', r.route, 'label', r.label, 'icon', r.icon)
                       order by d.ord)
      from (values ('home', 1), ('darshan', 2), ('revision', 3), ('profile', 4)) as d(key, ord)
      join public.nav_registry() r on r.key = d.key
    )
  );
$$;

revoke all on function public.settings_mobile_nav() from public;

comment on function public.settings_mobile_nav() is
  'The mobile bottom navigation bar as settings[''nav''].value.mobileBottom holds it right '
  'now (0019). Mirrors resolveMobileNav() in shared/domain/navigation.js, including how each '
  'malformed value falls. Routes come from nav_registry(), never from the stored row. '
  'Nothing in the app calls this — the phone resolves in JavaScript from a row it is already '
  'fetching; this is so the rule is answerable in the database too.';

-- ================================================================ the seed

-- મુખપૃષ્ઠ, દર્શન, પુનરાવર્તન, મારું — the four the app opens with, matching
-- DEFAULT_MOBILE_NAV in shared/domain/navigation.js exactly.
--
-- Seeded rather than left absent, even though the resolver falls back to these same four
-- either way. Two reasons, and the second is the real one:
--
--   1. The panel opens on a list the સંચાલક can rearrange, rather than on an empty screen
--      that says "nothing is configured" about a bar he can plainly see on his phone.
--   2. `on conflict do nothing`, so this is a no-op on any project that has already
--      configured its bar. A seed that overwrote would silently undo a live configuration on
--      the next deploy, which is the one thing a migration must never do to a settings row.
--
-- `sortOrder` is written out rather than inferred from array position, for the reason the
-- brief gives and the shared module repeats: position in a list is not an order anything may
-- rely on once the value has been through jsonb, a merge, or a panel that maps before it
-- sorts.
insert into public.settings (key, value) values (
  'nav',
  jsonb_build_object('mobileBottom', jsonb_build_array(
    jsonb_build_object('key', 'home',     'label', 'મુખપૃષ્ઠ',   'icon', 'home',    'route', '/',        'visible', true, 'enabled', true, 'sortOrder', 1),
    jsonb_build_object('key', 'darshan',  'label', 'દર્શન',      'icon', 'darshan', 'route', '/darshan', 'visible', true, 'enabled', true, 'sortOrder', 2),
    jsonb_build_object('key', 'revision', 'label', 'પુનરાવર્તન', 'icon', 'list',    'route', '/level/3', 'visible', true, 'enabled', true, 'sortOrder', 3),
    jsonb_build_object('key', 'profile',  'label', 'મારું',      'icon', 'person',  'route', '/profile', 'visible', true, 'enabled', true, 'sortOrder', 4)
  ))
)
on conflict (key) do nothing;
