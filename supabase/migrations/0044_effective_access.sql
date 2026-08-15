-- વર્ણી ધ્યાન — "what may he actually do?", answered by the database.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHY THIS IS A MIGRATION AND NOT A FUNCTION IN THE PANEL
-- ════════════════════════════════════════════════════════════════════════════
--
-- 0043 made access a resolution rather than a lookup: a role's permissions, plus every
-- unexpired ALLOW grant, minus every DENY, with the bootstrap allowlist short-circuiting the
-- whole thing. `caller_permissions()` performs that resolution, and `has_permission()` — which
-- 122 policy expressions call — consults it.
--
-- The Access screens have to show the same answer *about somebody else*: which permissions
-- this administrator ends up with, and where each one came from. There are two ways to do
-- that, and only one of them is safe.
--
--   In the browser.  Read `role_permissions` for his role, read his `admin_grants`, and apply
--                    the union/except in JavaScript. It works today and it is a second
--                    implementation of the resolution rule. The moment the two disagree — an
--                    expiry compared in the wrong time zone, a DENY ordered after an ALLOW —
--                    the panel states, with confidence, that a person may do something the
--                    database will refuse. That is the exact class of failure 0043's own
--                    header is written against, and shared/domain/permissions.js had its
--                    matrix deleted rather than left to drift for the same reason.
--
--   Here.            One resolution, used by the gate and by the screen that explains it.
--
-- So `permissions_of(uuid)` is extracted, `caller_permissions()` becomes a call to it, and the
-- panel reads `admin_effective_permissions(uuid)`. There is exactly one place where "what may
-- he do" is decided, and every reader of it — the RLS policies, the sidebar, the Effective
-- access screen — is looking at the same sentence.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT IS NOT TOUCHED
-- ════════════════════════════════════════════════════════════════════════════
--
-- `has_permission(text)`, again, keeps its signature. `caller_permissions()` keeps its
-- signature and its behaviour to the letter — this file moves its body into a function that
-- takes the id as an argument and passes it auth.uid(). scripts/test-rbac-dynamic.mjs asserts
-- the resolution order, the expiry rule and the bootstrap short-circuit, and it is unchanged
-- and still passing: that is what says the move was a move and not a rewrite.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. THE RESOLUTION, FOR ANY ADMINISTRATOR
-- ════════════════════════════════════════════════════════════════════════════

/*
  Deliberately NOT granted to `authenticated`.

  It performs no permission check of its own, because `caller_permissions()` calls it on every
  single query that touches a governed table — 0039's InitPlan hoisting keeps that to one
  evaluation per statement, and a permission check inside it would be a second resolution
  running inside the first. So the check lives in its callers, and the way this stays safe is
  that a browser cannot reach it: EXECUTE is revoked from PUBLIC and granted to nobody.

  Only two SECURITY DEFINER functions call it, and they run as the owner regardless of who is
  signed in: caller_permissions() (self, no check needed) and admin_effective_permissions()
  (anyone, gated on admins.read).
*/
create or replace function public.permissions_of(p_admin uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with subject as (
    select a.id, a.role
    from public.admins a
    where a.id = p_admin and a.status = 'ACTIVE'
  ),
  granted as (
    select g.permission, g.effect
    from public.admin_grants g
    join subject on subject.id = g.admin_id
    where g.expires_at is null or g.expires_at > now()
  ),
  resolved as (
      select rp.permission
      from subject
      join public.role_permissions rp on rp.role_key = subject.role
    union
      select permission from granted where effect = 'ALLOW'
    except
      select permission from granted where effect = 'DENY'
  )
  select coalesce(
    -- The bootstrap short-circuit, read first, exactly as 0043 wrote it: a botched role, a
    -- mistaken DENY or an empty role_permissions cannot lock a founding account out.
    (
      select array_agg(p.key order by p.sort, p.key)
      from public.permissions p
      where exists (select 1 from public.bootstrap_admins b where b.id = p_admin)
    ),
    (select array_agg(permission order by permission) from resolved),
    array[]::text[]
  );
$$;

comment on function public.permissions_of(uuid) is
  'The resolution - bootstrap, else role + ALLOW - DENY, unexpired only, ACTIVE only - for '
  'any administrator. Executable by nobody: it carries no permission check because '
  'caller_permissions() runs it on every governed query. Its two callers do the checking. 0044.';

revoke all on function public.permissions_of(uuid) from public;

-- Unchanged in signature and in behaviour. Its body is now one call, so there is one
-- implementation of the resolution rather than two that must be kept in step.
create or replace function public.caller_permissions()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select public.permissions_of(auth.uid());
$$;

comment on function public.caller_permissions() is
  'Every permission the caller holds. Since 0044 a call to permissions_of(auth.uid()), so the '
  'gate and the screen that explains the gate cannot disagree. What has_permission() consults.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. THE SAME ANSWER, WITH ITS REASONS
-- ════════════════════════════════════════════════════════════════════════════

/*
  What the Effective access screen renders.

  A flat list of permissions would answer "may he?" and leave the far more useful question —
  "why?" — to be worked out by comparing three tables by eye. The `source` column is the whole
  point of this function: "he has points.adjust because somebody granted it to him personally,
  and it expires on the 3rd" is a sentence a person can act on. "He has points.adjust" is not.

  DENIED rows are returned too, and that is deliberate. They are permissions he does NOT hold,
  so a list of what he holds would simply omit them — and then the screen cannot explain why a
  COORDINATOR is missing something every other COORDINATOR has. A denial is the most surprising
  state a person can be in and therefore the one most worth showing.

  Gated on `admins.read`: seeing what another administrator may do is reading the સંચાલક list,
  which is the permission that opens the screen these names appear on. A caller asking about
  *himself* is always allowed - he can see his own access on every screen he opens anyway, and
  refusing it would make the panel unable to tell a person what he may do.
*/
create or replace function public.admin_effective_permissions(p_admin uuid)
returns table (
  permission text,
  -- 'bootstrap' | 'role' | 'granted' | 'denied'
  source     text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    select p_admin as id
    where p_admin = auth.uid() or public.has_permission('admins.read')
  ),
  boot as (
    select exists (
      select 1 from public.bootstrap_admins b, allowed where b.id = allowed.id
    ) as is_boot
  ),
  subject as (
    select a.id, a.role
    from public.admins a, allowed
    where a.id = allowed.id and a.status = 'ACTIVE'
  ),
  granted as (
    select g.permission, g.effect, g.expires_at
    from public.admin_grants g
    join subject on subject.id = g.admin_id
    where g.expires_at is null or g.expires_at > now()
  ),
  denied as (
    select permission from granted where effect = 'DENY'
  )
  -- A founding account holds the catalogue and holds it for a reason no role can express, so
  -- the screen says 'bootstrap' rather than attributing it to a role he may not even have.
  select p.key, 'bootstrap'::text, null::timestamptz
  from public.permissions p, boot
  where boot.is_boot

  union all

  select rp.permission, 'role'::text, null::timestamptz
  from subject
  join public.role_permissions rp on rp.role_key = subject.role, boot
  where not boot.is_boot
    and rp.permission not in (select permission from denied)

  union all

  select g.permission, 'granted'::text, g.expires_at
  from granted g, boot
  where not boot.is_boot
    and g.effect = 'ALLOW'
    and g.permission not in (select permission from denied)
    -- An ALLOW duplicating something the role already carries is not a second reason to hold
    -- it, and showing it twice would read as a conflict.
    and g.permission not in (
      select rp.permission from subject join public.role_permissions rp on rp.role_key = subject.role
    )

  union all

  select d.permission, 'denied'::text, g.expires_at
  from denied d
  join granted g on g.permission = d.permission and g.effect = 'DENY', boot
  where not boot.is_boot;
$$;

comment on function public.admin_effective_permissions(uuid) is
  'Every permission an administrator ends up with and WHY - bootstrap / role / granted / '
  'denied, with the expiry where there is one. The same resolution has_permission() uses, so '
  'the screen cannot promise access the policies refuse. Needs admins.read, or be the subject.';

revoke all on function public.admin_effective_permissions(uuid) from public;
grant execute on function public.admin_effective_permissions(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. HOW MANY PEOPLE HOLD EACH ROLE
-- ════════════════════════════════════════════════════════════════════════════

/*
  The number the role editor shows before a change is saved: "this affects 4 administrators".

  A SECURITY DEFINER count rather than a `select count(*) from admins group by role` in the
  browser, for the reason 0038 gives about `admin_account_ids()`: the `admins` SELECT policy is
  `id = auth.uid() or has_permission('admins.read')`, so a caller without it counts himself and
  gets 1. A role editor that said "this affects 1 administrator" when it affects nine is worse
  than one that said nothing — somebody would believe it.

  Gated on `roles.manage` or `admins.read`, which are the two permissions that open the screens
  this number appears on.
*/
create or replace function public.admin_role_usage()
returns table (role_key text, members integer, active_members integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.key,
    count(a.id)::integer,
    count(a.id) filter (where a.status = 'ACTIVE')::integer
  from public.admin_roles r
  left join public.admins a on a.role = r.key
  where public.has_permission('roles.manage') or public.has_permission('admins.read')
  group by r.key;
$$;

comment on function public.admin_role_usage() is
  'How many administrators hold each role, counted past the admins RLS policy so every caller '
  'sees the same number. Returns nothing without roles.manage or admins.read. 0044.';

revoke all on function public.admin_role_usage() from public;
grant execute on function public.admin_role_usage() to authenticated;

do $$
begin
  raise notice '[0044] permissions_of(uuid) extracted; caller_permissions() now calls it.';
  raise notice '[0044] One resolution for the gate and for the screen that explains it.';
end
$$;
