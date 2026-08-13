-- વર્ણી ધ્યાન — મારી પ્રગતિ becomes a destination the bottom bar may hold.
--
-- What this adds
-- --------------
-- One row to `nav_registry()`: `history` → `/history`, પ્રગતિ, the `star` drawing, ready.
-- That is the whole of it.
--
-- Why a migration exists for one row
-- ----------------------------------
-- Because `nav_registry()` is the *second* copy of `NAV_REGISTRY` in
-- shared/domain/navigation.js, and the two are load-bearing in different directions. The JS
-- copy is what the panel offers and what a યુવક's bar is resolved against; this copy is what
-- `nav_config_known()` and the `settings_check_mobile_nav` trigger admit into a stored row
-- (0019). A key present in one and absent from the other is not a cosmetic drift — it is a
-- destination the panel will happily let a સંચાલક add and the database will then refuse to
-- save, with the refusal arriving as a `check_violation` about a button he can see on screen.
--
-- scripts/test-navigation.mjs reads this file as text and asserts every registry key appears
-- in it, which is what makes the pair a checked fact rather than a remembered one. 0020 added
-- `settings` for exactly the same reason and is the pattern this follows.
--
-- `create or replace`, so the function keeps its oid, its grants and 0019's revoke. Dropping
-- and recreating would silently restore the default `execute to public`.
--
-- What this does NOT change
-- -------------------------
-- * **Not one row of anybody's configuration.** There is no insert, no update and no seed
--   here. A project already running holds a `settings['nav']` row of its own — 0019 seeded
--   the original four with `on conflict do nothing` — and that row still decides its bar.
--   પ્રગતિ becomes *available* in the panel; whether it stands in the bar stays the
--   સંચાલક's, exactly as `ready` has always meant "this build has the screen" and never
--   "show it".
-- * **ક્રમાંક is untouched and is still `ready = false`.** The leaderboard is a separate
--   piece of work and this migration is deliberately not the place that quietly enables it.
--   મારી પ્રગતિ is one યુવક's own record with nobody else's number on it, which is why it
--   took a key of its own rather than borrowing that placeholder.
-- * **No new table, no new policy, no new permission**, and nothing about who may write
--   `public.settings`.

-- ================================================================ the registry

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
    -- The line this migration exists for. `/history` is routed in src/App.jsx.
    ('history',     '/history',     'પ્રગતિ',       'star',    true,  false),
    -- Still a placeholder, and deliberately left one.
    ('leaderboard', '/leaderboard', 'ક્રમાંક',      'trophy',  false, false);
$$;

comment on function public.nav_registry() is
  'Every destination a mobile bottom-bar button may have (0019; settings marked ready in '
  '0020, history added in 0022). The second copy of NAV_REGISTRY in '
  'shared/domain/navigation.js; scripts/test-navigation.mjs asserts the two agree, ready '
  'flags included. `ready` is whether src/App.jsx routes the path — no settings value may '
  'set it.';
