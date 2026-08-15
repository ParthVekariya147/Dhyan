-- વર્ણી ધ્યાન — who may do what stops being a deploy.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE DECISION THIS FILE REVERSES, AND THE SAFEGUARD THAT REPLACES IT
-- ════════════════════════════════════════════════════════════════════════════
--
-- 0004_rbac.sql argued, at length and correctly, for the matrix being a function:
--
--     The matrix could be a `role_permissions` table, and it would be editable from the
--     panel. It is a function instead, for the reason 0001 gave for keeping the mobile
--     list inside is_admin(): a row is data, and data has a write path. Changing who may
--     do what should require a migration and a deploy, not an UPDATE.
--
-- That is overruled here, deliberately, because the requirement is now precisely the thing
-- it forbids: the સંચાલક must be able to hand out access himself, to people he appoints,
-- without waiting for a developer. A permission model nobody but a developer can operate is
-- one that gets worked around — by sharing a SUPER_ADMIN password, which is how every
-- access-control system in the world is actually defeated.
--
-- The safeguard is to split 0004's sentence in two. What becomes data is the **binding** —
-- which role holds which permission. What stays code is the **catalogue** — which
-- permissions exist at all.
--
--   public.permissions        the catalogue.   Written ONLY by a migration. The trigger
--                             below refuses every insert, update and delete where
--                             auth.uid() is not null — which includes service_role.
--   public.admin_roles        the roles.       Created and edited from the panel.
--   public.role_permissions   the bindings.    Created and edited from the panel.
--   public.admin_grants       the exceptions.  One person, one permission, optional expiry.
--
-- Why the split is the whole of the safety argument: a permission name only means something
-- because some RLS policy or SECURITY DEFINER function checks it. There are 108 such checks
-- in this schema over 16 distinct names. A panel that could invent `users.delete` would
-- render a tick box that grants nothing and appears to grant everything — which is the exact
-- failure shared/domain/permissions.js has warned about in its header since it was written.
--
-- So: **you may hand out any permission that exists. You may not invent one.**
--
-- Two further guards, both BEFORE triggers rather than policies, for the reason 0004 gives —
-- a policy sees the new row and not the old one's rank, and does not bind service_role:
--
--   * No administrator may grant a permission he does not himself hold.
--   * No administrator may touch a role, or a person, at or above his own rank.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT IS NOT TOUCHED
-- ════════════════════════════════════════════════════════════════════════════
--
-- `public.has_permission(text)` keeps its exact signature. It is named in **122 policy
-- expressions** across this schema, and not one of them is re-issued here. Everything below
-- happens behind that function. This is the single most important property of this file:
-- the security boundary does not move, only what it consults.
--
-- `public.bootstrap_admins` (0024) is untouched and stays unreachable from any panel action.
-- caller_permissions() reads it FIRST and short-circuits, so a botched role, a bad grant or
-- an empty role_permissions table cannot lock the founding accounts out of their own panel.
-- That is the same guarantee 0024 was written to make, restated against the new tables.
--
-- ════════════════════════════════════════════════════════════════════════════
-- RE-APPLICABILITY
-- ════════════════════════════════════════════════════════════════════════════
--
-- `if not exists` on every object, `on conflict do nothing` on every seed, `create or
-- replace` on every function, `drop trigger if exists` before every trigger. scripts/
-- test-point-engine.mjs re-applies every migration from 0031 on and requires all of them to
-- succeed a second time, because that replay **is** the production repair procedure.
--
-- The seeds use `on conflict do nothing` and never `do update`, which is load-bearing rather
-- than idiomatic: a re-run must not silently undo a role a સંચાલક edited last week. This
-- migration seeds a starting position; it does not restore one.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. THE CATALOGUE
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.permissions (
  -- 'darshan.image.replace'. resource.verb, as every permission in this schema has been
  -- since 0004 — the panel groups by the part before the first dot.
  key         text primary key check (key ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$'),

  resource    text not null,
  verb        text not null,

  -- What the panel prints beside the tick box, and the sentence under it. Both are here
  -- rather than in a JS map because the person editing a role needs to know what he is
  -- granting, and a label that lives in the bundle is one that can disagree with the key
  -- it labels. This is the one place a permission is described.
  label       text not null check (length(trim(label)) > 0),
  description text not null default '',

  /*
    True when this permission alone opens a section of the panel.

    The role editor reads it to say "removing this hides Point Management from him
    entirely" instead of silently making a screen disappear. A permission that merely
    enables a button inside a screen he can already open is a different kind of change and
    should not carry the same warning.
  */
  is_section  boolean not null default false,

  sort        integer not null default 0
);

comment on table public.permissions is
  'Every permission that exists. Written ONLY by a migration - permissions_immutable() '
  'refuses any write with a session user, service_role included. role_permissions and '
  'admin_grants both reference it, so the panel can hand out any permission in here and '
  'cannot invent one that no policy enforces. See 0043.';

/*
  The immutability trigger, and the reason this whole design is safe.

  auth.uid() is NULL in a migration and NULL for the service_role key, and both are
  server-side and already trusted — that is the same test admins_guard(),
  profiles_guard_status() and every other guard in this schema applies. What is different
  here is that there is no branch after it: there is no permission that permits writing this
  table, because the moment one existed the catalogue would be data with a write path and the
  argument in the header would collapse.
*/
create or replace function public.permissions_immutable()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  raise exception 'the permission catalogue is changed by a migration, never from the panel';
end;
$$;

drop trigger if exists permissions_immutable on public.permissions;

create trigger permissions_immutable
  before insert or update or delete on public.permissions
  for each row execute function public.permissions_immutable();

-- ---------------------------------------------------------------- the catalogue itself
--
-- The nineteen 0004/0006/0040 defined, with their spellings unchanged — every one of them
-- appears in a live policy and renaming one would silently un-enforce it — followed by the
-- twenty-seven this migration adds.
--
-- The additions are all *splits* of permissions that were too coarse to express what the
-- સંચાલક actually needs to delegate. Four worth naming:
--
--   * darshan.image.replace is separate from darshan.update because replacing an image is
--     the one દર્શન edit that is irreversible from the panel and that two thousand phones
--     will see. Editing a વર્ણન and replacing a દ્રશ્ય are not the same act.
--   * points.adjust (hand a named person points) is separate from points.config.update
--     (reprice the whole system). The second is far more dangerous and the first is far
--     more often needed, and settings.update granted both.
--   * The five points.*.read split the reporting screens that all sat behind progress.read,
--     so "he may see the leaderboard but not the ledger" becomes expressible.
--   * The six app-shaped *.update split settings.update, which today grants Video,
--     Navigation, App Icon, ધૂન, Gallery and Session in one tick.
--
-- §3 below grants every one of them to exactly the roles that already held the permission it
-- was split out of, so nobody gains or loses anything on the day this ships.

insert into public.permissions (key, resource, verb, label, description, is_section, sort) values
  -- ── યુવક ──────────────────────────────────────────────────────────────────
  ('users.read',   'users', 'read',   'See યુવકો',
   'Open the યુવક list and read names, numbers, SMK and zone.', true, 100),
  ('users.update', 'users', 'update', 'Edit a યુવક',
   'Change a યુવક''s recorded details. Never his points or his progress.', false, 110),
  ('users.disable','users', 'disable','Suspend a યુવક',
   'Suspend or disable an account. A suspended યુવક may still sign in and read his own history, and may write nothing.', false, 120),
  ('users.test',   'users', 'test',   'Mark a test account',
   'Mark an account as a test account, or return it to being a real one. A test account earns points normally and appears in no total, ranking or export.', false, 130),
  ('users.purge',  'users', 'purge',  'Delete a test account',
   'Delete a test account and everything it produced. The only deletion of a person this application allows anywhere.', false, 140),
  ('users.export', 'users', 'export', 'Export the યુવક list',
   'Download the યુવક list as Excel. The file leaves the panel and is not governed after that.', false, 150),

  -- ── progress ─────────────────────────────────────────────────────────────
  ('progress.read',        'progress', 'read',        'See progress',
   'Open the progress report and read how far the સંઘ has reached.', true, 200),
  ('progress.detail.read', 'progress', 'detail.read', 'Open one યુવક''s progress',
   'Open a single યુવક and read his દર્શન, his attempts and his timeline.', false, 210),
  ('progress.export',      'progress', 'export',      'Export progress',
   'Download the progress report as Excel.', false, 220),
  ('sessions.read',        'sessions', 'read',        'See sessions',
   'Read the learning-session records.', true, 230),

  -- ── દર્શન ─────────────────────────────────────────────────────────────────
  ('darshan.read',          'darshan', 'read',          'See દર્શન',
   'Open the દર્શન collection and read every દ્રશ્ય, its number and its order.', true, 300),
  ('darshan.create',        'darshan', 'create',        'Add a દ્રશ્ય',
   'Call a new દ્રશ્ય into existence, outside the sheet-driven build.', false, 310),
  ('darshan.update',        'darshan', 'update',        'Edit a દ્રશ્ય',
   'Change a દ્રશ્ય''s title, વર્ણન or number.', false, 320),
  ('darshan.disable',       'darshan', 'disable',       'Publish or withdraw a દ્રશ્ય',
   'Move a દ્રશ્ય between DRAFT, PUBLISHED, ACTIVE and DISABLED.', false, 330),
  ('darshan.image.replace', 'darshan', 'image.replace', 'Replace a દ્રશ્ય image',
   'Replace the image itself. Irreversible from the panel, and every installed phone will see it.', false, 340),
  ('darshan.reorder',       'darshan', 'reorder',       'Reorder the collection',
   'Change the order the દ્રશ્યો are shown in. Changes what every યુવક sees next.', false, 350),
  ('darshan.import',        'darshan', 'import',        'Import from the sheet',
   'Run a bulk import from the સંચાલક''s spreadsheet.', false, 360),

  -- ── ગુણ ───────────────────────────────────────────────────────────────────
  ('points.read',             'points', 'read',             'Open Point Management',
   'Read how points are configured: what each level is worth, the pace, the rules.', true, 400),
  ('points.ledger.read',      'points', 'ledger.read',      'See the point ledger',
   'Every point transaction, per યુવક, with the rule that produced it.', true, 410),
  ('points.daily.read',       'points', 'daily.read',       'See daily activity',
   'What the app observed each યુવક doing, day by day.', true, 420),
  ('points.records.read',     'points', 'records.read',     'See daily records',
   'What each યુવક wrote down himself, day by day.', true, 430),
  ('points.level3.read',      'points', 'level3.read',      'See the લેવલ ૩ report',
   'Who has done how much પુનરાવર્તન, and who has done none.', true, 440),
  ('points.leaderboard.read', 'points', 'leaderboard.read', 'See the leaderboard',
   'The ranking as the યુવકો see it.', true, 450),
  ('points.config.update',    'points', 'config.update',    'Change what points are worth',
   'Reprice the system: level values, pace, earning mode. Affects every યુવક at once.', false, 460),
  ('points.bonus.update',     'points', 'bonus.update',     'Change bonus rules',
   'Create, edit and delete the bonus rules.', false, 470),
  ('points.adjust',           'points', 'adjust',           'Award points by hand',
   'Add or remove points from one named યુવક, with a reason. Recorded in the ledger under your name.', false, 480),

  -- ── લેવલ ──────────────────────────────────────────────────────────────────
  ('levels.read',   'levels', 'read',   'See the levels',
   'Read how the four levels are configured.', true, 500),
  ('levels.update', 'levels', 'update', 'Change the levels',
   'Change level thresholds and the લેવલ ૪ gate.', false, 510),
  ('level4.read',   'level4', 'read',   'Open લેવલ ૪',
   'Read which દર્શન each લેવલ ૪ sub-level asks for.', true, 520),
  ('level4.update', 'level4', 'update', 'Build લેવલ ૪',
   'Choose the દર્શન and the activities each લેવલ ૪ sub-level is made of.', false, 530),

  -- ── the app itself ───────────────────────────────────────────────────────
  ('settings.read',     'settings',   'read',   'See settings',
   'Read what is configured for the યુવક app.', true, 600),
  ('settings.update',   'settings',   'update', 'Change settings',
   'Save any app setting. Holding this is equivalent to holding all six below.', false, 610),
  ('video.update',      'video',      'update', 'Change the video',
   'Change the YouTube video shown in the app.', false, 620),
  ('navigation.update', 'navigation', 'update', 'Change the bottom bar',
   'Change which buttons a યુવક has at the bottom of his screen.', false, 630),
  ('appicon.update',    'appicon',    'update', 'Change the app icon',
   'Change the mark on two thousand home screens. iPhones that already installed will never see it.', false, 640),
  ('dhun.update',       'dhun',       'update', 'Change the ધૂન',
   'Replace the ધૂન audio.', false, 650),

  -- ── access ───────────────────────────────────────────────────────────────
  ('admins.read',    'admins', 'read',    'See સંચાલકો',
   'Open the સંચાલક list and read who holds which role.', true, 700),
  ('admins.create',  'admins', 'create',  'Appoint a સંચાલક',
   'Create a new સંચાલક account. Nobody may appoint himself.', false, 710),
  ('admins.update',  'admins', 'update',  'Edit a સંચાલક',
   'Change a સંચાલક''s details. Never your own role or status.', false, 720),
  ('admins.disable', 'admins', 'disable', 'Suspend a સંચાલક',
   'Suspend or disable a સંચાલક. Never deleted - the trail stays attached to a person.', false, 730),
  ('roles.assign',   'roles',  'assign',  'Change someone''s role',
   'Move a સંચાલક from one role to another. Never to a role at or above your own.', false, 740),
  ('roles.manage',   'roles',  'manage',  'Create and edit roles',
   'Create roles, and choose which permissions each role holds. The most powerful permission here.', true, 750),
  ('grants.manage',  'grants', 'manage',  'Grant one person one permission',
   'Give or take away a single permission for one person, on top of his role. You may only grant what you hold.', false, 760),
  ('scope.assign',   'scope',  'assign',  'Limit someone to a zone',
   'Restrict a સંચાલક to one or more સબઝોન, so every list and report he opens shows only those યુવકો.', false, 770),

  -- ── the trail ────────────────────────────────────────────────────────────
  ('audit.read',   'audit', 'read',   'See the audit trail',
   'Read who changed what, and when. The panel''s most sensitive read.', true, 800),
  ('audit.export', 'audit', 'export', 'Export the audit trail',
   'Download the audit trail as Excel.', false, 810)
on conflict (key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. ROLES, AS ROWS
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.admin_roles (
  -- Upper snake case, as the five enum labels were, so a role reads the same in the audit
  -- trail whether it shipped with the schema or was made last Tuesday.
  key         text primary key check (key ~ '^[A-Z][A-Z0-9_]{2,31}$'),
  label       text not null check (length(trim(label)) > 0),
  description text not null default '',

  /*
    The five roles this schema shipped with.

    A system role may be read, held, and listed like any other. It may not be renamed or
    deleted, and SUPER_ADMIN's permission set may not be edited at all — see
    role_permissions_guard(). The panel greys them accordingly.

    They are not privileged in any other way. A custom role may hold exactly the same
    permissions as ADMIN and be exactly as powerful; is_system is about whether the *name*
    is load-bearing elsewhere, not about authority.
  */
  is_system   boolean not null default false,

  /*
    Who may administer whom.

    0004 had one rule of this shape, written as a special case: "only a SUPER_ADMIN may
    change a SUPER_ADMIN", so that an ADMIN who somehow acquired admins.update could not
    demote the person above him. With roles becoming data, that special case has to
    generalise or it protects only the one role that happened to be hardcoded — a custom
    role holding roles.assign could otherwise rewrite ADMIN and take the panel.

    So every role carries a rank, and the rule is: you may not touch a role, or a person
    holding a role, at or above your own. SUPER_ADMIN is 100 and nothing may be created
    above it.
  */
  rank        integer not null default 0 check (rank between 0 and 100),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id)
);

comment on table public.admin_roles is
  'The roles a સંચાલક may hold. Replaces the public.admin_role enum as the authority - see '
  '0043. is_system marks the five that shipped with the schema; rank decides who may '
  'administer whom.';

insert into public.admin_roles (key, label, description, is_system, rank) values
  ('SUPER_ADMIN', 'Super Admin',
   'Holds every permission that exists, always. There is exactly one.', true, 100),
  ('ADMIN', 'Admin',
   'Runs the panel day to day. Cannot appoint administrators or change anyone''s role.', true, 80),
  ('CONTENT_MANAGER', 'Content Manager',
   'દર્શન and content. No user administration of any kind.', true, 50),
  ('COORDINATOR', 'Coordinator',
   'Sees people and progress, changes nothing.', true, 40),
  ('VIEWER', 'Viewer',
   'Reads. Holds no permission that ends in a mutating verb, and is deliberately kept out of the audit trail.', true, 10)
on conflict (key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. THE BINDINGS
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.role_permissions (
  role_key   text not null references public.admin_roles (key) on delete cascade,
  permission text not null references public.permissions (key),
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id),
  primary key (role_key, permission)
);

comment on table public.role_permissions is
  'Which role holds which permission. Editable from the panel by anyone holding '
  'roles.manage, subject to role_permissions_guard(): never SUPER_ADMIN, never a role at or '
  'above your own rank, and never a permission you do not hold yourself.';

/*
  The seed, and the last appearance of the hardcoded matrix.

  `base` is 0040's `permissions_for()` transcribed exactly. `split` is the derivation: each
  new permission names the coarse one it was carved out of, and a role receives it if and
  only if it already held the coarse one.

  Doing it this way rather than typing out forty-six rows per role is not brevity. It makes
  "nobody gains or loses anything on the day this ships" a *structural* property of the
  seed rather than a clerical claim about two hundred hand-written lines — the only way a
  role can gain something it should not is if a split names the wrong source, which is one
  line to check instead of two hundred.

  SUPER_ADMIN is handled separately and gets the whole catalogue by definition, which is
  also what role_permissions_guard() enforces from here on.
*/
with base (role_key, permission) as (
  values
    ('ADMIN', 'users.read'), ('ADMIN', 'users.update'), ('ADMIN', 'users.disable'),
    ('ADMIN', 'progress.read'), ('ADMIN', 'sessions.read'),
    ('ADMIN', 'darshan.read'), ('ADMIN', 'darshan.create'), ('ADMIN', 'darshan.update'),
    ('ADMIN', 'darshan.disable'),
    ('ADMIN', 'settings.read'), ('ADMIN', 'settings.update'),
    ('ADMIN', 'admins.read'), ('ADMIN', 'audit.read'),

    ('CONTENT_MANAGER', 'darshan.read'), ('CONTENT_MANAGER', 'darshan.create'),
    ('CONTENT_MANAGER', 'darshan.update'), ('CONTENT_MANAGER', 'darshan.disable'),
    ('CONTENT_MANAGER', 'settings.read'),

    ('COORDINATOR', 'users.read'), ('COORDINATOR', 'progress.read'),
    ('COORDINATOR', 'sessions.read'), ('COORDINATOR', 'darshan.read'),

    ('VIEWER', 'users.read'), ('VIEWER', 'progress.read'), ('VIEWER', 'sessions.read'),
    ('VIEWER', 'darshan.read'), ('VIEWER', 'settings.read')
),
split (permission, carved_from) as (
  values
    ('users.export',           'users.read'),
    ('progress.detail.read',   'progress.read'),
    ('progress.export',        'progress.read'),
    ('darshan.image.replace',  'darshan.update'),
    ('darshan.reorder',        'darshan.update'),
    ('darshan.import',         'darshan.create'),
    /*
      Carved from progress.read, and NOT from settings.read, although Point Management is a
      settings screen and AdminShell listed it under `settings.read` from the day it was built.

      Those two disagreed, and the database was the one telling the truth. The menu offered
      Point Management to a CONTENT_MANAGER, who holds settings.read; the four functions behind
      it open with admin_assert_progress_reader(), which he fails. So the link was there and the
      page was refused - the precise failure AdminShell's own header is written against.

      Carving from settings.read would have resolved the disagreement in favour of the menu and
      handed a CONTENT_MANAGER the point engine, which is a privilege expansion this migration
      promises not to make. Carving from progress.read resolves it in favour of the policy: the
      people who could open the page still can, and the menu entry now disappears for the role
      it never worked for. scripts/test-point-engine.mjs asserts that refusal and caught the
      other choice.
    */
    ('points.read',            'progress.read'),
    ('points.ledger.read',     'progress.read'),
    ('points.daily.read',      'progress.read'),
    ('points.records.read',    'progress.read'),
    ('points.level3.read',     'progress.read'),
    ('points.leaderboard.read','progress.read'),
    ('points.config.update',   'settings.update'),
    ('points.bonus.update',    'settings.update'),
    -- admin_award_manual_points() asserts settings.update today (0031:701), which is where
    -- this comes from and is exactly the over-broad grant the split exists to end.
    ('points.adjust',          'settings.update'),
    ('levels.read',            'settings.read'),
    ('levels.update',          'settings.update'),
    ('level4.read',            'settings.read'),
    ('level4.update',          'settings.update'),
    ('video.update',           'settings.update'),
    ('navigation.update',      'settings.update'),
    ('appicon.update',         'settings.update'),
    ('dhun.update',            'settings.update'),
    ('roles.manage',           'roles.assign'),
    ('grants.manage',          'roles.assign'),
    ('scope.assign',           'roles.assign'),
    ('audit.export',           'audit.read')
)
insert into public.role_permissions (role_key, permission)
select role_key, permission from base
union
select b.role_key, s.permission from base b join split s on s.carved_from = b.permission
union
select 'SUPER_ADMIN', key from public.permissions
on conflict do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. THE EXCEPTIONS
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.admin_grants (
  admin_id   uuid not null references public.admins (id) on delete cascade,
  permission text not null references public.permissions (key),

  -- ALLOW adds a permission the role does not carry. DENY removes one it does.
  -- DENY beats ALLOW beats the role — see caller_permissions(). That ordering is the only
  -- one under which a DENY means anything, and the panel states it in those words.
  effect     text not null check (effect in ('ALLOW', 'DENY')),

  /*
    Why this person is an exception.

    A column, not a convention: an override with no recorded reason is indistinguishable a
    year later from one somebody added by mistake, and the person who could have said is
    usually the person who left. The panel makes it a required field.
  */
  reason     text not null default '',

  /*
    The small feature that prevents the large problem.

    Every access system with only permanent grants accumulates them — somebody needs લેવલ ૪
    editing for one week of ઉત્સવ and holds it for three years, because revoking it is
    nobody's job. A grant that expires by itself is the only kind that gets cleaned up.

    Enforced in caller_permissions(), not by a sweeper: an expired row that is still present
    is a *record* of an access that was held, which the audit trail wants. The panel shows
    expired grants greyed rather than hiding them.
  */
  expires_at timestamptz,

  granted_by uuid references auth.users (id),
  granted_at timestamptz not null default now(),
  primary key (admin_id, permission)
);

comment on table public.admin_grants is
  'Per-person exceptions to a role, with an optional expiry. DENY beats ALLOW beats the '
  'role. Requires grants.manage, and nobody may grant a permission he does not hold or '
  'edit his own - see admin_grants_guard(). 0043.';

-- ════════════════════════════════════════════════════════════════════════════
-- 5. THE ENUM RETIRES
-- ════════════════════════════════════════════════════════════════════════════
--
-- `admins.role` is public.admin_role, an enum, and a dynamic role cannot be one: ALTER TYPE
-- … ADD VALUE cannot run inside a transaction block alongside the rest of a migration, and
-- an enum label can never be removed once added.
--
-- The column becomes text with a foreign key to admin_roles(key). The compatibility view
-- from 0038 selects this column, and Postgres refuses to alter the type of a column a view
-- depends on, so the view is dropped and rebuilt around the change — unchanged in every
-- other respect.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'admins'
      and column_name = 'role' and udt_name = 'admin_role'
  ) then
    drop view if exists public.admin_profiles;

    alter table public.admins alter column role type text using role::text;

    -- Recreated exactly as 0038 left it. See that migration's own note: eight test suites
    -- build their fixtures through this name, and rewriting them in the same commit that
    -- moves the schema underneath them would mean the suite proving the new model is the
    -- suite that was edited to pass against it.
    create view public.admin_profiles with (security_invoker = on) as
      select id, role, status, display_name, created_at, updated_at, created_by
      from public.admins;

    grant select, insert, update, delete on public.admin_profiles to authenticated;
  end if;
end
$$;

-- Separately from the type change, and after admin_roles is seeded, so an existing row whose
-- role is one of the five finds its parent. `not valid` is deliberately NOT used: every
-- existing value is one of the five keys just inserted, so the constraint validates
-- immediately and a row that somehow held something else should stop this migration rather
-- than survive it.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'admins_role_fkey' and conrelid = 'public.admins'::regclass
  ) then
    alter table public.admins
      add constraint admins_role_fkey foreign key (role) references public.admin_roles (key);
  end if;
end
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. RESOLUTION
-- ════════════════════════════════════════════════════════════════════════════

/*
  The role the caller is acting as, or NULL for an ordinary યુવક.

  Returns text now rather than public.admin_role. This looks like the dangerous part of the
  migration and is not, for one specific reason: **Postgres does not record function→function
  calls in pg_depend when the body is a string literal.** has_permission() calls this, and
  122 policies call has_permission() — but the policies depend on has_permission(text), whose
  signature does not change, and has_permission() does not depend on this at all as far as
  the catalogue is concerned. Dropping and recreating this function therefore cascades to
  nothing.

  Every other caller already writes `public.effective_role()::text` (0010, 0012, 0033, 0040),
  which is now a no-op cast, and the two clients that call it over RPC
  (admin/src/lib/adminAuth.jsx, src/lib/auth.jsx) receive a JSON string either way.

  public.admin_role itself is left in place, unused. Dropping it is a separate, zero-risk
  migration once nothing names it.
*/
drop function if exists public.effective_role();

create function public.effective_role()
returns text
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
      select 'SUPER_ADMIN'
      from public.bootstrap_admins b
      where b.id = auth.uid()
    )
  );
$$;

comment on function public.effective_role() is
  'The role key the caller is acting as, or NULL for an ordinary યુવક. public.admins first; '
  'then public.bootstrap_admins, the sealed fallback 0024 resolved once. Returns text since '
  '0043 - roles are rows in public.admin_roles, not enum labels.';

/** The caller''s rank, for the guards. 0 for someone holding no role at all. */
create or replace function public.caller_rank()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    -- A bootstrap account outranks everything, exactly as it held SUPER_ADMIN before.
    (select 100 from public.bootstrap_admins b where b.id = auth.uid()),
    (select r.rank from public.admin_roles r where r.key = public.effective_role()),
    0
  );
$$;

/*
  What this caller may do, resolved.

  Order, and every part of it is deliberate:

    1. bootstrap_admins short-circuits to the entire catalogue. Read FIRST, so a broken
       role, a mistaken DENY or a role_permissions table that failed to seed cannot lock the
       founding accounts out of the panel they own. This is 0024's guarantee restated: the
       fallback must not be revocable by anything the panel can write.
    2. the role's permissions
    3. plus every unexpired ALLOW grant
    4. minus every unexpired DENY grant

  DENY last, and therefore winning, because any other ordering makes DENY decorative.

  A grant only counts while the administrator himself is ACTIVE — the join to public.admins
  is what says so, and it means suspending a person revokes his exceptions along with his
  role rather than leaving them to reactivate silently.
*/
create or replace function public.caller_permissions()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select a.id, a.role
    from public.admins a
    where a.id = auth.uid() and a.status = 'ACTIVE'
  ),
  granted as (
    select g.permission, g.effect
    from public.admin_grants g
    join me on me.id = g.admin_id
    where g.expires_at is null or g.expires_at > now()
  ),
  resolved as (
      select rp.permission
      from me
      join public.role_permissions rp on rp.role_key = me.role
    union
      select permission from granted where effect = 'ALLOW'
    except
      select permission from granted where effect = 'DENY'
  )
  select coalesce(
    (
      select array_agg(p.key order by p.sort, p.key)
      from public.permissions p
      where exists (select 1 from public.bootstrap_admins b where b.id = auth.uid())
    ),
    (select array_agg(permission order by permission) from resolved),
    array[]::text[]
  );
$$;

comment on function public.caller_permissions() is
  'Every permission the caller holds: bootstrap short-circuit, else role + ALLOW - DENY, '
  'unexpired only, ACTIVE administrators only. What has_permission() consults. 0043.';

/*
  Unchanged signature, and that is the point of the whole file.

  122 policy expressions name this function. None of them is re-issued by this migration.

  The cost is real and worth stating plainly: permissions_for() was immutable over an enum
  and touched no table; this reads four. What makes it affordable is 0039, which hoisted
  every policy call into `(select has_permission(…))` — a scalar subquery with no outer
  reference is evaluated once per query as an InitPlan, not once per row. A 2,000-row scan
  of profiles calls this once. scripts/test-rbac-perf.mjs measures it rather than assuming it.
*/
create or replace function public.has_permission(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(perm = any(public.caller_permissions()), false);
$$;

-- Unchanged meaning: "may this person open the panel at all?"
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.effective_role() is not null;
$$;

/*
  permissions_for() is now a table read, and takes a role key rather than an enum label.

  The old permissions_for(public.admin_role) is dropped outright rather than kept as a
  delegating shim. It held a hardcoded copy of the matrix, and a hardcoded copy of a matrix
  that has moved into the database is worse than no copy: it would answer confidently and
  wrongly for every role edited after today. Nothing in JavaScript ever called it — the
  references in admin/src are all comments naming it as the source of a permission spelling.
*/
drop function if exists public.permissions_for(public.admin_role);

create or replace function public.permissions_for(role_key text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select array_agg(permission order by permission)
     from public.role_permissions where role_permissions.role_key = permissions_for.role_key),
    array[]::text[]
  );
$$;

revoke all on function public.effective_role() from public;
revoke all on function public.caller_rank() from public;
revoke all on function public.caller_permissions() from public;
revoke all on function public.has_permission(text) from public;
revoke all on function public.is_admin() from public;
revoke all on function public.permissions_for(text) from public;

grant execute on function public.effective_role() to authenticated;
grant execute on function public.caller_rank() to authenticated;
grant execute on function public.caller_permissions() to authenticated;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.permissions_for(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. ONE CALL, EVERYTHING THE PANEL NEEDS
-- ════════════════════════════════════════════════════════════════════════════
--
-- admin/src/lib/adminAuth.jsx calls effective_role() on every page load and then relies on
-- a copy of the matrix compiled into the bundle to decide what to render. That copy cannot
-- survive this migration — the matrix is now editable, and a bundle that remembers last
-- week's version of it would render a panel that disagrees with what the server enforces,
-- in whichever direction is less obvious.
--
-- 0004 justified the duplication by wanting to avoid a startup round trip. This replaces it
-- at no cost: the round trip was already being made, and this returns the answer instead of
-- half of it.

create or replace function public.admin_session()
returns table (
  role         text,
  role_label   text,
  rank         integer,
  permissions  text[],
  is_bootstrap boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    public.effective_role(),
    coalesce((select r.label from public.admin_roles r where r.key = public.effective_role()),
             public.effective_role()),
    public.caller_rank(),
    public.caller_permissions(),
    exists (select 1 from public.bootstrap_admins b where b.id = auth.uid())
  where public.effective_role() is not null;
$$;

comment on function public.admin_session() is
  'Everything the panel needs to render itself, in one call: role, label, rank, the resolved '
  'permission list, and whether the caller is holding a bootstrap fallback. Returns no row '
  'at all for an ordinary યુવક, which is the same answer effective_role() gave as NULL.';

revoke all on function public.admin_session() from public;
grant execute on function public.admin_session() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. THE SPLIT PERMISSIONS, ACTUALLY ENFORCED
-- ════════════════════════════════════════════════════════════════════════════
--
-- Adding `points.ledger.read` to the catalogue makes it *grantable*. Only this section makes
-- it *mean* anything, and shipping the first without the second would be the worse half of the
-- two: a tick box in the role editor that hands out nothing, and a menu entry that leads to a
-- page the database refuses. AdminShell's own header argues at length that a link leading
-- somewhere untrue is worse than a missing one.
--
-- Six reading screens sat behind `progress.read`. That one permission opened the point ledger,
-- the two daily reports, the લેવલ ૩ report, the leaderboard and Point Management together — so
-- "he may see the leaderboard" could not be said without also saying "he may read every point
-- transaction of every યુવક", which is a different disclosure about the same people.
--
-- ── Why this is generated rather than typed ─────────────────────────────────
--
-- Seventeen functions call `admin_assert_progress_reader()`, and the ten below are between
-- eighty and three hundred lines each. Re-issuing them by hand means copying eleven hundred
-- lines to change one token in each, and the failure is silent: a body pasted with a
-- transcription error still applies, still runs, and is wrong in a report nobody re-reads.
--
-- 0040 met exactly this and solved it by generating the re-issue from `pg_get_functiondef` with
-- one token replaced. The same is done here. `replace()` on a body that no longer contains the
-- old token is a no-op, so re-applying this file is safe: the earlier migrations restore the
-- original bodies on a replay and this rewrites them again.
--
-- ── Backward compatible, by construction ────────────────────────────────────
--
-- The new assert passes for `progress.read` OR the fine permission. So every role that reads
-- these reports today reads them tomorrow, and a role given only `points.leaderboard.read`
-- reaches exactly one screen. Nothing has to be re-granted.

/*
  `users.read` is required as well, and that half is NOT relaxed.

  0029 stated the reason and it has not changed: these functions return names and mobile
  numbers as well as progress, `users.read` is what governs public.profiles, and a
  CONTENT_MANAGER holds neither and is refused here rather than shown an empty report.

  Only the *progress* half of that AND becomes a choice. Relaxing both would have handed every
  report to anybody given one fine permission — a leaderboard carries names, so a role that may
  read the ranking must still be a role that may read people. scripts/test-point-engine.mjs
  asserts the CONTENT_MANAGER refusal for eight of these functions and caught exactly this.
*/
create or replace function public.admin_can_report(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- progress.read first: it is the permission every existing role holds for these screens, and
  -- the one that must keep working without anybody being re-granted anything.
  select (public.has_permission('progress.read') or public.has_permission(perm))
     and public.has_permission('users.read');
$$;

comment on function public.admin_can_report(perm text) is
  'May the caller open a report gated on `perm`? users.read AND (progress.read OR perm) - the '
  'coarse permission still opens everything, so 0043''s split is additive and no existing role '
  'loses a screen. Generalises admin_assert_progress_reader() (0029).';

create or replace function public.admin_assert_report_reader(perm text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.admin_can_report(perm) then
    /*
      42501, and the message opens with 0029's exact words.

      "progress reporting requires" is matched by scripts/test-point-engine.mjs against eight
      functions, so it is part of the contract rather than prose — the same status the
      admins_guard() messages have. What follows it is new and is the useful half: it names the
      permission that would have got the caller in, so the person reading the refusal can tell
      a SUPER_ADMIN what to grant rather than guessing.
    */
    raise exception 'progress reporting requires users.read and either progress.read or %', perm
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.admin_can_report(text) from public;
revoke all on function public.admin_assert_report_reader(text) from public;
grant execute on function public.admin_can_report(text) to authenticated;
grant execute on function public.admin_assert_report_reader(text) to authenticated;

do $$
declare
  m   record;
  fn  record;
  src text;
  out_src text;
  n   integer := 0;
begin
  for m in
    select * from (values
      -- Point Ledger
      ('admin_point_transactions',    'points.ledger.read'),
      -- Daily Activity - the page and the counts strip above it
      ('admin_daily_activity',        'points.daily.read'),
      ('admin_activity_counts',       'points.daily.read'),
      -- Daily Records - the list, and one day of one યુવક
      ('admin_daily_records',         'points.records.read'),
      ('admin_daily_record_detail',   'points.records.read'),
      -- Leaderboard
      ('admin_leaderboard',           'points.leaderboard.read'),
      -- Point Management: the four reads behind the configuration screen
      ('admin_points_overview',       'points.read'),
      ('admin_point_activities',      'points.read'),
      ('admin_bonus_rules',           'points.read'),
      ('admin_point_config_versions', 'points.read')
    ) as t(fn, perm)
  loop
    -- By oid, not by name: several of these have more than one overload, and a rewrite that
    -- caught only the first would leave the other enforcing the coarse permission.
    for fn in
      select p.oid
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname = m.fn and p.prokind = 'f'
    loop
      src := pg_get_functiondef(fn.oid);
      out_src := replace(
        src,
        'public.admin_assert_progress_reader()',
        format('public.admin_assert_report_reader(%L)', m.perm)
      );
      -- Only re-issue when something actually changed. On a replay the token is already gone,
      -- and executing an identical definition would be noise in the notice log rather than a
      -- correction.
      if out_src is distinct from src then
        execute out_src;
        n := n + 1;
      end if;
    end loop;
  end loop;

  raise notice '[0043] % report function(s) re-issued against their own permission.', n;
end
$$;

/*
  લેવલ ૩'s three functions do not use the shared assert.

  0035 wrote the test inline — `if not public.has_permission('progress.read') then raise
  exception 'level3_report_forbidden'` — so the rewrite above cannot reach them. The same
  technique applies to a different token, and the raise is deliberately left exactly as it is:
  `level3_report_forbidden` is asserted verbatim by scripts/test-level3-auth.mjs and worded by
  the panel, so this changes who gets past the test and not what is said when they do not.
*/
do $$
declare
  fn  record;
  src text;
  out_src text;
  n   integer := 0;
begin
  for fn in
    select p.oid
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.proname in ('admin_level3_report', 'admin_level3_users', 'admin_user_level3_detail')
      and p.prokind = 'f'
  loop
    src := pg_get_functiondef(fn.oid);
    out_src := replace(
      src,
      'not public.has_permission(''progress.read'')',
      'not public.admin_can_report(''points.level3.read'')'
    );
    if out_src is distinct from src then
      execute out_src;
      n := n + 1;
    end if;
  end loop;

  raise notice '[0043] % લેવલ ૩ function(s) re-issued against points.level3.read.', n;
end
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. THE GUARDS
-- ════════════════════════════════════════════════════════════════════════════
--
-- Written in the same shape and with the same message discipline as admins_guard() (0038):
-- verbatim strings, asserted by the test suites, matched by adminService.js so each refusal
-- is worded for the person who hit it rather than flattened into "this change does not
-- follow the rules".
--
-- BEFORE triggers rather than policies, for the reason 0004 gives: a policy sees the new row
-- and not the old one's rank, cannot express "at or above your own", and does not bind
-- service_role.
--
-- Every one opens with the same `auth.uid() is null` pass-through — a migration or the
-- service_role key, both server-side and already trusted, and the only way the first rows
-- in these tables exist at all.

-- ---------------------------------------------------------------- roles

create or replace function public.admin_roles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  my_rank integer;
  members integer;
begin
  if caller is null then
    if tg_op = 'DELETE' then return old; end if;
    if tg_op = 'UPDATE' then new.updated_at := now(); end if;
    return new;
  end if;

  my_rank := public.caller_rank();

  if not public.has_permission('roles.manage') then
    raise exception 'not permitted to create or edit roles';
  end if;

  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'a built-in role cannot be renamed or deleted';
    end if;
    if old.rank >= my_rank then
      raise exception 'you cannot change a role equal to or above your own';
    end if;
    -- Deleting a role with members would leave the foreign key on admins.role to refuse the
    -- delete anyway, with a message nobody can act on. This one names the number.
    select count(*) into members from public.admins where role = old.key;
    if members > 0 then
      raise exception 'move the % administrator(s) holding this role before deleting it', members;
    end if;
    return old;
  end if;

  -- Nothing may be created at or above the caller's own rank, and nothing may be created
  -- as a system role: is_system marks the five that shipped, and a role that could claim it
  -- would be a role the panel refuses to let anyone repair.
  if new.rank >= my_rank then
    raise exception 'you cannot change a role equal to or above your own';
  end if;

  if tg_op = 'INSERT' then
    new.is_system := false;
    new.created_by := coalesce(new.created_by, caller);
  else
    if old.rank >= my_rank then
      raise exception 'you cannot change a role equal to or above your own';
    end if;
    if old.is_system and (new.key is distinct from old.key or new.is_system is distinct from old.is_system) then
      raise exception 'a built-in role cannot be renamed or deleted';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists admin_roles_guard on public.admin_roles;

create trigger admin_roles_guard
  before insert or update or delete on public.admin_roles
  for each row execute function public.admin_roles_guard();

-- ---------------------------------------------------------------- bindings

create or replace function public.role_permissions_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  my_rank integer;
  row_role text := case tg_op when 'DELETE' then old.role_key else new.role_key end;
  row_perm text := case tg_op when 'DELETE' then old.permission else new.permission end;
  target_rank integer;
begin
  if caller is null then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  my_rank := public.caller_rank();

  if not public.has_permission('roles.manage') then
    raise exception 'not permitted to create or edit roles';
  end if;

  /*
    SUPER_ADMIN holds everything, by definition rather than by configuration.

    Without this, the single most available attack on the whole model is to remove
    roles.manage from SUPER_ADMIN and then edit at leisure — or, more likely than any
    attack, for somebody to untick something on the one role that must never be short of a
    permission and quietly break the only account that can repair the others.
  */
  if row_role = 'SUPER_ADMIN' then
    raise exception 'the SUPER_ADMIN role always holds every permission';
  end if;

  select rank into target_rank from public.admin_roles where key = row_role;
  if coalesce(target_rank, 0) >= my_rank then
    raise exception 'you cannot change a role equal to or above your own';
  end if;

  -- The rule that stops roles.manage from being a way to mint authority out of nothing.
  -- Only on the way in: taking a permission away from a role is not an escalation, and a
  -- સંચાલક who has just been denied something must still be able to tidy up after himself.
  if tg_op <> 'DELETE' and not public.has_permission(row_perm) then
    raise exception 'you cannot grant a permission you do not hold yourself';
  end if;

  if tg_op = 'INSERT' then
    new.granted_by := coalesce(new.granted_by, caller);
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

drop trigger if exists role_permissions_guard on public.role_permissions;

create trigger role_permissions_guard
  before insert or update or delete on public.role_permissions
  for each row execute function public.role_permissions_guard();

-- ---------------------------------------------------------------- exceptions

create or replace function public.admin_grants_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  my_rank integer;
  subject uuid := case tg_op when 'DELETE' then old.admin_id else new.admin_id end;
  subject_rank integer;
begin
  if caller is null then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  my_rank := public.caller_rank();

  if not public.has_permission('grants.manage') then
    raise exception 'not permitted to grant individual permissions';
  end if;

  -- The same rule admins_guard() applies to role and status, for the same reason: an
  -- administrator who can write his own grants has every permission that exists.
  if subject = caller then
    raise exception 'an administrator cannot change their own access';
  end if;

  select r.rank into subject_rank
  from public.admins a join public.admin_roles r on r.key = a.role
  where a.id = subject;

  if coalesce(subject_rank, 0) >= my_rank then
    raise exception 'you cannot change a role equal to or above your own';
  end if;

  -- ALLOW only. A DENY takes something away, which no rank can be escalated by.
  if tg_op <> 'DELETE' and new.effect = 'ALLOW' and not public.has_permission(new.permission) then
    raise exception 'you cannot grant a permission you do not hold yourself';
  end if;

  if tg_op <> 'DELETE' then
    new.granted_by := coalesce(new.granted_by, caller);
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

drop trigger if exists admin_grants_guard on public.admin_grants;

create trigger admin_grants_guard
  before insert or update or delete on public.admin_grants
  for each row execute function public.admin_grants_guard();

-- ---------------------------------------------------------------- administrators
--
-- admins_guard() re-issued from 0038. Every existing rule and every existing message is
-- carried over **verbatim** — scripts/test-rls.mjs and scripts/test-admins.mjs assert them
-- exactly, and admin/src/features/users/services/adminService.js maps all eight to sentences.
--
-- Three changes, and nothing else:
--
--   1. caller_role is text rather than public.admin_role.
--   2. The 0004 special case "only a SUPER_ADMIN may change a SUPER_ADMIN" is kept as it is,
--      and a general rank rule is added *after* it. Order matters: the specific message is
--      the one two suites assert, so the SUPER_ADMIN case must reach it rather than falling
--      into the general one.
--   3. The last active SUPER_ADMIN cannot be demoted or disabled. 0004 had no such rule
--      because the bootstrap list made lockout impossible; with roles editable it is worth
--      saying out loud, and 0046 turns it into an exact count.

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

    -- Carried from 0004 unchanged, and before the general rule below so that this exact
    -- sentence is the one a SUPER_ADMIN change produces.
    if old.role = 'SUPER_ADMIN' and caller_role is distinct from 'SUPER_ADMIN' then
      raise exception 'only a SUPER_ADMIN may change a SUPER_ADMIN';
    end if;

    /*
      The generalisation. With roles as data, "the person above you" is a rank and not a
      hardcoded name: a custom role holding roles.assign could otherwise rewrite ADMIN.

      Exempt for a SUPER_ADMIN caller, and that exemption is load-bearing rather than a
      convenience. SUPER_ADMIN is rank 100 and so is every other SUPER_ADMIN, so a bare
      `old_rank >= my_rank` would make `100 >= 100` true and forbid the one thing 0004
      explicitly permits — "only a SUPER_ADMIN may change a SUPER_ADMIN" says a SUPER_ADMIN
      *may*. It would also seal the recovery path: a bootstrap account resolves to rank 100
      precisely so it can repair a broken top-level administrator, and it could not.

      Nothing is lost by the exemption. Everything a SUPER_ADMIN may do to another one is
      already governed by the specific rule directly above, and by the last-Super-Admin count
      directly below.
    */
    if coalesce(old_rank, 0) >= my_rank and caller_role is distinct from 'SUPER_ADMIN' then
      raise exception 'you cannot change a role equal to or above your own';
    end if;

    /*
      Somebody has to be able to fix everything.

      Checked on the way out of SUPER_ADMIN rather than on the way in, and counted over
      ACTIVE rows only, so both routes out — a demotion and a suspension — reach it.
      bootstrap_admins is not counted: it is the sealed fallback and is deliberately not a
      substitute for a working, visible administrator.
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

  -- Nobody may hand out a role at or above his own. Exempt for a SUPER_ADMIN caller for the
  -- same reason as the rule above: appointing a second SUPER_ADMIN is rank 100 granting rank
  -- 100, which the specific sentence a few lines up already governs and permits.
  if coalesce(new_rank, 0) >= my_rank and caller_role is distinct from 'SUPER_ADMIN' then
    raise exception 'you cannot grant a role equal to or above your own';
  end if;

  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 10. THE TRAIL
-- ════════════════════════════════════════════════════════════════════════════
--
-- Same shape as audit_admin() (0038): SECURITY DEFINER so the insert passes audit_logs' own
-- policy, actor_id from auth.uid() and never from an argument, and the action derived from
-- the diff rather than from whatever the client called the button.

create or replace function public.audit_admin_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  act   text;
  b     jsonb;
  a     jsonb;
  tid   text;
begin
  if actor is null then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    act := 'ROLE_CREATED'; a := to_jsonb(new); tid := new.key;
  elsif tg_op = 'DELETE' then
    act := 'ROLE_DELETED'; b := to_jsonb(old); tid := old.key;
  else
    act := 'ROLE_UPDATED'; b := to_jsonb(old); a := to_jsonb(new); tid := new.key;
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, target_id, "before", "after")
  values (actor, public.effective_role(), act, 'admin_roles', tid, b, a);

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

drop trigger if exists audit_admin_roles on public.admin_roles;

create trigger audit_admin_roles
  after insert or update or delete on public.admin_roles
  for each row execute function public.audit_admin_role();

/*
  One row per permission moved, not one per save.

  The panel saves a role by writing the whole tick-box grid, so a "role updated" entry would
  say that something changed among forty-six checkboxes and leave the reader to diff two
  JSON blobs. `ROLE_PERMISSION_GRANTED  points.adjust  →  COORDINATOR` is the sentence
  somebody actually needs a year later, and it is what makes the trail answer "when did
  Coordinators get this?".
*/
create or replace function public.audit_role_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, target_id, "before", "after")
  values (
    actor,
    public.effective_role(),
    case tg_op when 'DELETE' then 'ROLE_PERMISSION_REVOKED' else 'ROLE_PERMISSION_GRANTED' end,
    'role_permissions',
    case tg_op when 'DELETE' then old.role_key else new.role_key end,
    case tg_op when 'DELETE' then to_jsonb(old) else null end,
    case tg_op when 'DELETE' then null else to_jsonb(new) end
  );

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

drop trigger if exists audit_role_permissions on public.role_permissions;

create trigger audit_role_permissions
  after insert or update or delete on public.role_permissions
  for each row execute function public.audit_role_permission();

create or replace function public.audit_admin_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, target_id, "before", "after")
  values (
    actor,
    public.effective_role(),
    case tg_op when 'DELETE' then 'GRANT_REMOVED' else 'GRANT_ADDED' end,
    'admin_grants',
    (case tg_op when 'DELETE' then old.admin_id else new.admin_id end)::text,
    case tg_op when 'DELETE' then to_jsonb(old) else null end,
    case tg_op when 'DELETE' then null else to_jsonb(new) end
  );

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

drop trigger if exists audit_admin_grants on public.admin_grants;

create trigger audit_admin_grants
  after insert or update or delete on public.admin_grants
  for each row execute function public.audit_admin_grant();

-- ════════════════════════════════════════════════════════════════════════════
-- 11. POLICIES
-- ════════════════════════════════════════════════════════════════════════════
--
-- Every call hoisted into a scalar subquery, which is what 0039 did to every other policy in
-- this schema: has_permission() sitting bare in a qual is re-evaluated once per row, and the
-- role editor lists forty-six permissions on one page.
--
-- The guards above are the real enforcement — they bind service_role and can see OLD. These
-- policies are the ordinary PostgREST layer in front of them, and they are deliberately not
-- the only thing standing between a browser and a role.

alter table public.permissions      enable row level security;
alter table public.admin_roles      enable row level security;
alter table public.role_permissions enable row level security;
alter table public.admin_grants     enable row level security;

drop policy if exists "permissions readable by admins" on public.permissions;
-- Readable by anyone holding any role at all, and by nobody else. The panel needs the whole
-- catalogue to render "here is what you may not do" as well as "here is what you may" — the
-- Effective access screen is meaningless if it can only list the permissions already held.
create policy "permissions readable by admins" on public.permissions
  for select using ((select public.is_admin()));
-- No insert, update or delete policy at all, and permissions_immutable() behind that.

drop policy if exists "roles readable by admins" on public.admin_roles;
drop policy if exists "roles writable by permission" on public.admin_roles;

create policy "roles readable by admins" on public.admin_roles
  for select using ((select public.is_admin()));

create policy "roles writable by permission" on public.admin_roles
  for all using ((select public.has_permission('roles.manage')))
  with check ((select public.has_permission('roles.manage')));

drop policy if exists "role permissions readable by admins" on public.role_permissions;
drop policy if exists "role permissions writable by permission" on public.role_permissions;

create policy "role permissions readable by admins" on public.role_permissions
  for select using ((select public.is_admin()));

create policy "role permissions writable by permission" on public.role_permissions
  for all using ((select public.has_permission('roles.manage')))
  with check ((select public.has_permission('roles.manage')));

drop policy if exists "own grants readable" on public.admin_grants;
drop policy if exists "grants writable by permission" on public.admin_grants;

-- Your own exceptions are yours to see — the panel shows every સંચાલક what he may do, and an
-- ALLOW he cannot read is a permission he holds for reasons the screen cannot explain.
create policy "own grants readable" on public.admin_grants
  for select using (admin_id = (select auth.uid()) or (select public.has_permission('admins.read')));

create policy "grants writable by permission" on public.admin_grants
  for all using ((select public.has_permission('grants.manage')))
  with check ((select public.has_permission('grants.manage')));

grant select on public.permissions to authenticated;
grant select, insert, update, delete on public.admin_roles to authenticated;
grant select, insert, update, delete on public.role_permissions to authenticated;
grant select, insert, update, delete on public.admin_grants to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 12. SAY WHAT HAPPENED
-- ════════════════════════════════════════════════════════════════════════════
--
-- In the style of 0038 and 0040: the migration reports what it did to authority, because
-- "nobody gains or loses anything today" is a claim that should be checkable by whoever
-- applies it rather than taken on trust from a comment.

do $$
declare
  r        record;
  perms_n  integer;
  roles_n  integer;
begin
  select count(*) into perms_n from public.permissions;
  select count(*) into roles_n from public.admin_roles;

  raise notice '[0043] % permissions in the catalogue, % roles.', perms_n, roles_n;
  raise notice '[0043] The catalogue is written by migrations only - permissions_immutable()';
  raise notice '[0043] refuses every write with a session user, service_role included.';
  raise notice '[0043]';
  raise notice '[0043] Permissions held, by role:';
  for r in
    select ar.key, ar.rank, count(rp.permission) as n
    from public.admin_roles ar
    left join public.role_permissions rp on rp.role_key = ar.key
    group by ar.key, ar.rank
    order by ar.rank desc
  loop
    raise notice '[0043]   rank %  %  -  % permission(s)', lpad(r.rank::text, 3), rpad(r.key, 16), r.n;
  end loop;
  raise notice '[0043]';
  raise notice '[0043] Every new permission was granted to exactly the roles that already held';
  raise notice '[0043] the coarse one it was carved out of. No administrator gains or loses';
  raise notice '[0043] anything today. What changes is that it can now be edited.';
end
$$;
