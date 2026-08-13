-- વર્ણી ધ્યાન — સેટિંગ stops being a placeholder.
--
-- What this changes
-- -----------------
-- One boolean: `nav_registry()`'s `settings` row goes from `ready = false` to `ready = true`,
-- because `/settings` is now a route src/App.jsx actually serves. The યુવક's own આપોઆપ speed
-- (the four presets of the requirement document, page 5, plus a custom 2-30 seconds) is what
-- gave the screen something to hold.
--
-- Nothing else. No new table, no new policy, no change to who may write, and not one row of
-- anybody's configuration is touched.
--
-- Why a new migration rather than an edit to 0019
-- -----------------------------------------------
-- 0019 has been applied. A migration that has run is history, and editing it means the file
-- in the repository no longer describes the database anybody actually has — `schema_migrations`
-- would still record 0019 as done, so the edit would never run, and the next person to read
-- the file would be reading a description of a state that exists nowhere. Append-only is the
-- only property that makes a migration directory trustworthy.
--
-- Why this is a database change at all
-- ------------------------------------
-- `ready` is the flag that decides whether a configuration may put an item in a યુવક's bar,
-- and it is enforced in `nav_config_error()` — which is what a curl hits, and therefore what
-- actually decides. Flipping it only in shared/domain/navigation.js would leave the panel
-- offering a checkbox that the database refuses, with the refusal arriving as a save error on
-- a control that looked enabled. The two copies of this registry are duplicated on purpose
-- (see 0019's header); the price of that is that both move together, and
-- scripts/test-navigation.mjs asserts they have.
--
-- What this does NOT do
-- ---------------------
-- * **It does not put સેટિંગ in anybody's bar.** `ready` means "this app has the screen", not
--   "show it". Whether it stands in the bar is still the સંચાલક's, through the same panel and
--   the same visible/enabled fields, and the seeded default four are unchanged — સેટિંગ is
--   reached from મારું, which is where a યુવક looks for it.
-- * **It does not touch settings['nav'].** No row is rewritten. A project whose સંચાલક has
--   already arranged his bar keeps exactly the arrangement he made.
-- * **It does not make ક્રમાંક available.** `leaderboard` stays `ready = false`. Points and
--   gamification remain a separate piece of work, and this migration is deliberately not the
--   place that quietly enables them.
-- * **It does not change the સંચાલક's slideshow setting.** `settings['app'].slideshow` and
--   its 1-60 trigger (0018) are untouched and still supply the default a યુવક starts from.
--   His own choice lives on his own device and never reaches this database.

-- `create or replace`, so the function keeps its oid, its grants and the revoke 0019 applied.
-- Dropping and recreating would silently restore the default `execute to public` that 0019
-- deliberately removed.
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
    -- The line this migration exists for. `/settings` is routed now.
    ('settings',    '/settings',    'સેટિંગ',       'gear',    true,  false),
    -- Still a placeholder, and deliberately left one.
    ('leaderboard', '/leaderboard', 'ક્રમાંક',      'trophy',  false, false);
$$;

comment on function public.nav_registry() is
  'Every destination a mobile bottom-bar button may have (0019; settings marked ready in '
  '0020). The second copy of NAV_REGISTRY in shared/domain/navigation.js; '
  'scripts/test-navigation.mjs asserts the two agree, ready flags included. `ready` is '
  'whether src/App.jsx routes the path — no settings value may set it.';
