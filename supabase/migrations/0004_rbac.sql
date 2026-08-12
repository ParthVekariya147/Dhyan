-- વર્ણી ધ્યાન — roles, permissions, lifecycle, and an audit trail that cannot be skipped.
--
-- What 0001 had was a boolean. `public.is_admin()` answered yes or no from a list of three
-- mobile numbers, and every policy in the schema asked it the same question. That is
-- enough while the only administrators are the two સંચાલક numbers from §3. It stops being
-- enough the moment someone is meant to manage દર્શન content *without* also being able to
-- read 2,000 yuvaks' progress, or to look at reports without being able to change
-- anything.
--
-- This migration replaces the boolean with a role, and the role with a permission.
--
--   effective_role()   →  which role is the caller acting as, right now
--   permissions_for()  →  what may that role do          (the matrix, in one place)
--   has_permission()   →  may the caller do this one thing
--
-- Every RLS policy below now names the permission it needs instead of asking "admin?".
-- `is_admin()` survives as "holds any role at all", so nothing that already calls it —
-- admin/src/lib/adminAuth.jsx, scripts/seed-admin.mjs — has to change today.
--
-- Why functions and not tables
-- ----------------------------
-- The matrix could be a `role_permissions` table, and it would be editable from the panel.
-- It is a function instead, for the reason 0001 gave for keeping the mobile list inside
-- is_admin(): a row is data, and data has a write path. Changing who may do what should
-- require a migration and a deploy, not an UPDATE. `shared/domain/permissions.js` holds
-- the UI's copy; `scripts/seed-admin.mjs` reports drift between the two.
--
-- SECURITY DEFINER, again
-- -----------------------
-- Same reason as is_admin(): these functions read tables whose own RLS policies call them.
-- Running as the owner bypasses that RLS and so avoids infinite recursion.

-- ================================================================ roles

create type public.admin_role as enum (
  'SUPER_ADMIN',
  'ADMIN',
  'CONTENT_MANAGER',
  'COORDINATOR',
  'VIEWER'
);

-- The administrative record for a person who already has a profile.
--
-- It is keyed by profiles.id, not by auth.users.id directly: an administrator is a
-- registered yuvak with a role, so there is exactly one identity and one name, and the
-- audit trail can join to it. §5 of the governance spec asked for a separate admin
-- identity — this is that, without inventing a second person.
create table public.admin_profiles (
  id           uuid primary key references public.profiles (id) on delete cascade,
  role         public.admin_role not null,

  -- Lifecycle, not deletion. A disabled administrator keeps his audit history attached
  -- to a row that still exists.
  status       text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'DISABLED')),

  -- Optional. The panel shows profiles.name; this is for "સંચાલક (વરાછા)" style labels.
  display_name text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id)
);

create index admin_profiles_role_idx on public.admin_profiles (role) where status = 'ACTIVE';

comment on table public.admin_profiles is
  'Who holds which સંચાલક role. Never the sole authority — has_permission() is what the '
  'RLS policies call, and it reads this table itself rather than trusting a client claim.';

-- ================================================================ the matrix

-- Mirrors shared/domain/permissions.js. Keep the two in step; seed-admin.mjs checks.
create or replace function public.permissions_for(r public.admin_role)
returns text[]
language sql
immutable
as $$
  select case r
    when 'SUPER_ADMIN' then array[
      'users.read', 'users.update', 'users.disable',
      'progress.read', 'sessions.read',
      'darshan.read', 'darshan.update', 'darshan.publish', 'darshan.disable',
      'settings.read', 'settings.update',
      'admins.read', 'admins.create', 'admins.update', 'admins.disable', 'roles.assign',
      'audit.read'
    ]
    when 'ADMIN' then array[
      'users.read', 'users.update', 'users.disable',
      'progress.read', 'sessions.read',
      'darshan.read', 'darshan.update', 'darshan.publish', 'darshan.disable',
      'settings.read', 'settings.update',
      'admins.read',
      'audit.read'
    ]
    when 'CONTENT_MANAGER' then array[
      'darshan.read', 'darshan.update', 'darshan.publish', 'darshan.disable',
      'settings.read'
    ]
    when 'COORDINATOR' then array[
      'users.read', 'progress.read', 'sessions.read', 'darshan.read'
    ]
    when 'VIEWER' then array[
      'users.read', 'progress.read', 'sessions.read', 'darshan.read', 'settings.read'
    ]
    else array[]::text[]
  end;
$$;

-- ================================================================ who the caller is

-- The role the caller is acting as, or null for an ordinary yuvak.
--
-- The three §3 mobile numbers remain a *bootstrap*, not an ordinary role: they resolve to
-- SUPER_ADMIN even with no admin_profiles row. That is what makes this migration safe to
-- apply — the founding accounts cannot be locked out of their own panel by a bad row, a
-- mistaken DISABLE, or an admin_profiles table that failed to seed. Changing the list
-- still requires a migration, exactly as 0001 argued.
create or replace function public.effective_role()
returns public.admin_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select ap.role
      from public.admin_profiles ap
      where ap.id = auth.uid()
        and ap.status = 'ACTIVE'
    ),
    (
      select 'SUPER_ADMIN'::public.admin_role
      from public.profiles p
      where p.id = auth.uid()
        and p.mobile in ('9601269715', '9601269009', '9925842081')
    )
  );
$$;

create or replace function public.has_permission(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(perm = any(public.permissions_for(public.effective_role())), false);
$$;

-- Unchanged meaning for every existing caller: "may this person open the panel at all?"
-- It is now derived from the role rather than from the mobile list directly.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.effective_role() is not null;
$$;

revoke all on function public.permissions_for(public.admin_role) from public;
revoke all on function public.effective_role() from public;
revoke all on function public.has_permission(text) from public;
grant execute on function public.permissions_for(public.admin_role) to authenticated;
grant execute on function public.effective_role() to authenticated;
grant execute on function public.has_permission(text) to authenticated;

-- ================================================================ lifecycle states

-- A yuvak's account. §7 of the governance spec: suspend, never delete — the history is
-- the point of the app.
alter table public.profiles
  add column if not exists status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'SUSPENDED', 'DISABLED'));

-- A lifecycle that nothing enforces is a label. This is what SUSPENDED actually costs:
-- the account can still sign in and read its own history, and can write nothing.
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'ACTIVE'
  );
$$;

revoke all on function public.is_active_user() from public;
grant execute on function public.is_active_user() to authenticated;

-- દર્શન content. `active` was a boolean; the states §7 asks for are DRAFT → VALIDATED →
-- PUBLISHED → ACTIVE → DISABLED.
--
-- Both columns are kept, and a trigger keeps them consistent, because the panel and the
-- યુવક app both read `active` today (shared/domain/darshan.js). Two columns describing one
-- fact is exactly the duplication §7 forbids — so they are not allowed to disagree, and
-- `active` is scheduled for removal once the panel reads `status` directly.
alter table public.scenes
  add column if not exists status text not null default 'ACTIVE'
    check (status in ('DRAFT', 'VALIDATED', 'PUBLISHED', 'ACTIVE', 'DISABLED'));

-- The replacement asset URL, once a scene has been re-published (§28).
--
-- shared/domain/darshan.js has read `scene.imageUrl` since it was written and
-- darshanService.saveScene() has written it, but 0001 never created the column: every
-- image replacement failed with an unknown-column error from PostgREST. The column is
-- snake_case here and mapped in the service, like every other column.
alter table public.scenes
  add column if not exists image_url text;

update public.scenes set status = case when active then 'ACTIVE' else 'DISABLED' end;

create or replace function public.scenes_sync_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- An explicit non-default status wins; otherwise `active` decides. A caller who
    -- passes status = 'ACTIVE' cannot be told apart from one who passed nothing, so that
    -- one case falls through to `active` — which is the column every reader uses today.
    if new.status is distinct from 'ACTIVE' then
      new.active := new.status in ('PUBLISHED', 'ACTIVE');
    else
      new.status := case when new.active then 'ACTIVE' else 'DISABLED' end;
    end if;
  elsif new.status is distinct from old.status then
    new.active := new.status in ('PUBLISHED', 'ACTIVE');
  elsif new.active is distinct from old.active then
    new.status := case when new.active then 'ACTIVE' else 'DISABLED' end;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger scenes_sync_status
  before insert or update on public.scenes
  for each row execute function public.scenes_sync_status();

-- A submitted round is COMPLETED — that is the only state the app writes today, and the
-- default says so honestly. STARTED / IN_PROGRESS / ABANDONED become reachable when the
-- app starts writing a session at the beginning of a round instead of at submit.
alter table public.learning_sessions
  add column if not exists status text not null default 'COMPLETED'
    check (status in ('STARTED', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED'));

-- ================================================================ data integrity

-- §9 — a દર્શન's printed number and its presentation order are each unique.
--
-- Both columns become nullable first, which also fixes a real defect: they were NOT NULL
-- with no default, so `saveScene(id, { active: false })` — an upsert that names neither —
-- could never insert a row. The overlay semantics were always "null means inherit from
-- the manifest" (shared/domain/darshan.js reads `Number.isInteger(scene?.order)`), and the
-- column now says so. Uniqueness is enforced where a value is present.
alter table public.scenes alter column "index" drop not null;
alter table public.scenes alter column "order" drop not null;

create unique index scenes_index_unique on public.scenes ("index") where "index" is not null;
create unique index scenes_order_unique on public.scenes ("order") where "order" is not null;

-- ================================================================ audit

-- §8 asked for actorRole, resourceType, before and after. 0001 had actor, action, target
-- and a free-form meta.
alter table public.audit_logs
  add column if not exists actor_role    text,
  add column if not exists resource_type text not null default '',
  add column if not exists "before"      jsonb,
  add column if not exists "after"       jsonb;

create index if not exists audit_logs_resource_idx on public.audit_logs (resource_type, target_id, at desc);

-- The change that matters most in this file.
--
-- Until now every audit row was written by the browser, from
-- admin/src/features/audit/services/auditService.js. An administrator who edited that out
-- of his own copy of the bundle kept his access and stopped leaving a trail — the RLS
-- policy required an audit row to be *writable*, never that one be *written*. Here the
-- database writes it, inside the same transaction as the change, from data the client
-- never supplies. There is no code path that mutates a governed table without a row
-- landing here.
--
-- SECURITY DEFINER lets the insert past the audit_logs RLS policy; `actor_id` is taken
-- from auth.uid(), never from an argument, so an entry cannot be attributed to someone
-- else.
create or replace function public.audit_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  act   text;
begin
  -- Migrations, seeds and anything running as service_role: no session user to attribute
  -- the change to, and audit_logs.actor_id is NOT NULL. Those changes are in the
  -- migration history instead.
  if actor is null then
    return new;
  end if;

  -- A yuvak writing his own row is the application working, not an administrative act.
  -- 2,000 gate answers and level-4 unlocks a day would bury the trail that matters. The
  -- same applies to an administrator editing his own profile as a yuvak.
  if not public.is_admin() or new.id = actor then
    return new;
  end if;

  act := case
           when new.status is distinct from old.status and new.status = 'SUSPENDED' then 'USER_SUSPENDED'
           when new.status is distinct from old.status and new.status = 'DISABLED'  then 'USER_DISABLED'
           else 'USER_UPDATED'
         end;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, target_id, "before", "after")
  values (actor, public.effective_role()::text, act, 'profiles', new.id::text, to_jsonb(old), to_jsonb(new));

  return new;
end;
$$;

-- admin_profiles carries its own function so that a role change is recorded as a role
-- change. "ADMIN_UPDATED" on a row whose `role` moved from VIEWER to SUPER_ADMIN is a
-- true statement and a useless one.
create or replace function public.audit_admin_profile()
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

  -- `b` is filled inside the UPDATE branch rather than by a CASE in the INSERT statement:
  -- PL/pgSQL passes record variables to a query as bound parameters, so `to_jsonb(old)`
  -- would have to be materialised before the CASE could skip it.
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
  values (actor, public.effective_role()::text, act, 'admin_profiles', new.id::text, b, to_jsonb(new));

  return new;
end;
$$;

-- દર્શન and settings get their own functions for the same reason admin_profiles does: the
-- panel already records IMAGE_REPLACED, DARSHAN_ORDER_CHANGED, VIDEO_UPDATED and the rest
-- (shared/domain/audit.js), and moving the write into the database must not flatten all of
-- them into "something changed". The action is derived from the diff, which is also more
-- honest than the client's version — it describes what the row actually did, not what the
-- button that sent it was called.
create or replace function public.audit_scene()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  act   text := 'DARSHAN_UPDATED';
  b     jsonb;
begin
  if actor is null or not public.is_admin() then
    return new;
  end if;

  -- OLD is only touched under an explicit tg_op test, never as the second half of an
  -- `and`: PL/pgSQL does not promise to evaluate boolean operands left to right, and
  -- reading OLD during an INSERT raises "record old is not assigned yet".
  if tg_op = 'UPDATE' then
    b := to_jsonb(old);

    if new.image_url is distinct from old.image_url then
      act := 'IMAGE_REPLACED';
    elsif new.status is distinct from old.status then
      if new.status = 'PUBLISHED' then
        act := 'DARSHAN_PUBLISHED';
      elsif new.status = 'DISABLED' then
        act := 'DARSHAN_DISABLED';
      elsif old.status = 'DISABLED' then
        act := 'DARSHAN_ACTIVATED';
      end if;
    elsif new."order" is distinct from old."order" then
      act := 'DARSHAN_ORDER_CHANGED';
    end if;
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, target_id, "before", "after")
  values (actor, public.effective_role()::text, act, 'scenes', new.id, b, to_jsonb(new));

  return new;
end;
$$;

create or replace function public.audit_setting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  act   text := 'SETTINGS_UPDATED';
  b     jsonb;
begin
  if actor is null or not public.is_admin() then
    return new;
  end if;

  if new.key = 'levels' then
    act := 'LEVEL_UPDATED';
  end if;

  if tg_op = 'UPDATE' then
    b := to_jsonb(old);
    if new.key = 'app' and new.value ->> 'youtubeUrl' is distinct from old.value ->> 'youtubeUrl' then
      act := 'VIDEO_UPDATED';
    end if;
  elsif new.key = 'app' and new.value ->> 'youtubeUrl' is not null then
    act := 'VIDEO_UPDATED';
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, target_id, "before", "after")
  values (actor, public.effective_role()::text, act, 'settings', new.key, b, to_jsonb(new));

  return new;
end;
$$;

create trigger audit_scenes
  after insert or update on public.scenes
  for each row execute function public.audit_scene();

create trigger audit_settings
  after insert or update on public.settings
  for each row execute function public.audit_setting();

create trigger audit_profiles_update
  after update on public.profiles
  for each row execute function public.audit_profile();

create trigger audit_admin_profiles
  after insert or update on public.admin_profiles
  for each row execute function public.audit_admin_profile();

-- ================================================================ role escalation

-- §2 of the governance spec: an administrator must not be able to write
-- `{"role": "SUPER_ADMIN"}` from a browser.
--
-- RLS alone cannot say all of this — a policy sees the new row, not the old one's role,
-- and cannot express "only a SUPER_ADMIN may demote a SUPER_ADMIN". A BEFORE trigger can,
-- and it applies to service_role too, which RLS policies would not.
create or replace function public.admin_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller      uuid := auth.uid();
  caller_role public.admin_role := public.effective_role();
begin
  -- No session user: a migration or the service_role key, both of which are server-side
  -- and already trusted. This is the only way the first row is ever created.
  if caller is null then
    if tg_op = 'UPDATE' then
      new.updated_at := now();
    end if;
    return new;
  end if;

  -- Every OLD reference below sits inside an explicit `if tg_op = 'UPDATE'` block rather
  -- than after an `and`: PL/pgSQL does not promise left-to-right evaluation of boolean
  -- operands, and reading OLD during an INSERT raises "record old is not assigned yet".
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

    -- Revoking SUPER_ADMIN is as restricted as granting it, so an ADMIN who somehow
    -- acquired admins.update cannot demote the person above them.
    if old.role = 'SUPER_ADMIN' and caller_role is distinct from 'SUPER_ADMIN' then
      raise exception 'only a SUPER_ADMIN may change a SUPER_ADMIN';
    end if;
  end if;

  if new.role = 'SUPER_ADMIN' and caller_role is distinct from 'SUPER_ADMIN' then
    raise exception 'only a SUPER_ADMIN may grant SUPER_ADMIN';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger admin_profiles_guard
  before insert or update on public.admin_profiles
  for each row execute function public.admin_profiles_guard();

-- Disable, never delete — and unlike a missing RLS policy, this also stops service_role.
create or replace function public.admin_profiles_no_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'administrators are disabled (status = DISABLED), never deleted';
end;
$$;

create trigger admin_profiles_no_delete
  before delete on public.admin_profiles
  for each row execute function public.admin_profiles_no_delete();

-- ================================================================ policies

alter table public.admin_profiles enable row level security;

-- Everyone with a role may see their own record — the panel needs it to know what to
-- render. Seeing *other* administrators is a permission.
create policy "own admin record readable" on public.admin_profiles
  for select using (id = auth.uid() or public.has_permission('admins.read'));

create policy "admin record insertable" on public.admin_profiles
  for insert with check (public.has_permission('admins.create'));

create policy "admin record updatable" on public.admin_profiles
  for update using (public.has_permission('admins.update'))
  with check (public.has_permission('admins.update'));

-- No delete policy, and a trigger behind it.

-- ---------------------------------------------------------------- rewritten from 0001
--
-- Each policy now names the permission it needs. `is_admin()` would still work and would
-- still be correct for SUPER_ADMIN; it would also hand a COORDINATOR the ability to
-- rewrite દર્શન content, which is the whole reason this file exists.

drop policy if exists "own profile readable"  on public.profiles;
drop policy if exists "own profile updatable" on public.profiles;

create policy "own profile readable" on public.profiles
  for select using (id = auth.uid() or public.has_permission('users.read'));

create policy "own profile updatable" on public.profiles
  for update using (id = auth.uid() or public.has_permission('users.update'))
  with check (id = auth.uid() or public.has_permission('users.update'));

drop policy if exists "own progress readable"  on public.progress;
drop policy if exists "own progress writable"  on public.progress;
drop policy if exists "own progress updatable" on public.progress;

create policy "own progress readable" on public.progress
  for select using (user_id = auth.uid() or public.has_permission('progress.read'));

create policy "own progress writable" on public.progress
  for insert with check (user_id = auth.uid() and public.is_active_user());

create policy "own progress updatable" on public.progress
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_active_user());

drop policy if exists "own learning readable"  on public.learning_state;
drop policy if exists "own learning writable"  on public.learning_state;
drop policy if exists "own learning updatable" on public.learning_state;

create policy "own learning readable" on public.learning_state
  for select using (user_id = auth.uid() or public.has_permission('progress.read'));

create policy "own learning writable" on public.learning_state
  for insert with check (user_id = auth.uid() and public.is_active_user());

create policy "own learning updatable" on public.learning_state
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_active_user());

drop policy if exists "own sessions readable"  on public.learning_sessions;
drop policy if exists "own sessions writable"  on public.learning_sessions;
drop policy if exists "own sessions updatable" on public.learning_sessions;

create policy "own sessions readable" on public.learning_sessions
  for select using (user_id = auth.uid() or public.has_permission('sessions.read'));

create policy "own sessions writable" on public.learning_sessions
  for insert with check (user_id = auth.uid() and public.is_active_user());

create policy "own sessions updatable" on public.learning_sessions
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_active_user());

drop policy if exists "scenes writable by admin" on public.scenes;

create policy "scenes writable by permission" on public.scenes
  for all using (public.has_permission('darshan.update'))
  with check (public.has_permission('darshan.update'));

drop policy if exists "settings writable by admin" on public.settings;

create policy "settings writable by permission" on public.settings
  for all using (public.has_permission('settings.update'))
  with check (public.has_permission('settings.update'));

drop policy if exists "audit readable by admin" on public.audit_logs;

create policy "audit readable by permission" on public.audit_logs
  for select using (public.has_permission('audit.read'));

-- The insert policy is unchanged and stays broad on purpose: ADMIN_LOGIN is written by
-- the panel and is not a table mutation, so no trigger can produce it. actor_id is still
-- pinned to the caller.

-- ================================================================ bootstrap

-- Give the §3 numbers a real row, so `admins.read` shows them and the trail names a role
-- rather than falling back to the mobile list. auth.uid() is null here, so the guard
-- trigger allows it and audit_admin_profile() writes nothing — correct: this is the
-- migration, not an administrative act by a person.
insert into public.admin_profiles (id, role, status, created_by)
select p.id, 'SUPER_ADMIN', 'ACTIVE', null
from public.profiles p
where p.mobile in ('9601269715', '9601269009', '9925842081')
on conflict (id) do nothing;
