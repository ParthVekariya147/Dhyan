-- વર્ણી ધ્યાન — a સંચાલક stops being a યુવક.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE DEFECT
-- ════════════════════════════════════════════════════════════════════════════
--
-- `admin_profiles.id` references `public.profiles (id)` (0004:50). An administrator is
-- therefore a row in the યુવક table first and an administrator second, and `profiles` is not
-- a neutral identity table — it is the learning record. It carries `smk`, `like_answer`,
-- `comment_answer`, `gate_passed_at`, `level4_unlocked`, and it is the target of twenty-three
-- foreign keys from `progress`, `points_ledger`, `daily_records`, `level3_revisions` and the
-- rest. None of that is true about a person whose job is to run the panel.
--
-- Three consequences, all of them live today:
--
--   1. **An administrator must invent a mobile number.** `profiles.mobile` is NOT NULL,
--      UNIQUE, CHECKed against '^[6-9][0-9]{9}$' and immutable after insert
--      (profiles_guard_immutable, 0001). Seeding admin@varni.com required the placeholder
--      9999999999, which is now permanent, occupies a real number in the UNIQUE index, and is
--      a working login identifier through netlify/functions/login-mobile.js.
--
--   2. **Administrators are counted as યુવક.** The dashboard's "Total registered", the Users
--      list, every export and every progress report read `profiles` and so include the people
--      running the panel. 104 registered was never 104 yuvaks.
--
--   3. **The panel cannot manage administrators at all.** `permissions_for()` has granted
--      `admins.read`, `admins.create`, `admins.update`, `admins.disable` and `roles.assign`
--      since 0004, and `admin_profiles` has RLS policies enforcing all five — but no page in
--      admin/src renders any of it. The only way to appoint an administrator is a Node script
--      run by hand with the secret key.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE FIX
-- ════════════════════════════════════════════════════════════════════════════
--
-- One credential store, two identities:
--
--        auth.users                      Supabase Auth. Never duplicated; the join key.
--             │
--       ┌─────┴─────┐
--   profiles      admins                 <- this migration
--   (યુવક)        (સંચાલક)
--
-- `public.admins` keys off `auth.users` directly, exactly as `profiles` does. An
-- administrator needs no profile row, no SMK, no mobile and no learning record.
--
-- ── Both at once is allowed, and deliberately ───────────────────────────────
--
-- The founding account (9925842081) is a real યુવક with real progress history *and* a
-- SUPER_ADMIN. Forcing a choice would delete a person's learning record to satisfy a schema.
-- So the two tables may share an id. What changes is only who is *counted* as a યુવક:
-- `public.yuvaks` (below) is profiles minus anyone holding an admins row, and the panel reads
-- that view wherever it means "the people learning".
--
-- ── What this migration deliberately does NOT touch ─────────────────────────
--
--   * `has_permission()`, `permissions_for()`, the permission matrix, and all forty-odd RLS
--     policies written against them. They call `effective_role()`, so rebinding that one
--     function carries the whole model across. This is what makes the change safe.
--   * `public.bootstrap_admins` (0024). It stays exactly as it is — a separate, policy-less
--     table resolved once at migration time, still the lockout fallback that no panel action
--     can revoke. Folding it into `admins` would have made it revocable from the UI this
--     migration is written to enable, which is the one thing 0024 exists to prevent.
--   * `profiles`. Not one column, constraint or trigger changes. The placeholder row for
--     admin@varni.com is left in place; the `yuvaks` view is what stops it being counted.

-- ================================================================ the table

-- `if not exists` on every object in this file, and the two destructive steps are guarded by
-- what they find in the catalogue. scripts/test-point-engine.mjs re-applies every migration from
-- 0031 on and requires all of them to succeed a second time, because that replay **is** the
-- production repair procedure: these files are re-applied as a set, never one out of the middle.
create table if not exists public.admins (
  -- auth.users, NOT profiles. The whole point of the migration is on this line.
  id           uuid primary key references auth.users (id) on delete cascade,

  -- Identity carried here rather than borrowed from a profile, because there may not be one.
  -- Both are filled by admins_fill_identity() below when a caller omits them.
  email        text not null,
  name         text not null check (length(trim(name)) > 0),

  /*
    Nullable, and contact information only.

    An administrator signs in by email. `netlify/functions/login-mobile.js` resolves a number
    against `profiles` and is untouched by this migration, so a number here is NOT a login
    identifier and grants nothing — which is exactly why it is allowed to be absent, and why
    admin@varni.com never needed 9999999999 in the first place.
  */
  mobile       text check (mobile ~ '^[6-9][0-9]{9}$'),

  role         public.admin_role not null,

  -- Lifecycle, not deletion. A disabled administrator keeps his audit history attached to a
  -- row that still exists. Same three states 0004 defined.
  status       text not null default 'ACTIVE'
               check (status in ('ACTIVE', 'SUSPENDED', 'DISABLED')),

  -- Optional. The panel shows `name`; this is for "સંચાલક (વરાછા)" style labels.
  display_name text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- auth.users and not profiles, for the same reason `id` is: the administrator who appointed
  -- this one may not have a profile either.
  created_by   uuid references auth.users (id)
);

comment on table public.admins is
  'Who holds which સંચાલક role. Keyed by auth.users, so an administrator needs no યુવક '
  'profile — see 0038. Never the sole authority: has_permission() is what the RLS policies '
  'call, and it reads this table itself rather than trusting a client claim.';

comment on column public.admins.mobile is
  'Contact only, and optional. Login is by email; login-mobile.js resolves numbers against '
  'public.profiles and never reads this column.';

-- Address uniqueness is really auth.users'', which is case-insensitive. Mirroring it here
-- stops two admins rows pointing at what a person would read as one account.
create unique index if not exists admins_email_key on public.admins (lower(email));

-- Partial, so any number of administrators may have no number while two still cannot claim
-- the same one.
create unique index if not exists admins_mobile_key on public.admins (mobile) where mobile is not null;

-- Mirrors admin_profiles_role_idx: "who currently holds this role" is the question the panel
-- and effective_role() both ask.
create index if not exists admins_role_idx on public.admins (role) where status = 'ACTIVE';

-- The સંચાલક tab's default ordering.
create index if not exists admins_created_idx on public.admins (created_at desc);

-- ================================================================ carry the existing rows

-- Before the triggers exist, so nothing has to stand aside for a migration. Every value comes
-- from the rows already present; nothing is invented.
--
-- Guarded on `admin_profiles` still being a *table* (relkind 'r'). On a second run it is the
-- compatibility view created at the bottom of this file, and selecting from it would mean
-- reading `admins` to insert into `admins` — harmless with ON CONFLICT, and confusing enough
-- to be worth not doing.
do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'admin_profiles' and c.relkind = 'r'
  ) then
    insert into public.admins (
      id, email, name, mobile, role, status, display_name, created_at, updated_at, created_by
    )
    select
      ap.id,
      coalesce(p.email, u.email, ap.id::text),
      -- A profile name if there is one, otherwise the local part of the address. Never empty:
      -- the CHECK above would refuse it and this migration must not fail on a live project.
      coalesce(
        nullif(trim(p.name), ''),
        nullif(split_part(coalesce(p.email, u.email, ''), '@', 1), ''),
        'સંચાલક'
      ),
      p.mobile,
      ap.role,
      ap.status,
      ap.display_name,
      ap.created_at,
      ap.updated_at,
      ap.created_by
    from public.admin_profiles ap
    left join public.profiles p on p.id = ap.id
    left join auth.users u on u.id = ap.id
    on conflict (id) do nothing;
  end if;
end
$$;

do $$
declare
  r record;
  n integer;
begin
  select count(*) into n from public.admins;
  raise notice '[0038] % administrator(s) carried over from admin_profiles:', n;
  for r in select role, status, name, email from public.admins order by created_at loop
    raise notice '[0038]   %  %  %  <%>', r.status, r.role, r.name, r.email;
  end loop;
end
$$;

-- ================================================================ identity, filled in

-- So a caller may write `(id, role)` and get a complete row. The seed script, the
-- create-admin function and the compatibility view below all rely on this rather than each
-- re-deriving a name and an address from somewhere.
create or replace function public.admins_fill_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null or trim(new.email) = '' then
    new.email := coalesce(
      (select p.email from public.profiles p where p.id = new.id),
      (select u.email from auth.users u where u.id = new.id)
    );
  end if;

  if new.name is null or trim(new.name) = '' then
    new.name := coalesce(
      (select nullif(trim(p.name), '') from public.profiles p where p.id = new.id),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'સંચાલક'
    );
  end if;

  -- NOT NULL is checked after BEFORE triggers, so a row that arrived with neither is legal by
  -- the time the constraint is evaluated — and a row for an id with no profile and no auth
  -- account still fails, which is correct.
  return new;
end;
$$;

drop trigger if exists admins_fill_identity on public.admins;

create trigger admins_fill_identity
  before insert on public.admins
  for each row execute function public.admins_fill_identity();

-- ================================================================ the guards, carried over

-- Identical in every rule and every message to admin_profiles_guard() (0004:480). Only the table
-- it defends changed.
--
-- The messages are part of the contract, not debug text: scripts/test-rls.mjs and
-- scripts/test-admins.mjs assert them verbatim, and admin/src/features/users/services/
-- adminService.js matches on them to tell a person which rule refused their edit. (They are
-- matched there rather than in admin/src/lib/errors.js, which maps every P0001 to one generic
-- sentence — so all eight refusals would otherwise have arrived as "this change does not follow
-- the rules", which is true of each of them and useful about none.)
create or replace function public.admins_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller      uuid := auth.uid();
  caller_role public.admin_role := public.effective_role();
begin
  -- No session user: a migration or the service_role key, both of which are server-side and
  -- already trusted. This is the only way the first row is ever created.
  if caller is null then
    if tg_op = 'UPDATE' then
      new.updated_at := now();
    end if;
    return new;
  end if;

  -- Every OLD reference below sits inside an explicit `if tg_op = 'UPDATE'` block rather than
  -- after an `and`: PL/pgSQL does not promise left-to-right evaluation of boolean operands,
  -- and reading OLD during an INSERT raises "record old is not assigned yet".
  if tg_op = 'INSERT' then
    if new.id = caller then
      raise exception 'an administrator cannot appoint themselves';
    end if;
    if not public.has_permission('admins.create') then
      raise exception 'not permitted to manage administrators';
    end if;
    new.created_by := coalesce(new.created_by, caller);
  else
    -- Editing your own display_name is fine; changing your own role or status is not,
    -- whoever you are.
    if new.id = caller
       and (new.role is distinct from old.role or new.status is distinct from old.status) then
      raise exception 'an administrator cannot change their own role or status';
    end if;

    if not public.has_permission('admins.update') then
      raise exception 'not permitted to manage administrators';
    end if;

    if new.role is distinct from old.role and not public.has_permission('roles.assign') then
      raise exception 'not permitted to assign roles';
    end if;

    if new.status is distinct from old.status and not public.has_permission('admins.disable') then
      raise exception 'not permitted to enable or disable administrators';
    end if;

    -- Revoking SUPER_ADMIN is as restricted as granting it, so an ADMIN who somehow acquired
    -- admins.update cannot demote the person above them.
    if old.role = 'SUPER_ADMIN' and caller_role is distinct from 'SUPER_ADMIN' then
      raise exception 'only a SUPER_ADMIN may change a SUPER_ADMIN';
    end if;

    new.updated_at := now();
  end if;

  if new.role = 'SUPER_ADMIN' and caller_role is distinct from 'SUPER_ADMIN' then
    raise exception 'only a SUPER_ADMIN may grant SUPER_ADMIN';
  end if;

  return new;
end;
$$;

-- AFTER admins_fill_identity by name: triggers of the same type fire in alphabetical order,
-- and 'admins_fill_identity' < 'admins_guard'. The guard reads nothing the fill writes, so the
-- order is not load-bearing — it is stated because a future rename could silently change it.
drop trigger if exists admins_guard on public.admins;

create trigger admins_guard
  before insert or update on public.admins
  for each row execute function public.admins_guard();

-- Disable, never delete — and unlike a missing RLS policy, this also stops service_role.
create or replace function public.admins_no_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'administrators are disabled (status = DISABLED), never deleted';
end;
$$;

drop trigger if exists admins_no_delete on public.admins;

create trigger admins_no_delete
  before delete on public.admins
  for each row execute function public.admins_no_delete();

-- ================================================================ the trail

-- Carried from audit_admin_profile() (0004:334). A role change is still recorded as a role
-- change: "ADMIN_UPDATED" on a row whose `role` moved from VIEWER to SUPER_ADMIN is a true
-- statement and a useless one.
create or replace function public.audit_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  act   text;
  b     jsonb;
begin
  if actor is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    act := 'ROLE_ASSIGNED';
  else
    b := to_jsonb(old);
    if new.role is distinct from old.role then
      act := 'ROLE_CHANGED';
    elsif new.status is distinct from old.status then
      act := case when new.status = 'ACTIVE' then 'ADMIN_ENABLED' else 'ADMIN_DISABLED' end;
    else
      act := 'ADMIN_UPDATED';
    end if;
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, target_id, "before", "after")
  values (actor, public.effective_role()::text, act, 'admins', new.id::text, b, to_jsonb(new));

  return new;
end;
$$;

drop trigger if exists audit_admins on public.admins;

create trigger audit_admins
  after insert or update on public.admins
  for each row execute function public.audit_admin();

-- ---------------------------------------------------------------- the trail's own key
--
-- `audit_logs.actor_id` referenced `public.profiles (id)` (0001:115), which quietly made a
-- profile row mandatory for every administrator: the AFTER triggers that write the trail run
-- inside the same transaction as the change, so an administrator with no profile could not
-- edit a દ્રશ્ય or save a setting at all — the insert would raise a foreign key violation and
-- take the whole statement with it.
--
-- Repointed at auth.users, which is where the identity actually lives. Every existing
-- actor_id already satisfies it: profiles.id is itself a reference to auth.users.
alter table public.audit_logs drop constraint if exists audit_logs_actor_id_fkey;

alter table public.audit_logs
  add constraint audit_logs_actor_id_fkey
  foreign key (actor_id) references auth.users (id);

-- The panel used to read the actor's name by embedding `profiles!audit_logs_actor_id_fkey`,
-- which the line above just made impossible (auth is not an exposed schema, and an admin may
-- have no profile). This answers the same question over both identities.
--
-- SECURITY DEFINER with an explicit permission check rather than a plain view: the caller needs
-- to see names of people they may hold no `users.read` over, and gating on `audit.read` — the
-- permission that opens the page these names appear on — is the honest rule.
create or replace function public.actor_names(ids uuid[])
returns table (id uuid, name text, kind text)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.name, 'admin'::text
  from public.admins a
  where a.id = any(ids) and public.has_permission('audit.read')
  union
  select p.id, p.name, 'yuvak'::text
  from public.profiles p
  where p.id = any(ids)
    and public.has_permission('audit.read')
    and not exists (select 1 from public.admins x where x.id = p.id);
$$;

revoke all on function public.actor_names(uuid[]) from public;
grant execute on function public.actor_names(uuid[]) to authenticated;

comment on function public.actor_names(uuid[]) is
  'Display names for audit_logs.actor_id, over both identities. Returns nothing unless the '
  'caller holds audit.read — the permission that opens the page these names are shown on.';

-- ================================================================ authority, rebound

-- `admin_profiles` becomes `admins`; the bootstrap fallback is untouched. Every RLS policy in
-- this schema is written against has_permission(), which calls this, so this one function is
-- the whole of the change for them.
create or replace function public.effective_role()
returns public.admin_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select a.role
      from public.admins a
      where a.id = auth.uid()
        and a.status = 'ACTIVE'
    ),
    (
      select 'SUPER_ADMIN'::public.admin_role
      from public.bootstrap_admins b
      where b.id = auth.uid()
    )
  );
$$;

comment on function public.effective_role() is
  'The role the caller is acting as, or NULL for an ordinary યુવક. public.admins first; then '
  'public.bootstrap_admins, which 0024 resolved once from the §3 mobile list. It reads neither '
  'profiles.mobile (chosen by the registrant, verified by nothing — see 0024) nor profiles at '
  'all: since 0038 an administrator need not be a યુવક.';

-- ================================================================ policies

alter table public.admins enable row level security;

-- Everyone with a role may see their own record — the panel needs it to know what to render.
-- Seeing *other* administrators is a permission. Identical to 0004:570.
drop policy if exists "own admin record readable" on public.admins;
drop policy if exists "admin record insertable" on public.admins;
drop policy if exists "admin record updatable" on public.admins;

-- Written with the call hoisted into a scalar subquery from the start, which is what 0039 does
-- to every other policy in the schema: `has_permission()` sitting bare in a qual is re-evaluated
-- once per row, and the સંચાલક tab lists every administrator on one page.
create policy "own admin record readable" on public.admins
  for select using (id = (select auth.uid()) or (select public.has_permission('admins.read')));

create policy "admin record insertable" on public.admins
  for insert with check ((select public.has_permission('admins.create')));

create policy "admin record updatable" on public.admins
  for update using ((select public.has_permission('admins.update')))
  with check ((select public.has_permission('admins.update')));

-- No delete policy, and a trigger behind it.

grant select, insert, update on public.admins to authenticated;

-- ================================================================ the old table

-- Dropping it takes its policies, its index and its three triggers with it. The functions
-- those triggers called are dropped by name because nothing else references them.
-- Guarded the same way the backfill is: on a re-run this name is the view below, and `drop
-- table` on a view raises rather than skipping.
do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'admin_profiles' and c.relkind = 'r'
  ) then
    drop table public.admin_profiles;
  end if;
end
$$;

drop function if exists public.admin_profiles_guard();
drop function if exists public.admin_profiles_no_delete();
drop function if exists public.audit_admin_profile();

/*
  Re-created as a view, and this is a compatibility shim with a limited life.

  Eight scripts under scripts/ speak to `admin_profiles` directly to build their fixtures, and
  every one of them asserts something about RLS or about a guard's message. Rewriting all eight
  in the same commit that changes the schema underneath them would mean the suite proving the
  new table is the suite that was edited to pass against it.

  So they keep their table name for one release. This is a simple view over one table with no
  aggregate, join or DISTINCT, which makes it auto-updatable: an INSERT through it is an INSERT
  into `admins`, so admins_fill_identity(), admins_guard(), admins_no_delete() and audit_admin()
  all fire exactly as they would on the base table. `security_invoker` means the policies above
  are applied with the caller's own rights rather than the view owner's — without it this view
  would be a way around every one of them.

  It cannot carry `email`, `name` or `mobile`: a caller writing through it supplies none of
  them, which is precisely what admins_fill_identity() is for.
*/
create or replace view public.admin_profiles
  with (security_invoker = on)
as
  select id, role, status, display_name, created_at, updated_at, created_by
  from public.admins;

comment on view public.admin_profiles is
  'DEPRECATED compatibility view over public.admins (0038). Kept so the scripts/test-*.mjs '
  'fixtures keep working across one release; new code reads public.admins. Auto-updatable, '
  'security_invoker, so every trigger and policy on the base table applies unchanged.';

grant select, insert, update, delete on public.admin_profiles to authenticated;

-- ================================================================ who is a યુવક

-- The counting fix. `profiles` still holds everybody who registered, administrators included
-- (an administrator may be a real યુવક — see the header), so "how many yuvaks are there" has
-- to be asked of something narrower than the table.
--
-- Built over `profiles_level4` rather than `profiles` so the panel loses nothing by switching:
-- that view is profiles plus `level4_gate_open`, the published gate rather than 0008's fixed
-- threshold, and admin/src/features/users/services/userService.js already reads it.
--
-- The exclusion goes through a SECURITY DEFINER function on purpose. Written as a plain
-- `not exists (select 1 from public.admins …)` under security_invoker, the subquery would be
-- subject to the admins SELECT policy — so for a COORDINATOR, who holds `users.read` but not
-- `admins.read`, it would match nothing and quietly stop excluding anyone. The list a
-- COORDINATOR sees would then disagree with the list an ADMIN sees, which is the kind of
-- difference nobody discovers until a report is wrong.
create or replace function public.admin_account_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.admins;
$$;

revoke all on function public.admin_account_ids() from public;
grant execute on function public.admin_account_ids() to authenticated;

comment on function public.admin_account_ids() is
  'Every id holding a સંચાલક record, regardless of the caller''s permissions. Exists so '
  'public.yuvaks excludes the same people for every role — see 0038.';

create or replace view public.yuvaks
  with (security_invoker = on)
as
  select v.*
  from public.profiles_level4 v
  where v.id not in (select public.admin_account_ids());

comment on view public.yuvaks is
  'The people learning: profiles_level4 minus anyone holding a public.admins row. What the '
  'Users list, the counts, the exports and the progress reports mean by "યુવક". Read this '
  'wherever a number is shown to a person; read profiles when you mean every account.';

grant select on public.yuvaks to authenticated;

-- ================================================================ say what happened

do $$
declare
  admins_n  integer;
  both_n    integer;
  yuvaks_n  integer;
  profiles_n integer;
begin
  select count(*) into admins_n from public.admins;
  select count(*) into profiles_n from public.profiles;
  select count(*) into both_n
    from public.admins a join public.profiles p on p.id = a.id;

  -- Counted directly rather than through the view: this block runs as the owner, where the
  -- view's security_invoker semantics are not what a signed-in caller would see.
  yuvaks_n := profiles_n - both_n;

  raise notice '[0038] % administrators, % profiles.', admins_n, profiles_n;
  raise notice '[0038] % account(s) are both — they keep their learning record and are', both_n;
  raise notice '[0038] excluded from public.yuvaks, which now holds %.', yuvaks_n;
  raise notice '[0038] Every count shown to a person should read public.yuvaks from here on.';
end
$$;
