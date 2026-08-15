# Access Control — dynamic roles, per-admin grants, zone scope, and a live dashboard

> **Status: step 1 and step 2 built and tested. Steps 3–8 still to do.**
>
> | # | Work | State |
> |---|---|---|
> | 1 | `0043_dynamic_rbac.sql` — catalogue, dynamic roles, overrides, guards, audit, split enforcement | **Done** |
> | 2 | Panel: `admin_session()` RPC, `permissions.js` rewrite, NAV re-pointed, roles from the DB | **Done** |
> | 3 | `0044_effective_access.sql` — `permissions_of()`, `admin_effective_permissions()`, `admin_role_usage()` | **Done** |
> | 4 | Panel: the `/access` section — all four tabs of §6.1 | **Done** |
> | 5 | Zone scope migration (was §3 of this plan) | To do |
> | 6 | Panel: scope editor | To do |
> | 7 | `user_activity_daily` + today/trend functions | To do |
> | 8 | યુવક app: presence write, and the dashboard Today band | To do |
> | 9 | Single Super Admin | To do — **needs the account named** |
>
> §6.1's `/access` section is built: Administrators, Roles, Permissions and Effective access,
> at `/access` under a new **Access & audit** sidebar group. The Administrators tab is one
> component rendered in both `/users` and `/access` rather than moved, so the two cannot drift.
>
> **The role editor and the effective-access view are arranged by page, not by permission** —
> see `shared/domain/access-map.js`. §6.1 originally described a grid of permissions grouped by
> resource, which is how the catalogue is shaped and is not how the decision is made: nobody
> asks "should he hold `points.ledger.read`", they ask "should he be able to open the Point
> Ledger, and only look at it". The permission-grouped grid was built first, shown, and
> rejected for exactly that reason. Each row is now a page of the panel with a **View** tick and
> one tick per action that page offers; actions are deliberately not collapsed into a single
> "Edit", because on દર્શન the difference between editing a વર્ણન and replacing an image two
> thousand phones will see is the whole reason those are separate permissions.
>
> The map is a presentation of the catalogue and never a second model.
> `test-permission-catalogue.mjs` §F asserts it covers every permission **exactly once** — a
> permission missing from it would exist, be enforced, and be impossible to grant; one listed
> twice would be two checkboxes writing the same row. It also asserts the sidebar and the map
> name the same permission for the same route.
>
> New suites, all passing: `test-rbac-dynamic.mjs` (112 assertions),
> `test-permission-catalogue.mjs` (15). Whole existing suite green, including `test:rls` (89),
> the migration replay in `test-point-engine.mjs` (332), and
> `verify-admin-responsive.mjs` (28 routes × 7 widths, 1142 assertions).
>
> ### Numbering note
>
> The zone-scope migration described in §3 below was **not** the file that became 0044.
> `0044_effective_access.sql` is the read surface the Access screens needed, and zone scope
> moves to the next free number. The design in §3 is unchanged.
>
> ### Where the build deviated from this plan, and why
>
> 1. **`permissions_for(admin_role)` was dropped, not kept as a delegating shim.** §2.1 planned
>    a shim. It held a hardcoded copy of the matrix, nothing in JavaScript ever called it, and a
>    stale copy of a matrix that has moved into the database answers confidently and wrongly.
>    Replaced by `permissions_for(text)`, which reads the table.
> 2. **0038 had to be edited to stay replay-safe.** It re-issues `effective_role()` as
>    enum-returning, which after 0043 is not merely redundant but *unbuildable* — `create or
>    replace` cannot change a return type (42P13), and dropping first does not help because the
>    body reads `admins.role`, which is now text (42804). Its definition is now guarded on the
>    column still being the enum, so it defines the function on a first application and stands
>    aside on a replay. Found by `test-point-engine.mjs`, which replays 0031 onward.
> 3. **The split permissions are enforced, not just grantable — §8 of the migration.** The plan
>    left this implicit. Ten report functions and the three લેવલ ૩ functions were re-issued from
>    `pg_get_functiondef` with one token replaced (0040's technique) so `points.ledger.read` and
>    its five siblings actually gate something. Without it the role editor would offer tick
>    boxes that hand out nothing and the sidebar would show links leading to refusals.
> 4. **`points.read` is carved from `progress.read`, not `settings.read`.** The menu listed Point
>    Management under `settings.read` while the four functions behind it asserted
>    `progress.read`. They disagreed, and a CONTENT_MANAGER got the link and a refused page.
>    Carving from `settings.read` would have resolved it in the menu's favour and handed him the
>    point engine — a privilege expansion this work promises not to make.
> 5. **`users.read` is still required for every report.** The first cut of `admin_can_report()`
>    relaxed 0029's `progress.read AND users.read` to just the progress half. These reports
>    return names and mobile numbers; only the progress half is now a choice. Both 4 and 5 were
>    caught by the existing `test-point-engine.mjs`, not by anything written for this work.
> 6. **Three permissions turned out never to have been enforced**, since 0004 and unrelated to
>    this change: `darshan.read` (scenes are world-readable), `darshan.disable` and
>    `users.disable` (both covered by the broader `.update` policy on the same table). They are
>    recorded as known exceptions in `test-permission-catalogue.mjs` rather than quietly
>    tightened — splitting those two policies is its own migration and its own review.
> 7. **`netlify/functions/create-admin.js` no longer validates the role against a fixed list.**
>    It checked the five enum labels, which would have refused every role created after its last
>    deploy. It now checks the key's *shape*; whether the role exists is decided by the foreign
>    key inside the same insert that checks `admins.create`.
> 8. **A promote-an-existing-user flow was added, which the plan did not describe.** The panel
>    could only *create* an administrator, and `createAdmin()` refuses an address that already
>    has an account — so a યુવક who was already registered could not be given a role at all,
>    and the workaround is a second account on a different address that splits one person into
>    two identities. `promoteUser()` is one INSERT carrying their existing `auth.users` id.
> 9. **`applyTerm()` in userService was rewritten.** Unrelated to the plan and found in use:
>    the યુવક search matched only from the *start* of a value, so a partial mobile number was
>    tried as a name prefix and never matched, and a surname never found anyone. Verified
>    against production data before and after.
> 10. **`verify-admin-responsive.mjs` needed two fixes of its own.** Its RPC fixture still
>    mocked `effective_role`, so after step 2 every route rendered an empty panel and the run
>    reported "nothing failed, but the routes rendered nothing" — a skip, correctly, not a pass.
>    Its screenshot filenames also could not carry a `?`, which the tab-scoped `/access` routes
>    introduced.
>
> Decisions taken with the સંચાલક on 2026-08-15:
>
> | Question | Decision |
> |---|---|
> | Scope of access | Features **and** zone scope (વેડરોડ / વરાછા / નવસારી) |
> | Role model | Editable roles in the database **plus** per-admin overrides |
> | Founding accounts | Exactly one SUPER_ADMIN; the others demoted to ADMIN |
> | Activity data | New daily-active table, one row per યુવક per day |

---

## 0. What exists today, honestly

This is not a greenfield build. The authorisation model here is already unusually complete,
and most of this plan is a *controlled reversal of one decision* rather than new machinery.

**What is already right and is not being touched:**

- `public.has_permission(text)` is called from **122 RLS policy expressions** across the
  schema. It is the security boundary and it stays exactly as it is, signature included.
  Every change below is made *behind* that function so no policy has to be re-issued.
- `public.admins` (0038) keys off `auth.users`, so an administrator needs no યુવક profile.
- `admins_guard()` refuses self-appointment, self-promotion, and SUPER_ADMIN grants from
  anyone who is not one. Eight refusal messages that `scripts/test-rls.mjs` asserts verbatim.
- `admins_no_delete()` — suspend, never delete — applies to `service_role` too.
- `audit_admin()` writes the trail from inside the transaction, from `auth.uid()`, so the
  client cannot attribute a change to somebody else.
- `bootstrap_admins` (0024) is the lockout fallback, RLS-on with no policy at all, and
  unreachable from any panel action. It stays unreachable.
- 0039 hoisted every policy call into `(select has_permission(…))`, which makes it an
  InitPlan — evaluated **once per query**, not once per row. This is what makes the change
  in §2 affordable at all.

**What is actually missing, and is what this plan builds:**

| Gap | Consequence today |
|---|---|
| The role→permission matrix is hardcoded in `permissions_for()` and mirrored in `shared/domain/permissions.js` | Giving one person one extra ability needs a migration and a deploy |
| Roles are a Postgres `enum` of five fixed values | A new role cannot exist without `ALTER TYPE` |
| No per-person exceptions | "This one coordinator may also replace images" is unrepresentable |
| Permissions are coarse (18 of them) | `settings.read` opens Levels, Level 4, Video, Navigation, Point Management **and** Settings. There is no way to grant Video without granting the point engine |
| No data scoping | Anyone with `users.read` sees all ~2,000 યુવકો in every zone |
| No login tracking for યુવકો anywhere | "How many logged in today" is unanswerable; the dashboard shows 7-day and 30-day registration counts and nothing about today |
| No self-service view of one's own access | An administrator cannot see what he is allowed to do, only discover it by hitting a locked door |

---

## 1. The one decision being reversed, and the safeguard that replaces it

`supabase/migrations/0004_rbac.sql` argues explicitly for the matrix being a function and
not a table:

> The matrix could be a `role_permissions` table, and it would be editable from the panel.
> It is a function instead… a row is data, and data has a write path. Changing who may do
> what should require a migration and a deploy, not an UPDATE.

That argument is sound and it is being overruled deliberately, because the requirement is
now precisely the thing it forbids: the સંચાલક must be able to hand out access himself,
without a developer.

**The safeguard that makes the reversal safe is to split the sentence in two.** What
becomes data is the *binding* — which role holds which permission. What stays code is the
*catalogue* — which permissions exist at all.

```
  permissions          (catalogue)   written ONLY by a migration.  Insert/update/delete
                                     refused for every client role including service_role.
  admin_roles          (bindings)    created and edited from the panel.
  role_permissions     (bindings)    created and edited from the panel.
  admin_grants         (bindings)    per-person exceptions, edited from the panel.
```

A permission name only means something because some RLS policy or SECURITY DEFINER
function checks it. A panel that could invent `users.delete` would render a tick box that
grants nothing and promises everything — the exact failure `shared/domain/permissions.js`
warns about in its header. So the catalogue is append-only from migrations, and
`role_permissions` carries a foreign key to it. **You can hand out any permission that
exists. You cannot invent one.**

Second safeguard: **no administrator may grant what he does not himself hold.** Enforced in
a `BEFORE` trigger, not a policy, so it binds `service_role` as well.

Third: **the escalation floor.** There is always at least one ACTIVE SUPER_ADMIN, the
SUPER_ADMIN role is `is_system` and its permission set is not editable, and `bootstrap_admins`
remains the sealed recovery path no panel action can reach.

---

## 2. Migration 0043 — dynamic roles and the permission catalogue

### 2.1 Retiring the enum

`admins.role` is `public.admin_role`, an enum. Dynamic roles cannot be an enum: `ALTER TYPE
… ADD VALUE` cannot run inside a transaction block alongside the rest of a migration, and
an enum value can never be removed.

`admins.role` becomes `text` with a foreign key to `admin_roles.key`:

```sql
alter table public.admins alter column role type text using role::text;
alter table public.admins add constraint admins_role_fkey
  foreign key (role) references public.admin_roles (key);
```

`public.effective_role()` changes its return type from `admin_role` to `text`. This is safe
and it is worth stating why, because it looks alarming:

- **Postgres does not record function→function calls in `pg_depend`.** `has_permission()`
  calls `effective_role()`, but dropping `effective_role()` does not cascade to it, and
  therefore does not cascade to the 122 policies. Only `has_permission(text)` is depended
  on by policies, and its signature does not change.
- Every existing caller writes `public.effective_role()::text` (0010, 0012, 0033, 0040) —
  `text::text` is a no-op.
- The client calls it over RPC (`admin/src/lib/adminAuth.jsx:86`, `src/lib/auth.jsx:293`)
  and receives a JSON string either way. **No client change is required for this step.**
- One plpgsql variable is typed `public.admin_role` (`admins_guard()`); that function is
  re-issued in this migration anyway.

The `admin_role` type itself is left in place, unused, rather than dropped. Dropping it is
a separate, later, zero-risk migration once nothing references it.

### 2.2 The tables

```sql
create table public.permissions (
  key         text primary key,          -- 'darshan.image.replace'
  resource    text not null,             -- 'darshan'      — how the UI groups them
  verb        text not null,             -- 'image.replace'
  label       text not null,             -- 'Replace a દ્રશ્ય image'
  description text not null,             -- what it actually allows, in one sentence
  -- Marks a permission that alone opens a section of the panel, so the UI can warn
  -- "removing this hides Point Management from him entirely".
  is_section  boolean not null default false,
  sort        integer not null default 0
);
```

RLS on, `select` granted to `authenticated`, and **a `BEFORE INSERT OR UPDATE OR DELETE`
trigger that raises unless `auth.uid()` is null** — so a migration writes it and nothing
else can, `service_role` included. This is the invariant the whole design rests on.

```sql
create table public.admin_roles (
  key         text primary key check (key ~ '^[A-Z][A-Z0-9_]{2,31}$'),
  label       text not null,
  description text not null default '',
  -- The five roles this schema shipped with. A system role may be *read* and its members
  -- listed; it may not be renamed, deleted, or (for SUPER_ADMIN) have its permissions edited.
  is_system   boolean not null default false,
  -- The rank that decides who may administer whom. SUPER_ADMIN is 100.
  rank        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id)
);

create table public.role_permissions (
  role_key   text not null references public.admin_roles (key) on delete cascade,
  permission text not null references public.permissions (key),
  primary key (role_key, permission)
);

create table public.admin_grants (
  admin_id   uuid not null references public.admins (id) on delete cascade,
  permission text not null references public.permissions (key),
  -- 'ALLOW' adds a permission the role does not carry. 'DENY' removes one it does.
  -- DENY wins over ALLOW wins over the role. See §2.4.
  effect     text not null check (effect in ('ALLOW', 'DENY')),
  reason     text not null default '',   -- required by the UI; why this person is an exception
  expires_at timestamptz,                -- optional; a temporary grant that expires by itself
  granted_by uuid references auth.users (id),
  granted_at timestamptz not null default now(),
  primary key (admin_id, permission)
);
```

`expires_at` is the small feature that prevents the large problem. Every access-control
system that has only permanent grants accumulates them: someone needs Level 4 editing for
one week in ઉત્સવ season and holds it for three years. A grant with an expiry is a grant
that cleans itself up.

### 2.3 The catalogue itself — from 18 permissions to ~40

The existing 18 stay, with their exact spellings, so **every current policy keeps working
unchanged**. What is added is the granularity the requirement asks for. Grouped as the UI
will group them:

| Resource | Permissions |
|---|---|
| **યુવક** | `users.read` · `users.update` · `users.disable` · `users.test` · `users.purge` · `users.export` |
| **Progress** | `progress.read` · `progress.detail.read` · `progress.export` · `sessions.read` |
| **દર્શન** | `darshan.read` · `darshan.create` · `darshan.update` · `darshan.disable` · `darshan.image.replace` · `darshan.reorder` · `darshan.import` |
| **ગુણ** | `points.read` · `points.ledger.read` · `points.daily.read` · `points.records.read` · `points.level3.read` · `points.leaderboard.read` · `points.config.update` · `points.bonus.update` · `points.adjust` |
| **લેવલ** | `levels.read` · `levels.update` · `level4.read` · `level4.update` |
| **App** | `settings.read` · `settings.update` · `video.update` · `navigation.update` · `appicon.update` · `dhun.update` |
| **Access** | `admins.read` · `admins.create` · `admins.update` · `admins.disable` · `roles.assign` · `roles.manage` · `grants.manage` · `scope.assign` |
| **Trail** | `audit.read` · `audit.export` |

Four notes on why these particular splits:

- `darshan.image.replace` is separate from `darshan.update` because replacing an image is
  the one દર્શન edit that is **irreversible from the panel** and that ~2,000 phones will
  see. Editing a વર્ણન and replacing a દ્રશ્ય are not the same act.
- `points.adjust` (manual award) is separate from `points.config.update` (rule change).
  One hands a named person points; the other reprices the whole system. The second is far
  more dangerous and the first is far more often needed.
- `points.*.read` splits the five reporting screens that all sat behind `progress.read`, so
  "he may see the leaderboard but not the ledger" becomes expressible.
- The six `*.update` app permissions split `settings.update`, which currently grants Video,
  Navigation, App Icon, ધૂન, Gallery and Session in one tick.

**Backward compatibility is a hard requirement of this migration.** Every new permission is
inserted into `role_permissions` for exactly the roles that already had the coarse
permission it was split out of, so no administrator gains or loses anything on the day this
ships. The migration prints a before/after permission count per role in a `raise notice`
block, in the style of 0038 and 0040.

The DB functions behind the split screens (`admin_point_transactions`,
`admin_leaderboard`, `admin_level3_report`, …) currently assert `progress.read` via
`admin_assert_progress_reader()`. Each is re-issued to assert its own new permission
**or** `progress.read`, so the coarse permission keeps working while the fine one becomes
available.

### 2.4 Resolution — how the effective set is computed

```sql
create or replace function public.caller_permissions()
returns text[]
language sql stable security definer set search_path = public
as $$
  with base as (
    select rp.permission
    from public.admins a
    join public.role_permissions rp on rp.role_key = a.role
    where a.id = auth.uid() and a.status = 'ACTIVE'
  ),
  granted as (
    select g.permission, g.effect
    from public.admin_grants g
    join public.admins a on a.id = g.admin_id
    where g.admin_id = auth.uid() and a.status = 'ACTIVE'
      and (g.expires_at is null or g.expires_at > now())
  ),
  resolved as (
    select permission from base
    union
    select permission from granted where effect = 'ALLOW'
    except
    select permission from granted where effect = 'DENY'
  )
  select coalesce(
    -- The bootstrap fallback resolves to the whole catalogue, exactly as SUPER_ADMIN did
    -- before. It is read first and short-circuits, so a broken admin_grants row cannot
    -- lock out the founding accounts. This is 0024's guarantee, unchanged.
    (select array_agg(key) from public.permissions
      where exists (select 1 from public.bootstrap_admins b where b.id = auth.uid())),
    (select array_agg(permission) from resolved),
    array[]::text[]
  );
$$;

create or replace function public.has_permission(perm text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(perm = any(public.caller_permissions()), false);
$$;
```

`has_permission(text)` keeps its exact signature, so **not one of the 122 policies is
touched.**

DENY beating ALLOW beating the role is the only ordering that lets a DENY mean anything.
The UI states it in those words on the override screen.

### 2.5 Performance

This is the real cost of the change and it is worth being precise about, because
`has_permission()` runs on every query against every governed table.

- Before: `permissions_for()` was `immutable` over an enum — no table access at all.
- After: `caller_permissions()` reads four tables.

Three things keep it affordable:

1. **0039 already hoisted every policy call into `(select has_permission(…))`.** Postgres
   evaluates a correlated-free scalar subquery in a qual once per query as an InitPlan.
   A 2,000-row scan of `profiles` calls this **once**, not 2,000 times. This is the load-bearing
   mitigation, and it is already in place — which is why this plan is affordable now and
   would not have been before 0039.
2. `caller_permissions()` is `stable`, so within one statement Postgres may reuse it.
3. Indexes: `role_permissions (role_key)` is the primary key's leading column;
   `admin_grants (admin_id)` likewise; `admins (id)` is the primary key. Every read is an
   index lookup on a table with tens to low hundreds of rows.

**Verification, not assertion:** `scripts/test-rbac-perf.mjs` (new) runs the ten heaviest
admin reports against a seeded 2,000-user database with `EXPLAIN (ANALYZE, BUFFERS)` before
and after, and fails if any query's planning or execution time regresses by more than 20%.
If it does regress, the fallback is a per-session cache: resolve once into a temp structure
keyed by `auth.uid()`. That is not built now because an unmeasured optimisation is how the
duplication this codebase keeps warning about gets introduced.

### 2.6 The guards

A new `role_permissions_guard()` and `admin_grants_guard()`, written in the same shape and
with the same message discipline as `admins_guard()` — verbatim strings, asserted by tests,
matched by `adminService.js` to word each refusal for the person who hit it.

| Rule | Message |
|---|---|
| Cannot grant a permission you do not hold | `you cannot grant a permission you do not hold yourself` |
| Cannot edit your own role, status, grants or scope | `an administrator cannot change their own access` |
| Cannot edit a role at or above your own rank | `you cannot change a role equal to or above your own` |
| SUPER_ADMIN's permission set is fixed | `the SUPER_ADMIN role always holds every permission` |
| A system role cannot be renamed or deleted | `a built-in role cannot be renamed or deleted` |
| A role with members cannot be deleted | `move the N administrator(s) holding this role before deleting it` |
| The last SUPER_ADMIN cannot be demoted or disabled | `there must always be one active Super Admin` |
| `grants.manage` is required for an override | `not permitted to grant individual permissions` |

Every one of these is a `BEFORE` trigger and not only a policy, for the reason 0004 gives:
a policy sees the new row, not the old one's rank, and does not bind `service_role`.

Audit: `audit_role_permission()` and `audit_grant()` write `ROLE_CREATED`,
`ROLE_PERMISSION_GRANTED`, `ROLE_PERMISSION_REVOKED`, `GRANT_ADDED`, `GRANT_REMOVED`,
`GRANT_EXPIRED`, `SCOPE_CHANGED` into the existing `audit_logs` with before/after JSON.
New action names are added to `shared/domain/audit.js`.

---

## 3. Migration 0044 — zone scope

`profiles.sub_zone_id` is `not null check (sub_zone_id in ('vedroad','varachha','navsari'))`
and `zone_id` defaults to `'surat'`. So scoping is a small, closed set — this is much easier
than it would be with free-text zones.

```sql
create table public.admin_scopes (
  admin_id    uuid not null references public.admins (id) on delete cascade,
  sub_zone_id text not null,
  primary key (admin_id, sub_zone_id)
);
```

**No rows for an administrator means every zone.** Not "no zones" — an empty scope table has
to mean unrestricted, or every existing administrator would lose all data the moment this
migration applies.

```sql
create or replace function public.caller_scope()
returns text[] language sql stable security definer set search_path = public
as $$
  select nullif(array_agg(sub_zone_id), '{}')
  from public.admin_scopes where admin_id = auth.uid();
$$;   -- NULL means unrestricted

create or replace function public.in_caller_scope(zone text)
returns boolean language sql stable security definer set search_path = public
as $$ select public.caller_scope() is null or zone = any(public.caller_scope()); $$;
```

### How it reaches every report without twenty-four edits

0040 solved exactly this problem and its solution is reused rather than reinvented. That
migration needed `and not is_test` in twenty-four reporting functions, refused to write it
twenty-four times, and instead gave the population a name — `counted_profiles` — then
re-issued the nine functions that *enumerate* a population to read the view instead of the
table.

The same move here:

```sql
create or replace view public.scoped_yuvaks with (security_invoker = on) as
  select v.* from public.yuvaks v where public.in_caller_scope(v.sub_zone_id);
```

and the nine enumerating functions are re-issued to read `scoped_yuvaks`. They are
identified the same way 0040 identified them — by searching `pg_get_functiondef` for reads
of the population view — and re-issued **generated from their live definitions with one
token changed**, so nothing else drifts while being copied.

The functions that resolve *one named person* (`admin_user_progress_detail`,
`admin_daily_record_detail`, `admin_award_manual_points`, `actor_names`, …) each get an
explicit scope check at the top that raises `42501` rather than returning empty — because a
scoped administrator who types another zone's user id into a URL must be told no, not shown
a blank page. This is the same argument `RequirePermission.jsx` makes: a refusal should be
stated, not mimed.

`profiles` RLS is tightened in the same migration:

```sql
create policy "own profile readable" on public.profiles
  for select using (
    id = (select auth.uid())
    or ((select public.has_permission('users.read')) and public.in_caller_scope(sub_zone_id))
  );
```

`in_caller_scope` is left un-hoisted here on purpose: it is per-row by nature, and
`caller_scope()` inside it is the `stable` call that gets cached.

**Test:** `scripts/test-scope.mjs` seeds three administrators — unrestricted, વરાછા-only,
and વરાછા+નવસારી — and asserts every reporting function returns disjoint, correct
populations for each, and that a cross-zone detail lookup raises rather than returning null.

---

## 4. Migration 0045 — "what happened today"

Nothing in this schema records that a યુવક opened the app. `point_transactions` and
`daily_activity_progress` record that he *did something*, which is not the same question —
a person who opens the app, looks at the leaderboard and closes it is invisible.

```sql
create table public.user_activity_daily (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  day        date not null,              -- IST, via the existing todayIST() convention
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  opens      integer not null default 1,
  primary key (user_id, day)
);
create index user_activity_daily_day_idx on public.user_activity_daily (day desc);
```

One row per person per day, not per open. At ~2,000 યુવકો that is ~2,000 rows a day,
~730,000 a year — small, and the primary key makes the write an upsert that is idempotent
under the double-fire that a PWA regaining focus will certainly cause.

Written by `public.touch_activity()`, a SECURITY DEFINER function the યુવક app calls once
per foreground session (`src/lib/auth.jsx`, beside the existing session logic from 0042).
It writes `auth.uid()` and never an argument, so nobody can mark anybody else present.
Fire-and-forget on the client: a failed presence write must never block the app.

**Retention:** rows older than 400 days are deleted by the same function, at most once per
day, guarded by an advisory lock. A table that only grows is a table someone has to
remember, and nobody will.

Then the dashboard functions:

```sql
public.admin_today()          -- one row: logins, active yuvaks, new registrations,
                              -- points awarded, level completions, દર્શન viewed,
                              -- લેવલ ૩ revisions, admin logins — all for today IST
public.admin_activity_trend(p_days integer default 30)
                              -- one row per day for the sparklines
public.admin_feature_usage(p_days integer default 7)
                              -- which parts of the app were actually used
```

All three assert `progress.read` or `users.read` and apply `in_caller_scope()`, so a
વરાછા-scoped coordinator's dashboard shows વરાછા's numbers and says so on screen. A
dashboard tile that silently means something different for different people is worse than
no tile.

Admin logins come from `audit_logs` where `action = 'ADMIN_LOGIN'` — already written by
`AdminShell.jsx`, once per browser session, and never surfaced anywhere until now.

---

## 5. Migration 0046 — one Super Admin

Currently up to three accounts hold permanent SUPER_ADMIN through `bootstrap_admins`, plus
whatever `admins` rows exist. The decision is one SUPER_ADMIN; the others become ADMIN.

The migration:

1. Prints every account currently holding SUPER_ADMIN by either route — SMK, name, email,
   route — in a `raise notice` block, with the same ⚠ warning discipline as 0024.
2. Sets `role = 'ADMIN'` for every `admins` row that is SUPER_ADMIN and is **not** the
   designated account. `auth.uid()` is null in a migration, so `admins_guard()` stands
   aside, as it is designed to.
3. Leaves `bootstrap_admins` **completely untouched.** This matters and is worth being
   explicit about: the demoted founders keep their sealed break-glass recovery, because
   `caller_permissions()` reads `bootstrap_admins` first (§2.4). They will not see
   SUPER_ADMIN in the panel and will not hold `roles.assign` in normal operation — the
   `admins` row is what the panel reads — but they are not locked out of a project they
   founded if the single Super Admin loses his password. 0024 exists precisely so this
   recovery path cannot be revoked from a UI, and this migration does not revoke it.
4. Adds the invariant:

```sql
create unique index admins_one_super_admin
  on public.admins ((true)) where role = 'SUPER_ADMIN' and status = 'ACTIVE';
```

A partial unique index on a constant expression — at most one row can satisfy the
predicate. Combined with the "last SUPER_ADMIN cannot be demoted" trigger from §2.6, this
means the count is exactly one, always, enforced by the database rather than by care.

**Which account keeps it is a question for you, not a default.** The migration reads it from
a `\set` variable / an environment substitution and refuses to apply without one, rather
than guessing from `created_at`.

---

## 6. The panel

### 6.1 A new section: Access

`/access`, under **System** in `NAV_GROUPS`, gated on `admins.read`. Four tabs, using the
existing `Tabs.jsx` the way `/users` already does.

**Roles** — the list, with a member count per role and a rank. Create, duplicate ("start
from Coordinator and add two things" is how roles actually get made), rename, delete.
Editing a role opens the matrix: permissions grouped by resource, one checkbox each, with
the plain-English `description` beside it. Two things the grid does that a plain checkbox
grid does not:

- A permission that alone opens a section (`is_section`) is marked, and unticking it shows
  "This hides Point Management from N administrators."
- The header shows how many administrators are affected before you save, and the confirm
  dialog names them. Changing a role is a bulk action on people and should read like one.

**Administrators** — the existing `AdminsTab.jsx`, extended. Role becomes a dropdown fed
from `admin_roles` rather than the hardcoded five. New columns for zone scope and for
"has overrides". Row actions: change role, edit overrides, edit scope, suspend/disable.

**Permissions** — the catalogue, read-only, filterable, showing for each permission which
roles hold it and which individuals hold it by override. This is the "who can do X"
question, which is unanswerable in any per-person system that lacks this screen.

**Effective access** — pick an administrator and see exactly what he can do: the sidebar as
it renders for him, and every permission with its source labelled *from role* / *granted
individually* / *denied individually* / *from bootstrap*. This directly answers
"he can see what he can do". It is also the screen that makes the whole system debuggable —
"why can he not open Point Ledger" has a single place that answers it.

### 6.2 Per-admin overrides

A drawer on an administrator's row. The role's permissions are shown ticked and greyed;
ticking something outside them creates an `ALLOW`, unticking something inside creates a
`DENY`. Each override requires a `reason` — enforced by a `not null default ''` plus a
client-side required field, because a `reason` nobody fills in is a column of empty strings.
Optional expiry with quick presets (1 week / 1 month / 3 months / never).

### 6.3 The client-side permission source

`shared/domain/permissions.js` currently holds the matrix. It cannot any more — the matrix
is now in the database. What that file becomes:

- `PERMISSIONS` — the catalogue keys, still code-defined, still the UI's list. This half of
  the file is unchanged in kind.
- The `MATRIX` constant and `permissionsFor()` are **deleted**. Nothing can know a role's
  permissions without asking the server.
- `can(permissions, key)` changes signature from `(role, key)` to `(permissionSet, key)`.

`adminAuth.jsx` replaces its `supabase.rpc('effective_role')` call with a single
`supabase.rpc('admin_session')` that returns `{ role, roleLabel, permissions[], scope[],
isBootstrap }` in one round trip. This is the same one call the panel already makes, so
**startup cost is unchanged** — the whole reason 0004 gave for duplicating the matrix into
the bundle was avoiding a round trip that, it turns out, is already being made.

`can()` in the context then tests membership in the returned array. `AdminShell.jsx`'s NAV
filter and `RequirePermission.jsx` need no logic change at all — they call `can(need)`.

The NAV `need` values are re-pointed at the new fine-grained permissions so the sidebar
splits properly (Video under `video.update`-or-`settings.read`, Point Management under
`points.read`, and so on). `NAV.find(can)` still decides the landing page, so the list order
does not change — `AdminShell.jsx` warns at length that reordering it moves people's front
door, and that warning is respected.

**New test, replacing the old drift check:** `scripts/test-permission-catalogue.mjs` asserts
that every `need` in `NAV` exists in the `permissions` table, and that every permission
string appearing in any RLS policy or `has_permission()` call in `supabase/migrations/`
exists in the catalogue. This is a stronger guarantee than the matrix-drift check it
replaces: it catches a permission that is *enforced* but not *grantable*, which is the new
failure mode this design introduces.

### 6.4 Dashboard

A "Today" band above the existing tiles: logins, active યુવકો, new registrations, points
awarded, દર્શન completed, લેવલ ૪ attempts, admin logins — each with a 30-day sparkline from
`admin_activity_trend()`. Below it, a 7-day feature-usage list. The band states its scope in
words when the viewer is zone-restricted.

---

## 7. Order of work, and what is safe to ship alone

Each row is independently shippable and independently revertible. Nothing after 0043
depends on 0044 or 0045.

| # | Work | Depends on | Ships alone? |
|---|---|---|---|
| 1 | **0043** catalogue, dynamic roles, overrides, guards, audit | — | Yes. Panel keeps working on the old five roles because they are seeded as `is_system` rows with identical permission sets. |
| 2 | Panel: `/access` section, `admin_session()` RPC, `permissions.js` rewrite | 1 | Yes |
| 3 | **0044** zone scope + `scoped_yuvaks` + function re-issue | 1 | Yes — no scope rows means no behaviour change |
| 4 | Panel: scope editor, scope banner on reports | 3 | Yes |
| 5 | **0045** `user_activity_daily`, `touch_activity()`, today/trend functions | — | Yes |
| 6 | યુવક app: presence write | 5 | Yes |
| 7 | Panel: Today band + sparklines | 5 | Yes |
| 8 | **0046** single Super Admin | 1 | Yes, and should go **last** — it reduces authority, so everything above should be working first |

### Testing

Per the standing convention, migrations run against `postgres:16` in Docker with an
`auth.uid()` stub, on `VARNI_PGTEST_PORT=54833`.

New suites, added to `npm test`:

- `test-rbac-dynamic.mjs` — catalogue immutability (a `service_role` insert into
  `permissions` must fail), resolution order (DENY > ALLOW > role > bootstrap), expiry.
- `test-rbac-guards.mjs` — all eight refusal messages, verbatim, including the
  cannot-grant-what-you-lack rule and the one-Super-Admin index.
- `test-scope.mjs` — §3.
- `test-activity.mjs` — upsert idempotency, IST day boundary, retention.
- `test-permission-catalogue.mjs` — §6.3.
- `test-rbac-perf.mjs` — §2.5, non-blocking warning at first, blocking once a baseline exists.

`scripts/test-rls.mjs` and `scripts/test-admins.mjs` both assert guard messages verbatim and
build fixtures through the deprecated `admin_profiles` compatibility view. 0043 keeps that
view working; the fixtures are migrated to `public.admins` in a **separate commit** so the
suite that proves the new model is not the suite that was edited to pass against it — which
is the argument 0038 makes for keeping the view in the first place.

---

## 8. What this plan deliberately does not do

- **No MFA.** Worth having eventually; it is Supabase Auth configuration and a login-flow
  change, not an authorisation change, and folding it in here would double the surface.
- **No admin invitation flow.** `createAdmin()` sets a password directly through the
  server function today and that works. An invite link is nicer and is not access control.
- **No IP or device restrictions.** Asked for by nobody, and it is the class of control that
  locks out the person it was meant to protect.
- **No permission on individual યુવક records.** Zone scope covers the requirement. A
  hand-maintained per-person access list was considered and rejected in the decisions above —
  it needs maintaining forever as people register.
- **`admin_role` enum is not dropped.** Separate zero-risk migration once nothing refers to it.
- **`shared/domain/permissions.js`'s MATRIX is deleted, not deprecated.** A stale copy of a
  matrix that has moved to the database is worse than no copy: it would render a panel that
  disagrees with what the server enforces, in whichever direction is less obvious.
