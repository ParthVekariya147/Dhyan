-- વર્ણી ધ્યાન — the સંચાલક may make buttons of his own, and the database still decides where
-- a button is allowed to go.
--
-- What this adds
-- --------------
-- One new table-valued function and four reissues, and not one row of anybody's data:
--
--   `nav_normalize_route()`  the two typing liberties a written route is allowed — trimmed,
--                            and no trailing slash on anything longer than `/`.
--   `nav_routes()`           **the destination table.** Every page a button of any kind may
--                            open. The second copy of NAV_ROUTES in
--                            shared/domain/navigation.js.
--   `nav_icons()`            reissued with four more drawings (chart, users, info, help).
--   `nav_config_error()`     reissued: the same rules as 0019 for built-in items, plus the
--                            rules for custom ones.
--   `nav_config_known()`     reissued: a custom item survives the filter when its route is
--                            one this build serves.
--   `settings_mobile_nav()`  reissued: resolves custom items alongside built-in ones.
--
-- Why a key can now be something other than one of nine
-- -----------------------------------------------------
-- Until this migration `key` did two jobs at once: it was the item's identity AND it was how
-- the destination got chosen, because `nav_registry()` held both. That conflation is the
-- whole reason a project could only ever have the nine buttons the app shipped with — there
-- was no way to write down "a second button, to a page that already has one" or "a button to
-- /learn, which no registry row names", since saying anything at all meant naming one of nine
-- keys.
--
-- So the two jobs are separated. A key beginning `custom:` is an identity the panel invented
-- and carries no destination; the destination comes from that item's `route`, matched against
-- `nav_routes()`. A key that does not begin `custom:` is a registry key and behaves in every
-- respect exactly as it did — including that its stored `route` is still refused if it
-- disagrees with the registry's.
--
-- Why this is not "the row may now name a destination"
-- ----------------------------------------------------
-- This is the paragraph that has to earn the change, because 0019's header is emphatic that a
-- settings row must never carry a destination, and it was right.
--
-- A custom item's `route` is a **selector**, not a destination. It is matched against a closed
-- table that lives in code and in this function, and a value the table does not contain
-- resolves to no button at all: `nav_config_known()` drops it on read, `nav_config_error()`
-- refuses it on write, and `resolveMobileNavConfig()` in JavaScript drops it a third time on
-- the phone. `javascript:alert(1)`, `https://evil.example`, `//evil.example`, `/admin` and
-- `/leaderbord` are all, identically, values that are not in the table.
--
-- The scheme, protocol-relative, leading-slash and query-string checks below are therefore
-- **not** what makes this safe — the table lookup already refuses every one of those strings
-- on its own. They exist so that a સંચાલક who pasted a link to another site is told that is
-- what he did, rather than being told the app has no page at `https://evil.example`, which is
-- true and useless. Same reasoning as every other message in this file: a refusal that names
-- the rule is one the next person can act on, and a refusal that says "invalid" is one he
-- works around.
--
-- Who may still invent a page: whoever deploys src/App.jsx, and nobody else. A tenth
-- destination arrives as a screen, a <Route>, a line in NAV_ROUTES and a line in
-- `nav_routes()` below — never as a row somebody typed into a panel.
--
-- What this does NOT change
-- -------------------------
-- * **Not one row of anybody's configuration.** No insert, no update, no seed. Every project
--   already running keeps the `settings['nav']` row it has; every one of those rows holds
--   built-in keys only, and every rule that applied to them yesterday applies unchanged
--   today. `toStoredMobileNav()` writes a built-in item byte for byte as it always did, so a
--   save that changes nothing still produces the identical value.
-- * **`nav_registry()`.** Not reissued and not touched. The nine built-ins, their routes,
--   their `ready` flags and the one `required` row are exactly as 0023 left them.
-- * **Who may write, and who may read.** Unchanged. `settings writable by permission` (0004)
--   is still the only way in, `settings.update` is still the permission, and `audit_setting`
--   still files every write as one SETTINGS_UPDATED carrying the whole before/after row — so
--   a custom button being created, renamed, reordered, hidden or deleted is answerable from
--   the audit page with no new action type and no new trigger.
-- * **The trigger itself.** `settings_check_mobile_nav` (0019) is unchanged and is not
--   redefined here: it selects the rows it cares about and asks `nav_config_error()`, which is
--   the function this migration replaces. Every rule still lives in that one place.
-- * **The bounds.** 2..5 shown, 12-character labels, મુખપૃષ્ઠ unhideable. A custom button is
--   subject to all three exactly as a built-in is; the only new bound is a ceiling of twelve
--   custom items in the row at once, which is a guard against a script rather than a budget
--   for a person.
-- * **લેવલ ૧–૪, progress, scoring, unlocking, points, ક્રમાંક, the ધૂન, image delivery.** A
--   navigation bar is chrome. Nothing here reads or writes a single fact about any યુવક.

-- ================================================================ the route

-- One written route, reduced to the one spelling this project stores.
--
-- Two liberties, both of them typing rather than meaning: surrounding whitespace, and a
-- trailing slash on anything longer than `/` itself. react-router treats `/darshan` and
-- `/darshan/` as the same place, so a સંચાલક typing the second must not be told his page does
-- not exist — but the row has to hold one of them, or two items pointing at one page look
-- like two pages to everything that reads the row afterwards.
--
-- Everything else is left exactly as written. `//evil.example` comes back as
-- `//evil.example` and NOT as `/`, which is the one case where being helpful would turn a
-- protocol-relative URL into a legal path. It fails the lookup, which is the point.
--
-- Mirrors `normalizeNavRoute()` in shared/domain/navigation.js; scripts/test-navigation.mjs
-- asserts the pair agrees.
create or replace function public.nav_normalize_route(v text)
returns text
language sql
immutable
as $$
  select case
           when v is null then ''
           -- length <= 1 covers '' and '/', neither of which has a trailing slash to strip
           -- and both of which must survive as themselves.
           when length(btrim(v)) <= 1 then btrim(v)
           else regexp_replace(btrim(v), '/+$', '')
         end;
$$;

revoke all on function public.nav_normalize_route(text) from public;

comment on function public.nav_normalize_route(text) is
  'One written navigation route reduced to the spelling this project stores (0028): trimmed, '
  'and without a trailing slash on anything longer than /. Mirrors normalizeNavRoute() in '
  'shared/domain/navigation.js. Deliberately does NOT repair //host into /.';

-- Every page a bottom-bar button may open — the destination table.
--
-- `nav_registry()` answers "which nine buttons does this app ship with". This answers the
-- smaller and different question "which pages exist to be pointed at", and the two are
-- separate so that a custom button can have the second without inheriting the first.
--
-- ────────────────────────────────────────────────────────────────────────────
-- Derived, not written out — and that is the whole design of this function
-- ────────────────────────────────────────────────────────────────────────────
--
-- Nine of these ten destinations are already in `nav_registry()`, under the same word and the
-- same picture, because a built-in button is a destination that a button already points at.
-- Writing them out again would be nine Gujarati labels in this file that can drift from the
-- nine above them — a second copy of a list that already HAS a second copy, and the drift
-- would be invisible because both files would look internally consistent.
--
-- So they are selected from `nav_registry()` and only the extras are literals. What that buys
-- is that this half of the drift cannot happen at all: `nav_registry()` is already asserted
-- against NAV_REGISTRY by scripts/test-navigation.mjs (acceptance 14), NAV_ROUTES is derived
-- from NAV_REGISTRY in shared/domain/navigation.js by the same rule, and what is left for
-- acceptance 17 to check is one row and the shape of the derivation. Two lists that agree by
-- construction beat two lists that agree because something checks them.
--
-- `where r.ready` is load-bearing rather than tidy. A custom button pointed at a page the app
-- has not built yet is the same button-that-goes-nowhere that `ready` exists to prevent on a
-- built-in, arriving through the other door. There is deliberately no `ready` column on this
-- table: `nav_registry()` needs one because it lists destinations the app INTENDS to have,
-- and this lists only destinations the app HAS, so a page that is not built yet is simply
-- absent until it is.
--
-- `label` and `icon` are the FALLBACK, not the answer: a custom item carries the સંચાલક's own
-- word and picture, and both are required of him at write time. These are what a row written
-- by something other than the panel falls back to, so that no configuration can produce a cell
-- with an icon and no word.
--
-- A function rather than a table, for 0019's reason: "who may invent a new destination" has
-- exactly one right answer, which is "whoever deploys src/App.jsx", and a function returning
-- constants cannot be written to at all.
create or replace function public.nav_routes()
returns table (route text, label text, icon text)
language sql
immutable
as $$
  select r.route, r.label, r.icon
  from public.nav_registry() r
  where r.ready
  union all
  -- The destinations no built-in names, and the reason this table exists as something other
  -- than nav_registry()'s routes copied out.
  --
  -- /learn is a route src/App.jsx has served since long before any of this: the guided journey
  -- is reached from the મુખપૃષ્ઠ and from nowhere else. That is not an oversight in the
  -- registry — a tenth built-in would spend one of five bar slots on a screen most સંઘો do not
  -- want a button for. It is exactly the case a custom button answers.
  --
  -- The casts are explicit because a bare literal in a UNION arm is typed `unknown` and would
  -- be resolved positionally against `returns table`, which works right up until a column is
  -- added or reordered.
  select '/learn'::text, 'યાત્રા'::text, 'book'::text;
$$;

revoke all on function public.nav_routes() from public;

comment on function public.nav_routes() is
  'Every page a bottom-bar button may open (0028). The second copy of NAV_ROUTES in '
  'shared/domain/navigation.js; scripts/test-navigation.mjs asserts the two agree and that '
  'every route here is one src/App.jsx serves. A custom item''s stored route is a SELECTOR '
  'into this table - the resolver takes its answer from the row found here, never from the '
  'settings row that asked for it.';

-- ================================================================ the icons

-- The icons a bottom-bar item may carry. Closed, for the reason 0019 gives: the alternative is
-- a સંચાલક typing a name that becomes a component lookup or a URL, which is markup injection
-- with extra steps. Mirrors NAV_ICONS.
--
-- Four more than 0019 had, and the reason the list grew is custom buttons: a સંચાલક who may
-- now put his own word on his own button needs more than ten pictures to tell one from
-- another. Every name here has a drawing behind it in src/components/NavIcon.jsx, which that
-- file asserts at module evaluation and scripts/verify-nav.mjs asserts against the built
-- chunk — a name a સંચાલક can pick and the app cannot draw is a blank square on a phone.
--
-- `create or replace`, so the function keeps its oid and 0019's revoke. Dropping and
-- recreating would silently restore the default `execute to public`.
create or replace function public.nav_icons()
returns text[]
language sql
immutable
as $$
  select array[
    'home', 'play', 'darshan', 'list', 'grid', 'person', 'gear', 'trophy', 'star', 'book',
    'chart', 'users', 'info', 'help'
  ]::text[];
$$;

-- ================================================================ the check

-- Refuses what `settings_mobile_nav()` would silently correct — 0019's function, extended to
-- know about a second kind of item.
--
-- The shape is unchanged and so is every rule that applied to a built-in row. What is added is
-- one branch: an item whose key begins `custom:` is checked on its id, its destination, its
-- name and its picture instead of against `nav_registry()`, and is counted against a ceiling
-- of its own. Everything after that branch — the duplicate check, the visible/enabled types,
-- the order, the label length, the 2..5 bound and મુખપૃષ્ઠ — runs over both kinds identically,
-- because those are rules about the BAR and a custom button stands in the same bar.
--
-- Mirrors `validateMobileNav()` in shared/domain/navigation.js message for message.
create or replace function public.nav_config_error(v jsonb)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  item      jsonb;
  reg       record;
  rt        record;
  k         text;
  nm        text;
  rte       text;
  is_custom boolean;
  seen      text[] := array[]::text[];
  shown     integer := 0;
  custom_n  integer := 0;
  n         numeric;
  lbl       text;
  home_ok   boolean := false;
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

    k := item ->> 'key';
    -- The whole of the test for which kind of item this is, here and in all three of the
    -- other places that ask. No registry key contains a colon, so the namespaces cannot
    -- collide; a `type` column beside the key would be a second field that can disagree with
    -- the first, and the one that won would be whichever the reader happened to look at.
    is_custom := k is not null and k like 'custom:%';

    if is_custom then
      /*
        A custom key is refused on its SHAPE rather than looked up, because there is nothing to
        look it up in: it is an identity the panel invented. It is constrained rather than
        accepted as typed because it ends up in a DOM attribute, in an `id=` on a form control
        and in the audit trail, and any of those is a place where a hostile string is worth not
        having. Mirrors NAV_CUSTOM_SLUG.
      */
      if k !~ '^custom:[a-z0-9]([a-z0-9-]{0,22}[a-z0-9])?$' then
        return format('settings.nav: "%s" is not a usable id for a button', k);
      end if;

      custom_n := custom_n + 1;
      -- A bound on the LIST, not on the bar. Hidden items cost nothing on any screen, but this
      -- jsonb is read by every યુવક on every visit and there is no reason to allow an unbounded
      -- number of rows in it. Twelve is a number nobody arranging a five-button bar will reach.
      if custom_n > 12 then
        return 'settings.nav: at most 12 custom buttons - the bar shows 5 and the rest are a list nobody can read';
      end if;

      -- The word this item's refusals are spoken in. A built-in is named by the registry; a
      -- custom item has no registry word, so its own label is the only name it has.
      nm := coalesce(nullif(btrim(coalesce(item ->> 'label', '')), ''), k);
    else
      select * into reg from public.nav_registry() r where r.key = k;
      if not found then
        return format('settings.nav: "%s" is not a navigation item this app has', k);
      end if;
      nm := reg.label;
    end if;

    if k = any (seen) then
      return format('settings.nav: "%s" appears twice in the list', nm);
    end if;
    seen := seen || k;

    -- `jsonb_typeof`, never a cast, and `coalesce(..., 'absent')` because `jsonb_typeof` of a
    -- MISSING key is NULL and `NULL <> 'boolean'` is NULL rather than true. 0019 learned that
    -- the hard way: without the coalesce an item that simply forgot `visible` was not counted
    -- toward the ceiling here while resolveMobileNav() read it as shown, and a row of five
    -- plus one forgetful item drew six buttons on the phone.
    if coalesce(jsonb_typeof(item -> 'visible'), 'absent') <> 'boolean'
       or coalesce(jsonb_typeof(item -> 'enabled'), 'absent') <> 'boolean' then
      return format('settings.nav: "%s" must say both visible and enabled, as true or false', nm);
    end if;

    -- `sortOrder` is what the panel writes; `sort_order` is the brief's own spelling and is
    -- read too, so a hand-run SQL patch cannot silently give an item no position.
    if jsonb_typeof(item -> 'sortOrder') = 'number' then
      n := (item ->> 'sortOrder')::numeric;
    elsif jsonb_typeof(item -> 'sort_order') = 'number' then
      n := (item ->> 'sort_order')::numeric;
    else
      return format('settings.nav: "%s" has no position in the order', nm);
    end if;

    if n <> trunc(n) or n < 1 then
      return format('settings.nav: "%s" must have a whole position of 1 or more (got %s)', nm, n);
    end if;

    if is_custom then
      /*
        THE boundary. Everything else in this function is a bound.

        A custom item's `route` is the one field of any stored item that actually decides where
        a button goes. The load-bearing line is the `nav_routes()` lookup at the bottom of this
        block: a route that table does not contain is refused, and every dangerous string is
        refused by that line alone.

        The four checks above it refuse nothing the lookup would have allowed. They exist so
        that a સંચાલક who pasted a link is told he pasted a link, instead of being told this app
        has no page at `https://evil.example` — which is true, and useless. Order matters:
        `https://x` fails the scheme test and the leading-slash test both, and the first of
        those is the more useful sentence.
      */
      -- `coalesce(..., 'absent')`, never a bare `<>`. `item -> 'route'` on a MISSING key is
      -- SQL NULL, `jsonb_typeof(NULL)` is NULL, and `NULL <> 'string'` is NULL rather than
      -- true — so without the coalesce this IF does not fire for the one case it most needs to
      -- catch, and the item falls through to the table lookup to be refused there with a
      -- message about a page at "". 0019 documents this hazard for `visible`, having been bitten
      -- by it; it is the same hazard and the same fix.
      if coalesce(jsonb_typeof(item -> 'route'), 'absent') <> 'string' then
        return format('settings.nav: "%s" must say which page it opens', nm);
      end if;
      rte := btrim(item ->> 'route');

      -- `scheme:` — javascript:, data:, http:, https:, mailto:, anything at all. A URL with a
      -- scheme is by definition not a page of this app, whichever scheme it happens to carry.
      if rte ~* '^[a-z][a-z0-9+.-]*:' then
        return format('settings.nav: "%s" is a link outside this app (%s) - a button may only open a page of this app', nm, rte);
      end if;
      -- Protocol-relative. The one external URL that looks like a path, with no scheme to give
      -- it away, and the reason nav_normalize_route() refuses to repair a leading `//`.
      if rte like '//%' then
        return format('settings.nav: "%s" is a link to another site (%s)', nm, rte);
      end if;
      if rte not like '/%' then
        return format('settings.nav: "%s" is not a page of this app (%s) - a page starts with /', nm, rte);
      end if;
      -- A query or a fragment is not a destination, it is an instruction to one, and nothing
      -- in the app reads either from the bar. Accepting them would store text that changes
      -- nothing, which is worse than refusing them.
      if rte ~ '[?#]' then
        return format('settings.nav: "%s" cannot carry a ? or a # (%s) - choose the page itself', nm, rte);
      end if;

      select * into rt from public.nav_routes() r
        where r.route = public.nav_normalize_route(rte);
      if not found then
        return format('settings.nav: this app has no page at "%s" - it has to be built and routed before a button can open it',
          public.nav_normalize_route(rte));
      end if;

      /*
        Required of a custom item and optional on a built-in, and the asymmetry is the whole
        difference between the two kinds. A built-in with no label falls back to the registry's
        own word, which is a word this app chose and stands behind. A custom button has no such
        word: the resolver would fall back to the name of the PAGE, so a સંચાલક who meant to
        write લીડરબોર્ડ and saved nothing would get a button reading ક્રમાંક with nothing to
        tell him his name had been dropped. Refused at the moment he saves instead.
      */
      /*
        `coalesce(..., 'absent')` for the reason spelled out at the route check above, and this
        is where the hazard actually bit: written as a bare `jsonb_typeof(...) <> 'string'`,
        this accepted a custom item with NO label at all. `item -> 'label'` on a missing key is
        SQL NULL, so the first operand was NULL; `item ->> 'label'` is NULL too, so
        `btrim(regexp_replace(NULL, ...)) = ''` was NULL as well; and `NULL or NULL` is NULL, so
        the IF did not fire. The write was accepted here and refused by validateMobileNav() in
        JavaScript — the two copies disagreeing, which is the one thing this pair may not do.

        It was caught by running the matrix against a real Postgres rather than by reading, and
        that is the argument for running it.
      */
      if coalesce(jsonb_typeof(item -> 'label'), 'absent') <> 'string'
         or btrim(regexp_replace(coalesce(item ->> 'label', ''), '\s+', ' ', 'g')) = '' then
        return 'settings.nav: a custom button needs a name to show under its icon';
      end if;

      if not (coalesce(item ->> 'icon', '') = any (public.nav_icons())) then
        return format('settings.nav: "%s" needs a picture this app can draw (%s)', nm, item ->> 'icon');
      end if;
    else
      /*
        A route may be stored on a BUILT-IN — the brief asks the item to carry one — but it may
        only be the one the registry already holds. The યુવક app ignores the stored value
        entirely and takes the route from its own registry, so this refusal is not what keeps
        him safe; it is here so that a row which *claims* a different destination is refused
        when it is written rather than sitting in the table looking authoritative to whoever
        reads it next in psql.

        It is also what keeps the two kinds honestly apart: the way to point a button somewhere
        else is to make a custom one, not to edit a built-in's destination out from under the
        key that names it.
      */
      if item ? 'route' and item ->> 'route' is distinct from reg.route then
        return format('settings.nav: "%s" cannot be pointed at a different page (%s is not %s)',
          nm, item ->> 'route', reg.route);
      end if;

      -- `coalesce` again, for the same NULL reason: `{"icon": null}` yields NULL from `->>`,
      -- `NULL = any(...)` is NULL, and `not NULL` is NULL — so the guard would not fire. Empty
      -- string is never in the icon list, so coalescing to it refuses the write.
      if item ? 'icon' and not (coalesce(item ->> 'icon', '') = any (public.nav_icons())) then
        return format('settings.nav: "%s" has an icon this app cannot draw (%s)', nm, item ->> 'icon');
      end if;
    end if;

    if item ? 'label' then
      if jsonb_typeof(item -> 'label') <> 'string' then
        return format('settings.nav: "%s" must have a name written as text', nm);
      end if;
      -- Whitespace collapsed before measuring, matching the shared resolver exactly. A label
      -- that passes here and is then shortened there is a name in the panel that no યુવક sees.
      lbl := btrim(regexp_replace(item ->> 'label', '\s+', ' ', 'g'));
      if lbl = '' then
        return format('settings.nav: "%s" cannot have an empty name', nm);
      end if;
      -- `length()` counts characters, not bytes — the whole point on a Gujarati label, where
      -- `octet_length()` would be roughly three times the number of letters and would refuse
      -- every name the panel offers.
      if length(lbl) > 12 then
        return format('settings.nav: "%s" name must be 12 characters or fewer (got %s) - it has to fit under an icon on a phone',
          nm, length(lbl));
      end if;
    end if;

    if (item ->> 'visible')::boolean and (item ->> 'enabled')::boolean then
      /*
        Nested rather than written as `if not is_custom and not reg.ready`, and this is not a
        style preference — that expression is a bug. PL/pgSQL hands a condition to the SQL
        expression evaluator, which does not promise left-to-right evaluation of AND, so
        `reg.ready` may be read on an iteration where `reg` was never assigned because the item
        was custom. That raises `record "reg" is not assigned yet` from inside a BEFORE trigger,
        which is a settings page that cannot save with an error naming a variable. The same
        hazard is why `settings_mobile_nav()` uses ordered CASEs rather than guarded ANDs, and
        why 0018 does.
      */
      if not is_custom then
        -- §4 — a future item may sit in the list; it may not stand in the bar. Checked against
        -- the registry's `ready`, which is a fact about src/App.jsx that no row can claim.
        --
        -- A custom item has no `ready` and needs none: its equivalent question was asked and
        -- answered above by the `nav_routes()` lookup, and every row of that table is a page
        -- this build serves.
        if not reg.ready then
          return format('settings.nav: "%s" is not built yet, so it cannot be shown', nm);
        end if;
        if reg.required then
          home_ok := true;
        end if;
      end if;
      shown := shown + 1;
    end if;
  end loop;

  if shown < 2 then
    return format('settings.nav: show at least 2 items - one button is not a navigation bar (got %s)', shown);
  end if;

  if shown > 5 then
    return format('settings.nav: show at most 5 items - more than that and the labels stop fitting on a 320px phone (got %s)', shown);
  end if;

  /*
    §8 — the one item no configuration may take away, and note that no custom button can ever
    satisfy it. `home_ok` is set only from a registry row carrying `required`, so a સંચાલક who
    deleted મુખપૃષ્ઠ and made his own button to `/` would still be refused. That is deliberate:
    the guarantee is that the way home is a button the APP owns, whose word and picture may be
    his but whose existence is not. A custom item can be deleted; the way back must not be
    something that can be deleted.
  */
  if not home_ok then
    return 'settings.nav: "મુખપૃષ્ઠ" (home) cannot be switched off - it is the way back from every other page';
  end if;

  -- NULL means "nothing wrong with it". Every other path above returns the sentence a
  -- સંચાલક will read.
  return null;
end;
$$;

comment on function public.nav_config_error(jsonb) is
  'The whole of the mobile bottom navigation rules, in one place (0019; custom items added in '
  '0028): known registry keys or well-formed custom ids, no duplicates, 2..5 shown, home '
  'always shown, built-in routes matching nav_registry(), custom routes matching '
  'nav_routes(), icons from a closed list, labels of 12 characters or fewer, at most 12 '
  'custom items, and nothing shown whose route this build does not have. Returns NULL when '
  'the list is sound, otherwise the sentence explaining why not. Mirrors validateMobileNav() '
  'in shared/domain/navigation.js. Both the write-time trigger and the read-time resolver '
  'call this.';

-- The list with everything this build cannot draw removed — unknown registry keys, keys whose
-- route src/App.jsx does not have, and custom items pointing at a page that is not in
-- `nav_routes()`.
--
-- The reason the resolver filters and the trigger does not is unchanged from 0019 and now
-- covers both kinds with one sentence: a **write** naming a destination this build has never
-- heard of is a mistake being made right now and is refused outright; a **read** of a row
-- containing one is a row written by a newer build being rendered on an older phone, and must
-- cost one button rather than the whole bar.
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
      where
        -- a built-in this build routes …
        exists (
          select 1 from public.nav_registry() r
          where r.key = (e.item ->> 'key') and r.ready
        )
        -- … or a custom item pointing at a page this build serves. A malformed custom id is
        -- deliberately NOT filtered here: it is not a destination this build lacks, it is a
        -- damaged row, and nav_config_error() is what has an opinion about those.
        or (
          (e.item ->> 'key') like 'custom:%'
          and exists (
            select 1 from public.nav_routes() rt
            where rt.route = public.nav_normalize_route(e.item ->> 'route')
          )
        )
    ),
    '[]'::jsonb
  );
$$;

-- ================================================================ the resolver

-- The bar as the settings row holds it right now — every item that is visible, enabled and
-- routable, in order, carrying the registry's or the destination table's route rather than the
-- row's.
--
-- Mirrors `resolveMobileNav()` in shared/domain/navigation.js branch for branch, including
-- which way each malformed value falls, and that parity is asserted rather than asserted-to:
-- the same inputs are pushed through this function and through the JavaScript one and the two
-- outputs compared.
--
-- **Nothing in the application calls this.** The યુવક app resolves in JavaScript, from the row
-- it is already fetching, because a phone that has to make an RPC before it can draw its own
-- chrome is a phone that draws no chrome on a weak signal. This exists so that the rule is
-- answerable *in the database* — by a report, by a psql session debugging what a યુવક is
-- actually seeing, and by anything added later that must agree with the app about the bar
-- without reimplementing the resolver a third time.
create or replace function public.settings_mobile_nav()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  /*
    Filter, then validate, then resolve — in that order, because it is the order
    resolveMobileNavConfig() uses and the three steps are not commutative. Validating before
    filtering would reject the whole bar because a newer panel had saved a destination this
    build has never heard of.

    Then the whole filtered list stands or falls together. A list that fails is replaced
    entirely by the default four, never honoured in part: resolving leniently field by field
    is what produced a **one-item bar** from a row where two of three items were switched off,
    below the floor the trigger enforces, with no way to reach anything.
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
      -- The built-in's registry key, or the custom item's own id. `r.key` is NULL for a
      -- custom row and `e.item ->> 'key'` has already been matched against `custom:%` by
      -- nav_config_known() for it to be here at all.
      coalesce(r.key, e.item ->> 'key') as key,
      -- Code's, always: nav_registry()'s row for a built-in, nav_routes()' for a custom one.
      -- Never `e.item ->> 'route'`, which was only ever used to FIND the row below.
      coalesce(r.route, rt.route) as route,
      coalesce(
        nullif(btrim(regexp_replace(
          case
            when jsonb_typeof(e.item -> 'label') = 'string'
              -- The length cap the JavaScript resolver applies. Unreachable behind the
              -- trigger, which refuses a long label on the way in; here so that a row
              -- predating 0019 resolves the same way on both sides.
              and length(btrim(regexp_replace(e.item ->> 'label', '\s+', ' ', 'g'))) <= 12
            then e.item ->> 'label'
            else ''
          end,
          '\s+', ' ', 'g')), ''),
        r.label, rt.label
      ) as label,
      case
        when e.item ->> 'icon' = any (public.nav_icons()) then e.item ->> 'icon'
        else coalesce(r.icon, rt.icon)
      end as icon,
      -- Absence is not "off"; `false` is how that is said. A CASE and not
      -- `jsonb_typeof(...) = 'boolean' and not (...)::boolean`, because Postgres does not
      -- promise left-to-right evaluation of AND — the cast in the second arm may run even when
      -- the first is false, and `'yes'::boolean` is true while `'maybe'::boolean` raises.
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
    -- Two LEFT JOINs and a WHERE rather than one JOIN, because an item now has two ways of
    -- having a destination and exactly one of them applies to any given row. The `like`
    -- condition on the second join is what stops a built-in key from picking up a destination
    -- out of the route table by way of a stored route it has no business carrying.
    left join public.nav_registry() r
      on r.key = (e.item ->> 'key') and r.ready
    left join public.nav_routes() rt
      on (e.item ->> 'key') like 'custom:%'
     and rt.route = public.nav_normalize_route(e.item ->> 'route')
    where r.key is not null or rt.route is not null
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

comment on function public.settings_mobile_nav() is
  'The mobile bottom navigation bar as settings[''nav''].value.mobileBottom holds it right '
  'now (0019; custom items added in 0028). Mirrors resolveMobileNav() in '
  'shared/domain/navigation.js, including how each malformed value falls. Routes come from '
  'nav_registry() and nav_routes(), never from the stored row. Nothing in the app calls this '
  '- the phone resolves in JavaScript from a row it is already fetching; this is so the rule '
  'is answerable in the database too.';
