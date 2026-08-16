-- વર્ણી ધ્યાન — where a યુવક is, as rows the સંચાલક writes.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE DEFECT
-- ════════════════════════════════════════════════════════════════════════════
--
-- Every યુવક carries two placenames, and until this migration both were **hardcoded twice**:
--
--     0001:29                       check (sub_zone_id in ('vedroad', 'varachha', 'navsari'))
--     shared/domain/constants.js:35  ZONES = [{ id: 'surat', … }]
--     shared/domain/constants.js:37  SUBZONES = [ vedroad, varachha, navsari ]
--
-- So opening a મંડળ in રાંધેર was a **release**: a migration to widen the constraint, a bundle
-- to widen the array, and the two deployed together — because a bundle that shipped first would
-- put રાંધેર on the નોંધણી form and the database would then refuse every યુવક who chose it,
-- with a `check_violation` on a screen he cannot act on. A સંઘ that has opened a new મંડળ
-- cannot wait for that, and should not have to ask anybody for it.
--
-- The same is true one level up. `zone_id` is the **city** and has never had any constraint at
-- all — only `default 'surat'` — so the panel's "All cities" filter has been offering a list of
-- exactly one, forever, with no way to add a second.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE COLUMN NAMES ARE THE WRONG WAY ROUND, AND STAY THAT WAY
-- ════════════════════════════════════════════════════════════════════════════
--
--     profiles.zone_id      is the CITY      ('surat')
--     profiles.sub_zone_id  is the ZONE      ('varachha')
--
-- Every report in the panel already aliases them (`p.zone_id as city_id, p.sub_zone_id as
-- zone_id`, e.g. 0040:371). Renaming the columns would touch nine reporting functions, six RLS
-- policies, the નોંધણી form and every Excel export, to improve nothing a person can see — and
-- it would do it in the same migration that changes what those columns MEAN, which is the one
-- combination guaranteed to make a mistake unreviewable.
--
-- So the columns keep their names, the new tables are called what they are, and
-- shared/domain/geography.js is the vocabulary that stops the confusion spreading: everything
-- on that side of the line says `city` and `zone`.
--
-- ════════════════════════════════════════════════════════════════════════════
-- NOTHING THAT EXISTS MOVES — and the order below is what makes that true
-- ════════════════════════════════════════════════════════════════════════════
--
-- Checked against the live project before this was written: 111 profiles, 108 in
-- surat/varachha and 3 in surat/vedroad, no empty values, and nothing outside the seed.
--
--   1. the tables
--   2. the seed — the SAME four ids and the SAME Gujarati names the array and the constraint
--      already carry, so no screen changes a character
--   3. only then the constraint swap
--
-- There is no `update public.profiles` in this file. The foreign keys attach to rows that
-- already satisfy them, and if any row did not, the ALTER would abort — and `scripts/db.mjs`
-- runs each file in one transaction, so an abort leaves nothing behind at all.
--
-- `navsari` is seeded although no યુવક is in it: it is a choice the નોંધણી form offers today,
-- and a migration that quietly removed an option would be making a decision about a સંઘ.
--
-- Written to run twice: every create is `if not exists`, every seed is `on conflict do nothing`,
-- every constraint is dropped before it is added.

-- ================================================================ the two tables

/*
  An id is lower-case English, and that is not a style rule.

  It goes into a foreign key on every profile row, into a query string on the panel's filters
  (`?city=surat&zone=varachha`), into a CSV column a સંચાલક opens in Excel, and into more than
  one jsonb key. Spaces, capitals and Gujarati survive some of those and not others, and the
  ones they do not survive fail late and quietly — a filter that matches nothing looks exactly
  like a zone with nobody in it.

  Gujarati belongs in `name`, which is the only one of the two any યુવક ever reads.

  The pattern is character for character the one in shared/domain/geography.js's GEO_ID_RE, so
  the panel refuses what the database refuses and says something useful about it first.
*/
create table if not exists public.cities (
  id         text primary key check (id ~ '^[a-z][a-z0-9-]{1,30}$'),

  -- What every screen prints. Gujarati, and bounded so a list stays a list.
  name       text not null check (length(btrim(name)) > 0 and length(name) <= 60),

  /*
    ACTIVE or RETIRED, and there is no third state and no delete.

    §7's "suspend, never delete" is this schema's rule for people, and it binds harder here: a
    city id is written into every profile in it, into every record behind those profiles, into
    audit rows and into exports already printed. Deleting one would either orphan all of that or
    cascade into deleting યુવકો. RETIRED means "nobody new here" — it is not offered on the
    નોંધણી form, and it is still shown everywhere a યુવક who is already in it appears, because
    he is still in it.
  */
  status     text not null default 'ACTIVE' check (status in ('ACTIVE', 'RETIRED')),

  -- The સંચાલક's own order. Two rows he has not ordered fall back to their names in the
  -- resolver, so a list is stable between two loads either way.
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.cities is
  'The cities a યુવક can belong to, as rows rather than a default (0050). profiles.zone_id is '
  'a foreign key to this - the column name is 0001''s and is the wrong way round; see the '
  'header. Never deleted: cities_no_delete() refuses it, because the id is written into every '
  'profile in the city. Read by anon, because નોંધણી needs the list before anybody signs in.';

create table if not exists public.zones (
  id         text primary key check (id ~ '^[a-z][a-z0-9-]{1,30}$'),

  /*
    Which city, and `on update cascade` rather than a plain reference.

    A city id is not something a સંચાલક may edit — cities_guard() below pins it — so the
    cascade is not there to follow a rename. It is there so that the one operation which WOULD
    move it, a future migration renaming a city, cannot silently orphan every zone in it.
  */
  city_id    text not null references public.cities (id) on update cascade,

  name       text not null check (length(btrim(name)) > 0 and length(name) <= 60),
  status     text not null default 'ACTIVE' check (status in ('ACTIVE', 'RETIRED')),
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/*
  The id is unique across every city, not merely within one.

  It has to be: `profiles.sub_zone_id` is a single text column with no city beside it, so a
  zone id is the whole of what a profile row remembers about where he is. Two cities each
  holding a `varachha` would make 111 profile rows ambiguous, and the ambiguity would surface
  as a report quietly counting one city's યુવકો into another's total.

  It is why the panel must suggest `surat-randher` rather than `randher` when a second city
  arrives, and shared/domain/geography.js's messages say so in as many words.
*/
create index if not exists zones_city_idx on public.zones (city_id, sort_order, id);

comment on table public.zones is
  'The zones inside a city (0050). profiles.sub_zone_id is a foreign key to this, replacing '
  '0001''s three-value CHECK. The id is unique across ALL cities, because a profile stores the '
  'zone alone with no city beside it. Never deleted - zones_no_delete() refuses it. Read by '
  'anon, because નોંધણી needs the list before anybody signs in.';

-- ================================================================ the seed

/*
  The ids the hardcoded array and the CHECK constraint already carry, with the same Gujarati
  names, so that not one character changes on the નોંધણી form or in any report on the day this
  runs.

  **One city.** સુરત is the only city there is any data for — all 111 profiles are in it — and a
  second one seeded "ready for later" would be an empty option on the first screen of the app
  with nobody behind it. When નવસારી becomes a city it is a row the સંચાલક adds in the panel,
  which is the entire point of this migration.

  **Two open zones, and a third that is closed rather than absent.**

  વરાછા (108 યુવકો) and વેડરોડ (3) stay open. `navsari` currently holds nobody, and the ask was
  for those two alone — but it is seeded as RETIRED rather than left out, and the difference
  matters for one reason: **the running app still offers it.** `SUBZONES` in the bundle lists
  three, so between this migration landing and the new bundle reaching a phone, a visitor can
  still choose નવસારી on નોંધણી. Omitting the row would meet that registration with a
  `foreign_key_violation` on a screen he cannot act on; seeding it RETIRED meets it with the
  ordinary "this zone is closed" refusal, and profiles_guard_geography() is what says so.

  RETIRED means it is not offered — `geography()` hides it from a signed-out caller, so the two
  dropdown options are વરાછા and વેડરોડ exactly as asked. Reopening it later is one click.

  `on conflict do nothing` throughout: this file is written to run twice, and on the second run
  the સંચાલક may already have renamed one of these — **વેડરોડ to મૂર્તિબાગ is exactly the edit
  this whole migration exists to make possible**, and it needs no migration, no deploy, and does
  not touch the 3 profile rows in it. A seed that overwrote would undo his work.
*/
insert into public.cities (id, name, sort_order) values
  ('surat', 'સુરત', 1)
on conflict (id) do nothing;

insert into public.zones (id, city_id, name, status, sort_order) values
  ('varachha', 'surat', 'વરાછા',  'ACTIVE',  1),
  ('vedroad',  'surat', 'વેડરોડ', 'ACTIVE',  2),
  ('navsari',  'surat', 'નવસારી', 'RETIRED', 3)
on conflict (id) do nothing;

-- ================================================================ the constraint swap

/*
  0001's CHECK goes, and two foreign keys arrive.

  The CHECK is dropped by SEARCHING for it rather than by naming it, and that is not caution
  for its own sake: 0001 wrote it inline, so its name is whatever Postgres generated, and a
  project restored from a dump or created by an older tool may carry a different one. A
  `drop constraint if exists profiles_sub_zone_id_check` that found nothing would leave the
  three-value constraint standing, the foreign key would be added beside it, and રાંધેર would
  still be refused — with every screen in the panel saying the zone exists.
*/
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'profiles'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%sub_zone_id%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
    raise notice '[0050] dropped 0001''s zone CHECK: %', c.conname;
  end loop;
end
$$;

alter table public.profiles drop constraint if exists profiles_city_fk;
alter table public.profiles drop constraint if exists profiles_zone_fk;

/*
  `not valid` is deliberately NOT used, on either key.

  It would let the constraint be added without checking the 111 existing rows, which is the
  right tool for a large table that cannot be locked. Here it would be the wrong one: the whole
  claim this migration makes is that every existing profile already fits, and `not valid` is
  precisely the option that declines to check that claim. If a row does not fit, this must fail
  loudly inside the transaction and leave the database exactly as it was.
*/
alter table public.profiles
  add constraint profiles_city_fk foreign key (zone_id)
  references public.cities (id) on update cascade;

alter table public.profiles
  add constraint profiles_zone_fk foreign key (sub_zone_id)
  references public.zones (id) on update cascade;

-- ================================================================ the two must agree

/*
  A profile's city and its zone are two columns, and nothing above stops them contradicting
  each other: `zone_id = 'navsari-city'` beside `sub_zone_id = 'varachha'` satisfies both
  foreign keys and is nonsense.

  It matters more than tidiness, and this is the reason to state plainly: **an admin's scope is
  a (city, zone) pair** (0051). A profile whose two columns disagree would be visible to a
  સંચાલક scoped to one of them and invisible to the other, and neither would be wrong — the row
  itself would be. So the pair is made impossible rather than reported.

  A trigger and not a CHECK: the rule reads another table, which a CHECK may not do.
*/
create or replace function public.profiles_guard_geography()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  z record;
begin
  -- Nothing to check when neither column moved. An UPDATE that touches a યુવક's name must not
  -- pay for a lookup, and — more importantly — must not start failing because the સંચાલક
  -- retired the zone he is in six months ago. See the ACTIVE test below.
  if tg_op = 'UPDATE'
     and new.zone_id is not distinct from old.zone_id
     and new.sub_zone_id is not distinct from old.sub_zone_id then
    return new;
  end if;

  select * into z from public.zones where id = new.sub_zone_id;

  -- The foreign key has already refused an unknown zone by the time this runs, so this branch
  -- is unreachable through an ordinary write. It is stated anyway: a future migration that
  -- dropped the key would otherwise silently disable the whole of this function.
  if z.id is null then
    raise exception 'There is no zone called "%".', new.sub_zone_id
      using errcode = 'foreign_key_violation';
  end if;

  if z.city_id is distinct from new.zone_id then
    raise exception 'The zone "%" is in "%", not in "%".', z.id, z.city_id, new.zone_id
      using errcode = 'check_violation';
  end if;

  /*
    A RETIRED zone may not take somebody new, and this is the whole meaning of RETIRED.

    Only on INSERT and on a MOVE, never on an ordinary UPDATE — that is what the early return
    above is for. A યુવક who has been in વેડરોડ for three years when the સંચાલક retires it must
    go on being able to change his own name, pass the ગેટ and be suspended; he simply cannot be
    the reason somebody is put there. Freezing his row instead would make retiring a zone an act
    that quietly breaks every account in it.
  */
  if z.status <> 'ACTIVE' then
    raise exception 'The zone "%" is closed - choose an open one.', z.name
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.profiles_guard_geography() from public;

drop trigger if exists profiles_guard_geography on public.profiles;

create trigger profiles_guard_geography
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_geography();

comment on function public.profiles_guard_geography() is
  'A profile''s zone must belong to its city, and a new one may not be placed in a RETIRED '
  'zone (0050). Skipped entirely when neither column moved, so retiring a zone never freezes '
  'the યુવકો already in it. The city/zone pair is what an admin scope is expressed in (0051), '
  'which is why a contradictory pair is made impossible rather than reported.';

-- ================================================================ retire, never delete

/*
  The same refusal `admins_no_delete()` (0038) makes, for the same reason and one more.

  0038's reason: the history has to stay attached to somebody. This one's: a city or zone id is
  written into every profile in it, so a DELETE either fails on the foreign key — a
  `foreign_key_violation` naming a constraint, which tells a સંચાલક nothing he can act on — or,
  if somebody ever adds `on delete cascade` in a hurry, takes 108 યુવકો with it.

  Refusing here means the answer is always the same sentence, and the sentence says what to do
  instead.
*/
create or replace function public.geography_no_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'A % is closed, never deleted - set its status to RETIRED instead. Yuvaks already there keep their record.',
    case tg_table_name when 'cities' then 'city' else 'zone' end
    using errcode = 'check_violation';
end;
$$;

revoke all on function public.geography_no_delete() from public;

drop trigger if exists cities_no_delete on public.cities;
create trigger cities_no_delete
  before delete on public.cities
  for each row execute function public.geography_no_delete();

drop trigger if exists zones_no_delete on public.zones;
create trigger zones_no_delete
  before delete on public.zones
  for each row execute function public.geography_no_delete();

comment on function public.geography_no_delete() is
  'Refuses DELETE on cities and zones (0050). The id is written into every profile there, so '
  'the alternatives are a foreign-key error nobody can act on or a cascade that deletes '
  'યુવકો. RETIRED is the way a place is closed.';

/*
  What may be edited, and what may not.

  **The id may never change.** It is the value 111 profile rows carry, and `on update cascade`
  would faithfully rewrite all of them — which is exactly the problem: a સંચાલક correcting a
  typo in an id would silently rewrite every યુવક's record and every report keyed on the old
  value would go blank with nothing to explain it. The NAME is what he wants to change in
  practice, and that is free.

  **A city may not be retired while an open zone stands in it.** Otherwise the city disappears
  from the નોંધણી form while its zones keep taking new યુવકો — every screen correct, the
  intention silently not carried out. Mirrors canRetireCity() in shared/domain/geography.js,
  message for message.

  **A zone may not change city once anybody is in it.** `profiles.zone_id` holds the city
  separately, so moving the zone would put every યુવક in it into the contradictory state the
  guard above exists to prevent — and it would do it to rows nobody touched.
*/
create or replace function public.geography_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'A % id cannot be changed - it is stored on every yuvak there. Change the name instead.',
        case tg_table_name when 'cities' then 'city' else 'zone' end
        using errcode = 'check_violation';
    end if;

    new.updated_at := now();
  end if;

  if tg_table_name = 'cities' then
    if new.status = 'RETIRED' and (tg_op = 'INSERT' or old.status <> 'RETIRED') then
      select count(*) into n from public.zones where city_id = new.id and status = 'ACTIVE';
      if n > 0 then
        raise exception 'Retire this city''s % open zone(s) first.', n
          using errcode = 'check_violation';
      end if;
    end if;

    return new;
  end if;

  -- zones
  if tg_op = 'UPDATE' and new.city_id is distinct from old.city_id then
    select count(*) into n from public.profiles where sub_zone_id = new.id;
    if n > 0 then
      raise exception 'This zone cannot be moved to another city - % yuvak(s) are in it.', n
        using errcode = 'check_violation';
    end if;
  end if;

  -- A zone cannot be opened inside a city that is closed: the city would not be offered on the
  -- નોંધણી form, so the zone would be unreachable and would look like a bug rather than a
  -- decision.
  if new.status = 'ACTIVE'
     and (select c.status from public.cities c where c.id = new.city_id) <> 'ACTIVE' then
    raise exception 'The city this zone is in is closed - reopen the city first.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.geography_guard() from public;

drop trigger if exists cities_guard on public.cities;
create trigger cities_guard
  before insert or update on public.cities
  for each row execute function public.geography_guard();

drop trigger if exists zones_guard on public.zones;
create trigger zones_guard
  before insert or update on public.zones
  for each row execute function public.geography_guard();

comment on function public.geography_guard() is
  'Holds the rules a foreign key cannot state (0050): an id is immutable because every profile '
  'there stores it; a city cannot be retired while an open zone stands in it; a zone cannot '
  'move city once anybody is in it; a zone cannot be open inside a closed city. Mirrors '
  'validateCity(), validateZone() and canRetireCity() in shared/domain/geography.js.';

-- ================================================================ who may write them

/*
  A new permission rather than `settings.update`.

  Placing a યુવક is not a setting: `settings.update` is held by ADMIN and CONTENT_MANAGER and
  covers the ધૂન, the slideshow and the ક્રમાંક's shape — things that change what a screen
  looks like. Retiring a zone changes which population every report in the panel enumerates and
  which યુવકો a scoped સંચાલક can see at all (0051). That is closer to `users.test` than to a
  checkbox, and it gets a name of its own so a role can hold one without the other.

  `permissions` is written ONLY by a migration — permissions_immutable() (0043) refuses any
  write with a session user, service_role included — so this insert is the only way the key can
  come to exist, and no policy anywhere can enforce a key that is not in here.
*/
insert into public.permissions (key, resource, verb, label, description, is_section, sort) values
  ('geography.manage', 'geography', 'manage',
   'Manage cities and zones',
   'Add a city or a zone, rename one, change its order, or close one. Closing a zone stops new yuvaks being registered there and changes what every report counts.',
   true, 810)
on conflict (key) do nothing;

/*
  SUPER_ADMIN only, to begin with.

  The same judgement 0040 made about `users.test`: an act that changes which population every
  report enumerates is closer to granting a role than to editing a field. It is a row in
  `role_permissions`, so a SUPER_ADMIN can hand it to ADMIN from the role editor this afternoon
  without a migration — which is the whole point of 0043 and the reason this does not need to
  guess right.
*/
insert into public.role_permissions (role_key, permission) values
  ('SUPER_ADMIN', 'geography.manage')
on conflict do nothing;

-- ================================================================ who may read them

alter table public.cities enable row level security;
alter table public.zones  enable row level security;

/*
  **Readable by `anon`, and that is the point of the whole table.**

  નોંધણી asks a visitor for his city and his zone BEFORE he has an account, so the list has to
  be readable with no session at all. Today it is readable because it is compiled into the
  bundle; the moment it becomes a row, a policy limited to `authenticated` would give the first
  screen of the app an empty dropdown — and 0047 exists because exactly that happened to the
  app icon on લોગિન.

  What is disclosed by this is a list of placenames the નોંધણી form has always printed on a
  public page. There is no count, no યુવક, and no relationship to anybody — the counts the panel
  shows are computed by the `admin_*` reports, which are behind `progress.read` and are not
  touched here.

  RETIRED rows are NOT readable by anon: they are not choices, and a closed zone appearing in a
  visitor's dropdown is the one failure this feature must not have. The panel reads them through
  the second policy, because it has to be able to reopen one.
*/
drop policy if exists "open places are public" on public.cities;
create policy "open places are public" on public.cities
  for select to anon, authenticated
  using (status = 'ACTIVE');

drop policy if exists "open places are public" on public.zones;
create policy "open places are public" on public.zones
  for select to anon, authenticated
  using (status = 'ACTIVE');

/*
  Everyone in the panel reads every place, open or closed, because a યુવક in a retired zone must
  still print with his zone's NAME rather than with its id — on his detail page, in a report and
  in an export. `users.read` and not `geography.manage`: reading a placename is not managing one.
*/
drop policy if exists "the panel reads every place" on public.cities;
create policy "the panel reads every place" on public.cities
  for select to authenticated
  using (public.has_permission('users.read') or public.has_permission('geography.manage'));

drop policy if exists "the panel reads every place" on public.zones;
create policy "the panel reads every place" on public.zones
  for select to authenticated
  using (public.has_permission('users.read') or public.has_permission('geography.manage'));

drop policy if exists "geography.manage writes places" on public.cities;
create policy "geography.manage writes places" on public.cities
  for insert to authenticated
  with check (public.has_permission('geography.manage'));

drop policy if exists "geography.manage edits places" on public.cities;
create policy "geography.manage edits places" on public.cities
  for update to authenticated
  using (public.has_permission('geography.manage'))
  with check (public.has_permission('geography.manage'));

drop policy if exists "geography.manage writes places" on public.zones;
create policy "geography.manage writes places" on public.zones
  for insert to authenticated
  with check (public.has_permission('geography.manage'));

drop policy if exists "geography.manage edits places" on public.zones;
create policy "geography.manage edits places" on public.zones
  for update to authenticated
  using (public.has_permission('geography.manage'))
  with check (public.has_permission('geography.manage'));

/*
  **No DELETE policy on either table, for anybody.**

  RLS denies any command it has no policy for, so this is the strongest possible statement of
  the rule and it is made by absence rather than by a check. The trigger above says the same
  thing again in words a person can read; the trigger is the explanation and this is the wall.
*/

-- Supabase's default privileges grant every new table in `public` to anon and authenticated, so
-- RLS is otherwise the only thing standing between a browser and this table. Stated rather than
-- relied upon, exactly as 0034:3069 and 0035:2486 state it for their own tables.
grant select on public.cities to anon, authenticated;
grant select on public.zones  to anon, authenticated;
grant insert, update on public.cities to authenticated;
grant insert, update on public.zones  to authenticated;
revoke delete on public.cities from anon, authenticated;
revoke delete on public.zones  from anon, authenticated;

-- ================================================================ the list, in one call

/*
  Cities and zones together, with how many યુવકો are in each.

  One call rather than two selects, because every screen that wants one wants the other: the
  નોંધણી form fills its second dropdown from the first, the panel's filter does the same, and
  the scope editor (0051) picks a (city, zone) pair. Two round trips to draw one control is two
  chances for the second to fail and leave the first on screen.

  SECURITY DEFINER and **counted from public.yuvaks**, which is the important line. The counts
  are what make the panel's list mean something — "retire વેડરોડ" is a different decision at 3
  યુવકો than at 300 — and `yuvaks` is the population every other count in this panel uses:
  administrators excluded (0038), test accounts excluded (0040). A count taken from `profiles`
  here would disagree with the Users page by however many people were testing that week.

  The counts are returned to `authenticated` only. `anon` gets the names — it is filling in a
  form — and a signed-out visitor learning how many યુવકો are in each zone is a fact about the
  સંઘ that the નોંધણી page has no reason to publish.
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
                 select count(*) from public.yuvaks y where y.zone_id = c.id
               ) end
             ) order by c.sort_order, c.name, c.id)
      from public.cities c
      -- A signed-out visitor is filling in નોંધણી and is shown only what he may choose.
      -- Anybody signed in reads the closed ones too, because a યુવક already in one has to be
      -- able to see its name on his own profile.
      where auth.uid() is not null or c.status = 'ACTIVE'
    ), '[]'::jsonb),

    'zones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', z.id, 'city_id', z.city_id, 'name', z.name, 'status', z.status,
               'sort_order', z.sort_order,
               'yuvaks', case when auth.uid() is null then 0 else (
                 select count(*) from public.yuvaks y where y.sub_zone_id = z.id
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
  'the panel''s filters and the scope editor (0050). SECURITY DEFINER so the counts can come '
  'from public.yuvaks - administrators and test accounts excluded, the same population every '
  'other count in the panel uses. A signed-out caller sees ACTIVE places only and no counts at '
  'all: he is filling in a form, and how many યુવકો are in each zone is not something the '
  'નોંધણી page publishes. Consumed by normaliseGeography() in shared/domain/geography.js.';

-- ================================================================ say what happened

do $$
declare
  n_cities integer;
  n_zones  integer;
  n_prof   integer;
begin
  select count(*) into n_cities from public.cities;
  select count(*) into n_zones  from public.zones;
  select count(*) into n_prof   from public.profiles;

  raise notice '[0050] % city/cities and % zone(s) are now rows.', n_cities, n_zones;
  raise notice '[0050] % profile(s) checked against them - none was written to.', n_prof;
  raise notice '[0050] 0001''s three-value CHECK is gone. New places are added from the panel,';
  raise notice '[0050] and renaming one does not touch a single profile.';
end
$$;
