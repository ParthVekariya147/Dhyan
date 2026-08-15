-- વર્ણી ધ્યાન — an appointment made by mistake can be undone.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE DEFECT
-- ════════════════════════════════════════════════════════════════════════════
--
-- `public.yuvaks` (0038, extended by 0040) is the population every count, list, ranking,
-- export and report means by "યુવક":
--
--     select v.* from public.profiles_level4 v
--     where v.id not in (select public.admin_account_ids())
--       and v.id in (select c.id from public.counted_profiles c);
--
-- and `admin_account_ids()` is:
--
--     select id from public.admins;
--
-- **No status filter.** Any row in `public.admins`, in any state, removes that person from the
-- યુવક roll. That was correct while an administrator was somebody created *as* an
-- administrator: 0038's whole argument is that "104 registered was never 104 yuvaks", and a
-- person whose job is running the panel should not be counted among the people learning.
--
-- It stopped being correct the moment an existing યુવક could be appointed with one press.
-- `promoteUser()` writes an `admins` row carrying his existing `auth.users` id — and from that
-- instant he is gone from the Users list, from "Total registered", from the leaderboard, from
-- the progress report, from the point ledger's roll and from every Excel export. His `profiles`
-- row, his `progress`, his `point_transactions`, his `daily_activity_records` and his
-- `level3_revisions` are all untouched and completely intact. They are simply not shown,
-- because the view that decides who is a યુવક no longer counts him as one.
--
-- And there was no way back:
--
--   * `status = 'SUSPENDED'` or `'DISABLED'` stops his panel access and changes nothing here,
--     because `admin_account_ids()` never looks at status.
--   * `delete from public.admins` is refused by `admins_no_delete()` for every caller
--     including `service_role`, which is deliberate and should stay that way — the audit trail
--     names people, and a person who can be deleted is a trail with a hole in it.
--
-- So a mis-click was permanent, it silently removed a real યુવક from every number the panel
-- produces, and nothing on any screen said so. That is the worst shape a defect can have: it
-- is invisible, it corrupts reports rather than breaking them, and the corruption is in the
-- direction of under-counting people who are doing the સાધના.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE FIX
-- ════════════════════════════════════════════════════════════════════════════
--
-- A fourth lifecycle state that means *the appointment itself is undone*, as distinct from the
-- three that mean something about an administrator who is still one.
--
--     ACTIVE     he is an administrator and may sign in.
--     SUSPENDED  he is an administrator; his access is paused. Temporary, by intent.
--     DISABLED   he is a former administrator. He has left, and the record stays.
--     REVOKED    he was never meant to be an administrator. This appointment was a mistake.
--
-- The first three all keep him out of the યુવક roll, and that is right: SUSPENDED and DISABLED
-- both describe somebody whose relationship with the panel is real. **REVOKED does not**, and
-- `admin_account_ids()` below skips it — so the person returns to `public.yuvaks` and every
-- count, report, ranking and export includes him again, immediately, with the learning record
-- he never stopped having.
--
-- ── Why a status and not a delete ───────────────────────────────────────────
--
-- 0038's "suspend, never delete" is not being weakened. The row stays; `created_by` still
-- names whoever made the appointment, `created_at` still says when, and `audit_admin()` writes
-- an `ADMIN_REVOKED` entry naming whoever undid it. A mistake that leaves no trace is a
-- mistake nobody can learn from — and "who made this person an administrator for two days last
-- August" stays answerable.
--
-- ── His exceptions are left in place, and they are inert ────────────────────
--
-- `admin_grants` rows for a revoked person are not deleted. `permissions_of()` (0044) joins
-- `public.admins` on `status = 'ACTIVE'`, so a revoked account resolves to no permissions at
-- all and every grant on it is dead. They are kept rather than cascaded because deleting them
-- needs `grants.manage`, which the person doing the revoking may not hold — and a revoke that
-- fails halfway because of a permission on a different table would be worse than a few inert
-- rows. If he is ever restored, the Effective access screen lists them under "granted
-- individually" with their reasons, which is where a stale exception should be noticed.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. THE STATE
-- ════════════════════════════════════════════════════════════════════════════

-- The CHECK was written inline in 0038, so its name is whatever Postgres generated. Found by
-- what it constrains rather than by a name this file would have to guess.
do $$
declare
  c text;
begin
  select con.conname into c
  from pg_constraint con
  where con.conrelid = 'public.admins'::regclass
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%status%';

  if c is not null then
    execute format('alter table public.admins drop constraint %I', c);
  end if;
end
$$;

alter table public.admins
  add constraint admins_status_check
  check (status in ('ACTIVE', 'SUSPENDED', 'DISABLED', 'REVOKED'));

comment on column public.admins.status is
  'ACTIVE / SUSPENDED / DISABLED describe an administrator. REVOKED means the appointment '
  'itself was a mistake and is undone - only that one returns the person to public.yuvaks. '
  'The row is never deleted in any of the four. See 0045.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. WHO IS EXCLUDED FROM THE યુવક ROLL
-- ════════════════════════════════════════════════════════════════════════════

/*
  The one line this whole migration is about.

  Everything downstream follows from it without being touched: `public.yuvaks` reads this
  function, and 0040 re-issued nine reporting functions to read `public.yuvaks`. So a person
  moving to REVOKED reappears in the Users list, "Total registered", the progress report, the
  leaderboard, the daily reports, the point ledger's roll and every Excel export, in one step,
  with no other definition needing to know that this state exists.

  That is the same argument 0040 made for naming the population instead of adding `and not
  is_test` to twenty-four reports, and it is why that decision keeps paying.
*/
create or replace function public.admin_account_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.admins where status <> 'REVOKED';
$$;

comment on function public.admin_account_ids() is
  'Every id holding a live સંચાલક record - ACTIVE, SUSPENDED or DISABLED - regardless of the '
  'caller''s permissions. REVOKED is excluded, because that state means the appointment was '
  'undone and the person is a યુવક again. public.yuvaks reads this. See 0038 and 0045.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. THE GUARD
-- ════════════════════════════════════════════════════════════════════════════
--
-- Re-issued from 0043 with two rules added and every existing one carried over verbatim —
-- scripts/test-rls.mjs, scripts/test-admins.mjs and scripts/test-rbac-dynamic.mjs assert those
-- messages exactly, and admin/src/.../adminService.js maps them to sentences.

create or replace function public.admins_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller      uuid := auth.uid();
  caller_role text := public.effective_role();
  my_rank     integer;
  new_rank    integer;
  old_rank    integer;
  supers      integer;
begin
  if caller is null then
    if tg_op = 'UPDATE' then
      new.updated_at := now();
    end if;
    return new;
  end if;

  my_rank := public.caller_rank();
  select rank into new_rank from public.admin_roles where key = new.role;

  if tg_op = 'INSERT' then
    if new.id = caller then
      raise exception 'an administrator cannot appoint themselves';
    end if;
    if not public.has_permission('admins.create') then
      raise exception 'not permitted to manage administrators';
    end if;
    new.created_by := coalesce(new.created_by, caller);
  else
    select rank into old_rank from public.admin_roles where key = old.role;

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

    /*
      Coming *out* of REVOKED is an appointment, not a re-enablement.

      SUSPENDED and DISABLED describe somebody who is an administrator, so returning him to
      ACTIVE is restoring access he already had. REVOKED says the appointment was a mistake and
      undoes it — so undoing *that* is appointing him, and it asks for the permission that
      appointing asks for. Without this rule, `admins.disable` alone would be enough to put
      anybody who was ever an administrator back, which is a quieter route to the same
      authority `admins.create` governs.
    */
    if old.status = 'REVOKED' and new.status is distinct from 'REVOKED'
       and not public.has_permission('admins.create') then
      raise exception 'restoring a revoked administrator is an appointment - admins.create is required';
    end if;

    -- Carried from 0004 unchanged, and before the general rule below so that this exact
    -- sentence is the one a SUPER_ADMIN change produces.
    if old.role = 'SUPER_ADMIN' and caller_role is distinct from 'SUPER_ADMIN' then
      raise exception 'only a SUPER_ADMIN may change a SUPER_ADMIN';
    end if;

    if coalesce(old_rank, 0) >= my_rank and caller_role is distinct from 'SUPER_ADMIN' then
      raise exception 'you cannot change a role equal to or above your own';
    end if;

    /*
      Somebody has to be able to fix everything.

      REVOKED reaches this by being `distinct from 'ACTIVE'`, so revoking the last SUPER_ADMIN
      is refused by the same count that refuses demoting or suspending him. bootstrap_admins is
      still not counted: a fallback nobody can see is not a substitute for a working, visible
      administrator.
    */
    if (old.role = 'SUPER_ADMIN' and new.role is distinct from 'SUPER_ADMIN')
       or (old.role = 'SUPER_ADMIN' and old.status = 'ACTIVE' and new.status is distinct from 'ACTIVE') then
      select count(*) into supers
      from public.admins
      where role = 'SUPER_ADMIN' and status = 'ACTIVE' and id <> old.id;
      if supers = 0 then
        raise exception 'there must always be one active Super Admin';
      end if;
    end if;

    new.updated_at := now();
  end if;

  if new.role = 'SUPER_ADMIN' and caller_role is distinct from 'SUPER_ADMIN' then
    raise exception 'only a SUPER_ADMIN may grant SUPER_ADMIN';
  end if;

  if coalesce(new_rank, 0) >= my_rank and caller_role is distinct from 'SUPER_ADMIN' then
    raise exception 'you cannot grant a role equal to or above your own';
  end if;

  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. THE TRAIL
-- ════════════════════════════════════════════════════════════════════════════
--
-- Re-issued from 0038 so a revocation is recorded as a revocation. "ADMIN_DISABLED" on a row
-- whose appointment was undone is a true statement and a misleading one — the two mean
-- different things about the same person, and only one of them puts him back in every report.

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
      act := case
               when new.status = 'REVOKED' then 'ADMIN_REVOKED'
               -- Coming back from REVOKED is an appointment being remade, not an account
               -- being switched on again, and the trail should not call the two the same.
               when old.status = 'REVOKED' then 'ADMIN_RESTORED'
               when new.status = 'ACTIVE' then 'ADMIN_ENABLED'
               else 'ADMIN_DISABLED'
             end;
    else
      act := 'ADMIN_UPDATED';
    end if;
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, target_id, "before", "after")
  values (actor, public.effective_role(), act, 'admins', new.id::text, b, to_jsonb(new));

  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. SAY WHO IS AFFECTED RIGHT NOW
-- ════════════════════════════════════════════════════════════════════════════
--
-- Nothing is changed automatically. Which appointments were mistakes is not a question a
-- migration can answer, and guessing would be the same class of error as the defect itself.
-- What it can do is name every person this is currently true of, so whoever applies it knows
-- exactly who is missing from the reports and can decide one by one.

do $$
declare
  r record;
  n integer := 0;
begin
  raise notice '[0045] REVOKED added. admin_account_ids() now skips it, so a revoked';
  raise notice '[0045] appointment returns the person to public.yuvaks and to every report.';
  raise notice '[0045]';

  for r in
    select a.id, a.name, a.email, a.role, a.status, p.smk
    from public.admins a
    join public.profiles p on p.id = a.id
    where a.status <> 'REVOKED'
    order by a.created_at
  loop
    n := n + 1;
    if n = 1 then
      raise notice '[0045] These accounts are BOTH a સંચાલક and a યુવક with a learning record.';
      raise notice '[0045] Each one is currently excluded from every યુવક count and report:';
    end if;
    raise notice '[0045]   %  %  %  <%>  role=% status=%', r.smk, r.id, r.name, r.email, r.role, r.status;
  end loop;

  if n = 0 then
    raise notice '[0045] No administrator currently holds a યુવક profile. Nothing to review.';
  else
    raise notice '[0045]';
    raise notice '[0045] If any of those appointments was a mistake, set its status to REVOKED';
    raise notice '[0045] from the સંચાલક list and that person is back in every report at once.';
    raise notice '[0045] A founding account that is genuinely both should be left alone.';
  end if;
end
$$;
